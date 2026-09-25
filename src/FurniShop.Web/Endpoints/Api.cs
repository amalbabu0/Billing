using System.Data;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Core.Settings;
using FurniShop.Core.Validation;
using FurniShop.Infrastructure;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Documents;
using FurniShop.Infrastructure.Services;
using FurniShop.Web.Hosting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;

namespace FurniShop.Web.Endpoints;

public static partial class Api
{
    /// <summary>
    /// All JSON endpoints live under /api. Every one requires a signed-in user except the auth group; the permission
    /// checks themselves happen inside the service layer, so the API can never expose more than the services allow.
    /// </summary>
    public static void MapFurniShopApi(this WebApplication app)
    {
        var root = app.MapGroup("/api");
        MapAuth(root.MapGroup("/auth").AllowAnonymous());

        var api = root.MapGroup("").RequireAuthorization().AddEndpointFilter(async (ctx, next) =>
        {
            var rs = ctx.HttpContext.RequestServices.GetRequiredService<RequestSession>();
            if (rs.MustChangePassword)
                return Problem(403, "Please set a new password to continue.", "password_change_required");
            return await next(ctx);
        });

        MapCommon(api);
        MapCatalog(api);
        MapInventory(api);
        MapCustomers(api);
        MapSales(api);
        MapPayments(api);
        MapOperations(api);
        MapPurchases(api);
        MapGst(api);
        MapReports(api);
        MapAdmin(api);
    }

    // ------------------------------------------------------------------ helpers
    public static IResult Problem(int status, string title, string? code = null) =>
        Results.Json(new { status, title, code }, statusCode: status, contentType: "application/problem+json");

    public static ListQuery Clamp(this ListQuery q)
    {
        q.Page = Math.Max(1, q.Page);
        q.PageSize = Math.Clamp(q.PageSize, 1, 500);
        return q;
    }

    public static IResult Pdf(byte[] data, string name, bool download = false) =>
        Results.File(data, "application/pdf", download ? Safe(name) + ".pdf" : null, enableRangeProcessing: false);

    public static string Safe(string name) =>
        new string(name.Select(c => char.IsLetterOrDigit(c) || c is '-' or '_' or ' ' ? c : '-').ToArray()).Trim();

    public static object WhatsApp(AppSettingsSnapshot s, string? mobile, string message) => new
    {
        mobile, message,
        link = Core.Messaging.MessageTemplates.WhatsAppLink(mobile, message, s.WhatsApp.CountryCode, false),
    };

    // ------------------------------------------------------------------ auth
    public sealed record LoginRequest(string Username, string Password);
    public sealed record ChangePasswordRequest(string Current, string NewPassword);
    public sealed record SetupRequest(string ShopName, string StateCode, string? Gstin, string FullName, string Username, string Password, bool LoadDemo);

    private static void MapAuth(RouteGroupBuilder auth)
    {
        auth.MapGet("/csrf", (HttpContext ctx) => { Security.IssueXsrf(ctx); return Results.NoContent(); });

        auth.MapGet("/status", async (AppServices app) => new { needsSetup = await app.Auth.NeedsInitialSetupAsync() });

        auth.MapPost("/setup", async (SetupRequest r, AppServices app, UserDirectory dir, HttpContext ctx) =>
        {
            if (!await app.Auth.NeedsInitialSetupAsync()) return Problem(409, "This shop is already set up. Sign in instead.", "already_setup");
            if (IndianStates.ByCode(r.StateCode) is null) throw new ValidationException("StateCode", "Select the shop's state.");
            await app.Auth.CreateInitialAdminAsync(r.Username, r.FullName, r.Password);
            var login = await app.Auth.LoginAsync(r.Username, r.Password);
            if (login.Outcome != LoginOutcome.Success) return Problem(401, login.Message);
            var s = await app.Settings.GetAsync(true);
            s.Shop.ShopName = r.ShopName.Trim();
            s.Shop.StateCode = r.StateCode;
            s.Shop.Gstin = Validators.Clean(r.Gstin)?.ToUpperInvariant();
            if (s.Shop.Gstin is null) s.Tax.GstRegistered = false;
            await app.Settings.SaveAsync("shop", s.Shop);
            await app.Settings.SaveAsync("tax", s.Tax);
            if (r.LoadDemo) await new DemoDataSeeder(app).SeedAsync();
            return await SignInAsync(ctx, app, dir, false);
        }).RequireRateLimiting("login");

        auth.MapPost("/login", async (LoginRequest r, AppServices app, UserDirectory dir, HttpContext ctx) =>
        {
            var res = await app.Auth.LoginAsync(r.Username ?? "", r.Password ?? "");
            if (res.Outcome != LoginOutcome.Success)
                return Problem(401, res.Message, res.Outcome switch
                {
                    LoginOutcome.LockedOut => "locked", LoginOutcome.Disabled => "disabled", _ => "invalid_credentials",
                });
            return await SignInAsync(ctx, app, dir, res.MustChangePassword);
        }).RequireRateLimiting("login");

        auth.MapPost("/logout", async (AppServices app, HttpContext ctx) =>
        {
            if (app.Session.IsAuthenticated) await app.Auth.LogoutAsync();
            await ctx.SignOutAsync(Security.Scheme);
            ctx.User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity());
            Security.IssueXsrf(ctx);
            return Results.NoContent();
        });

        auth.MapGet("/me", async (AppServices app, RequestSession rs) =>
            app.Session.IsAuthenticated ? Results.Ok(await MeAsync(app, rs.MustChangePassword)) : Results.NoContent());

        auth.MapPost("/change-password", async (ChangePasswordRequest r, AppServices app, UserDirectory dir, HttpContext ctx) =>
        {
            if (!app.Session.IsAuthenticated) return Problem(401, "Please sign in.", "unauthenticated");
            await app.Auth.ChangePasswordAsync(r.Current ?? "", r.NewPassword ?? "");
            UserDirectory.InvalidateAll();
            return await SignInAsync(ctx, app, dir, false);
        }).RequireRateLimiting("login");
    }

    private static async Task<IResult> SignInAsync(HttpContext ctx, AppServices app, UserDirectory dir, bool mustChange)
    {
        UserDirectory.InvalidateAll();
        var u = await dir.GetAsync(app.Session.UserId!.Value) ?? throw new PermissionDeniedException("not signed in");
        var principal = Security.Principal(u, mustChange);
        await ctx.SignInAsync(Security.Scheme, principal);
        ctx.User = principal;
        Security.IssueXsrf(ctx); // anti-forgery tokens are bound to the signed-in identity
        return Results.Ok(await MeAsync(app, mustChange));
    }

    private static async Task<object> MeAsync(AppServices app, bool mustChange)
    {
        var s = await app.Settings.GetAsync();
        var session = app.Session;
        return new
        {
            user = new { id = session.UserId, username = session.Username, fullName = session.FullName, roleCode = session.RoleCode, roleName = session.RoleName },
            permissions = session.Permissions.OrderBy(p => p).ToArray(),
            isAdmin = session.IsAdmin,
            canSeeCost = session.CanSeeCost,
            mustChangePassword = mustChange,
            shop = new
            {
                name = s.Shop.ShopName, s.Shop.Tagline, s.Shop.StateCode, stateName = IndianStates.NameOf(s.Shop.StateCode), s.Shop.Gstin,
                s.Shop.LogoAttachmentId, s.Shop.City, s.Shop.Phone, gstRegistered = s.Tax.GstRegistered,
            },
            security = new { s.Security.IdleTimeoutMinutes, s.Security.MinPasswordLength },
        };
    }

    // ------------------------------------------------------------------ common
    public sealed record ExportColumn(string Key, string Label, bool Money = false);
    public sealed record ExportRequest(string Title, string? Subtitle, string Format, List<ExportColumn> Columns, List<Dictionary<string, System.Text.Json.JsonElement>> Rows,
        List<ExportTotal>? Totals);
    public sealed record ExportTotal(string Label, string Value);

    private static void MapCommon(RouteGroupBuilder api)
    {
        api.MapGet("/lookups", async (AppServices app) =>
        {
            var s = await app.Settings.GetAsync();
            var session = app.Session;
            var canCatalog = session.HasAny(Perm.ProductView, Perm.InvoiceCreate, Perm.QuotationManage, Perm.PurchaseManage, Perm.ReportSales);
            return new
            {
                states = IndianStates.All.Select(x => new { code = x.Code, name = x.Name }),
                categories = canCatalog ? await app.Catalog.CategoriesAsync(true) : Array.Empty<Category>(),
                brands = canCatalog ? await app.Catalog.BrandsAsync() : Array.Empty<Brand>(),
                gstRates = await app.Settings.GstRatesAsync(true),
                hsnCodes = await app.Settings.HsnCodesAsync(),
                paymentMethods = await app.Settings.PaymentMethodsAsync(true),
                expenseCategories = session.HasAny(Perm.ExpenseView, Perm.ExpenseManage) ? await app.Expenses.CategoriesAsync() : Array.Empty<ExpenseCategory>(),
                staff = session.HasAny(Perm.DeliveryManage, Perm.InstallationManage)
                    ? (await app.Users.ActiveStaffAsync()).Select(u => new { u.Id, u.FullName, u.RoleCode, u.Mobile })
                    : Enumerable.Empty<object>(),
                defaults = new
                {
                    shopStateCode = s.Shop.StateCode, s.Tax.GstRegistered, s.Tax.DefaultGstRate, s.Tax.ChargesGstRate, s.Tax.DefaultPriceIncludesGst, s.Tax.DefaultHsn,
                    s.Invoice.DefaultDueDays, s.Invoice.QuotationValidityDays, s.Invoice.RoundOff, s.Invoice.DefaultPrintFormat,
                    s.Delivery.DefaultDeliveryCharge, s.Delivery.DefaultInstallationCharge, s.Delivery.RequireOtp,
                    s.Inventory.AllowNegativeStock, s.Printer.ThermalWidthMm,
                },
            };
        });

        api.MapGet("/search", async (string? q, AppServices app) =>
            string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2 ? Array.Empty<SearchResult>() : await app.Search.SearchAsync(q.Trim(), 5));

        api.MapGet("/notifications", async (AppServices app) => await app.Notifications.UnreadAsync());
        api.MapPost("/notifications/{id:long}/read", async (long id, AppServices app) =>
        {
            await app.Db.ExecuteAsync("update notifications set is_read = true where id = @id and (user_id is null or user_id = @uid)", new { id, uid = app.Session.UserId });
            return Results.NoContent();
        });
        api.MapPost("/notifications/read-all", async (AppServices app) => { await app.Notifications.MarkAllReadAsync(); return Results.NoContent(); });
        api.MapPost("/notifications/generate", async (AppServices app) => { await app.Notifications.GenerateDailyAsync(); return Results.NoContent(); });

        api.MapGet("/dashboard", async (DateTime? from, DateTime? to, AppServices app) =>
            await app.Workspace.OverviewAsync(from ?? DateTime.Today, to ?? DateTime.Today));

        // Files are served only to signed-in users, with their verified content type and never as active content.
        api.MapGet("/attachments/{id:long}", async (long id, AppServices app, HttpContext ctx) =>
        {
            var file = await app.Attachments.GetAsync(id);
            if (file is null) return Problem(404, "File not found.", "not_found");
            var (info, data) = file.Value;
            var session = app.Session;
            var allowed = info.OwnerType switch
            {
                "delivery" => session.HasAny(Perm.DeliveryView, Perm.DeliveryManage, Perm.CustomerView),
                "custom_order" => session.HasAny(Perm.CustomOrderView, Perm.CustomerView),
                "settings" or "product" or "variant" => true,
                _ => session.HasAny(Perm.CustomerView, Perm.ProductView),
            };
            if (!allowed) return Problem(403, "You don't have permission to view this file.", "forbidden");
            ctx.Response.Headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'";
            ctx.Response.Headers.CacheControl = "private, max-age=3600";
            return Results.File(data, info.ContentType);
        });

        api.MapPost("/attachments", async (IFormFile file, string ownerType, long? ownerId, string? purpose, AppServices app) =>
        {
            if (ownerType is not ("product" or "variant" or "custom_order" or "delivery" or "settings" or "customer"))
                throw new ValidationException("OwnerType", "Unknown attachment owner.");
            await using var stream = file.OpenReadStream();
            using var ms = new MemoryStream();
            await stream.CopyToAsync(ms);
            var id = await app.Attachments.SaveAsync(ms.ToArray(), file.FileName, ownerType, ownerId, purpose ?? "image");
            return new { id };
        }).DisableAntiforgery(); // the global X-XSRF-TOKEN header check (UseCsrfProtection) still applies

        // Any table on screen can be exported: the client sends the rows it is allowed to see.
        api.MapPost("/export", async (ExportRequest r, AppServices app) =>
        {
            app.Session.Demand(Perm.ExportData);
            if (r.Rows.Count > 20000) throw new ValidationException("Rows", "Too many rows to export at once — narrow the filters.");
            var table = new DataTable(r.Title);
            foreach (var c in r.Columns) table.Columns.Add(c.Label, c.Money ? typeof(decimal) : typeof(string));
            foreach (var row in r.Rows)
            {
                var dr = table.NewRow();
                foreach (var c in r.Columns)
                {
                    if (!row.TryGetValue(c.Key, out var v) || v.ValueKind is System.Text.Json.JsonValueKind.Null or System.Text.Json.JsonValueKind.Undefined) continue;
                    dr[c.Label] = c.Money
                        ? (v.ValueKind == System.Text.Json.JsonValueKind.Number ? v.GetDecimal() : decimal.TryParse(v.ToString(), out var d) ? d : DBNull.Value)
                        : v.ValueKind == System.Text.Json.JsonValueKind.String ? v.GetString() : v.ToString();
                }
                table.Rows.Add(dr);
            }
            var money = r.Columns.Where(c => c.Money).Select(c => c.Label).ToHashSet();
            var subtitle = r.Subtitle ?? DateTime.Now.ToString("dd-MMM-yyyy HH:mm");
            var name = Safe($"{r.Title} {DateTime.Today:yyyy-MM-dd}");
            await app.Audit.LogAsync("EXPORT", "Reports", $"exported {r.Title} ({r.Rows.Count} rows, {r.Format})");
            return r.Format switch
            {
                "csv" => Results.File(DocumentService.ToCsv(table, money), "text/csv; charset=utf-8", name + ".csv"),
                "xlsx" => Results.File(DocumentService.ToExcel(table, r.Title, subtitle, money), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name + ".xlsx"),
                "pdf" => Results.File(await app.Documents.ToPdfAsync(table, r.Title, subtitle, money,
                    (r.Totals ?? new()).Select(t => (t.Label, t.Value)).ToList()), "application/pdf", name + ".pdf"),
                _ => throw new ValidationException("Format", "Choose CSV, Excel or PDF."),
            };
        }).RequireRateLimiting("heavy");
    }
}
