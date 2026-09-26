using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FurniShop.Core.Domain;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace FurniShop.Tests;

/// <summary>Runs the real ASP.NET Core pipeline (auth cookie, CSRF, rate limits, error mapping) against a test database.</summary>
public sealed class WebFixture : IAsyncLifetime
{
    public DbFixture Db { get; } = new();
    public WebApplicationFactory<Program> Factory { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        await Db.InitializeAsync();
        if (!DbFactAttribute.Available) return;
        await new Infrastructure.Database.DemoDataSeeder(Db.App).SeedAsync();
        Factory = new WebApplicationFactory<Program>().WithWebHostBuilder(b => b.UseSetting("ConnectionStrings:FurniShop", Db.ConnectionString));
    }

    public async Task DisposeAsync()
    {
        if (Factory is not null) await Factory.DisposeAsync();
        await Db.DisposeAsync();
    }

    public ApiClient Client() => new(Factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true, AllowAutoRedirect = false }));
}

/// <summary>Browser-like client: keeps cookies and echoes the XSRF token on unsafe requests.</summary>
public sealed class ApiClient(HttpClient http)
{
    private string? _xsrf;
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private void Capture(HttpResponseMessage r)
    {
        if (!r.Headers.TryGetValues("Set-Cookie", out var cookies)) return;
        foreach (var c in cookies.Where(c => c.StartsWith("XSRF-TOKEN=")))
            _xsrf = Uri.UnescapeDataString(c[11..c.IndexOf(';')]);
    }

    public async Task<HttpResponseMessage> GetAsync(string url)
    {
        var r = await http.GetAsync(url);
        Capture(r);
        return r;
    }

    public Task<HttpResponseMessage> PostAsync(string url, object? body = null, bool withToken = true) => SendAsync(HttpMethod.Post, url, body, withToken);

    public async Task<HttpResponseMessage> SendAsync(HttpMethod method, string url, object? body = null, bool withToken = true)
    {
        using var req = new HttpRequestMessage(method, url) { Content = JsonContent.Create(body ?? new { }) };
        if (withToken && _xsrf is not null) req.Headers.Add("X-XSRF-TOKEN", _xsrf);
        var r = await http.SendAsync(req);
        Capture(r);
        return r;
    }

    public async Task<JsonElement> JsonAsync(HttpResponseMessage r)
    {
        var text = await r.Content.ReadAsStringAsync();
        return string.IsNullOrEmpty(text) ? default : JsonDocument.Parse(text).RootElement.Clone();
    }

    public async Task<HttpResponseMessage> LoginAsync(string user, string password)
    {
        await GetAsync("/api/auth/csrf");
        return await PostAsync("/api/auth/login", new { username = user, password });
    }
}

public class ApiTests(WebFixture w) : IClassFixture<WebFixture>
{
    [DbFact]
    public async Task Unsafe_requests_need_the_antiforgery_token_and_apis_need_a_session()
    {
        var c = w.Client();
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/api/dashboard")).StatusCode);
        var noToken = await c.PostAsync("/api/auth/login", new { username = "admin", password = DbFixture.AdminPassword }, withToken: false);
        Assert.Equal(HttpStatusCode.BadRequest, noToken.StatusCode);
        Assert.Equal("csrf", (await c.JsonAsync(noToken)).GetProperty("code").GetString());

        var ok = await c.LoginAsync("admin", DbFixture.AdminPassword);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var me = await c.JsonAsync(ok);
        Assert.True(me.GetProperty("canSeeCost").GetBoolean());

        var headers = await c.GetAsync("/api/auth/status");
        Assert.Contains("default-src 'self'", headers.Headers.GetValues("Content-Security-Policy").Single());
        Assert.Equal("nosniff", headers.Headers.GetValues("X-Content-Type-Options").Single());

        foreach (var url in new[]
                 {
                     "/api/dashboard?from=2026-01-01", "/api/lookups", "/api/products?pageSize=5&sortBy=price&sortDescending=true", "/api/products/facets",
                     "/api/inventory?state=LOW", "/api/inventory/summary", "/api/inventory/movements?group=in", "/api/customers?outstanding=true",
                     "/api/invoices?paymentState=OUTSTANDING", "/api/quotations", "/api/sales-orders?open=true", "/api/payments", "/api/returns",
                     "/api/exchanges", "/api/custom-orders", "/api/deliveries/board", "/api/installations", "/api/expenses", "/api/purchases",
                     "/api/purchase-returns", "/api/suppliers", "/api/supplier-payments", "/api/gst/dashboard", "/api/gst/sales?type=B2B",
                     $"/api/gst/hsn?from={DateTime.Today.AddDays(-90):yyyy-MM-dd}&to={DateTime.Today:yyyy-MM-dd}", "/api/users", "/api/roles",
                     "/api/audit?pageSize=10", "/api/settings", "/api/reports", "/api/search?q=sofa", "/api/notifications", "/api/brands", "/api/pos/recent",
                     "/api/warehouses", "/api/warehouses/stock", "/api/transfers?status=OPEN", "/api/raw-materials?low=true", "/api/raw-materials/categories",
                     "/api/raw-materials/movements", "/api/boms", "/api/production/board", "/api/production?status=OPEN",
                     "/api/warranties?status=EXPIRING", "/api/service?status=OPEN", "/api/leads?status=OPEN", "/api/leads/pipeline", "/api/follow-ups?scope=today&mine=true",
                     "/api/cash", "/api/cash/history",
                 })
        {
            var r = await c.GetAsync(url);
            Assert.True(r.StatusCode == HttpStatusCode.OK, $"{url} → {(int)r.StatusCode} {await r.Content.ReadAsStringAsync()}");
        }

        var bad = await c.GetAsync("/api/products?page=abc");
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.True((await c.JsonAsync(bad)).GetProperty("errors").TryGetProperty("page", out _));
    }

    [DbFact]
    public async Task Sales_staff_can_bill_but_never_see_cost_or_restricted_modules()
    {
        var c = w.Client();
        Assert.Equal(HttpStatusCode.OK, (await c.LoginAsync("sales1", Infrastructure.Database.DemoDataSeeder.DemoPassword)).StatusCode);

        foreach (var url in new[] { "/api/settings", "/api/gst/dashboard", "/api/users", "/api/audit", "/api/purchases" })
            Assert.Equal(HttpStatusCode.Forbidden, (await c.GetAsync(url)).StatusCode);
        // Production is visible to sales staff, but never its costs.
        var board = await c.JsonAsync(await c.GetAsync("/api/production/board"));
        Assert.All(board.EnumerateArray(), o => Assert.Equal(JsonValueKind.Null, o.GetProperty("labourCost").ValueKind));
        Assert.Equal(HttpStatusCode.Forbidden, (await c.PostAsync("/api/raw-materials", new { name = "x", category = "x", unit = "x" })).StatusCode);

        var products = await c.JsonAsync(await c.GetAsync("/api/products?pageSize=50"));
        Assert.All(products.GetProperty("items").EnumerateArray(), p => Assert.Equal(JsonValueKind.Null, p.GetProperty("costPrice").ValueKind));
        var items = await c.JsonAsync(await c.GetAsync("/api/sellable?search=chair&limit=5"));
        var item = items.EnumerateArray().First(i => i.GetProperty("available").GetDecimal() > 0);
        Assert.Equal(JsonValueKind.Null, item.GetProperty("costPrice").ValueKind);

        // Live totals come from the server's GST calculator.
        var walkIn = await c.JsonAsync(await c.GetAsync("/api/customers/walk-in"));
        var doc = new
        {
            customerId = walkIn.GetProperty("id").GetInt64(),
            lines = new[]
            {
                new { variantId = item.GetProperty("variantId").GetInt64(), quantity = 1m, unitPrice = item.GetProperty("sellingPrice").GetDecimal(),
                      priceIncludesGst = item.GetProperty("priceIncludesGst").GetBoolean(), gstRate = item.GetProperty("gstRate").GetDecimal() },
            },
        };
        var preview = await c.JsonAsync(await c.PostAsync("/api/sales/preview", doc));
        var total = preview.GetProperty("totals").GetProperty("grandTotal").GetDecimal();
        Assert.True(total > 0);
        Assert.Equal(JsonValueKind.Null, preview.GetProperty("lines")[0].GetProperty("unitCost").ValueKind);

        // Cash sale through the API.
        var checkout = await c.PostAsync("/api/invoices/checkout", new { document = doc, payments = new[] { new { methodCode = "CASH", amount = total } }, useAdvance = 0 });
        Assert.True(checkout.IsSuccessStatusCode, await checkout.Content.ReadAsStringAsync());
        var result = await c.JsonAsync(checkout);
        Assert.StartsWith("INV-", result.GetProperty("invoiceNumber").GetString());
        var invoice = await c.JsonAsync(await c.GetAsync($"/api/invoices/{result.GetProperty("invoiceId").GetInt64()}"));
        Assert.Equal(0m, invoice.GetProperty("invoice").GetProperty("balance").GetDecimal());

        // Business rule errors come back as readable 409s; a credit sale to walk-in is refused.
        var credit = await c.PostAsync("/api/invoices/checkout", new { document = doc, payments = Array.Empty<object>(), useAdvance = 0 });
        Assert.Equal(HttpStatusCode.Conflict, credit.StatusCode);
        Assert.Contains("customer", (await c.JsonAsync(credit)).GetProperty("title").GetString(), StringComparison.OrdinalIgnoreCase);

        var pdf = await c.GetAsync($"/api/invoices/{result.GetProperty("invoiceId").GetInt64()}/pdf");
        Assert.Equal("application/pdf", pdf.Content.Headers.ContentType!.MediaType);
    }

    [DbFact]
    public async Task New_staff_must_change_password_and_disabled_staff_lose_their_session_immediately()
    {
        var admin = w.Client();
        await admin.LoginAsync("admin", DbFixture.AdminPassword);
        var roles = await admin.JsonAsync(await admin.GetAsync("/api/roles"));
        var salesRole = roles.GetProperty("roles").EnumerateArray().First(r => r.GetProperty("role").GetProperty("code").GetString() == "SALES")
            .GetProperty("role").GetProperty("id").GetInt64();
        var created = await admin.PostAsync("/api/users", new { user = new { username = "newbie", fullName = "New Staff", roleId = salesRole, isActive = true }, password = "Start@1234" });
        Assert.True(created.IsSuccessStatusCode, await created.Content.ReadAsStringAsync());
        var userId = (await admin.JsonAsync(created)).GetProperty("id").GetInt64();

        var staff = w.Client();
        var login = await admin.JsonAsync(await staff.LoginAsync("newbie", "Start@1234"));
        Assert.True(login.GetProperty("mustChangePassword").GetBoolean());
        var blocked = await staff.GetAsync("/api/dashboard");
        Assert.Equal(HttpStatusCode.Forbidden, blocked.StatusCode);
        Assert.Equal("password_change_required", (await staff.JsonAsync(blocked)).GetProperty("code").GetString());
        Assert.Equal(HttpStatusCode.OK, (await staff.PostAsync("/api/auth/change-password", new { current = "Start@1234", newPassword = "Better@5678" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await staff.GetAsync("/api/customers?pageSize=1")).StatusCode);

        // Owner disables the account → the very next request is rejected.
        var put = await admin.SendAsync(HttpMethod.Put, $"/api/users/{userId}",
            new { user = new { username = "newbie", fullName = "New Staff", roleId = salesRole, isActive = false }, password = (string?)null });
        Assert.True(put.IsSuccessStatusCode, await put.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Unauthorized, (await staff.GetAsync("/api/customers?pageSize=1")).StatusCode);
    }

    [DbFact]
    public async Task Sign_in_is_rate_limited()
    {
        // A separate server instance so this test's limiter does not affect the others (the test server has one client address).
        await using var isolated = w.Factory.WithWebHostBuilder(_ => { });
        var c = new ApiClient(isolated.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true }));
        await c.GetAsync("/api/auth/csrf");
        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 12; i++)
            statuses.Add((await c.PostAsync("/api/auth/login", new { username = "ghost" + i, password = "wrong" })).StatusCode);
        Assert.Contains(HttpStatusCode.TooManyRequests, statuses);
    }
}
