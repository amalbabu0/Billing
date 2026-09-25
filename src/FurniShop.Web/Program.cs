using System.Text.Json;
using System.Text.Json.Serialization;
using FurniShop.Infrastructure.Database;
using FurniShop.Web.Endpoints;
using FurniShop.Web.Hosting;
using Microsoft.AspNetCore.HttpOverrides;

var builder = WebApplication.CreateBuilder(args);

// Connection string: appsettings / user-secrets "ConnectionStrings:FurniShop" or the FURNISHOP_DB environment variable.
// Neon URLs (postgresql://user:pass@host/db) are accepted too.
var cs = builder.Configuration.GetConnectionString("FurniShop");
if (string.IsNullOrWhiteSpace(cs)) cs = Environment.GetEnvironmentVariable("FURNISHOP_DB");
if (string.IsNullOrWhiteSpace(cs))
    throw new InvalidOperationException("Set the database connection string in ConnectionStrings:FurniShop or the FURNISHOP_DB environment variable.");
cs = ConnectionStringParser.Normalise(cs);

builder.Services.AddSingleton(new Db(cs));
builder.Services.AddFurniShopSecurity(builder.Configuration);
builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
    o.SerializerOptions.NumberHandling = JsonNumberHandling.AllowReadingFromString;
});
builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(o => o.MultipartBodyLengthLimit = 6 * 1024 * 1024);
builder.WebHost.ConfigureKestrel(k => k.Limits.MaxRequestBodySize = 8 * 1024 * 1024);
if (builder.Configuration.GetValue("FurniShop:TrustForwardedHeaders", false))
    builder.Services.Configure<ForwardedHeadersOptions>(o =>
    {
        o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        o.KnownNetworks.Clear();
        o.KnownProxies.Clear();
    });

var app = builder.Build();

// Schema migrations run under an advisory lock, so several instances can start together safely.
using (var scope = app.Services.CreateScope())
    await new Migrator(scope.ServiceProvider.GetRequiredService<Db>()).MigrateAsync();

if (builder.Configuration.GetValue("FurniShop:TrustForwardedHeaders", false)) app.UseForwardedHeaders();
app.UseSecurityHeaders();
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = c =>
    {
        // Hashed build assets are immutable; index.html must always be revalidated.
        c.Context.Response.Headers.CacheControl = c.File.Name.EndsWith(".html", StringComparison.OrdinalIgnoreCase)
            ? "no-cache" : "public, max-age=31536000, immutable";
    },
});
app.UseApiErrors();
app.UseAuthentication();
app.UseRequestSession();
app.UseRateLimiter();
app.UseCsrfProtection();
app.UseAuthorization();

app.MapFurniShopApi();

// Client-side routes fall back to the single-page app.
app.MapFallback(async ctx =>
{
    if (ctx.Request.Path.StartsWithSegments("/api"))
    {
        await Errors.WriteAsync(ctx, 404, "Not found.", code: "not_found");
        return;
    }
    var index = Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "index.html");
    if (!File.Exists(index))
    {
        ctx.Response.StatusCode = 503;
        await ctx.Response.WriteAsync("The web client has not been built. Run: cd web && npm install && npm run build");
        return;
    }
    ctx.Response.ContentType = "text/html; charset=utf-8";
    ctx.Response.Headers.CacheControl = "no-cache";
    await ctx.Response.SendFileAsync(index);
});

app.Run();

public partial class Program;
