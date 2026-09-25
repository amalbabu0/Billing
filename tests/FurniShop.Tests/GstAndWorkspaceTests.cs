using System.Data;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Infrastructure.Services;
using Xunit;
using static FurniShop.Tests.DbFixture;

namespace FurniShop.Tests;

public class GstUnitTests
{
    [Fact]
    public void Invoice_register_finds_gaps_within_each_series()
    {
        var gaps = GstService.FindGaps(new[] { "INV-2026-0001", "INV-2026-0002", "INV-2026-0005", "INV-2027-0001", "INV-2027-0002" });
        Assert.Equal(new[] { "INV-2026-0003", "INV-2026-0004" }, gaps);
        Assert.Empty(GstService.FindGaps(new[] { "INV-2026-0009", "INV-2026-0010", "INV-2026-0011" }));
    }
}

public class DebitNoteTests(DbFixture f) : IClassFixture<DbFixture>
{
    [DbFact]
    public async Task Debit_note_removes_stock_reduces_payable_and_is_reported_as_input_tax_reversal()
    {
        var v = await f.ProductAsync("DN-1", 30000, 20000, 0);
        var s = await f.App.Suppliers.SaveAsync(new Supplier { Name = "Mysore Woods", StateCode = "29", Gstin = "29AABCU9603R1Z" + Core.Validation.Validators.GstinCheckChar("29AABCU9603R1Z") });
        var pid = await f.App.Purchases.SaveAsync(new PurchaseInput
        {
            SupplierId = s, SupplierInvoiceNo = "MW/77", Complete = true,
            Lines = { new PurchaseLineInput { VariantId = v, Quantity = 4, UnitCost = 20000, GstRate = 18 } },
        });
        var purchase = await f.App.Purchases.GetAsync(pid);
        Assert.Equal(94400m, purchase.GrandTotal);

        // One damaged piece goes back from damaged stock, one good piece from sellable stock.
        await f.App.Inventory.AdjustAsync(new StockAdjustmentInput { VariantId = v, AdjustmentType = AdjustmentType.MarkDamaged, Quantity = 1, Reason = "Cracked top" });
        var item = purchase.Lines[0].Id;
        var (id, number) = await f.App.PurchaseReturns.CreateAsync(new PurchaseReturnInput
        {
            PurchaseId = pid, Reason = "Damaged in transit",
            Lines = { new PurchaseReturnLineInput { PurchaseItemId = item, Quantity = 1, FromDamaged = true }, new PurchaseReturnLineInput { PurchaseItemId = item, Quantity = 1 } },
        });
        Assert.StartsWith($"DN-{DateTime.Today.Year}-", number);

        var levels = await f.App.Inventory.LevelsAsync(v);
        Assert.Equal((2m, 0m), (levels.OnHand, levels.Damaged)); // 4 − 1 damaged moved out of sellable − 1 returned; damaged 1 − 1

        purchase = await f.App.Purchases.GetAsync(pid);
        Assert.Equal((47200m, 47200m), (purchase.ReturnedTotal, purchase.Balance));
        Assert.Equal(2m, purchase.Lines[0].ReturnedQty);
        var sup = await f.App.Suppliers.GetAsync(s);
        Assert.Equal(47200m, sup.Outstanding);
        var ledger = await f.App.Suppliers.LedgerAsync(s);
        Assert.Contains(ledger, l => l.DocType == "DEBIT_NOTE" && l.Debit == 47200m);
        Assert.Equal(47200m, ledger[^1].Balance);

        // Cannot return more than was bought, and the purchase can no longer be cancelled.
        await Assert.ThrowsAsync<ValidationException>(() => f.App.PurchaseReturns.CreateAsync(new PurchaseReturnInput
        {
            PurchaseId = pid, Reason = "x", Lines = { new PurchaseReturnLineInput { PurchaseItemId = item, Quantity = 3 } },
        }));
        await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.Purchases.CancelAsync(pid, "wrong"));

        // Paying the supplier only allocates the reduced balance.
        await f.App.Purchases.PayAsync(new SupplierPaymentInput { SupplierId = s, Amount = 47200, MethodCode = PaymentMethodCode.Bank, Reference = "NEFT9" });
        Assert.Equal("PAID", (await f.App.Purchases.GetAsync(pid)).PaymentState);

        var dash = await f.App.Gst.DashboardAsync(DateTime.Today.AddDays(-1), DateTime.Today);
        Assert.Equal(1, dash.DebitNotes.Count);
        Assert.Equal(7200m, dash.DebitNotes.Tax);
        Assert.Equal(dash.Purchases.Tax - 7200m, dash.InputTax);
        var notes = await f.App.Gst.DebitNotesAsync(new GstFilter { From = DateTime.Today, To = DateTime.Today });
        Assert.Equal((3600m, 3600m, 0m), (notes.Items[0].Cgst, notes.Items[0].Sgst, notes.Items[0].Igst));

        // The debit note is immutable.
        await Assert.ThrowsAnyAsync<Npgsql.PostgresException>(() => f.App.Db.ExecuteAsync("delete from purchase_returns where id = @id", new { id }));
    }
}

public class GstAndWorkspaceTests(DbFixture f) : IClassFixture<DbFixture>
{
    private async Task EnsureDemoAsync()
    {
        if (await f.App.Db.ScalarAsync<int>("select count(*) from invoices") == 0)
            await new Infrastructure.Database.DemoDataSeeder(f.App).SeedAsync();
    }

    [DbFact]
    public async Task Gst_views_reconcile_with_invoices_and_reports()
    {
        await EnsureDemoAsync();
        var from = DateTime.Today.AddDays(-60);
        var to = DateTime.Today;
        var dash = await f.App.Gst.DashboardAsync(from, to);

        var expected = await f.App.Db.QuerySingleOrDefaultAsync<(decimal Taxable, decimal Tax, int Count)>("""
            select coalesce(sum(taxable_total),0), coalesce(sum(cgst_total + sgst_total + igst_total),0), count(*)::int
            from invoices where status = 'FINAL' and invoice_date between @from and @to
            """, new { from, to });
        Assert.Equal(expected.Taxable, dash.Sales.Taxable);
        Assert.Equal(expected.Tax, dash.Sales.Tax);
        Assert.Equal(expected.Count, dash.B2b.Count + dash.B2c.Count);
        Assert.True(dash.B2b.Count > 0, "demo data has a GST-registered customer");
        Assert.True(dash.Sales.Igst > 0, "demo data has an inter-state sale");
        Assert.Equal(dash.OutputTax - dash.InputTax, dash.NetPosition);

        // Listing: totals over every page equal the dashboard; paging returns the requested size.
        var listing = await f.App.Gst.SalesAsync(new GstFilter { From = from, To = to, Status = InvoiceStatus.Final, PageSize = 5 });
        Assert.Equal(expected.Count, listing.TotalCount);
        Assert.Equal(dash.Sales.Tax, listing.Totals.Tax);
        Assert.True(listing.Items.Count <= 5);
        var b2b = await f.App.Gst.SalesAsync(new GstFilter { From = from, To = to, Type = "B2B" });
        Assert.All(b2b.Items, r => Assert.False(string.IsNullOrEmpty(r.CustomerGstin)));
        var igstOnly = await f.App.Gst.SalesAsync(new GstFilter { From = from, To = to, Status = InvoiceStatus.Final, StateCode = "33" });
        Assert.All(igstOnly.Items, r => Assert.True(r.Igst > 0 && r.Cgst == 0));
        var paid = await f.App.Gst.SalesAsync(new GstFilter { From = from, To = to, PaymentState = "PAID", PageSize = 500 });
        Assert.All(paid.Items, r => Assert.Equal("PAID", r.PaymentState));

        // Rate summary and HSN summary add up to the same tax.
        var rates = await f.App.Gst.RateSummaryAsync(from, to);
        Assert.Equal(dash.Sales.Tax, rates.Sum(r => r.TotalTax));
        var hsn = await f.App.Gst.HsnSummaryAsync(from, to);
        var charges = rates.Where(r => r.Rate is null).Sum(r => r.TotalTax);
        Assert.Equal(dash.Sales.Tax - charges, hsn.Sum(h => h.TotalTax));

        // Component ledgers split the totals exactly.
        var all = await f.App.Gst.TaxLedgerAsync(from, to);
        var parts = (await f.App.Gst.TaxLedgerAsync(from, to, "CGST")).Sum(r => r.Output)
                    + (await f.App.Gst.TaxLedgerAsync(from, to, "SGST")).Sum(r => r.Output)
                    + (await f.App.Gst.TaxLedgerAsync(from, to, "IGST")).Sum(r => r.Output);
        Assert.Equal(all.Sum(r => r.Output), parts);
        Assert.Equal(dash.Sales.Tax, all.Sum(r => r.Output));

        var credit = await f.App.Gst.CreditNotesAsync(new GstFilter { From = from, To = to });
        Assert.Equal(dash.CreditNotes.Tax, credit.Totals.Tax);

        var register = await f.App.Gst.RegisterAsync(from, to);
        Assert.Empty(register.Gaps);
        Assert.Equal(register.Rows.Count, register.Issued);

        var xlsx = await f.App.Gst.ExportWorkbookAsync(from, to);
        using var wb = new ClosedXML.Excel.XLWorkbook(new MemoryStream(xlsx));
        Assert.Contains(wb.Worksheets, w => w.Name == "B2B");
        Assert.Contains(wb.Worksheets, w => w.Name == "HSN");
    }

    [DbFact]
    public async Task Workspace_queries_power_dashboard_products_stock_pos_and_customer_timeline()
    {
        await EnsureDemoAsync();
        var o = await f.App.Workspace.OverviewAsync(DateTime.Today.AddDays(-29), DateTime.Today);
        Assert.Equal(30, o.Trend.Count);
        Assert.Equal(o.Sales.Value, o.Trend.Sum(t => t.Sales));
        Assert.Equal(o.Collection.Value, o.Trend.Sum(t => t.Collected));
        Assert.NotNull(o.Sales.Previous);
        Assert.NotEmpty(o.RecentInvoices);
        Assert.NotEmpty(o.Activity);
        var year = await f.App.Workspace.OverviewAsync(DateTime.Today.AddDays(-200), DateTime.Today);
        Assert.Equal("month", year.Granularity);

        var facets = await f.App.Workspace.ProductFacetsAsync();
        Assert.NotEmpty(facets.Categories);
        var all = await f.App.Workspace.ProductsAsync(new ProductFilter { PageSize = 200 });
        Assert.True(all.TotalCount > 5);
        var cat = facets.Categories.First(c => c.ProductCount > 0);
        var byCat = await f.App.Workspace.ProductsAsync(new ProductFilter { CategoryId = cat.Id, PageSize = 200 });
        Assert.All(byCat.Items, p => Assert.Equal(cat.Id, p.CategoryId));
        var cheap = await f.App.Workspace.ProductsAsync(new ProductFilter { MaxPrice = 20000, PageSize = 200 });
        Assert.All(cheap.Items, p => Assert.True(p.SellingPrice <= 20000));
        var out_ = await f.App.Workspace.ProductsAsync(new ProductFilter { Stock = "OUT", PageSize = 200 });
        Assert.All(out_.Items, p => Assert.Equal("OUT_OF_STOCK", p.StockState));
        var byPrice = await f.App.Workspace.ProductsAsync(new ProductFilter { SortBy = "price", SortDescending = true, PageSize = 200 });
        Assert.Equal(byPrice.Items.Select(p => p.SellingPrice).OrderByDescending(x => x), byPrice.Items.Select(p => p.SellingPrice));

        var source = all.Items.First(p => p.VariantCount > 1);
        var copyId = await f.App.Workspace.DuplicateProductAsync(source.Id);
        var copy = await f.App.Catalog.GetProductAsync(copyId);
        Assert.Equal("INACTIVE", copy.Status);
        Assert.Equal(source.VariantCount, copy.Variants.Count);
        Assert.All(copy.Variants, v => Assert.Equal(0m, v.OnHand));

        var variant = await f.App.Db.ScalarAsync<long>("select it.variant_id from invoice_items it join invoices i on i.id = it.invoice_id where i.status = 'FINAL' and it.variant_id is not null limit 1");
        var detail = await f.App.Workspace.StockDetailAsync(variant);
        Assert.NotEmpty(detail.Sales);
        Assert.NotEmpty(detail.Timeline);
        Assert.Equal(detail.Item.OnHand, detail.Timeline[0].OnHandAfter);

        Assert.True(await f.App.Workspace.ToggleFavoriteAsync(variant));
        Assert.Contains(await f.App.Workspace.FavoritesAsync(), i => i.VariantId == variant);
        Assert.False(await f.App.Workspace.ToggleFavoriteAsync(variant));
        Assert.NotEmpty(await f.App.Workspace.RecentAsync());

        var customer = await f.App.Db.ScalarAsync<long>("select customer_id from invoices where status = 'FINAL' group by customer_id order by count(*) desc limit 1");
        var timeline = await f.App.Workspace.CustomerTimelineAsync(customer);
        Assert.Contains(timeline, t => t.Kind == "INVOICE");
        Assert.Equal(timeline.OrderByDescending(t => t.At).Select(t => t.At), timeline.Select(t => t.At));
    }
}
