using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Infrastructure.Services;
using Xunit;

namespace FurniShop.Tests;

public class LocationAndProductionTests(DbFixture f) : IClassFixture<DbFixture>
{
    private async Task<decimal> AtAsync(long warehouseId, long variantId) =>
        await f.App.Db.ScalarAsync<decimal?>("select on_hand from warehouse_stock where warehouse_id = @warehouseId and variant_id = @variantId", new { warehouseId, variantId }) ?? 0;

    private async Task AssertLocationsSumAsync(long variantId)
    {
        var total = (await f.App.Inventory.LevelsAsync(variantId)).OnHand;
        var sum = await f.App.Db.ScalarAsync<decimal>("select coalesce(sum(on_hand), 0) from warehouse_stock where variant_id = @variantId", new { variantId });
        Assert.Equal(total, sum);
    }

    [DbFact]
    public async Task Transfers_move_stock_between_locations_without_double_counting()
    {
        var v = await f.ProductAsync("LOC-1", 20000, 12000, 10);
        var main = (await f.App.Locations.ListAsync()).Single(w => w.IsDefault).Id;
        var godown = await f.App.Locations.SaveAsync(new Warehouse { Code = "GDN", Name = "Peenya godown", Kind = "WAREHOUSE" });
        Assert.Equal(10m, await AtAsync(main, v));

        var t = await f.App.Locations.SaveTransferAsync(new TransferInput { FromWarehouseId = main, ToWarehouseId = godown, Lines = { new TransferLineInput { VariantId = v, Quantity = 6 } } });
        await f.App.Locations.DispatchAsync(t);
        // In transit: left the showroom, not yet in the godown, not sellable.
        Assert.Equal((4m, 0m), (await AtAsync(main, v), await AtAsync(godown, v)));
        Assert.Equal(4m, (await f.App.Inventory.LevelsAsync(v)).Available);
        var transit = await f.App.Locations.StockAsync(godown, v, null);
        Assert.Equal(6m, transit.Single().InTransit);
        await f.App.Locations.ReceiveAsync(t);
        Assert.Equal((4m, 6m), (await AtAsync(main, v), await AtAsync(godown, v)));
        Assert.Equal(10m, (await f.App.Inventory.LevelsAsync(v)).OnHand);

        // A transfer cannot take more than the source location holds.
        var t2 = await f.App.Locations.SaveTransferAsync(new TransferInput { FromWarehouseId = main, ToWarehouseId = godown, Lines = { new TransferLineInput { VariantId = v, Quantity = 5 } } });
        await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.Locations.DispatchAsync(t2));

        // A counter sale takes from the showroom first, then from the godown.
        var c = await f.CustomerAsync("Loc Customer", "9876511111");
        await f.App.Invoices.CheckoutAsync(new SalesDocumentInput { CustomerId = c, Lines = { await f.LineAsync(v, 5) } }, new[] { DbFixture.Pay(PaymentMethodCode.Cash, 100000) });
        Assert.Equal((0m, 5m), (await AtAsync(main, v), await AtAsync(godown, v)));
        await AssertLocationsSumAsync(v);

        // Purchases land in the chosen location; cancelling a dispatched transfer puts goods back.
        var s = await f.App.Suppliers.SaveAsync(new Supplier { Name = "Loc Supplier", StateCode = "29" });
        await f.App.Purchases.SaveAsync(new PurchaseInput { SupplierId = s, WarehouseId = godown, Complete = true, Lines = { new PurchaseLineInput { VariantId = v, Quantity = 3, UnitCost = 12000, GstRate = 18 } } });
        Assert.Equal(8m, await AtAsync(godown, v));
        var t3 = await f.App.Locations.SaveTransferAsync(new TransferInput { FromWarehouseId = godown, ToWarehouseId = main, Lines = { new TransferLineInput { VariantId = v, Quantity = 2 } } });
        await f.App.Locations.DispatchAsync(t3);
        await f.App.Locations.CancelTransferAsync(t3, "Truck not available");
        Assert.Equal(8m, await AtAsync(godown, v));
        await AssertLocationsSumAsync(v);

        // A location holding stock cannot be deactivated.
        await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.Locations.SaveAsync(new Warehouse { Id = godown, Code = "GDN", Name = "Peenya godown", Kind = "WAREHOUSE", IsActive = false }));
    }

    [DbFact]
    public async Task Bom_costs_a_product_and_production_consumes_materials_into_finished_stock()
    {
        var ply = await f.App.Production.SaveMaterialAsync(new RawMaterial { Name = "BWP plywood 18mm", Category = "Plywood", Unit = "sheet", CostPrice = 2400, OpeningStock = 10, MinStock = 2 });
        var hinge = await f.App.Production.SaveMaterialAsync(new RawMaterial { Name = "Soft-close hinge", Category = "Hardware", Unit = "piece", CostPrice = 150, OpeningStock = 20 });
        // Weighted average cost on receipt: (10 × 2400 + 10 × 2700) / 20 = 2550.
        await f.App.Production.StockAsync(new RawMaterialStockInput { RawMaterialId = ply, Type = "RECEIVE", Quantity = 10, UnitCost = 2700 });
        Assert.Equal(2550m, (await f.App.Production.MaterialAsync(ply)).CostPrice);

        var v = await f.ProductAsync("WRD-2D", 42000, 0, 0);
        await f.App.Production.SaveBomAsync(new Bom
        {
            VariantId = v, LabourCost = 6000, OtherCost = 1000,
            Lines = { new BomLine { RawMaterialId = ply, Quantity = 4, WastagePercent = 10 }, new BomLine { RawMaterialId = hinge, Quantity = 4 } },
        });
        var bom = await f.App.Production.BomAsync(v);
        Assert.Equal(4.4m, bom.Lines.Single(l => l.RawMaterialId == ply).GrossQuantity);
        Assert.Equal(4.4m * 2550 + 4 * 150, bom.MaterialCost);
        Assert.Equal(bom.MaterialCost + 7000, bom.TotalCost);

        // An order for 2 pulls BOM × 2 as its material plan.
        var po = await f.App.Production.SaveOrderAsync(new ProductionInput { VariantId = v, Quantity = 2 });
        var o = await f.App.Production.OrderAsync(po);
        Assert.Equal(8.8m, o.Materials.Single(m => m.RawMaterialId == ply).QuantityRequired);
        Assert.Equal(12000m, o.LabourCost);

        // Work cannot start before materials are issued.
        await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.Production.MoveAsync(po, ProductionStatus.Cutting, null));
        await f.App.Production.IssueAsync(po, new[] { new IssueInput { RawMaterialId = ply, Quantity = 8.8m }, new IssueInput { RawMaterialId = hinge, Quantity = 8 } });
        Assert.Equal(20m - 8.8m, (await f.App.Production.MaterialAsync(ply)).Stock);
        await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.Production.CompleteAsync(po, null)); // not through QC yet
        foreach (var s in new[] { ProductionStatus.Cutting, ProductionStatus.Assembly, ProductionStatus.Finishing, ProductionStatus.Qc })
            await f.App.Production.MoveAsync(po, s, null);
        await f.App.Production.CompleteAsync(po, "Passed QC");

        o = await f.App.Production.OrderAsync(po);
        Assert.Equal(ProductionStatus.Completed, o.Status);
        Assert.Equal(8.8m * 2550 + 8 * 150, o.MaterialCost);
        var levels = await f.App.Inventory.LevelsAsync(v);
        Assert.Equal(2m, levels.OnHand);
        var move = (await f.App.Inventory.MovementsAsync(new ListQuery { PageSize = 10 }, v)).Items.First();
        Assert.Equal(MovementType.ProductionIn, move.MovementType);
        Assert.Equal(Math.Round(o.TotalCost!.Value / 2, 2), move.UnitCost);

        // Raw material ledger is immutable.
        await Assert.ThrowsAnyAsync<Npgsql.PostgresException>(() => f.App.Db.ExecuteAsync("delete from raw_material_movements"));
    }

    [DbFact]
    public async Task Production_for_a_custom_order_drives_its_stages_and_cost_and_cancel_returns_materials()
    {
        var foam = await f.App.Production.SaveMaterialAsync(new RawMaterial { Name = "HR foam 40D", Category = "Foam", Unit = "sq.ft", CostPrice = 90, OpeningStock = 100 });
        var c = await f.CustomerAsync("Sofa Customer", "9876522222");
        var co = await f.App.CustomOrders.SaveAsync(new CustomOrder { CustomerId = c, ProductType = "L-shape sofa", EstimatedCost = 95000, GstRate = 18 });

        var po = await f.App.Production.SaveOrderAsync(new ProductionInput { CustomOrderId = co, LabourCost = 9000, Materials = new() { new ProductionMaterialInput { RawMaterialId = foam, QuantityRequired = 60 } } });
        Assert.Equal(CustomOrderStatus.Production, (await f.App.CustomOrders.GetAsync(co)).Status);
        await f.App.Production.IssueAsync(po, new[] { new IssueInput { RawMaterialId = foam, Quantity = 60 } });
        await f.App.Production.MoveAsync(po, ProductionStatus.Qc, null);
        await f.App.Production.CompleteAsync(po, null);
        var order = await f.App.CustomOrders.GetAsync(co);
        Assert.Equal(CustomOrderStatus.QualityCheck, order.Status);
        Assert.Equal(9000m + 60 * 90, order.ProductionCost);

        // Cancelling another order returns what was issued.
        var po2 = await f.App.Production.SaveOrderAsync(new ProductionInput { CustomOrderId = co, Description = "Extra cushions", Materials = new() { new ProductionMaterialInput { RawMaterialId = foam, QuantityRequired = 10 } } });
        await f.App.Production.IssueAsync(po2, new[] { new IssueInput { RawMaterialId = foam, Quantity = 10 } });
        Assert.Equal(30m, (await f.App.Production.MaterialAsync(foam)).Stock);
        await f.App.Production.CancelAsync(po2, "Customer changed mind");
        Assert.Equal(40m, (await f.App.Production.MaterialAsync(foam)).Stock);
        await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.Production.IssueAsync(po2, new[] { new IssueInput { RawMaterialId = foam, Quantity = 1 } }));
    }
}

public class ServiceCrmCashTests(DbFixture f) : IClassFixture<DbFixture>
{
    private async Task<long> WarrantyProductAsync(string code, int months)
    {
        var v = await f.ProductAsync(code, 30000, 18000, 5);
        var pid = await f.App.Db.ScalarAsync<long>("select product_id from product_variants where id = @v", new { v });
        await f.App.Db.ExecuteAsync("update products set warranty_months = @months, warranty_terms = 'Manufacturing defects only' where id = @pid", new { months, pid });
        return v;
    }

    [DbFact]
    public async Task Warranty_is_registered_on_sale_voided_on_cancel_and_service_outside_warranty_is_billed()
    {
        var v = await WarrantyProductAsync("WAR-BED", 24);
        var c = await f.CustomerAsync("Warranty Customer", "9876533333");
        var sale = await f.App.Invoices.CheckoutAsync(new SalesDocumentInput { CustomerId = c, Lines = { await f.LineAsync(v) } }, new[] { DbFixture.Pay(PaymentMethodCode.Cash, 30000) });
        var w = (await f.App.ServiceDesk.WarrantiesAsync(new ListQuery { CustomerId = c })).Items.Single();
        Assert.Equal(DateTime.Today.AddMonths(24).AddDays(-1), w.EndDate);
        Assert.Equal("ACTIVE", w.State);
        Assert.Equal("Manufacturing defects only", w.Terms);
        await f.App.ServiceDesk.UpdateWarrantyAsync(w.Id, "SN-7781", w.Terms);
        Assert.Equal("SN-7781", await f.App.Db.ScalarAsync<string>("select serial_no from invoice_items where id = @id", new { id = w.InvoiceItemId }));

        // Ticket against an active warranty: free repair, no invoice.
        var t1 = await f.App.ServiceDesk.SaveTicketAsync(new ServiceTicketInput { CustomerId = c, WarrantyId = w.Id, ProductName = w.ProductName, Issue = "Hydraulic lift stuck" });
        Assert.True((await f.App.ServiceDesk.TicketAsync(t1)).UnderWarranty);
        await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.ServiceDesk.CompleteAsync(t1, new ServiceCompleteInput { Resolution = "x" })); // no technician
        await f.App.ServiceDesk.AssignAsync(t1, DateTime.Today.AddDays(1), "Suresh", null);
        await f.App.ServiceDesk.MoveAsync(t1, ServiceStatus.Repair, null);
        Assert.Null(await f.App.ServiceDesk.CompleteAsync(t1, new ServiceCompleteInput { Resolution = "Replaced gas lift" }));

        // Out-of-warranty job with a charge → GST service invoice (SAC 998719), part-paid.
        var t2 = await f.App.ServiceDesk.SaveTicketAsync(new ServiceTicketInput { CustomerId = c, ProductName = "Old sofa", Issue = "Re-upholstery" });
        await f.App.ServiceDesk.AssignAsync(t2, DateTime.Today, "Imran", null);
        var bill = await f.App.ServiceDesk.CompleteAsync(t2, new ServiceCompleteInput { Resolution = "New fabric", ServiceCharge = 5900, Payments = { DbFixture.Pay(PaymentMethodCode.Upi, 2000, "U1") } });
        var inv = await f.App.Invoices.GetAsync(bill!.InvoiceId);
        Assert.Equal((5900m, 5000m, 900m), (inv.GrandTotal, inv.TaxableTotal, inv.CgstTotal + inv.SgstTotal));
        Assert.Equal(ServiceDeskService.ServiceHsn, inv.Lines.Single().HsnCode);
        Assert.Equal(3900m, inv.Balance);
        Assert.Equal(bill.InvoiceId, (await f.App.ServiceDesk.TicketAsync(t2)).ServiceInvoiceId);

        // Cancelling the sale voids its warranty.
        await f.App.Invoices.CancelAsync(sale.InvoiceId, "Wrong customer");
        Assert.Equal("VOID", (await f.App.ServiceDesk.WarrantyAsync(w.Id)).State);
    }

    [DbFact]
    public async Task Credit_limit_blocks_unless_an_authorised_user_gives_a_reason()
    {
        var v = await f.ProductAsync("CRD-1", 50000, 30000, 5);
        var c = await f.App.Customers.SaveAsync(new Customer { Name = "Credit Customer", Mobile = "9876544444", StateCode = "29", CreditLimit = 20000 });
        var doc = new SalesDocumentInput { CustomerId = c, Lines = { await f.LineAsync(v) } };
        var ex = await Assert.ThrowsAsync<CreditLimitException>(() => f.App.Invoices.CheckoutAsync(doc, new[] { DbFixture.Pay(PaymentMethodCode.Cash, 10000) }));
        Assert.True(ex.CanOverride); // admin holds credit.override
        Assert.Equal(40000m, ex.Outstanding);
        var ok = await f.App.Invoices.CheckoutAsync(doc, new[] { DbFixture.Pay(PaymentMethodCode.Cash, 10000) }, creditOverride: "Long-standing customer, cheque on Friday");
        Assert.Equal("Long-standing customer, cheque on Friday", await f.App.Db.ScalarAsync<string>("select credit_override_reason from invoices where id = @id", new { id = ok.InvoiceId }));
        // Within the limit no reason is needed.
        await f.App.Invoices.CheckoutAsync(new SalesDocumentInput { CustomerId = c, Lines = { await f.LineAsync(v) } }, new[] { DbFixture.Pay(PaymentMethodCode.Cash, 50000) });
    }

    [DbFact]
    public async Task Lead_moves_through_pipeline_and_converts_with_follow_ups()
    {
        var id = await f.App.Crm.SaveLeadAsync(new Lead { Name = "Priya Menon", Mobile = "98450 11122", Source = "Walk-in", InterestedProducts = "L-shape sofa, dining set", ExpectedValue = 120000, NextFollowUp = DateTime.Today });
        await Assert.ThrowsAsync<ValidationException>(() => f.App.Crm.SaveLeadAsync(new Lead { Name = "Dup", Mobile = "9845011122" }));
        var due = await f.App.Crm.FollowUpsAsync("today", mine: true);
        var fu = due.Single(x => x.RefType == "LEAD" && x.RefId == id);
        await f.App.Crm.CompleteFollowUpAsync(fu.Id, "Wants fabric samples", DateTime.Today.AddDays(3), "Share fabric catalogue");
        Assert.Equal(DateTime.Today.AddDays(3), (await f.App.Crm.LeadAsync(id)).NextFollowUp);

        await f.App.Crm.MoveLeadAsync(id, LeadStatus.Contacted, null);
        var customer = await f.App.Crm.ConvertAsync(id, keepOpen: true);
        var lead = await f.App.Crm.LeadAsync(id);
        Assert.Equal((LeadStatus.Quotation, customer), (lead.Status, lead.CustomerId));
        Assert.Equal("9845011122", (await f.App.Customers.GetAsync(customer)).Mobile);
        Assert.Equal(customer, await f.App.Crm.ConvertAsync(id)); // same customer, now converted
        Assert.Equal(LeadStatus.Converted, (await f.App.Crm.LeadAsync(id)).Status);
        await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.Crm.MoveLeadAsync(id, LeadStatus.Negotiation, null));

        var lost = await f.App.Crm.SaveLeadAsync(new Lead { Name = "Window shopper" });
        await Assert.ThrowsAsync<ValidationException>(() => f.App.Crm.MoveLeadAsync(lost, LeadStatus.Lost, null));
        await f.App.Crm.MoveLeadAsync(lost, LeadStatus.Lost, null, "Budget too low");
        Assert.Equal(LeadStatus.Lost, (await f.App.Crm.LeadAsync(lost)).Status);
    }

    [DbFact]
    public async Task Cash_register_expects_opening_plus_cash_flows_and_differences_need_approval()
    {
        var day = DateTime.Today;
        await f.App.Cash.OpenAsync(5000, day);
        await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.Cash.OpenAsync(5000, day));
        var before = (await f.App.Cash.DayAsync(day)).Figures; // other tests in this class also take cash today
        var v = await f.ProductAsync("CASH-1", 11800, 6000, 5);
        var c = await f.CustomerAsync("Cash Customer", "9876555555");
        await f.App.Invoices.CheckoutAsync(new SalesDocumentInput { CustomerId = c, Lines = { await f.LineAsync(v) } }, new[] { DbFixture.Pay(PaymentMethodCode.Cash, 8000), DbFixture.Pay(PaymentMethodCode.Upi, 3800, "U") });
        var cat = await f.App.Db.ScalarAsync<long>("select id from expense_categories order by id limit 1");
        await f.App.Expenses.SaveAsync(new Expense { CategoryId = cat, Amount = 500, MethodCode = PaymentMethodCode.Cash, ExpenseDate = day, Description = "Tea" });

        var d = await f.App.Cash.DayAsync(day);
        Assert.Equal((8000m, 500m, 3800m), (d.Figures.CashSales - before.CashSales, d.Figures.CashExpenses - before.CashExpenses, d.Figures.NonCash - before.NonCash));
        var expected = 5000 + before.Net + 7500;
        Assert.Equal(expected, d.Expected);

        await Assert.ThrowsAsync<ValidationException>(() => f.App.Cash.CloseAsync(day, expected - 200, null)); // difference needs a note
        var closed = await f.App.Cash.CloseAsync(day, expected - 200, "₹200 given as change, not recorded");
        Assert.Equal(("CLOSED", -200m), (closed.Status, closed.Difference!.Value));
        await f.App.Cash.ApproveAsync(day, "Accepted");
        Assert.Equal("APPROVED", (await f.App.Cash.DayAsync(day)).Session!.Status);
        Assert.Equal(expected - 200, (await f.App.Cash.DayAsync(day.AddDays(1))).SuggestedOpening);
    }
}

public class PricingImportLifecycleTests(DbFixture f) : IClassFixture<DbFixture>
{
    [DbFact]
    public async Task Group_discount_and_measured_rate_are_allowed_prices_for_sales_staff_and_commission_follows_salesperson()
    {
        var v = await f.ProductAsync("GRP-1", 10000, 6000, 10, discount: 5);
        var glass = await f.ProductAsync("GLASS-SQFT", 0, 0, 0, stockItem: false);
        var pid = await f.App.Db.ScalarAsync<long>("select product_id from product_variants where id = @glass", new { glass });
        var prod = await f.App.Catalog.GetProductAsync(pid);
        prod.Variants[0].PricingMode = "PER_SQFT"; prod.Variants[0].PricingRate = 450;
        await f.App.Catalog.SaveProductAsync(prod);
        Assert.Equal("PER_SQFT", (await f.App.Catalog.GetSellableAsync(glass))!.PricingMode);

        var roles = (await f.App.Users.RolesAsync()).ToDictionary(r => r.Code, r => r.Id);
        var sid = await f.App.Users.SaveAsync(new User { Username = "sales.grp", FullName = "Group Seller", RoleId = roles["SALES"], IsActive = true, CommissionPercent = 2 }, "Sales@2026");
        var dealer = await f.App.Customers.SaveAsync(new Customer { Name = "Dealer Co", Mobile = "9876566666", StateCode = "29", CustomerGroup = "DEALER" });
        var retail = await f.CustomerAsync("Retail Buyer", "9876577777");
        Assert.Equal(15m, (await f.App.Customers.GetAsync(dealer)).GroupDiscount);

        await using var staff = new FurniShop.Infrastructure.AppServices(f.ConnectionString);
        Assert.Equal(LoginOutcome.Success, (await staff.Auth.LoginAsync("sales.grp", "Sales@2026")).Outcome);
        LineInput Line(decimal disc) => new() { VariantId = v, Quantity = 1, UnitPrice = 10000, GstRate = 18, DiscountPercent = disc };
        // Retail: only the product's 5%. Dealer group: 15%.
        await Assert.ThrowsAsync<PermissionDeniedException>(() => staff.Invoices.SaveDraftAsync(new SalesDocumentInput { CustomerId = retail, Lines = { Line(15) } }));
        var sale = await staff.Invoices.CheckoutAsync(new SalesDocumentInput { CustomerId = dealer, Lines = { Line(15) } }, new[] { DbFixture.Pay(PaymentMethodCode.Cash, 8500) });
        Assert.Equal(sid, await f.App.Db.ScalarAsync<long?>("select salesperson_id from invoices where id = @id", new { id = sale.InvoiceId }));

        // Measured item: 6 ft × 3 ft = 18 sq.ft at ₹450 is fine; a lower rate is not.
        var ok = new LineInput { VariantId = glass, Description = "Toughened glass top (6 ft × 3 ft = 18 sq.ft)", Quantity = 18, UnitPrice = 450, GstRate = 18 };
        await staff.Invoices.SaveDraftAsync(new SalesDocumentInput { CustomerId = retail, Lines = { ok } });
        ok.UnitPrice = 300;
        await Assert.ThrowsAsync<PermissionDeniedException>(() => staff.Invoices.SaveDraftAsync(new SalesDocumentInput { CustomerId = retail, Lines = { ok } }));

        var report = await f.App.Reports.RunAsync("sales.commission", new ReportFilter { From = DateTime.Today, To = DateTime.Today });
        var row = report.Table.Rows.Cast<System.Data.DataRow>().Single(r => (string)r["Salesperson"] == "Group Seller");
        var net = await f.App.Db.ScalarAsync<decimal>("select taxable_total from invoices where id = @id", new { id = sale.InvoiceId });
        Assert.Equal(Math.Round(net * 0.02m, 2), (decimal)row["Commission"]);
    }

    [DbFact]
    public async Task Product_import_previews_validates_and_creates_or_updates_and_bulk_update_changes_prices()
    {
        await f.ProductAsync("IMP-OLD", 20000, 12000, 3);
        var csv = """
            Code,Name,Category,Brand,Selling price,GST %,Cost price,Opening stock,Warranty months,Price includes GST
            IMP-NEW,"Bookshelf, 5 tier",Storage,Nilkamal,"8,500",18,5000,4,12,Yes
            IMP-OLD,Renamed old product,Sofa,,21000,18,,2,,Yes
            IMP-BAD,,Storage,,abc,7,,,,
            IMP-NEW,Duplicate,Storage,,100,18,,,,
            """;
        var preview = await f.App.ProductImport.PreviewAsync(System.Text.Encoding.UTF8.GetBytes(csv), "products.csv");
        Assert.Equal(("CREATE", "UPDATE", "ERROR", "ERROR"), (preview.Rows[0].Action, preview.Rows[1].Action, preview.Rows[2].Action, preview.Rows[3].Action));
        Assert.Contains(preview.Rows[2].Errors, e => e.Contains("Name"));
        Assert.Contains(preview.Rows[2].Errors, e => e.Contains("GST 7%"));
        Assert.Contains(preview.Rows[1].Warnings, w => w.Contains("Opening stock is ignored"));
        Assert.Contains("Storage", preview.NewCategories);
        Assert.Equal(8500m, preview.Rows[0].SellingPrice);

        var result = await f.App.ProductImport.CommitAsync(preview.Rows);
        Assert.Equal((1, 1), (result.Created, result.Updated));
        var created = (await f.App.Catalog.SearchSellableAsync("IMP-NEW")).Single();
        Assert.Equal(("Bookshelf, 5 tier", 4m), (created.ProductName, created.OnHand));
        var old = (await f.App.Catalog.SearchSellableAsync("IMP-OLD")).Single();
        Assert.Equal(("Renamed old product", 21000m, 3m), (old.ProductName, old.SellingPrice, old.OnHand)); // stock untouched

        var n = await f.App.ProductImport.BulkUpdateAsync(new BulkProductUpdate { ProductIds = { created.ProductId, old.ProductId }, Action = "PRICE_PERCENT", Value = 10 });
        Assert.Equal(2, n);
        Assert.Equal(23100m, (await f.App.Catalog.GetSellableAsync(old.VariantId))!.SellingPrice);
        await Assert.ThrowsAsync<ValidationException>(() => f.App.ProductImport.BulkUpdateAsync(new BulkProductUpdate { ProductIds = { old.ProductId }, Action = "GST", Value = 7 }));
    }

    [DbFact]
    public async Task Order_360_follows_quotation_to_order_advance_invoice_delivery_and_warranty()
    {
        var v = await f.ProductAsync("L360-1", 30000, 18000, 5);
        var pid = await f.App.Db.ScalarAsync<long>("select product_id from product_variants where id = @v", new { v });
        await f.App.Db.ExecuteAsync("update products set warranty_months = 12 where id = @pid", new { pid });
        var c = await f.CustomerAsync("Lifecycle Customer", "9876588888");
        var q = await f.App.Quotations.SaveAsync(new SalesDocumentInput { CustomerId = c, Lines = { await f.LineAsync(v) }, RequiresDelivery = true });
        var so = await f.App.Quotations.ConvertToSalesOrderAsync(q, DateTime.Today.AddDays(7), true);
        await f.App.Payments.ReceiveAsync(new PaymentInput { CustomerId = c, DocType = DocType.SalesOrder, DocId = so, Lines = { DbFixture.Pay(PaymentMethodCode.Upi, 10000, "ADV") } });
        var inv = await f.App.SalesOrders.ConvertToInvoiceAsync(so, new[] { DbFixture.Pay(PaymentMethodCode.Cash, 20000) });

        foreach (var (kind, id) in new[] { ("QUOTATION", q), ("SALES_ORDER", so), ("INVOICE", inv.InvoiceId) })
        {
            var life = await f.App.Lifecycle.ForAsync(kind, id);
            Assert.Equal(c, life.CustomerId);
            var stages = life.Stages.ToDictionary(s => s.Key, s => s.State);
            Assert.Equal(("done", "done", "done", "done", "done"), (stages["QUOTATION"], stages["ORDER"], stages["ADVANCE"], stages["INVOICE"], stages["PAYMENT"]));
            Assert.Equal("done", stages["WARRANTY"]);
            Assert.Equal(0m, life.Balance);
            Assert.Equal(2, life.Documents["payments"].Count);
            Assert.Contains(life.Events, e => e.Kind == "INVOICE");
        }
    }
}
