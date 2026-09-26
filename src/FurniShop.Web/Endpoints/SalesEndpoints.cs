using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Infrastructure;
using FurniShop.Infrastructure.Services;

using FurniShop.Web.Hosting;

namespace FurniShop.Web.Endpoints;

public static partial class Api
{
    public sealed record CheckoutRequest(SalesDocumentInput Document, List<PaymentLineInput>? Payments, decimal UseAdvance, string? CreditOverride = null);
    public sealed record FinalizeRequest(List<PaymentLineInput>? Payments, decimal UseAdvance, string? CreditOverride = null);
    public sealed record ReasonRequest(string Reason);
    public sealed record StatusRequest(string Status, string? Note);
    public sealed record ConvertQuotationRequest(DateTime? ExpectedDelivery, bool Confirm = true);
    public sealed record ConvertOrderRequest(List<PaymentLineInput>? Payments, DateTime? DueDate);
    public sealed record ExchangePreviewRequest(ExchangeInput Input, decimal NewInvoiceTotal);

    private static void MapCustomers(RouteGroupBuilder api)
    {
        api.MapGet("/customers", async (QueryOf<ListQuery> lq, bool? outstanding, AppServices app) =>
            await app.Customers.ListAsync(lq.Value.Clamp(), outstanding == true));
        api.MapGet("/customers/search", async (string? q, AppServices app) => await app.Customers.SearchAsync(q, 12));
        api.MapGet("/customers/walk-in", async (AppServices app) => { app.Session.DemandAny(Perm.CustomerView, Perm.InvoiceCreate); return await app.Customers.WalkInAsync(); });
        api.MapGet("/customers/{id:long}", async (long id, AppServices app) => await app.Customers.GetAsync(id));
        api.MapGet("/customers/{id:long}/summary", async (long id, AppServices app) => await app.Customers.SummaryAsync(id));
        api.MapGet("/customers/{id:long}/ledger", async (long id, DateTime? from, DateTime? to, AppServices app) => await app.Customers.LedgerAsync(id, from, to));
        api.MapGet("/customers/{id:long}/timeline", async (long id, AppServices app) => await app.Workspace.CustomerTimelineAsync(id));
        api.MapGet("/customers/{id:long}/reminder", async (long id, AppServices app) =>
        {
            app.Session.Demand(Perm.CustomerView);
            var (mobile, message) = await app.Documents.OutstandingReminderAsync(id);
            return WhatsApp(await app.Settings.GetAsync(), mobile, message);
        });
        api.MapPost("/customers", async (Customer c, AppServices app) => { c.Id = 0; var id = await app.Customers.SaveAsync(c); return await app.Customers.GetAsync(id); });
        api.MapPut("/customers/{id:long}", async (long id, Customer c, AppServices app) => { c.Id = id; await app.Customers.SaveAsync(c); return await app.Customers.GetAsync(id); });
        api.MapDelete("/customers/{id:long}", async (long id, AppServices app) => { await app.Customers.DeleteAsync(id); return Results.NoContent(); });
    }

    private static void MapSales(RouteGroupBuilder api)
    {
        // ---------------- invoices
        api.MapGet("/invoices", async (QueryOf<ListQuery> lq, string? paymentState, AppServices app) => await app.Invoices.ListAsync(lq.Value.Clamp(), paymentState));
        api.MapGet("/invoices/summary", async (DateTime? from, DateTime? to, long? customerId, AppServices app) =>
        {
            app.Session.Demand(Perm.InvoiceView);
            return await app.Db.QuerySingleOrDefaultAsync<InvoiceSummary>("""
                select count(*) filter (where i.status = 'FINAL')::int as count,
                       coalesce(sum(i.grand_total) filter (where i.status = 'FINAL'), 0) as total,
                       coalesce(sum(b.paid), 0) as paid,
                       coalesce(sum(b.balance) filter (where b.balance > 0), 0) as balance,
                       coalesce(sum(b.balance) filter (where b.balance > 0 and i.due_date < current_date), 0) as overdue,
                       count(*) filter (where i.status = 'DRAFT')::int as drafts,
                       count(*) filter (where i.status = 'CANCELLED')::int as cancelled
                from invoices i left join v_invoice_balances b on b.invoice_id = i.id
                where (@from::date is null or i.invoice_date >= @from::date) and (@to::date is null or i.invoice_date <= @to::date)
                  and (@customerId::bigint is null or i.customer_id = @customerId)
                """, new { from, to, customerId });
        });
        api.MapGet("/invoices/{id:long}", async (long id, AppServices app) =>
        {
            var inv = await app.Invoices.GetAsync(id);
            var s = app.Session;
            return new
            {
                invoice = inv,
                payments = s.HasAny(Perm.PaymentView, Perm.InvoiceView) ? await app.Payments.ForDocumentAsync(DocType.Invoice, id) : Array.Empty<Payment>(),
                returns = s.Has(Perm.ReturnView) ? await app.Invoices.ReturnsForAsync(id) : Array.Empty<SalesReturn>(),
                deliveries = s.Has(Perm.DeliveryView) ? await app.Deliveries.ForDocumentAsync("invoice_id", id) : Array.Empty<Delivery>(),
                history = s.Has(Perm.AuditView) ? await app.Audit.ForRecordAsync("invoice", id) : Array.Empty<AuditLog>(),
            };
        });
        api.MapPost("/invoices/draft", async (SalesDocumentInput input, AppServices app) => new { id = await app.Invoices.SaveDraftAsync(input) });
        api.MapPost("/invoices/checkout", async (CheckoutRequest r, AppServices app) =>
            await app.Invoices.CheckoutAsync(r.Document, r.Payments ?? new(), r.UseAdvance, r.CreditOverride));
        api.MapPost("/invoices/{id:long}/finalize", async (long id, FinalizeRequest r, AppServices app) =>
            await app.Invoices.FinalizeAsync(id, r.Payments ?? new(), r.UseAdvance, r.CreditOverride));
        api.MapPost("/invoices/{id:long}/cancel", async (long id, ReasonRequest r, AppServices app) => { await app.Invoices.CancelAsync(id, r.Reason); return Results.NoContent(); });
        api.MapDelete("/invoices/{id:long}", async (long id, AppServices app) => { await app.Invoices.DeleteDraftAsync(id); return Results.NoContent(); });
        api.MapGet("/invoices/{id:long}/pdf", async (long id, string? format, bool? download, AppServices app) =>
        {
            app.Session.Demand(Perm.InvoiceView);
            var inv = await app.Invoices.GetAsync(id);
            return Pdf(await app.Documents.InvoicePdfAsync(id, format == "thermal"), $"{inv.Number ?? "Draft"} {inv.CustomerName}", download == true);
        }).RequireRateLimiting("heavy");
        api.MapGet("/invoices/{id:long}/whatsapp", async (long id, bool? reminder, AppServices app) =>
        {
            app.Session.Demand(Perm.InvoiceView);
            var (mobile, message) = await app.Documents.InvoiceMessageAsync(id, reminder == true);
            return WhatsApp(await app.Settings.GetAsync(), mobile, message);
        });

        // ---------------- quotations
        api.MapGet("/quotations", async (QueryOf<ListQuery> lq, AppServices app) => await app.Quotations.ListAsync(lq.Value.Clamp()));
        api.MapGet("/quotations/{id:long}", async (long id, AppServices app) => new
        {
            quotation = await app.Quotations.GetAsync(id),
            history = app.Session.Has(Perm.AuditView) ? await app.Audit.ForRecordAsync("quotation", id) : Array.Empty<AuditLog>(),
        });
        api.MapPost("/quotations", async (SalesDocumentInput input, AppServices app) => new { id = await app.Quotations.SaveAsync(input) });
        api.MapPost("/quotations/{id:long}/status", async (long id, StatusRequest r, AppServices app) => { await app.Quotations.SetStatusAsync(id, r.Status, r.Note); return Results.NoContent(); });
        api.MapPost("/quotations/{id:long}/convert", async (long id, ConvertQuotationRequest r, AppServices app) =>
            new { salesOrderId = await app.Quotations.ConvertToSalesOrderAsync(id, r.ExpectedDelivery, r.Confirm) });
        api.MapGet("/quotations/{id:long}/pdf", async (long id, bool? download, AppServices app) =>
        {
            var q = await app.Quotations.GetAsync(id);
            return Pdf(await app.Documents.QuotationPdfAsync(id), $"{q.Number} {q.CustomerName}", download == true);
        }).RequireRateLimiting("heavy");
        api.MapGet("/quotations/{id:long}/whatsapp", async (long id, AppServices app) =>
        {
            app.Session.Demand(Perm.QuotationView);
            var (mobile, message) = await app.Documents.QuotationMessageAsync(id);
            return WhatsApp(await app.Settings.GetAsync(), mobile, message);
        });

        // ---------------- sales orders
        api.MapGet("/sales-orders", async (QueryOf<ListQuery> lq, bool? open, AppServices app) => await app.SalesOrders.ListAsync(lq.Value.Clamp(), open == true));
        api.MapGet("/sales-orders/{id:long}", async (long id, AppServices app) =>
        {
            var s = app.Session;
            return new
            {
                order = await app.SalesOrders.GetAsync(id),
                history = await app.SalesOrders.HistoryAsync(id),
                payments = s.HasAny(Perm.PaymentView, Perm.SalesOrderView) ? await app.Payments.ForDocumentAsync(DocType.SalesOrder, id) : Array.Empty<Payment>(),
                deliveries = s.Has(Perm.DeliveryView) ? await app.Deliveries.ForDocumentAsync("sales_order_id", id) : Array.Empty<Delivery>(),
            };
        });
        api.MapPost("/sales-orders", async (SalesDocumentInput input, AppServices app) => new { id = await app.SalesOrders.SaveAsync(input) });
        api.MapPost("/sales-orders/{id:long}/confirm", async (long id, AppServices app) => await app.SalesOrders.ConfirmAsync(id));
        api.MapPost("/sales-orders/{id:long}/reserve", async (long id, AppServices app) => await app.SalesOrders.ReserveAsync(id));
        api.MapPost("/sales-orders/{id:long}/status", async (long id, StatusRequest r, AppServices app) => { await app.SalesOrders.ChangeStatusAsync(id, r.Status, r.Note); return Results.NoContent(); });
        api.MapPost("/sales-orders/{id:long}/invoice", async (long id, ConvertOrderRequest r, AppServices app) =>
            await app.SalesOrders.ConvertToInvoiceAsync(id, r.Payments ?? new(), r.DueDate));
        api.MapPost("/sales-orders/{id:long}/delivery", async (long id, DateTime? date, AppServices app) => new { id = await app.Deliveries.CreateForSalesOrderAsync(id, date) });
        api.MapGet("/sales-orders/{id:long}/pdf", async (long id, bool? download, AppServices app) =>
        {
            var o = await app.SalesOrders.GetAsync(id);
            return Pdf(await app.Documents.SalesOrderPdfAsync(id), $"{o.Number} {o.CustomerName}", download == true);
        }).RequireRateLimiting("heavy");
        api.MapGet("/sales-orders/{id:long}/whatsapp", async (long id, AppServices app) =>
        {
            app.Session.Demand(Perm.SalesOrderView);
            var (mobile, message) = await app.Documents.OrderConfirmationMessageAsync(id);
            return WhatsApp(await app.Settings.GetAsync(), mobile, message);
        });

        // ---------------- returns & exchanges
        api.MapGet("/returns", async (QueryOf<ListQuery> lq, AppServices app) => await app.Returns.ListAsync(lq.Value.Clamp()));
        api.MapGet("/returns/{id:long}", async (long id, AppServices app) => await app.Returns.GetAsync(id));
        api.MapPost("/returns", async (ReturnInput input, AppServices app) =>
        {
            var (id, number, credit) = await app.Returns.CreateAsync(input);
            return new { id, number, credit };
        });
        api.MapGet("/exchanges", async (QueryOf<ListQuery> lq, AppServices app) => await app.Returns.ListExchangesAsync(lq.Value.Clamp()));
        api.MapPost("/exchanges/preview", async (ExchangePreviewRequest r, AppServices app) => await app.Returns.PreviewExchangeAsync(r.Input, r.NewInvoiceTotal));
        api.MapPost("/exchanges", async (ExchangeInput input, AppServices app) => await app.Returns.ExchangeAsync(input));
    }

    public sealed record RefundRequest(long CustomerId, decimal Amount, PaymentLineInput Method, string? Notes, string? DocType, long? DocId);

    private static void MapPayments(RouteGroupBuilder api)
    {
        api.MapGet("/payments", async (QueryOf<ListQuery> lq, string? method, AppServices app) => await app.Payments.ListAsync(lq.Value.Clamp(), method));
        api.MapGet("/payments/{id:long}", async (long id, AppServices app) => await app.Payments.GetAsync(id));
        api.MapGet("/payments/position", async (string docType, long docId, AppServices app) => new
        {
            position = await app.Payments.PositionAsync(docType, docId),
            history = await app.Payments.ForDocumentAsync(docType, docId),
        });
        api.MapGet("/payments/on-account/{customerId:long}", async (long customerId, AppServices app) =>
        {
            app.Session.DemandAny(Perm.PaymentView, Perm.PaymentReceive, Perm.InvoiceCreate);
            return new { amount = await app.Payments.OnAccountBalanceAsync(customerId) };
        });
        api.MapPost("/payments", async (PaymentInput input, AppServices app) =>
        {
            var (id, number) = await app.Payments.ReceiveAsync(input);
            return new { id, number };
        });
        api.MapPost("/payments/refund", async (RefundRequest r, AppServices app) =>
        {
            var (id, number) = await app.Payments.RefundAsync(r.CustomerId, r.Amount, r.Method, r.Notes, r.DocType ?? DocType.OnAccount, r.DocId);
            return new { id, number };
        });
        api.MapPost("/payments/{id:long}/void", async (long id, ReasonRequest r, AppServices app) => { await app.Payments.VoidAsync(id, r.Reason); return Results.NoContent(); });
        api.MapGet("/payments/{id:long}/pdf", async (long id, bool? download, AppServices app) =>
        {
            var p = await app.Payments.GetAsync(id);
            return Pdf(await app.Documents.ReceiptPdfAsync(id), $"{p.Number} {p.CustomerName}", download == true);
        }).RequireRateLimiting("heavy");
        api.MapGet("/payments/{id:long}/whatsapp", async (long id, AppServices app) =>
        {
            app.Session.Demand(Perm.PaymentView);
            var (mobile, message) = await app.Documents.ReceiptMessageAsync(id);
            return WhatsApp(await app.Settings.GetAsync(), mobile, message);
        });
    }

    public sealed class InvoiceSummary
    {
        public int Count { get; set; }
        public decimal Total { get; set; }
        public decimal Paid { get; set; }
        public decimal Balance { get; set; }
        public decimal Overdue { get; set; }
        public int Drafts { get; set; }
        public int Cancelled { get; set; }
    }
}
