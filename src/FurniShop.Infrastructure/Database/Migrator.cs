using System.Reflection;
using Dapper;

namespace FurniShop.Infrastructure.Database;

/// <summary>
/// Applies embedded SQL migrations (Database/Migrations/NNN_name.sql) in order, each in its
/// own transaction, guarded by an advisory lock so two tills starting together cannot race.
/// </summary>
public sealed class Migrator(Db db)
{
    private const long LockKey = 7_246_310_001;

    public sealed record Migration(int Version, string Name, string Sql);

    public static IReadOnlyList<Migration> Discover()
    {
        var asm = typeof(Migrator).Assembly;
        return asm.GetManifestResourceNames()
            .Where(n => n.Contains(".Database.Migrations.") && n.EndsWith(".sql"))
            .Select(n =>
            {
                var file = n[(n.IndexOf(".Migrations.", StringComparison.Ordinal) + ".Migrations.".Length)..];
                var version = int.Parse(file[..3]);
                using var s = asm.GetManifestResourceStream(n)!;
                using var r = new StreamReader(s);
                return new Migration(version, file, r.ReadToEnd());
            })
            .OrderBy(m => m.Version)
            .ToList();
    }

    public async Task<IReadOnlyList<string>> MigrateAsync(CancellationToken ct = default)
    {
        var applied = new List<string>();
        await using var conn = await db.OpenAsync(ct);
        await conn.ExecuteAsync("select pg_advisory_lock(@k)", new { k = LockKey });
        try
        {
            await conn.ExecuteAsync("""
                create table if not exists schema_migrations (
                    version int primary key, name text not null, applied_at timestamptz not null default now())
                """);
            var done = (await conn.QueryAsync<int>("select version from schema_migrations")).ToHashSet();
            foreach (var m in Discover().Where(m => !done.Contains(m.Version)))
            {
                await using var tx = await conn.BeginTransactionAsync(ct);
                await conn.ExecuteAsync(m.Sql, transaction: tx, commandTimeout: 300);
                await conn.ExecuteAsync("insert into schema_migrations(version, name) values (@Version, @Name)", new { m.Version, m.Name }, tx);
                await tx.CommitAsync(ct);
                applied.Add(m.Name);
            }
        }
        finally
        {
            await conn.ExecuteAsync("select pg_advisory_unlock(@k)", new { k = LockKey });
        }
        return applied;
    }

    public async Task<int> CurrentVersionAsync()
    {
        await using var conn = await db.OpenAsync();
        var exists = await conn.ExecuteScalarAsync<bool>("select to_regclass('schema_migrations') is not null");
        return exists ? await conn.ExecuteScalarAsync<int>("select coalesce(max(version),0) from schema_migrations") : 0;
    }

    public static string AppVersion => Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.0.0";
}
