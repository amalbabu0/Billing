using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Infrastructure;
using FurniShop.Infrastructure.Services;
using FurniShop.Web.Hosting;

namespace FurniShop.Web.Endpoints;

public static partial class Api
{
    public sealed record WarrantyUpdateRequest(string? SerialNo, string? Terms);
    public sealed record AssignRequest(DateTime VisitDate, string? TechnicianName, long? TechnicianUserId);
    public sealed record LeadMoveRequest(string Status, string? Note, string? LostReason);
    public sealed record FollowUpDoneRequest(string? Outcome, DateTime? NextDate, string? NextTitle);
    public sealed record CashOpenRequest(decimal OpeningCash, DateTime? Date);
    public sealed record CashCloseRequest(DateTime Date, decimal CountedCash, string? Note);
    public sealed record CashApproveRequest(DateTime Date, string? Note);
    public sealed record CashReopenRequest(DateTime Date, string Reason);

    private static void MapService(RouteGroupBuilder api)
    {
        // ---------------- warranty
        api.MapGet("/warranties", async (QueryOf<ListQuery> lq, AppServices app) => await app.ServiceDesk.WarrantiesAsync(lq.Value.Clamp()));
        api.MapGet("/warranties/{id:long}", async (long id, AppServices app) => await app.ServiceDesk.WarrantyAsync(id));
        api.MapPost("/warranties", async (WarrantyInput w, AppServices app) => new { id = await app.ServiceDesk.RegisterAsync(w) });
        api.MapPut("/warranties/{id:long}", async (long id, WarrantyUpdateRequest r, AppServices app) => { await app.ServiceDesk.UpdateWarrantyAsync(id, r.SerialNo, r.Terms); return Results.NoContent(); });
        api.MapGet("/warranties/{id:long}/whatsapp", async (long id, AppServices app) =>
        {
            var (mobile, message) = await app.Documents.WarrantyReminderMessageAsync(id);
            return WhatsApp(await app.Settings.GetAsync(), mobile, message);
        });
        api.MapPost("/warranties/{id:long}/void", async (long id, ReasonRequest r, AppServices app) => { await app.ServiceDesk.VoidWarrantyAsync(id, r.Reason); return Results.NoContent(); });

        // ---------------- service tickets
        api.MapGet("/service", async (QueryOf<ListQuery> lq, AppServices app) => await app.ServiceDesk.TicketsAsync(lq.Value.Clamp()));
        api.MapGet("/service/{id:long}", async (long id, AppServices app) =>
            new { ticket = await app.ServiceDesk.TicketAsync(id), history = await app.ServiceDesk.TicketHistoryAsync(id) });
        api.MapPost("/service", async (ServiceTicketInput t, AppServices app) => { t.Id = 0; return new { id = await app.ServiceDesk.SaveTicketAsync(t) }; });
        api.MapPut("/service/{id:long}", async (long id, ServiceTicketInput t, AppServices app) => { t.Id = id; return new { id = await app.ServiceDesk.SaveTicketAsync(t) }; });
        api.MapPost("/service/{id:long}/assign", async (long id, AssignRequest r, AppServices app) => { await app.ServiceDesk.AssignAsync(id, r.VisitDate, r.TechnicianName, r.TechnicianUserId); return Results.NoContent(); });
        api.MapPost("/service/{id:long}/move", async (long id, MoveRequest r, AppServices app) => { await app.ServiceDesk.MoveAsync(id, r.Status, r.Note); return Results.NoContent(); });
        api.MapPost("/service/{id:long}/complete", async (long id, ServiceCompleteInput r, AppServices app) => new { bill = await app.ServiceDesk.CompleteAsync(id, r) });
        api.MapPost("/service/{id:long}/cancel", async (long id, ReasonRequest r, AppServices app) => { await app.ServiceDesk.CancelTicketAsync(id, r.Reason); return Results.NoContent(); });
        api.MapGet("/service/{id:long}/whatsapp", async (long id, AppServices app) =>
        {
            var t = await app.ServiceDesk.TicketAsync(id);
            var s = await app.Settings.GetAsync();
            var status = t.Status switch
            {
                ServiceStatus.New => "has been registered", ServiceStatus.Assigned => $"is assigned to {t.TechnicianName} for {t.VisitDate:dd-MMM-yyyy}",
                ServiceStatus.Visit => "— our technician is on the way", ServiceStatus.Repair => "is under repair", ServiceStatus.Qc => "is in final quality check",
                ServiceStatus.Completed => "is completed", _ => $"status: {t.Status.ToLowerInvariant()}",
            };
            var msg = FurniShop.Core.Messaging.MessageTemplates.Render(s.WhatsApp.ServiceUpdateTemplate, new Dictionary<string, string?>
            {
                ["customer"] = t.CustomerName, ["shop"] = s.Shop.ShopName, ["shop_phone"] = s.Shop.Phone, ["number"] = t.Number, ["product"] = t.ProductName,
                ["status"] = status, ["technician"] = t.TechnicianName, ["date"] = t.VisitDate?.ToString("dd-MMM-yyyy"),
            });
            return WhatsApp(s, t.CustomerMobile, msg);
        });

        // ---------------- leads & follow-ups
        api.MapGet("/leads", async (QueryOf<ListQuery> lq, long? salespersonId, AppServices app) => await app.Crm.LeadsAsync(lq.Value.Clamp(), salespersonId));
        api.MapGet("/leads/pipeline", async (long? salespersonId, AppServices app) => await app.Crm.PipelineAsync(salespersonId));
        api.MapGet("/leads/{id:long}", async (long id, AppServices app) => new
        {
            lead = await app.Crm.LeadAsync(id), history = await app.Crm.LeadHistoryAsync(id),
            followUps = await app.Crm.FollowUpsAsync("all", refType: "LEAD", refId: id),
        });
        api.MapPost("/leads", async (Lead l, AppServices app) => { l.Id = 0; return new { id = await app.Crm.SaveLeadAsync(l) }; });
        api.MapPut("/leads/{id:long}", async (long id, Lead l, AppServices app) => { l.Id = id; return new { id = await app.Crm.SaveLeadAsync(l) }; });
        api.MapPost("/leads/{id:long}/move", async (long id, LeadMoveRequest r, AppServices app) => { await app.Crm.MoveLeadAsync(id, r.Status, r.Note, r.LostReason); return Results.NoContent(); });
        api.MapPost("/leads/{id:long}/convert", async (long id, bool? keepOpen, AppServices app) => new { customerId = await app.Crm.ConvertAsync(id, keepOpen ?? false) });
        api.MapGet("/follow-ups", async (string? scope, bool? mine, string? refType, long? refId, long? customerId, AppServices app) => await app.Crm.FollowUpsAsync(scope ?? "today", mine ?? false, refType, refId, customerId: customerId));
        api.MapPost("/follow-ups", async (FollowUpInput f, AppServices app) => new { id = await app.Crm.AddFollowUpAsync(f) });
        api.MapPost("/follow-ups/{id:long}/done", async (long id, FollowUpDoneRequest r, AppServices app) => { await app.Crm.CompleteFollowUpAsync(id, r.Outcome, r.NextDate, r.NextTitle); return Results.NoContent(); });

        // ---------------- catalogue import & bulk changes
        api.MapGet("/products/import/template", (AppServices app) =>
        {
            app.Session.Demand(FurniShop.Core.Security.Perm.ProductImport);
            return Results.File(ProductImportService.Template(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "product-import-template.xlsx");
        });
        api.MapPost("/products/import/preview", async (IFormFile file, AppServices app) =>
        {
            if (file.Length > 5 * 1024 * 1024) throw new ValidationException("File", "The file is larger than 5 MB.");
            var name = file.FileName ?? "import.csv";
            if (!(name.EndsWith(".csv", StringComparison.OrdinalIgnoreCase) || name.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)))
                throw new ValidationException("File", "Upload a .csv or .xlsx file.");
            await using var stream = file.OpenReadStream();
            using var ms = new MemoryStream();
            await stream.CopyToAsync(ms);
            return await app.ProductImport.PreviewAsync(ms.ToArray(), name);
        }).DisableAntiforgery().RequireRateLimiting("heavy");
        api.MapPost("/products/import/commit", async (List<ImportRow> rows, AppServices app) => await app.ProductImport.CommitAsync(rows)).RequireRateLimiting("heavy");
        api.MapPost("/products/bulk", async (BulkProductUpdate u, AppServices app) => new { updated = await app.ProductImport.BulkUpdateAsync(u) });

        // ---------------- analytics
        api.MapGet("/analytics", async (DateTime from, DateTime to, DateTime? compareFrom, DateTime? compareTo, AppServices app) =>
            await app.Analytics.CompareAsync(from, to, compareFrom, compareTo)).RequireRateLimiting("heavy");

        // ---------------- order 360°
        api.MapGet("/lifecycle/{kind}/{id:long}", async (string kind, long id, AppServices app) => await app.Lifecycle.ForAsync(kind, id));

        // ---------------- cash register
        api.MapGet("/cash", async (DateTime? date, AppServices app) => await app.Cash.DayAsync(date));
        api.MapGet("/cash/history", async (AppServices app) => await app.Cash.HistoryAsync());
        api.MapPost("/cash/open", async (CashOpenRequest r, AppServices app) => new { id = await app.Cash.OpenAsync(r.OpeningCash, r.Date) });
        api.MapPost("/cash/close", async (CashCloseRequest r, AppServices app) => await app.Cash.CloseAsync(r.Date, r.CountedCash, r.Note));
        api.MapPost("/cash/approve", async (CashApproveRequest r, AppServices app) => { await app.Cash.ApproveAsync(r.Date, r.Note); return Results.NoContent(); });
        api.MapPost("/cash/reopen", async (CashReopenRequest r, AppServices app) => { await app.Cash.ReopenAsync(r.Date, r.Reason); return Results.NoContent(); });
    }
}
