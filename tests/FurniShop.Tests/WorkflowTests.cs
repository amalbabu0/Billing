using System.Data;
using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Core.Settings;
using FurniShop.Infrastructure.Services;
using Npgsql;
using Xunit;
using static FurniShop.Tests.DbFixture;

namespace FurniShop.Tests;

public class BillingWorkflowTests(DbFixture f) : IClassFixture<DbFixture>
{
    private static int _n;
    private static string Code(string p) => $"{p}-{Interlocked.Increment(ref _n)}";

    [DbFact]
    public async Task Cash_sale_decreases_stock_and_is_fully_paid()
    {
        var v = await f.ProductAsync(Code("WRD"), 45000, 32000, 5);
        var walkIn = await f.App.Customers.WalkInAsync();
        var r = await f.App.Invoices.CheckoutAsync(new SalesDocumentInput { CustomerId = walkIn.Id, Lines = { await f.LineAsync(v) } },
            new[] { Pay(PaymentMethodCode.Cash, 45000) });

        Assert.StartsWith($"INV-{DateTime.Today.Year}-", r.InvoiceNumber);
        var inv = await f.App.Invoices.GetAsync(r.InvoiceId);
        Assert.Equal(InvoiceStatus.Final, inv.Status);
        Assert.Equal(45000m, inv.GrandTotal);
        Assert.Equal(38135.59m, inv.TaxableTotal);
        Assert.Equal(0m, inv.Balance);
        Assert.Equal(32000m, inv.CostTotal);
        var levels = await f.App.Inventory.LevelsAsync(v);
        Assert.Equal(4m, levels.OnHand);
        var moves = await f.App.Inventory.MovementsAsync(new ListQuery(), v);
        Assert.Contains(moves.Items, m => m.MovementType == MovementType.SaleOut && m.RefNumber == r.InvoiceNumber && m.OnHandAfter == 4);
        var audit = await f.App.Audit.ForRecordAsync("invoice", r.InvoiceId);
        Assert.Contains(audit, a => a.Action == "FINALIZE");
    }

    [DbFact]
    public async Task Backup_reminder_is_raised_once_a_day_for_backup_admins()
    {
        await f.App.Notifications.GenerateDailyAsync();
        await f.App.Notifications.GenerateDailyAsync();
        var backups = (await f.App.Notifications.UnreadAsync(100)).Where(n => n.Kind == "BACKUP").ToList();
        Assert.Single(backups);
    }

    [DbFact]
    public async Task Credit_sale_needs_a_real_customer()
    {
        var v = await f.ProductAsync(Code("CHR"), 4200, 2600, 10);
        var walkIn = await f.App.Customers.WalkInAsync();
        var line = await f.LineAsync(v);
        var ex = await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.Invoices.CheckoutAsync(
            new SalesDocumentInput { CustomerId = walkIn.Id, Lines = { line } }, new[] { Pay(PaymentMethodCode.Cash, 1000) }));
        Assert.Contains("customer", ex.Message, StringComparison.OrdinalIgnoreCase);
        // Rolled back: no stock change, no invoice number consumed.
        Assert.Equal(10m, (await f.App.Inventory.LevelsAsync(v)).OnHand);
    }

    [DbFact]
    public async Task Mixed_payment_leaves_correct_balance_and_later_payments_clear_it()
    {
        // Invoice ₹80,000: cash 20k + UPI 30k + card 10k → balance 20k
        var v = await f.ProductAsync(Code("SOF"), 80000, 50000, 3);
        var c = await f.CustomerAsync("Rahul Mix", "9876500001");
        var r = await f.App.Invoices.CheckoutAsync(new SalesDocumentInput { CustomerId = c, Lines = { await f.LineAsync(v) } },
            new[] { Pay(PaymentMethodCode.Cash, 20000), Pay(PaymentMethodCode.Upi, 30000, "UPI123"), Pay(PaymentMethodCode.Card, 10000, "CARD1") });
        var inv = await f.App.Invoices.GetAsync(r.InvoiceId);
        Assert.Equal(60000m, inv.Paid);
        Assert.Equal(20000m, inv.Balance);
        Assert.NotNull(inv.DueDate);
        var receipt = await f.App.Payments.GetAsync(r.PaymentId!.Value);
        Assert.Equal(3, receipt.Lines.Count);

        var summary = await f.App.Customers.SummaryAsync(c);
        Assert.Equal(20000m, summary.Outstanding);

        // Payment without choosing an invoice → applied to oldest outstanding; excess held as advance
        await f.App.Payments.ReceiveAsync(new PaymentInput { CustomerId = c, Lines = { Pay(PaymentMethodCode.Upi, 25000, "UPI999") } });
        inv = await f.App.Invoices.GetAsync(r.InvoiceId);
        Assert.Equal(0m, inv.Balance);
        summary = await f.App.Customers.SummaryAsync(c);
        Assert.Equal(0m, summary.Outstanding);
        Assert.Equal(5000m, summary.AdvanceAmount);

        var ledger = await f.App.Customers.LedgerAsync(c);
        Assert.Equal(-5000m, ledger[^1].Balance); // shop holds ₹5,000 for the customer
    }

    [DbFact]
    public async Task Reserved_stock_is_not_available_and_is_consumed_by_the_order_invoice()
    {
        // 5 sofas, customer reserves 1 with advance → available 4, reserved 1
        var v = await f.ProductAsync(Code("SOFA"), 50000, 35000, 5);
        var c = await f.CustomerAsync("Reserving Customer", "9876500002");
        var so = await f.App.SalesOrders.SaveAsync(new SalesDocumentInput { CustomerId = c, Lines = { await f.LineAsync(v) }, RequiresDelivery = false });
        var res = await f.App.SalesOrders.ConfirmAsync(so);
        Assert.True(res.FullyReserved);
        var lv = await f.App.Inventory.LevelsAsync(v);
        Assert.Equal((5m, 1m, 4m), (lv.OnHand, lv.Reserved, lv.Available));

        // Selling 5 over the counter is impossible — one is reserved.
        var walkIn = await f.App.Customers.WalkInAsync();
        var five = await f.LineAsync(v, 5);
        await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.Invoices.CheckoutAsync(
            new SalesDocumentInput { CustomerId = walkIn.Id, Lines = { five } }, new[] { Pay(PaymentMethodCode.Cash, 250000) }));

        await f.App.Payments.ReceiveAsync(new PaymentInput { CustomerId = c, DocType = DocType.SalesOrder, DocId = so, Lines = { Pay(PaymentMethodCode.Cash, 20000) } });
        var inv = await f.App.SalesOrders.ConvertToInvoiceAsync(so, Array.Empty<PaymentLineInput>());
        lv = await f.App.Inventory.LevelsAsync(v);
        Assert.Equal((4m, 0m), (lv.OnHand, lv.Reserved));
        var invoice = await f.App.Invoices.GetAsync(inv.InvoiceId);
        Assert.Equal(20000m, invoice.Paid);     // advance moved to the invoice
        Assert.Equal(30000m, invoice.Balance);
        Assert.Equal(so, invoice.SalesOrderId);
        var order = await f.App.SalesOrders.GetAsync(so);
        Assert.Equal(inv.InvoiceId, order.InvoiceId);
        Assert.Equal(20000m, order.AdvancePaid);
    }

    [DbFact]
    public async Task Quotation_to_order_to_invoice_with_three_payments()
    {
        // Order value ₹75,000, advance ₹25,000 → balance ₹50,000 → two more payments of ₹25,000
        var v = await f.ProductAsync(Code("DIN"), 75000, 50000, 2);
        var c = await f.CustomerAsync("Quote Customer", "9876500003");
        var q = await f.App.Quotations.SaveAsync(new SalesDocumentInput { CustomerId = c, Lines = { await f.LineAsync(v) }, Notes = "Dining set" });
        var quote = await f.App.Quotations.GetAsync(q);
        Assert.Equal(75000m, quote.GrandTotal);
        var so = await f.App.Quotations.ConvertToSalesOrderAsync(q);
        quote = await f.App.Quotations.GetAsync(q);
        Assert.Equal(QuotationStatus.Converted, quote.Status);
        Assert.Equal(so, quote.SalesOrderId);
        var order = await f.App.SalesOrders.GetAsync(so);
        Assert.Equal(q, order.QuotationId);
        Assert.Equal(SalesOrderStatus.Confirmed, order.Status);
        Assert.Equal("Dining set", order.Notes);
        Assert.Equal(quote.Lines[0].Id, order.Lines[0].SourceItemId);

        await f.App.Payments.ReceiveAsync(new PaymentInput { CustomerId = c, DocType = DocType.SalesOrder, DocId = so, Lines = { Pay(PaymentMethodCode.Upi, 25000, "U1") } });
        order = await f.App.SalesOrders.GetAsync(so);
        Assert.Equal(50000m, order.Balance);

        var inv = await f.App.SalesOrders.ConvertToInvoiceAsync(so, new[] { Pay(PaymentMethodCode.Cash, 25000) });
        var invoice = await f.App.Invoices.GetAsync(inv.InvoiceId);
        Assert.Equal((75000m, 50000m, 25000m), (invoice.GrandTotal, invoice.Paid, invoice.Balance));
        Assert.Equal(q, invoice.QuotationId);

        await f.App.Payments.ReceiveAsync(new PaymentInput { CustomerId = c, DocType = DocType.SalesOrder, DocId = so, Lines = { Pay(PaymentMethodCode.Bank, 25000, "NEFT") } });
        invoice = await f.App.Invoices.GetAsync(inv.InvoiceId);
        Assert.Equal(0m, invoice.Balance);
        Assert.Equal(3, (await f.App.Payments.ForDocumentAsync(DocType.Invoice, inv.InvoiceId)).Count);
    }

    [DbFact]
    public async Task Negative_stock_blocked_unless_admin_enables_it()
    {
        var v = await f.ProductAsync(Code("NEG"), 1000, 500, 1);
        var walkIn = await f.App.Customers.WalkInAsync();
        var input = new SalesDocumentInput { CustomerId = walkIn.Id, Lines = { await f.LineAsync(v, 2) } };
        await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.Invoices.CheckoutAsync(input, new[] { Pay(PaymentMethodCode.Cash, 2000) }));

        await f.App.Settings.SaveAsync("inventory", new InventorySettings { AllowNegativeStock = true });
        try
        {
            await f.App.Invoices.CheckoutAsync(input, new[] { Pay(PaymentMethodCode.Cash, 2000) });
            Assert.Equal(-1m, (await f.App.Inventory.LevelsAsync(v)).OnHand);
        }
        finally
        {
            await f.App.Settings.SaveAsync("inventory", new InventorySettings { AllowNegativeStock = false });
        }
    }

    [DbFact]
    public async Task Returns_restock_by_condition_and_refund_is_limited_to_overpayment()
    {
        var good = await f.ProductAsync(Code("RET-G"), 10000, 6000, 3);
        var bad = await f.ProductAsync(Code("RET-B"), 20000, 12000, 3);
        var c = await f.CustomerAsync("Return Customer", "9876500004");
        var r = await f.App.Invoices.CheckoutAsync(new SalesDocumentInput { CustomerId = c, Lines = { await f.LineAsync(good), await f.LineAsync(bad) } },
            new[] { Pay(PaymentMethodCode.Cash, 30000) });
        var inv = await f.App.Invoices.GetAsync(r.InvoiceId);

        await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.Returns.CreateAsync(new ReturnInput
        {
            InvoiceId = inv.Id, Reason = ReturnReason.CustomerRequest, RefundAmount = 20000.01m,
            Lines = { new ReturnLineInput { InvoiceItemId = inv.Lines[1].Id, Quantity = 1, Condition = ItemCondition.Damaged } },
        }));

        await f.App.Returns.CreateAsync(new ReturnInput
        {
            InvoiceId = inv.Id, Reason = ReturnReason.Damaged, RefundAmount = 5000, RefundMethod = PaymentMethodCode.Cash,
            Lines =
            {
                new ReturnLineInput { InvoiceItemId = inv.Lines[0].Id, Quantity = 1, Condition = ItemCondition.Good },
                new ReturnLineInput { InvoiceItemId = inv.Lines[1].Id, Quantity = 1, Condition = ItemCondition.Damaged },
            },
        });
        Assert.Equal((3m, 0m), ((await f.App.Inventory.LevelsAsync(good)).OnHand, (await f.App.Inventory.LevelsAsync(good)).Damaged));
        var badLv = await f.App.Inventory.LevelsAsync(bad);
        Assert.Equal((2m, 1m), (badLv.OnHand, badLv.Damaged));

        inv = await f.App.Invoices.GetAsync(r.InvoiceId);
        Assert.Equal(30000m, inv.ReturnedAmount);
        Assert.Equal(0m, inv.Balance);
        // ₹5,000 refunded, remaining ₹25,000 held as advance
        Assert.Equal(25000m, (await f.App.Customers.SummaryAsync(c)).AdvanceAmount);
        Assert.Equal(2m, inv.Lines.Sum(l => l.ReturnedQty));
        await Assert.ThrowsAsync<ValidationException>(() => f.App.Returns.CreateAsync(new ReturnInput
        {
            InvoiceId = inv.Id, Lines = { new ReturnLineInput { InvoiceItemId = inv.Lines[0].Id, Quantity = 1 } },
        }));
    }

    [DbFact]
    public async Task Exchange_charges_only_the_difference()
    {
        // Old sofa ₹50,000 (paid) exchanged for new sofa ₹65,000 → customer pays ₹15,000
        var oldSofa = await f.ProductAsync(Code("OLD"), 50000, 30000, 2);
        var newSofa = await f.ProductAsync(Code("NEW"), 65000, 40000, 2);
        var c = await f.CustomerAsync("Exchange Customer", "9876500005");
        var r = await f.App.Invoices.CheckoutAsync(new SalesDocumentInput { CustomerId = c, Lines = { await f.LineAsync(oldSofa) } }, new[] { Pay(PaymentMethodCode.Upi, 50000, "U") });
        var inv = await f.App.Invoices.GetAsync(r.InvoiceId);

        var input = new ExchangeInput
        {
            OriginalInvoiceId = inv.Id,
            ReturnLines = { new ReturnLineInput { InvoiceItemId = inv.Lines[0].Id, Quantity = 1, Condition = ItemCondition.Good } },
            NewInvoice = new SalesDocumentInput { Lines = { await f.LineAsync(newSofa) } },
        };
        var preview = await f.App.Returns.PreviewExchangeAsync(input, 65000);
        Assert.Equal(15000m, preview.Difference);
        input.Payments.Add(Pay(PaymentMethodCode.Card, 15000, "C"));
        var ex = await f.App.Returns.ExchangeAsync(input);
        Assert.Equal((50000m, 65000m, 50000m, 15000m), (ex.OldValue, ex.NewValue, ex.TransferredAmount, ex.Difference));

        var newInv = await f.App.Invoices.GetAsync(ex.NewInvoiceId!.Value);
        Assert.Equal(0m, newInv.Balance);
        var oldInv = await f.App.Invoices.GetAsync(inv.Id);
        Assert.Equal(0m, oldInv.Balance);
        Assert.Equal(0m, oldInv.NetTotal);
        Assert.Equal(2m, (await f.App.Inventory.LevelsAsync(oldSofa)).OnHand);
        Assert.Equal(1m, (await f.App.Inventory.LevelsAsync(newSofa)).OnHand);
    }

    [DbFact]
    public async Task Cancelled_invoice_keeps_number_restores_stock_and_keeps_money_as_advance()
    {
        var v = await f.ProductAsync(Code("CAN"), 12000, 8000, 2);
        var c = await f.CustomerAsync("Cancel Customer", "9876500006");
        var r = await f.App.Invoices.CheckoutAsync(new SalesDocumentInput { CustomerId = c, Lines = { await f.LineAsync(v) } }, new[] { Pay(PaymentMethodCode.Cash, 5000) });
        await Assert.ThrowsAsync<ValidationException>(() => f.App.Invoices.CancelAsync(r.InvoiceId, " "));
        await f.App.Invoices.CancelAsync(r.InvoiceId, "Customer changed mind");
        var inv = await f.App.Invoices.GetAsync(r.InvoiceId);
        Assert.Equal(InvoiceStatus.Cancelled, inv.Status);
        Assert.Equal(r.InvoiceNumber, inv.Number);
        Assert.Equal(2m, (await f.App.Inventory.LevelsAsync(v)).OnHand);
        Assert.Equal(5000m, (await f.App.Customers.SummaryAsync(c)).AdvanceAmount);
        // finalised invoices cannot be deleted at database level either
        await Assert.ThrowsAsync<PostgresException>(() => f.App.Db.ExecuteAsync("delete from invoices where id = @id", new { id = r.InvoiceId }));
    }

    [DbFact]
    public async Task Payments_are_immutable_and_void_restores_balance()
    {
        var v = await f.ProductAsync(Code("VOID"), 10000, 5000, 2);
        var c = await f.CustomerAsync("Void Customer", "9876500007");
        var r = await f.App.Invoices.CheckoutAsync(new SalesDocumentInput { CustomerId = c, Lines = { await f.LineAsync(v) } }, new[] { Pay(PaymentMethodCode.Cash, 10000) });
        await Assert.ThrowsAsync<PostgresException>(() => f.App.Db.ExecuteAsync("update payments set amount = 1 where id = @id", new { id = r.PaymentId }));
        await Assert.ThrowsAsync<PostgresException>(() => f.App.Db.ExecuteAsync("delete from payments where id = @id", new { id = r.PaymentId }));
        await f.App.Payments.VoidAsync(r.PaymentId!.Value, "Entered twice");
        Assert.Equal(10000m, (await f.App.Invoices.GetAsync(r.InvoiceId)).Balance);
        await Assert.ThrowsAsync<PostgresException>(() => f.App.Db.ExecuteAsync("update audit_logs set summary = 'x'"));
    }

    [DbFact]
    public async Task Invoice_numbers_are_sequential_and_unique_under_concurrency()
    {
        var v = await f.ProductAsync(Code("SEQ"), 100, 50, 50);
        var walkIn = await f.App.Customers.WalkInAsync();
        var line = await f.LineAsync(v);
        var tasks = Enumerable.Range(0, 8).Select(_ => f.App.Invoices.CheckoutAsync(
            new SalesDocumentInput { CustomerId = walkIn.Id, Lines = { new LineInput { VariantId = v, Quantity = 1, UnitPrice = line.UnitPrice, GstRate = 18 } } },
            new[] { Pay(PaymentMethodCode.Cash, 100) }));
        var results = await Task.WhenAll(tasks);
        Assert.Equal(8, results.Select(x => x.InvoiceNumber).Distinct().Count());
        Assert.Equal(42m, (await f.App.Inventory.LevelsAsync(v)).OnHand);
    }
}

public class PurchaseAndOrderTests(DbFixture f) : IClassFixture<DbFixture>
{
    [DbFact]
    public async Task Purchase_adds_stock_updates_cost_and_supplier_ledger()
    {
        var v = await f.ProductAsync("PUR-1", 45000, 30000, 0);
        var s = await f.App.Suppliers.SaveAsync(new Supplier { Name = "Timber Co", StateCode = "29", Mobile = "9880000001" });
        var id = await f.App.Purchases.SaveAsync(new PurchaseInput
        {
            SupplierId = s, SupplierInvoiceNo = "TC/1", Complete = true, PaidNow = 150000, PaidMethod = PaymentMethodCode.Bank, PaidReference = "NEFT1",
            Lines = { new PurchaseLineInput { VariantId = v, Quantity = 5, UnitCost = 33898.31m, GstRate = 18 } },
        });
        var p = await f.App.Purchases.GetAsync(id);
        Assert.Equal(PurchaseStatus.Completed, p.Status);
        Assert.Equal(5m, (await f.App.Inventory.LevelsAsync(v)).OnHand);
        Assert.Equal(33898.31m, (await f.App.Catalog.GetSellableAsync(v))!.CostPrice);
        Assert.Equal(200000m, p.GrandTotal); // 5 × 33,898.31 = 1,69,491.55 + 18% = 2,00,000.03 → rounded
        var sup = await f.App.Suppliers.GetAsync(s);
        Assert.Equal((200000m, 150000m, 50000m), (sup.TotalPurchases, sup.TotalPaid, sup.Outstanding));
        var ledger = await f.App.Suppliers.LedgerAsync(s);
        Assert.Equal(50000m, ledger[^1].Balance);
        await Assert.ThrowsAsync<ValidationException>(() => f.App.Purchases.SaveAsync(new PurchaseInput
        {
            SupplierId = s, SupplierInvoiceNo = "TC/1", Lines = { new PurchaseLineInput { VariantId = v, Quantity = 1, UnitCost = 1, GstRate = 18 } },
        }));
    }

    [DbFact]
    public async Task Custom_order_flows_from_advance_to_delivery_and_completion()
    {
        var c = await f.CustomerAsync("Custom Customer", "9876500010");
        var id = await f.App.CustomOrders.SaveAsync(new CustomOrder
        {
            CustomerId = c, ProductType = "Wardrobe", Width = 8, Height = 7, Depth = 2, Material = "Teak", Finish = "Walnut", Doors = 4,
            EstimatedCost = 85000, GstRate = 18, RequiresInstallation = true, DeliveryAddress = "22 Residency Road",
        });
        await f.App.Payments.ReceiveAsync(new PaymentInput { CustomerId = c, DocType = DocType.CustomOrder, DocId = id, Lines = { Pay(PaymentMethodCode.Upi, 25000, "U") } });
        var o = await f.App.CustomOrders.GetAsync(id);
        Assert.Equal((25000m, 60000m), (o.AdvancePaid, o.Balance));

        await f.App.CustomOrders.AdvanceAsync(id); // production
        await f.App.CustomOrders.AdvanceAsync(id); // QC
        await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.CustomOrders.AdvanceAsync(id)); // final price missing
        o.FinalPrice = 85000;
        await f.App.CustomOrders.SaveAsync(o);
        Assert.Equal(CustomOrderStatus.Ready, await f.App.CustomOrders.AdvanceAsync(id));

        var inv = await f.App.CustomOrders.GenerateInvoiceAsync(id, new[] { Pay(PaymentMethodCode.Cash, 10000) });
        var invoice = await f.App.Invoices.GetAsync(inv.InvoiceId);
        Assert.Equal((85000m, 35000m, 50000m), (invoice.GrandTotal, invoice.Paid, invoice.Balance));

        var did = await f.App.Deliveries.CreateForCustomOrderAsync(id, DateTime.Today);
        Assert.Equal(CustomOrderStatus.Delivery, (await f.App.CustomOrders.GetAsync(id)).Status);
        var otp = await f.App.Deliveries.ScheduleAsync(did, DateTime.Today, "2-5 PM", "Ramesh", null, "KA01", 400);
        await f.App.Deliveries.DispatchAsync(did);
        // No proof → rejected; wrong OTP → rejected
        await Assert.ThrowsAsync<ValidationException>(() => f.App.Deliveries.CompleteAsync(new DeliveryCompletion { DeliveryId = did, ReceiverName = "Wife" }));
        await Assert.ThrowsAsync<ValidationException>(() => f.App.Deliveries.CompleteAsync(new DeliveryCompletion { DeliveryId = did, ReceiverName = "Wife", Otp = otp == "1234" ? "4321" : "1234" }));
        await f.App.Deliveries.CompleteAsync(new DeliveryCompletion { DeliveryId = did, ReceiverName = "Wife", Otp = otp });
        Assert.Equal(CustomOrderStatus.Installation, (await f.App.CustomOrders.GetAsync(id)).Status);

        var inst = (await f.App.Installations.ListAsync(new ListQuery())).Items.Single(i => i.CustomOrderId == id);
        await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.Installations.CompleteAsync(inst.Id, "done"));
        await f.App.Installations.ScheduleAsync(inst.Id, DateTime.Today, "Shivu", null, 300);
        await f.App.Installations.CompleteAsync(inst.Id, "Fitted");
        Assert.Equal(CustomOrderStatus.Completed, (await f.App.CustomOrders.GetAsync(id)).Status);
    }

    [DbFact]
    public async Task Sales_order_delivery_moves_order_to_completed()
    {
        var v = await f.ProductAsync("SOD-1", 30000, 20000, 3);
        var c = await f.CustomerAsync("Delivery Customer", "9876500011");
        var so = await f.App.SalesOrders.SaveAsync(new SalesDocumentInput { CustomerId = c, Lines = { await f.LineAsync(v) }, RequiresDelivery = true, DeliveryCharge = 500 });
        await f.App.SalesOrders.ConfirmAsync(so);
        await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.SalesOrders.ChangeStatusAsync(so, SalesOrderStatus.Delivered));
        var did = await f.App.Deliveries.CreateForSalesOrderAsync(so, DateTime.Today);
        await f.App.Deliveries.ScheduleAsync(did, DateTime.Today, null, "Ramesh", null, null, null);
        await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.Deliveries.DispatchAsync(did)); // not invoiced yet
        await f.App.SalesOrders.ConvertToInvoiceAsync(so, new[] { Pay(PaymentMethodCode.Upi, 30590, "U") });
        await f.App.Deliveries.DispatchAsync(did);
        Assert.Equal(SalesOrderStatus.Dispatched, (await f.App.SalesOrders.GetAsync(so)).Status);
        await f.App.Deliveries.CompleteAsync(new DeliveryCompletion { DeliveryId = did, ReceiverName = "Self", Remarks = "OK", SignaturePng = TinyPng });
        Assert.Equal(SalesOrderStatus.Completed, (await f.App.SalesOrders.GetAsync(so)).Status);
        var d = await f.App.Deliveries.GetAsync(did);
        Assert.NotNull(d.SignatureAttachmentId);
        Assert.NotNull(d.InvoiceId);
    }

    private static readonly byte[] TinyPng = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");
}

public class PermissionTests(DbFixture f) : IClassFixture<DbFixture>
{
    [DbFact]
    public async Task Sales_staff_cannot_see_cost_adjust_stock_or_over_discount()
    {
        var v = await f.ProductAsync("PERM-1", 10000, 7000, 5, discount: 5);
        var roles = (await f.App.Users.RolesAsync()).ToDictionary(r => r.Code, r => r.Id);
        await f.App.Users.SaveAsync(new User { Username = "sales.t", FullName = "Sales T", RoleId = roles["SALES"], IsActive = true }, "Sales@2026");
        var c = await f.CustomerAsync("Perm Customer", "9876500020");

        await using var staffApp = new FurniShop.Infrastructure.AppServices(f.ConnectionString);
        var login = await staffApp.Auth.LoginAsync("sales.t", "Sales@2026");
        Assert.Equal(LoginOutcome.Success, login.Outcome);
        Assert.True(login.MustChangePassword);

        var item = await staffApp.Catalog.GetSellableAsync(v);
        Assert.Null(item!.CostPrice);
        var product = await staffApp.Catalog.GetProductAsync((await f.App.Catalog.GetProductAsync(item.ProductId)).Id);
        Assert.Null(product.CostPrice);
        await Assert.ThrowsAsync<PermissionDeniedException>(() => staffApp.Inventory.AdjustAsync(new StockAdjustmentInput { VariantId = v, Quantity = 1, Reason = "x" }));
        await Assert.ThrowsAsync<PermissionDeniedException>(() => staffApp.Reports.RunAsync("profit.summary", new ReportFilter()));
        await Assert.ThrowsAsync<PermissionDeniedException>(() => staffApp.Payments.VoidAsync(1, "x"));

        // 5% allowed, 10% needs a manager
        var line = new LineInput { VariantId = v, Quantity = 1, UnitPrice = 10000, GstRate = 18, DiscountPercent = 10 };
        await Assert.ThrowsAsync<PermissionDeniedException>(() => staffApp.Invoices.SaveDraftAsync(new SalesDocumentInput { CustomerId = c, Lines = { line } }));
        line.DiscountPercent = 5;
        var draft = await staffApp.Invoices.SaveDraftAsync(new SalesDocumentInput { CustomerId = c, Lines = { line } });
        Assert.Null((await staffApp.Invoices.GetAsync(draft)).CostTotal);
        // A sales person cannot lower the price below the allowed discount by editing the rate either.
        line.DiscountPercent = 0; line.UnitPrice = 8000;
        await Assert.ThrowsAsync<PermissionDeniedException>(() => staffApp.Invoices.SaveDraftAsync(new SalesDocumentInput { CustomerId = c, Lines = { line } }));
    }

    [DbFact]
    public async Task Delivery_staff_only_sees_deliveries_and_lockout_after_failed_logins()
    {
        var roles = (await f.App.Users.RolesAsync()).ToDictionary(r => r.Code, r => r.Id);
        await f.App.Users.SaveAsync(new User { Username = "driver.t", FullName = "Driver", RoleId = roles["DELIVERY"], IsActive = true }, "Driver@2026");
        await using var d = new FurniShop.Infrastructure.AppServices(f.ConnectionString);
        for (var i = 0; i < 4; i++) Assert.Equal(LoginOutcome.InvalidCredentials, (await d.Auth.LoginAsync("driver.t", "wrong")).Outcome);
        Assert.Equal(LoginOutcome.LockedOut, (await d.Auth.LoginAsync("driver.t", "wrong")).Outcome);
        Assert.Equal(LoginOutcome.LockedOut, (await d.Auth.LoginAsync("driver.t", "Driver@2026")).Outcome);
        var uid = await f.App.Db.ScalarAsync<long>("select id from users where username = 'driver.t'");
        await f.App.Users.UnlockAsync(uid);
        Assert.Equal(LoginOutcome.Success, (await d.Auth.LoginAsync("driver.t", "Driver@2026")).Outcome);
        await d.Deliveries.ListAsync(new ListQuery());
        await Assert.ThrowsAsync<PermissionDeniedException>(() => d.Invoices.ListAsync(new ListQuery()));
        await Assert.ThrowsAsync<PermissionDeniedException>(() => d.Dashboard.LoadAsync());
        await Assert.ThrowsAsync<PermissionDeniedException>(() => d.Customers.SaveAsync(new Customer { Name = "x", Mobile = "9876500099" }));
    }
}

public class DemoDataAndReportTests(DbFixture f) : IClassFixture<DbFixture>
{
    [DbFact]
    public async Task Demo_data_loads_and_every_report_dashboard_search_and_document_works()
    {
        await new Infrastructure.Database.DemoDataSeeder(f.App).SeedAsync();

        // Stock can never be negative after the demo run (negative stock is off).
        Assert.Equal(0, await f.App.Db.ScalarAsync<int>("select count(*) from inventory where on_hand < 0 or reserved > on_hand"));
        // Every invoice balance is consistent: net − paid = balance, never negative.
        Assert.Equal(0, await f.App.Db.ScalarAsync<int>("select count(*) from v_invoice_balances where balance < 0"));
        // Stock on hand equals the sum of all movements.
        Assert.Equal(0, await f.App.Db.ScalarAsync<int>("""
            select count(*) from inventory i
            where i.on_hand <> coalesce((select sum(on_hand_delta) from inventory_movements m where m.variant_id = i.variant_id), 0)
               or i.reserved <> coalesce((select sum(reserved_delta) from inventory_movements m where m.variant_id = i.variant_id), 0)
            """));
        // Reserved quantities on orders match the inventory reservation.
        Assert.Equal(await f.App.Db.ScalarAsync<decimal>("select coalesce(sum(reserved),0) from inventory"),
            await f.App.Db.ScalarAsync<decimal>("select coalesce(sum(reserved_qty),0) from sales_order_items"));
        // Every payment is fully allocated.
        Assert.Equal(0, await f.App.Db.ScalarAsync<int>("select count(*) from payments p where p.amount <> (select sum(amount) from payment_allocations a where a.payment_id = p.id)"));
        Assert.Equal(0, await f.App.Db.ScalarAsync<int>("select count(*) from payments p where p.amount <> (select sum(amount) from payment_lines l where l.payment_id = p.id)"));

        var dash = await f.App.Dashboard.LoadAsync();
        Assert.True(dash.MonthSales > 0);
        Assert.True(dash.TodayInvoices > 0);
        Assert.Equal(30, dash.SalesLast30Days.Count);
        Assert.NotNull(dash.MonthGrossProfit);

        var filter = new ReportFilter { From = DateTime.Today.AddDays(-90), To = DateTime.Today, GroupBy = "month" };
        foreach (var def in ReportService.All)
        {
            var r = await f.App.Reports.RunAsync(def.Key, filter);
            Assert.True(r.Table.Columns.Count > 0, def.Key);
            var pdf = await f.App.Documents.ToPdfAsync(r.Table, def.Title, r.Subtitle, r.MoneyColumns, r.Totals);
            Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(pdf, 0, 4));
            Assert.NotEmpty(Infrastructure.Documents.DocumentService.ToExcel(r.Table, def.Title, r.Subtitle, r.MoneyColumns));
            Assert.NotEmpty(Infrastructure.Documents.DocumentService.ToCsv(r.Table));
        }
        // GST report totals agree with the invoice register.
        var gst = await f.App.Reports.RunAsync("gst.rate", filter);
        var register = await f.App.Reports.RunAsync("sales.register", filter);
        decimal Sum(System.Data.DataTable t, string col) => t.AsEnumerable().Sum(r => r.IsNull(col) ? 0m : (decimal)r[col]);
        Assert.Equal(Sum(register.Table, "Taxable"), Sum(gst.Table, "Taxable value"));
        Assert.Equal(Sum(register.Table, "CGST") + Sum(register.Table, "IGST"), Sum(gst.Table, "CGST") + Sum(gst.Table, "IGST"));

        var results = await f.App.Search.SearchAsync("Rahul");
        Assert.Contains(results, r => r.Kind == "Customer");
        Assert.Contains(await f.App.Search.SearchAsync("WRD-003"), r => r.Kind == "Product");

        var invoiceId = await f.App.Db.ScalarAsync<long>("select id from invoices where status = 'FINAL' order by grand_total desc limit 1");
        foreach (var pdf in new[]
                 {
                     await f.App.Documents.InvoicePdfAsync(invoiceId), await f.App.Documents.InvoicePdfAsync(invoiceId, thermal: true),
                     await f.App.Documents.QuotationPdfAsync(await f.App.Db.ScalarAsync<long>("select min(id) from quotations")),
                     await f.App.Documents.SalesOrderPdfAsync(await f.App.Db.ScalarAsync<long>("select min(id) from sales_orders")),
                     await f.App.Documents.ReceiptPdfAsync(await f.App.Db.ScalarAsync<long>("select min(id) from payments")),
                     Infrastructure.Documents.DocumentService.LabelsPdf(await f.App.Documents.LabelItemsAsync(new[] { (await f.App.Db.ScalarAsync<long>("select min(id) from product_variants"), 3) }), Infrastructure.Documents.LabelFormat.A4Sheet3x8, false),
                     Infrastructure.Documents.DocumentService.LabelsPdf(await f.App.Documents.LabelItemsAsync(new[] { (await f.App.Db.ScalarAsync<long>("select min(id) from product_variants"), 1) }), Infrastructure.Documents.LabelFormat.Roll50x25, true),
                 })
            Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(pdf, 0, 4));

        var (mobile, msg) = await f.App.Documents.InvoiceMessageAsync(invoiceId);
        Assert.Contains("Balance", msg);
        Assert.False(string.IsNullOrEmpty(mobile));

        var zip = await f.App.Backup.ExportDataAsync(Path.Combine(Path.GetTempPath(), "fs-export-test"));
        Assert.True(File.Exists(zip));
        File.Delete(zip);
    }
}
