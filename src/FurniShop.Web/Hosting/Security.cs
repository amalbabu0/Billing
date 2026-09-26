using System.Security.Claims;
using System.Text.Json;
using System.Threading.RateLimiting;
using Dapper;
using FurniShop.Core;
using FurniShop.Infrastructure;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Caching.Memory;
using Npgsql;

namespace FurniShop.Web.Hosting;

/// <summary>The signed-in user for this HTTP request. Every service call checks permissions against it.</summary>
public sealed class RequestSession
{
    public UserSession Session { get; } = new();
    public bool MustChangePassword { get; set; }
}

public sealed record CachedUser(long Id, string Username, string FullName, string RoleCode, string RoleName, string[] Permissions,
    bool Active, long Stamp, bool MustChangePassword);

/// <summary>
/// Users and their role permissions, cached for a few seconds so each request does not hit the database.
/// A cookie is only honoured while the user is active and their password (stamp) has not changed.
/// </summary>
public sealed class UserDirectory(Db db, IMemoryCache cache)
{
    private static long _generation;

    public async Task<CachedUser?> GetAsync(long id) =>
        await cache.GetOrCreateAsync($"user:{Interlocked.Read(ref _generation)}:{id}", async e =>
        {
            e.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(20);
            var u = await db.QuerySingleOrDefaultAsync<UserRow>("""
                select u.id, u.username, u.full_name, r.code as role_code, r.name as role_name, (u.is_active and not u.is_deleted) as active,
                       (extract(epoch from u.password_changed_at) * 1000)::bigint as stamp, u.must_change_password,
                       array(select permission_code from role_permissions rp where rp.role_id = u.role_id) as permissions
                from users u join roles r on r.id = u.role_id where u.id = @id
                """, new { id });
            return u is null ? null : new CachedUser(u.Id, u.Username, u.FullName, u.RoleCode, u.RoleName, u.Permissions, u.Active, u.Stamp, u.MustChangePassword);
        });

    /// <summary>Called after users, roles or permissions change so the next request sees the new rights.</summary>
    public static void InvalidateAll() => Interlocked.Increment(ref _generation);

    private sealed class UserRow
    {
        public long Id { get; set; }
        public string Username { get; set; } = "";
        public string FullName { get; set; } = "";
        public string RoleCode { get; set; } = "";
        public string RoleName { get; set; } = "";
        public bool Active { get; set; }
        public long Stamp { get; set; }
        public bool MustChangePassword { get; set; }
        public string[] Permissions { get; set; } = Array.Empty<string>();
    }
}

public static class Security
{
    public const string Scheme = CookieAuthenticationDefaults.AuthenticationScheme;
    public const string XsrfCookie = "XSRF-TOKEN";

    public static void AddFurniShopSecurity(this IServiceCollection services, IConfiguration config)
    {
        var hours = config.GetValue("FurniShop:SessionHours", 10);
        services.AddAuthentication(Scheme).AddCookie(o =>
        {
            o.Cookie.Name = "fs_session";
            o.Cookie.HttpOnly = true;
            o.Cookie.SameSite = SameSiteMode.Strict;
            o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
            o.ExpireTimeSpan = TimeSpan.FromHours(hours);
            o.SlidingExpiration = true;
            // An API never redirects to a login page — the client shows its own sign-in screen.
            o.Events.OnRedirectToLogin = c => { c.Response.StatusCode = 401; return Task.CompletedTask; };
            o.Events.OnRedirectToAccessDenied = c => { c.Response.StatusCode = 403; return Task.CompletedTask; };
        });
        services.AddAuthorization();
        services.AddAntiforgery(o =>
        {
            o.HeaderName = "X-XSRF-TOKEN";
            o.Cookie.Name = "fs_af";
            o.Cookie.SameSite = SameSiteMode.Strict;
            o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        });
        services.AddMemoryCache();
        services.AddSingleton<UserDirectory>();
        services.AddScoped<RequestSession>();
        services.AddScoped(sp => new AppServices(sp.GetRequiredService<Db>(), sp.GetRequiredService<RequestSession>().Session));

        services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = 429;
            o.OnRejected = async (ctx, ct) =>
            {
                if (ctx.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retry))
                    ctx.HttpContext.Response.Headers.RetryAfter = ((int)retry.TotalSeconds).ToString();
                await Errors.WriteAsync(ctx.HttpContext, 429, "Too many requests. Please wait a moment and try again.", code: "rate_limited");
            };
            // Sign-in: 10 attempts per 5 minutes per address (the account lock-out applies on top of this).
            o.AddPolicy("login", ctx => RateLimitPartition.GetFixedWindowLimiter(ClientKey(ctx),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(5), QueueLimit = 0 }));
            // Exports, PDFs and backups are expensive.
            o.AddPolicy("heavy", ctx => RateLimitPartition.GetFixedWindowLimiter(ClientKey(ctx),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 40, Window = TimeSpan.FromMinutes(1), QueueLimit = 2 }));
            // Everything else under /api: generous burst for a busy counter, bounded sustained rate.
            o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
                ctx.Request.Path.StartsWithSegments("/api")
                    ? RateLimitPartition.GetTokenBucketLimiter(ClientKey(ctx), _ => new TokenBucketRateLimiterOptions
                    {
                        TokenLimit = 240, TokensPerPeriod = 120, ReplenishmentPeriod = TimeSpan.FromSeconds(30), QueueLimit = 20,
                        AutoReplenishment = true,
                    })
                    : RateLimitPartition.GetNoLimiter("static"));
        });
    }

    private static string ClientKey(HttpContext ctx) =>
        ctx.User.FindFirstValue("uid") is { } uid ? "u:" + uid : "ip:" + (ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown");

    public static ClaimsPrincipal Principal(CachedUser u, bool mustChange) => new(new ClaimsIdentity(new[]
    {
        new Claim("uid", u.Id.ToString()), new Claim("stamp", u.Stamp.ToString()), new Claim(ClaimTypes.Name, u.Username),
        new Claim("mcp", mustChange ? "1" : "0"),
    }, Scheme));

    /// <summary>Rebuilds the service-layer session from the auth cookie on every request.</summary>
    public static IApplicationBuilder UseRequestSession(this IApplicationBuilder app) => app.Use(async (ctx, next) =>
    {
        var rs = ctx.RequestServices.GetRequiredService<RequestSession>();
        rs.Session.ClientIp = ctx.Connection.RemoteIpAddress?.ToString();
        var ua = ctx.Request.Headers.UserAgent.ToString();
        rs.Session.ClientDevice = ua.Length > 120 ? ua[..120] : ua;

        if (ctx.User.Identity?.IsAuthenticated == true && long.TryParse(ctx.User.FindFirstValue("uid"), out var uid))
        {
            var u = await ctx.RequestServices.GetRequiredService<UserDirectory>().GetAsync(uid);
            if (u is null || !u.Active || u.Stamp.ToString() != ctx.User.FindFirstValue("stamp"))
            {
                await ctx.SignOutAsync(Scheme);
                ctx.User = new ClaimsPrincipal(new ClaimsIdentity());
            }
            else
            {
                rs.Session.SignIn(u.Id, u.Username, u.FullName, u.RoleCode, u.RoleName, u.Permissions);
                rs.MustChangePassword = ctx.User.FindFirstValue("mcp") == "1" || u.MustChangePassword;
            }
        }
        await next();
    });

    /// <summary>Unsafe API requests must echo the anti-forgery token (double-submit cookie + header).</summary>
    public static IApplicationBuilder UseCsrfProtection(this IApplicationBuilder app) => app.Use(async (ctx, next) =>
    {
        if (ctx.Request.Path.StartsWithSegments("/api") && !HttpMethods.IsGet(ctx.Request.Method)
            && !HttpMethods.IsHead(ctx.Request.Method) && !HttpMethods.IsOptions(ctx.Request.Method))
        {
            var af = ctx.RequestServices.GetRequiredService<IAntiforgery>();
            if (!await af.IsRequestValidAsync(ctx))
            {
                await Errors.WriteAsync(ctx, 400, "Your session security token has expired. Refresh the page and try again.", code: "csrf");
                return;
            }
        }
        await next();
    });

    /// <summary>Issues a fresh anti-forgery token readable by the client script (for the header).</summary>
    public static void IssueXsrf(HttpContext ctx)
    {
        var tokens = ctx.RequestServices.GetRequiredService<IAntiforgery>().GetAndStoreTokens(ctx);
        ctx.Response.Cookies.Append(XsrfCookie, tokens.RequestToken!, new CookieOptions
        {
            HttpOnly = false, SameSite = SameSiteMode.Strict, Secure = ctx.Request.IsHttps, Path = "/",
        });
    }

    public static IApplicationBuilder UseSecurityHeaders(this IApplicationBuilder app) => app.Use(async (ctx, next) =>
    {
        var h = ctx.Response.Headers;
        h["X-Content-Type-Options"] = "nosniff";
        h["Referrer-Policy"] = "same-origin";
        h["X-Frame-Options"] = "SAMEORIGIN";
        h["Cross-Origin-Opener-Policy"] = "same-origin";
        h["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=(), payment=()";
        // No inline scripts anywhere; documents (PDF previews) may be framed by the app itself only.
        h["Content-Security-Policy"] =
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; " +
            "connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
        if (ctx.Request.IsHttps) h["Strict-Transport-Security"] = "max-age=31536000";
        if (ctx.Request.Path.StartsWithSegments("/api")) h.CacheControl = "no-store";
        await next();
    });
}

/// <summary>Maps service-layer exceptions to JSON problem responses the client can show next to fields.</summary>
public static class Errors
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static Task WriteAsync(HttpContext ctx, int status, string title, IReadOnlyDictionary<string, string>? errors = null, string? code = null)
    {
        if (ctx.Response.HasStarted) return Task.CompletedTask;
        ctx.Response.Clear();
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/problem+json";
        var fieldErrors = errors?.ToDictionary(kv => char.ToLowerInvariant(kv.Key[0]) + kv.Key[1..], kv => kv.Value);
        return ctx.Response.WriteAsync(JsonSerializer.Serialize(new { status, title, code, errors = fieldErrors, traceId = ctx.TraceIdentifier }, Json));
    }

    public static IApplicationBuilder UseApiErrors(this IApplicationBuilder app) => app.Use(async (ctx, next) =>
    {
        try
        {
            await next();
        }
        catch (ValidationException ex)
        {
            await WriteAsync(ctx, 400, ex.Errors.Count == 1 ? ex.Errors.Values.First() : "Please correct the highlighted fields.", ex.Errors, "validation");
        }
        catch (CreditLimitException ex) { await WriteAsync(ctx, 409, ex.Message, code: ex.CanOverride ? "credit_limit_overridable" : "credit_limit"); }
        catch (BusinessRuleException ex) { await WriteAsync(ctx, 409, ex.Message, code: "rule"); }
        catch (ConcurrencyException ex) { await WriteAsync(ctx, 409, ex.Message, code: "concurrency"); }
        catch (NotFoundException ex) { await WriteAsync(ctx, 404, ex.Message, code: "not_found"); }
        catch (PermissionDeniedException ex)
        {
            var status = ex.Permission == "not signed in" ? 401 : 403;
            var i = ex.Permission.IndexOf(": ", StringComparison.Ordinal);
            var msg = i >= 0 ? ex.Permission[(i + 2)..] : status == 401 ? "Please sign in again." : "You don't have permission to do this. Ask the owner or a manager.";
            await WriteAsync(ctx, status, char.ToUpperInvariant(msg[0]) + msg[1..], code: status == 401 ? "unauthenticated" : "forbidden");
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            await WriteAsync(ctx, 409, "This record already exists (a number, code or SKU is already used).", code: "duplicate");
        }
        catch (PostgresException ex) when (ex.SqlState is PostgresErrorCodes.CheckViolation or PostgresErrorCodes.ForeignKeyViolation or PostgresErrorCodes.RaiseException)
        {
            ctx.RequestServices.GetRequiredService<ILogger<RequestSession>>().LogWarning(ex, "Data rule rejected a change");
            await WriteAsync(ctx, 409, "The change was rejected because it would break a data rule (for example, stock or payment history).", code: "constraint");
        }
        catch (Exception ex) when (ex is BadHttpRequestException or JsonException or FormatException or ArgumentException)
        {
            await WriteAsync(ctx, 400, "The request could not be understood.", code: "bad_request");
        }
        catch (OperationCanceledException) when (ctx.RequestAborted.IsCancellationRequested)
        {
            // client went away
        }
        catch (Exception ex)
        {
            ctx.RequestServices.GetRequiredService<ILogger<RequestSession>>().LogError(ex, "Unhandled error on {Path}", ctx.Request.Path);
            await WriteAsync(ctx, 500, "Something went wrong on the server. Please try again; if it keeps happening, note the reference and contact support.", code: "server");
        }
    });
}
