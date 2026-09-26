using System.Data;
using System.Text.Json;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Messaging;
using FurniShop.Core.Security;
using FurniShop.Core.Settings;
using FurniShop.Infrastructure;
using FurniShop.Infrastructure.Documents;
using FurniShop.Infrastructure.Services;
using FurniShop.Web.Hosting;

namespace FurniShop.Web.Endpoints;

public static partial class Api
{
    public sealed record PurchaseReturnRequest(PurchaseReturnInput Input);
    public sealed record UserRequest(User User, string? Password);
    public sealed record RoleRequest(Role Role, List<string> Permissions);
    public sealed record TemplatePreviewRequest(string Template);

    private static void MapPurchases(RouteGroupBuilder api)
    {
        api.MapGet("/purchases", async (QueryOf<ListQuery> lq, bool? outstanding, AppServices app) => await app.Purchases.ListAsync(lq.Value.Clamp(), outstanding == true));
        api.MapGet("/purchases/{id:long}", async (long id, AppServices app) => new
        {
            purchase = await app.Purchases.GetAsync(id),
            returns = await app.PurchaseReturns.ForPurchaseAsync(id),
            payments = app.Session.HasAny(Perm.SupplierPay, Perm.PurchaseView)
                ? (await app.Db.QueryAsync<SupplierPayment>("""
                    select sp.*, a.amount as amount_applied from supplier_payments sp join supplier_payment_allocations a on a.supplier_payment_id = sp.id
                    where a.purchase_id = @id order by sp.payment_date
                    """, new { id }))
                : Array.Empty<SupplierPayment>(),
        });
        api.MapPost("/purchases", async (PurchaseInput input, AppServices app) => { input.Id = 0; return new { id = await app.Purchases.SaveAsync(input) }; });
        api.MapPut("/purchases/{id:long}", async (long id, PurchaseInput input, AppServices app) => { input.Id = id; return new { id = await app.Purchases.SaveAsync(input) }; });
        api.MapPost("/purchases/{id:long}/complete", async (long id, AppServices app) => { await app.Purchases.CompleteAsync(id); return Results.NoContent(); });
        api.MapPost("/purchases/{id:long}/cancel", async (long id, ReasonRequest r, AppServices app) => { await app.Purchases.CancelAsync(id, r.Reason); return Results.NoContent(); });
        api.MapGet("/purchase-returns", async (QueryOf<ListQuery> lq, AppServices app) => await app.PurchaseReturns.ListAsync(lq.Value.Clamp()));
        api.MapPost("/purchase-returns", async (PurchaseReturnInput input, AppServices app) =>
        {
            var (id, number) = await app.PurchaseReturns.CreateAsync(input);
            return new { id, number };
        });

        api.MapGet("/suppliers", async (QueryOf<ListQuery> lq, AppServices app) => await app.Suppliers.ListAsync(lq.Value.Clamp()));
        api.MapGet("/suppliers/{id:long}", async (long id, AppServices app) => await app.Suppliers.GetAsync(id));
        api.MapGet("/suppliers/{id:long}/ledger", async (long id, AppServices app) => await app.Suppliers.LedgerAsync(id));
        api.MapPost("/suppliers", async (Supplier s, AppServices app) => { s.Id = 0; var id = await app.Suppliers.SaveAsync(s); return await app.Suppliers.GetAsync(id); });
        api.MapPut("/suppliers/{id:long}", async (long id, Supplier s, AppServices app) => { s.Id = id; await app.Suppliers.SaveAsync(s); return await app.Suppliers.GetAsync(id); });
        api.MapDelete("/suppliers/{id:long}", async (long id, AppServices app) => { await app.Suppliers.DeleteAsync(id); return Results.NoContent(); });

        api.MapGet("/supplier-payments", async (QueryOf<ListQuery> lq, AppServices app) => await app.Purchases.ListPaymentsAsync(lq.Value.Clamp()));
        api.MapPost("/supplier-payments", async (SupplierPaymentInput input, AppServices app) => new { number = await app.Purchases.PayAsync(input) });
        api.MapPost("/supplier-payments/{id:long}/void", async (long id, ReasonRequest r, AppServices app) => { await app.Purchases.VoidPaymentAsync(id, r.Reason); return Results.NoContent(); });
    }

    private static void MapGst(RouteGroupBuilder api)
    {
        static GstFilter Clean(GstFilter f)
        {
            f.Page = Math.Max(1, f.Page);
            f.PageSize = Math.Clamp(f.PageSize, 1, 5000);
            return f;
        }
        api.MapGet("/gst/dashboard", async (DateTime? from, DateTime? to, AppServices app) =>
            await app.Gst.DashboardAsync(from ?? new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1), to ?? DateTime.Today));
        api.MapGet("/gst/sales", async (QueryOf<GstFilter> gf, AppServices app) => await app.Gst.SalesAsync(Clean(gf.Value)));
        api.MapGet("/gst/purchases", async (QueryOf<GstFilter> gf, AppServices app) => await app.Gst.PurchasesAsync(Clean(gf.Value)));
        api.MapGet("/gst/credit-notes", async (QueryOf<GstFilter> gf, AppServices app) => await app.Gst.CreditNotesAsync(Clean(gf.Value)));
        api.MapGet("/gst/debit-notes", async (QueryOf<GstFilter> gf, AppServices app) => await app.Gst.DebitNotesAsync(Clean(gf.Value)));
        api.MapGet("/gst/hsn", async (DateTime from, DateTime to, string? side, string? search, AppServices app) => await app.Gst.HsnSummaryAsync(from, to, side ?? "sales", search));
        api.MapGet("/gst/rates", async (DateTime from, DateTime to, string? side, AppServices app) => await app.Gst.RateSummaryAsync(from, to, side ?? "sales"));
        api.MapGet("/gst/ledger", async (DateTime from, DateTime to, string? component, AppServices app) => await app.Gst.TaxLedgerAsync(from, to, component));
        api.MapGet("/gst/register", async (DateTime from, DateTime to, string? search, AppServices app) => await app.Gst.RegisterAsync(from, to, search));
        api.MapGet("/gst/export", async (DateTime from, DateTime to, AppServices app) =>
        {
            var bytes = await app.Gst.ExportWorkbookAsync(from, to);
            await app.Audit.LogAsync("EXPORT", "GST", $"exported GST data {from:dd-MMM-yyyy} to {to:dd-MMM-yyyy}");
            return Results.File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"GST {from:yyyy-MM-dd} to {to:yyyy-MM-dd}.xlsx");
        }).RequireRateLimiting("heavy");
    }

    private static void MapReports(RouteGroupBuilder api)
    {
        api.MapGet("/reports", (AppServices app) => app.Reports.Available());
        api.MapPost("/reports/{key}", async (string key, ReportFilter f, AppServices app) =>
        {
            var r = await app.Reports.RunAsync(key, f);
            return ReportJson(r);
        }).RequireRateLimiting("heavy");
        api.MapPost("/reports/{key}/export", async (string key, ReportFilter f, string format, AppServices app) =>
        {
            app.Session.Demand(Perm.ExportData);
            var r = await app.Reports.RunAsync(key, f);
            var name = Safe($"{r.Definition.Title} {f.From:yyyy-MM-dd} to {f.To:yyyy-MM-dd}");
            await app.Audit.LogAsync("EXPORT", "Reports", $"exported report {r.Definition.Title} ({format})");
            return format switch
            {
                "csv" => Results.File(DocumentService.ToCsv(r.Table, r.MoneyColumns), "text/csv; charset=utf-8", name + ".csv"),
                "xlsx" => Results.File(DocumentService.ToExcel(r.Table, r.Definition.Title, r.Subtitle, r.MoneyColumns), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name + ".xlsx"),
                _ => Results.File(await app.Documents.ToPdfAsync(r.Table, r.Definition.Title, r.Subtitle, r.MoneyColumns, r.Totals), "application/pdf", name + ".pdf"),
            };
        }).RequireRateLimiting("heavy");
    }

    private static object ReportJson(ReportResult r) => new
    {
        definition = r.Definition,
        subtitle = r.Subtitle,
        columns = r.Table.Columns.Cast<DataColumn>().Select(c => new
        {
            name = c.ColumnName,
            kind = r.MoneyColumns.Contains(c.ColumnName) ? "money"
                : c.DataType == typeof(DateTime) ? "date"
                : c.DataType == typeof(decimal) || c.DataType == typeof(double) || c.DataType == typeof(int) || c.DataType == typeof(long) || c.DataType == typeof(short) ? "number"
                : "text",
        }),
        rows = r.Table.Rows.Cast<DataRow>().Select(row => row.ItemArray.Select(v => v is DBNull ? null : v)),
        totals = r.Totals.Select(t => new { label = t.Label, value = t.Value }),
    };

    private static void MapAdmin(RouteGroupBuilder api)
    {
        // ---------------- users & roles
        api.MapGet("/users", async (AppServices app) => await app.Users.ListAsync());
        api.MapPost("/users", async (UserRequest r, AppServices app) =>
        {
            r.User.Id = 0;
            var id = await app.Users.SaveAsync(r.User, r.Password);
            UserDirectory.InvalidateAll();
            return new { id };
        });
        api.MapPut("/users/{id:long}", async (long id, UserRequest r, AppServices app) =>
        {
            r.User.Id = id;
            await app.Users.SaveAsync(r.User, r.Password);
            UserDirectory.InvalidateAll();
            return new { id };
        });
        api.MapPost("/users/{id:long}/unlock", async (long id, AppServices app) => { await app.Users.UnlockAsync(id); return Results.NoContent(); });
        api.MapDelete("/users/{id:long}", async (long id, AppServices app) => { await app.Users.DeleteAsync(id); UserDirectory.InvalidateAll(); return Results.NoContent(); });

        api.MapGet("/roles", async (AppServices app) =>
        {
            app.Session.DemandAny(Perm.RoleManage, Perm.UserManage);
            var roles = await app.Users.RolesAsync();
            var result = new List<object>();
            foreach (var r in roles) result.Add(new { role = r, permissions = await app.Users.RolePermissionsAsync(r.Id) });
            return new { roles = result, permissions = await app.Users.PermissionsAsync() };
        });
        api.MapPost("/roles", async (RoleRequest r, AppServices app) =>
        {
            r.Role.Id = 0;
            var id = await app.Users.SaveRoleAsync(r.Role, r.Permissions);
            UserDirectory.InvalidateAll();
            return new { id };
        });
        api.MapPut("/roles/{id:long}", async (long id, RoleRequest r, AppServices app) =>
        {
            r.Role.Id = id;
            await app.Users.SaveRoleAsync(r.Role, r.Permissions);
            UserDirectory.InvalidateAll();
            return new { id };
        });
        api.MapDelete("/roles/{id:long}", async (long id, AppServices app) => { await app.Users.DeleteRoleAsync(id); UserDirectory.InvalidateAll(); return Results.NoContent(); });

        api.MapGet("/audit", async (QueryOf<ListQuery> lq, string? module, long? userId, string? action, AppServices app) => await app.Audit.ListAsync(lq.Value.Clamp(), module, userId, action));
        api.MapGet("/audit/actions", async (AppServices app) => { app.Session.Demand(FurniShop.Core.Security.Perm.AuditView); return await app.Db.QueryAsync<string>("select distinct action from audit_logs order by 1"); });
        api.MapGet("/audit/record/{type}/{id:long}", async (string type, long id, AppServices app) =>
        {
            app.Session.Demand(Perm.AuditView);
            return await app.Audit.ForRecordAsync(type, id);
        });

        // ---------------- settings
        api.MapGet("/settings", async (AppServices app) =>
        {
            app.Session.DemandAny(Perm.SettingsManage, Perm.BackupManage);
            var s = await app.Settings.GetAsync(true);
            return new
            {
                settings = s,
                sequences = await app.Settings.SequencesAsync(),
                gstRates = await app.Settings.GstRatesAsync(),
                hsnCodes = await app.Settings.HsnCodesAsync(),
                paymentMethods = await app.Settings.PaymentMethodsAsync(),
                expenseCategories = await app.Expenses.CategoriesAsync(),
            };
        });
        api.MapPut("/settings/{section}", async (string section, JsonElement body, AppServices app) =>
        {
            var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
            switch (section)
            {
                case "shop": await app.Settings.SaveAsync(section, body.Deserialize<ShopSettings>(options)!); break;
                case "invoice": await app.Settings.SaveAsync(section, body.Deserialize<InvoiceSettings>(options)!); break;
                case "tax": await app.Settings.SaveAsync(section, body.Deserialize<TaxSettings>(options)!); break;
                case "delivery": await app.Settings.SaveAsync(section, body.Deserialize<DeliverySettings>(options)!); break;
                case "inventory": await app.Settings.SaveAsync(section, body.Deserialize<InventorySettings>(options)!); break;
                case "printer": await app.Settings.SaveAsync(section, body.Deserialize<PrinterSettings>(options)!); break;
                case "whatsapp": await app.Settings.SaveAsync(section, body.Deserialize<WhatsAppSettings>(options)!); break;
                case "security": await app.Settings.SaveAsync(section, body.Deserialize<SecuritySettings>(options)!); break;
                case "backup":
                    var b = body.Deserialize<BackupSettings>(options)!;
                    b.LastBackupAt = (await app.Settings.GetAsync(true)).Backup.LastBackupAt; // not client-settable
                    await app.Settings.SaveAsync(section, b);
                    break;
                default: return Problem(404, "Unknown settings section.", "not_found");
            }
            return Results.NoContent();
        });
        api.MapPost("/settings/whatsapp/preview", (TemplatePreviewRequest r, AppServices app) =>
        {
            app.Session.Demand(Perm.SettingsManage);
            return new { text = MessageTemplates.Sample(r.Template ?? "") };
        });
        api.MapPost("/settings/gst-rates", async (GstRate r, AppServices app) => { await app.Settings.SaveGstRateAsync(r); return Results.NoContent(); });
        api.MapPost("/settings/hsn", async (HsnCode h, AppServices app) => { await app.Settings.SaveHsnAsync(h); return Results.NoContent(); });
        api.MapPost("/settings/payment-methods", async (PaymentMethod m, AppServices app) => { await app.Settings.SavePaymentMethodAsync(m); return Results.NoContent(); });
        api.MapPost("/settings/sequences", async (DocumentSequence s, AppServices app) => { await app.Settings.SaveSequenceAsync(s); return Results.NoContent(); });
        api.MapPost("/settings/expense-categories", async (ExpenseCategory c, AppServices app) => { await app.Expenses.SaveCategoryAsync(c); return Results.NoContent(); });

        // ---------------- backup (downloads; restores are done with the CLI or Neon's point-in-time restore)
        api.MapPost("/backup/export", async (AppServices app) =>
        {
            var folder = Path.Combine(Path.GetTempPath(), "furnishop-export-" + Guid.NewGuid().ToString("N"));
            var path = await app.Backup.ExportDataAsync(folder);
            var bytes = await File.ReadAllBytesAsync(path);
            Directory.Delete(folder, true);
            return Results.File(bytes, "application/zip", Path.GetFileName(path));
        }).RequireRateLimiting("heavy");
        api.MapPost("/backup/dump", async (AppServices app, CancellationToken ct) =>
        {
            var folder = Path.Combine(Path.GetTempPath(), "furnishop-dump-" + Guid.NewGuid().ToString("N"));
            var path = await app.Backup.BackupAsync(folder, ct);
            var bytes = await File.ReadAllBytesAsync(path, ct);
            Directory.Delete(folder, true);
            return Results.File(bytes, "application/octet-stream", Path.GetFileName(path));
        }).RequireRateLimiting("heavy");
    }
}
