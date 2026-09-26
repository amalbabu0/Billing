using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Infrastructure;
using FurniShop.Infrastructure.Services;

using FurniShop.Web.Hosting;

namespace FurniShop.Web.Endpoints;

public static partial class Api
{
    public sealed record NoteRequest(string? Note);
    public sealed record PaymentsRequest(List<PaymentLineInput>? Payments);
    public sealed record ScheduleDeliveryRequest(DateTime Date, string? TimeSlot, string? DriverName, long? DriverUserId, string? VehicleNo, decimal? DeliveryCost, string? Priority = null, string? Route = null, int? RouteOrder = null);
    public sealed record CompleteDeliveryRequest(string ReceiverName, string? Otp, string? SignatureDataUrl, string? PhotoDataUrl, string? PhotoFileName, string? Remarks);
    public sealed record ScheduleInstallationRequest(DateTime Date, string? TechnicianName, long? TechnicianUserId, decimal? Cost);
    public sealed record CompleteInstallationRequest(string? Notes, string? PhotoDataUrl = null, string? PhotoFileName = null, string? ConfirmedBy = null);

    private static byte[]? FromDataUrl(string? dataUrl)
    {
        if (string.IsNullOrWhiteSpace(dataUrl)) return null;
        var comma = dataUrl.IndexOf(',');
        var b64 = comma >= 0 ? dataUrl[(comma + 1)..] : dataUrl;
        if (b64.Length > 7_500_000) throw new ValidationException("File", "The image is larger than 5 MB.");
        try { return Convert.FromBase64String(b64); }
        catch (FormatException) { throw new ValidationException("File", "The image could not be read."); }
    }

    private static void MapOperations(RouteGroupBuilder api)
    {
        // ---------------- custom orders
        api.MapGet("/custom-orders", async (QueryOf<ListQuery> lq, string? stage, AppServices app) => await app.CustomOrders.ListAsync(lq.Value.Clamp(), stage));
        api.MapGet("/custom-orders/{id:long}", async (long id, AppServices app) =>
        {
            var s = app.Session;
            return new
            {
                order = await app.CustomOrders.GetAsync(id),
                history = await app.CustomOrders.HistoryAsync(id),
                payments = s.HasAny(Perm.PaymentView, Perm.CustomOrderView) ? await app.Payments.ForDocumentAsync(DocType.CustomOrder, id) : Array.Empty<Payment>(),
                deliveries = s.Has(Perm.DeliveryView) ? await app.Deliveries.ForDocumentAsync("custom_order_id", id) : Array.Empty<Delivery>(),
            };
        });
        api.MapPost("/custom-orders", async (CustomOrder o, AppServices app) => { o.Id = 0; return new { id = await app.CustomOrders.SaveAsync(o) }; });
        api.MapPut("/custom-orders/{id:long}", async (long id, CustomOrder o, AppServices app) => { o.Id = id; return new { id = await app.CustomOrders.SaveAsync(o) }; });
        api.MapPost("/custom-orders/{id:long}/advance", async (long id, NoteRequest r, AppServices app) => new { status = await app.CustomOrders.AdvanceAsync(id, r.Note) });
        api.MapPost("/custom-orders/{id:long}/cancel", async (long id, ReasonRequest r, AppServices app) => { await app.CustomOrders.CancelAsync(id, r.Reason); return Results.NoContent(); });
        api.MapPost("/custom-orders/{id:long}/invoice", async (long id, PaymentsRequest r, AppServices app) => await app.CustomOrders.GenerateInvoiceAsync(id, r.Payments ?? new()));
        api.MapPost("/custom-orders/{id:long}/delivery", async (long id, DateTime? date, AppServices app) => new { id = await app.Deliveries.CreateForCustomOrderAsync(id, date) });
        api.MapGet("/custom-orders/{id:long}/whatsapp", async (long id, AppServices app) =>
        {
            app.Session.Demand(Perm.CustomOrderView);
            var (mobile, message) = await app.Documents.CustomOrderConfirmationMessageAsync(id);
            return WhatsApp(await app.Settings.GetAsync(), mobile, message);
        });

        // ---------------- deliveries
        api.MapGet("/deliveries", async (QueryOf<ListQuery> lq, AppServices app) => await app.Deliveries.ListAsync(lq.Value.Clamp()));
        api.MapGet("/deliveries/board", async (AppServices app) =>
        {
            // One call for the kanban: every open delivery plus today's completed ones.
            var open = await app.Deliveries.ListAsync(new ListQuery { PageSize = 300, Status = null, SortDescending = false });
            return open.Items.Where(d => d.Status is not (DeliveryStatus.Delivered or DeliveryStatus.Cancelled or DeliveryStatus.Failed)
                                          || (d.DeliveredAt?.Date == DateTime.Today)).ToList();
        });
        api.MapGet("/deliveries/{id:long}", async (long id, AppServices app) =>
        {
            var d = await app.Deliveries.GetAsync(id);
            object? payment = null;
            if (d.InvoiceId is { } invId && app.Session.HasAny(Perm.PaymentView, Perm.InvoiceView))
                payment = await app.Payments.PositionAsync(DocType.Invoice, invId);
            return new { delivery = d, history = await app.Deliveries.HistoryAsync(id), payment };
        });
        api.MapPost("/deliveries/from-invoice/{invoiceId:long}", async (long invoiceId, AppServices app) => new { id = await app.Deliveries.CreateForInvoiceAsync(invoiceId) });
        api.MapPost("/deliveries/{id:long}/schedule", async (long id, ScheduleDeliveryRequest r, AppServices app) =>
            new { otp = await app.Deliveries.ScheduleAsync(id, r.Date, r.TimeSlot, r.DriverName, r.DriverUserId, r.VehicleNo, r.DeliveryCost, r.Priority, r.Route, r.RouteOrder) });
        api.MapPost("/deliveries/{id:long}/dispatch", async (long id, AppServices app) => { await app.Deliveries.DispatchAsync(id); return Results.NoContent(); });
        api.MapPost("/deliveries/{id:long}/complete", async (long id, CompleteDeliveryRequest r, AppServices app) =>
        {
            await app.Deliveries.CompleteAsync(new DeliveryCompletion
            {
                DeliveryId = id, ReceiverName = r.ReceiverName, Otp = r.Otp, SignaturePng = FromDataUrl(r.SignatureDataUrl),
                PhotoBytes = FromDataUrl(r.PhotoDataUrl), PhotoFileName = r.PhotoFileName ?? "proof.jpg", Remarks = r.Remarks,
            });
            return Results.NoContent();
        });
        api.MapPost("/deliveries/{id:long}/fail", async (long id, ReasonRequest r, AppServices app) => { await app.Deliveries.FailAsync(id, r.Reason); return Results.NoContent(); });
        api.MapPost("/deliveries/{id:long}/cancel", async (long id, ReasonRequest r, AppServices app) => { await app.Deliveries.CancelAsync(id, r.Reason); return Results.NoContent(); });
        api.MapGet("/deliveries/{id:long}/whatsapp", async (long id, string? otp, AppServices app) =>
        {
            app.Session.Demand(Perm.DeliveryView);
            var (mobile, message) = await app.Documents.DeliveryMessageAsync(id, otp);
            return WhatsApp(await app.Settings.GetAsync(), mobile, message);
        });

        // ---------------- installations
        api.MapGet("/installations", async (QueryOf<ListQuery> lq, AppServices app) => await app.Installations.ListAsync(lq.Value.Clamp()));
        api.MapPost("/installations", async (Installation i, AppServices app) => { i.Id = 0; return new { id = await app.Installations.CreateAsync(i) }; });
        api.MapPost("/installations/{id:long}/schedule", async (long id, ScheduleInstallationRequest r, AppServices app) =>
        {
            await app.Installations.ScheduleAsync(id, r.Date, r.TechnicianName, r.TechnicianUserId, r.Cost);
            return Results.NoContent();
        });
        api.MapPost("/installations/{id:long}/complete", async (long id, CompleteInstallationRequest r, AppServices app) => { await app.Installations.CompleteAsync(id, r.Notes, null, FromDataUrl(r.PhotoDataUrl), r.PhotoFileName, r.ConfirmedBy); return Results.NoContent(); });
        api.MapPost("/installations/{id:long}/cancel", async (long id, ReasonRequest r, AppServices app) => { await app.Installations.CancelAsync(id, r.Reason); return Results.NoContent(); });

        // ---------------- expenses
        api.MapGet("/expenses", async (QueryOf<ListQuery> lq, AppServices app) => await app.Expenses.ListAsync(lq.Value.Clamp()));
        api.MapGet("/expenses/summary", async (DateTime? from, DateTime? to, AppServices app) =>
        {
            app.Session.Demand(Perm.ExpenseView);
            return await app.Db.QueryAsync<CategoryTotal>("""
                select c.name as category, sum(e.amount) as amount, count(*)::int as count
                from expenses e join expense_categories c on c.id = e.category_id
                where not e.is_deleted and e.expense_date between @from and @to group by c.name order by 2 desc
                """, new { from = (from ?? new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1)).Date, to = (to ?? DateTime.Today).Date });
        });
        api.MapPost("/expenses", async (Expense e, AppServices app) => { e.Id = 0; return new { id = await app.Expenses.SaveAsync(e) }; });
        api.MapPut("/expenses/{id:long}", async (long id, Expense e, AppServices app) => { e.Id = id; return new { id = await app.Expenses.SaveAsync(e) }; });
        api.MapDelete("/expenses/{id:long}", async (long id, AppServices app) => { await app.Expenses.DeleteAsync(id); return Results.NoContent(); });
    }

    public sealed class CategoryTotal
    {
        public string Category { get; set; } = "";
        public decimal Amount { get; set; }
        public int Count { get; set; }
    }
}
