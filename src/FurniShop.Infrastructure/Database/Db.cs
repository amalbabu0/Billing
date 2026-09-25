using System.Data;
using Dapper;
using Npgsql;

namespace FurniShop.Infrastructure.Database;

/// <summary>
/// Entry point to PostgreSQL (Neon). All SQL uses parameters (Dapper) — never string
/// concatenation of user input — which protects against SQL injection.
/// </summary>
public sealed class Db : IAsyncDisposable
{
    private readonly NpgsqlDataSource _dataSource;

    static Db()
    {
        // date / timestamptz map to DateTime in local time — the shop runs in one time zone (IST).
        AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);
        DefaultTypeMap.MatchNamesWithUnderscores = true;
    }

    public Db(string connectionString)
    {
        var builder = new NpgsqlConnectionStringBuilder(connectionString);
        if (string.IsNullOrEmpty(builder.ApplicationName)) builder.ApplicationName = "FurniShop";
        // Neon closes idle compute; keep pooled connections short-lived and retry friendly.
        if (builder.ConnectionIdleLifetime == 300) builder.ConnectionIdleLifetime = 60;
        if (builder.Timeout == 15) builder.Timeout = 30;
        ConnectionString = builder.ConnectionString;
        _dataSource = NpgsqlDataSource.Create(builder.ConnectionString);
    }

    public string ConnectionString { get; }

    public async Task<NpgsqlConnection> OpenAsync(CancellationToken ct = default)
    {
        // Neon may be waking from auto-suspend; retry transient failures a few times.
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return await _dataSource.OpenConnectionAsync(ct);
            }
            catch (NpgsqlException ex) when (ex.IsTransient && attempt < 4)
            {
                await Task.Delay(TimeSpan.FromMilliseconds(500 * attempt), ct);
            }
        }
    }

    /// <summary>Runs work in a single database transaction; commits on success, rolls back on any exception.</summary>
    public async Task<T> InTransactionAsync<T>(Func<NpgsqlConnection, NpgsqlTransaction, Task<T>> work,
        IsolationLevel isolation = IsolationLevel.ReadCommitted, CancellationToken ct = default)
    {
        await using var conn = await OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(isolation, ct);
        try
        {
            var result = await work(conn, tx);
            await tx.CommitAsync(ct);
            return result;
        }
        catch
        {
            try { await tx.RollbackAsync(CancellationToken.None); } catch { /* connection may be broken */ }
            throw;
        }
    }

    public Task InTransactionAsync(Func<NpgsqlConnection, NpgsqlTransaction, Task> work, CancellationToken ct = default) =>
        InTransactionAsync<bool>(async (c, t) => { await work(c, t); return true; }, IsolationLevel.ReadCommitted, ct);

    public async Task<IReadOnlyList<T>> QueryAsync<T>(string sql, object? args = null)
    {
        await using var conn = await OpenAsync();
        return (await conn.QueryAsync<T>(sql, args)).AsList();
    }

    public async Task<T?> QuerySingleOrDefaultAsync<T>(string sql, object? args = null)
    {
        await using var conn = await OpenAsync();
        return await conn.QuerySingleOrDefaultAsync<T>(sql, args);
    }

    public async Task<T> ScalarAsync<T>(string sql, object? args = null)
    {
        await using var conn = await OpenAsync();
        return await conn.ExecuteScalarAsync<T>(sql, args) ?? default!;
    }

    public async Task<int> ExecuteAsync(string sql, object? args = null)
    {
        await using var conn = await OpenAsync();
        return await conn.ExecuteAsync(sql, args);
    }

    /// <summary>Checks connectivity and returns the server version string.</summary>
    public static async Task<string> TestConnectionAsync(string connectionString, CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync(ct);
        return await conn.ExecuteScalarAsync<string>("select version()") ?? "";
    }

    public ValueTask DisposeAsync() => _dataSource.DisposeAsync();
}
