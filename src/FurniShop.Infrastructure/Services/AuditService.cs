using System.Text.Json;
using System.Text.Json.Serialization;
using Dapper;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

/// <summary>Append-only activity log. Financial actions are logged inside the same transaction as the change.</summary>
public sealed class AuditService(Db db, UserSession session)
{
    private static readonly JsonSerializerOptions Json = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        ReferenceHandler = ReferenceHandler.IgnoreCycles,
    };

    public Task LogAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, string action, string module,
        string summary, string? recordType = null, long? recordId = null, string? recordRef = null,
        object? oldValue = null, object? newValue = null) =>
        conn.ExecuteAsync("""
            insert into audit_logs (user_id, username, action, module, record_type, record_id, record_ref, summary,
                                    old_value, new_value, machine, ip_address)
            values (@UserId, @Username, @Action, @Module, @RecordType, @RecordId, @RecordRef, @Summary,
                    cast(@Old as jsonb), cast(@New as jsonb), @Machine, @Ip)
            """,
            new
            {
                session.UserId, Username = session.IsAuthenticated ? session.Username : "system", Action = action, Module = module,
                RecordType = recordType, RecordId = recordId, RecordRef = recordRef,
                Summary = $"{(session.IsAuthenticated ? session.FullName : "System")} {summary}",
                Old = Serialize(oldValue), New = Serialize(newValue),
                Machine = session.ClientDevice ?? UserSession.MachineName, Ip = session.ClientIp ?? UserSession.IpAddress,
            }, tx);

    public async Task LogAsync(string action, string module, string summary, string? recordType = null,
        long? recordId = null, string? recordRef = null, object? oldValue = null, object? newValue = null)
    {
        await using var conn = await db.OpenAsync();
        await LogAsync(conn, null, action, module, summary, recordType, recordId, recordRef, oldValue, newValue);
    }

    public async Task<PagedResult<AuditLog>> ListAsync(ListQuery q, string? module = null, long? userId = null)
    {
        session.Demand(Perm.AuditView);
        var where = """
            where (@From::date is null or occurred_at >= @From::date)
              and (@To::date is null or occurred_at < @To::date + 1)
              and (@Module::text is null or module = @Module)
              and (@UserId::bigint is null or user_id = @UserId)
              and (@Search::text is null or summary ilike '%' || @Search || '%' or record_ref ilike '%' || @Search || '%')
            """;
        var args = new { q.From, q.To, Module = module, UserId = userId, Search = Blank(q.Search), q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from audit_logs {where}", args);
        var items = await conn.QueryAsync<AuditLog>($"""
            select id, occurred_at, user_id, username, action, module, record_type, record_id, record_ref, summary,
                   old_value::text as old_value, new_value::text as new_value, machine, ip_address
            from audit_logs {where} order by occurred_at desc, id desc limit @PageSize offset @Offset
            """, args);
        return new PagedResult<AuditLog> { Items = items.AsList(), TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    public async Task<IReadOnlyList<AuditLog>> ForRecordAsync(string recordType, long recordId)
    {
        await using var conn = await db.OpenAsync();
        return (await conn.QueryAsync<AuditLog>("""
            select id, occurred_at, username, action, module, record_type, record_id, record_ref, summary,
                   old_value::text as old_value, new_value::text as new_value, machine
            from audit_logs where record_type = @recordType and record_id = @recordId order by occurred_at
            """, new { recordType, recordId })).AsList();
    }

    public static string? Serialize(object? value) => value switch
    {
        null => null,
        string s => JsonSerializer.Serialize(new { value = s }),
        _ => JsonSerializer.Serialize(value, value.GetType(), Json),
    };

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
