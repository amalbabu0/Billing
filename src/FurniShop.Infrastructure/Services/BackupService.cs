using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json;
using Dapper;
using FurniShop.Core;
using FurniShop.Core.Security;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

/// <summary>
/// Backup strategy:
///  1. Neon itself keeps point-in-time history (branching / restore in the Neon console).
///  2. Full database backups with pg_dump (custom format) that can be restored with pg_restore.
///  3. A data export (ZIP of JSON files, one per table) that needs no PostgreSQL tools and is human-readable.
/// </summary>
public sealed class BackupService(Db db, UserSession session, AuditService audit, SettingsService settings)
{
    private static readonly string[] ExportTables =
    {
        "settings", "roles", "role_permissions", "users", "categories", "brands", "products", "product_variants", "inventory",
        "inventory_movements", "stock_adjustments", "customers", "customer_addresses", "suppliers", "quotations", "quotation_items",
        "sales_orders", "sales_order_items", "invoices", "invoice_items", "payments", "payment_lines", "payment_allocations",
        "sales_returns", "sales_return_items", "exchanges", "custom_orders", "custom_order_items", "purchases", "purchase_items",
        "supplier_payments", "supplier_payment_allocations", "deliveries", "delivery_items", "installations", "expense_categories",
        "expenses", "gst_rates", "hsn_codes", "payment_methods", "document_sequences", "status_history", "audit_logs",
    };

    public string DefaultFolder(Core.Settings.BackupSettings b) =>
        string.IsNullOrWhiteSpace(b.BackupFolder)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "FurniShop", "Backups")
            : b.BackupFolder;

    /// <summary>Exports every business table to JSON inside a ZIP. Password hashes are never exported.</summary>
    public async Task<string> ExportDataAsync(string? folder = null, IProgress<string>? progress = null)
    {
        session.Demand(Perm.BackupManage);
        var s = await settings.GetAsync(true);
        folder ??= DefaultFolder(s.Backup);
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, $"FurniShop-data-{DateTime.Now:yyyyMMdd-HHmmss}.zip");
        await using (var conn = await db.OpenAsync())
        await using (var fs = File.Create(path))
        using (var zip = new ZipArchive(fs, ZipArchiveMode.Create))
        {
            foreach (var table in ExportTables)
            {
                progress?.Report($"Exporting {table}…");
                var sql = table == "users"
                    ? "select id, username, full_name, mobile, email, role_id, is_active, created_at from users"
                    : $"select * from {table}";
                var json = await conn.ExecuteScalarAsync<string>($"select coalesce(json_agg(t), '[]'::json)::text from ({sql}) t");
                var entry = zip.CreateEntry($"{table}.json", CompressionLevel.Optimal);
                await using var w = new StreamWriter(entry.Open());
                await w.WriteAsync(json);
            }
            var meta = zip.CreateEntry("export-info.json");
            await using (var w = new StreamWriter(meta.Open()))
                await w.WriteAsync(JsonSerializer.Serialize(new { exportedAt = DateTime.Now, by = session.Username, app = Migrator.AppVersion }));
        }
        await audit.LogAsync("EXPORT", "Backup", $"exported all data to {Path.GetFileName(path)}");
        await MarkBackupAsync(s);
        return path;
    }

    /// <summary>Full backup with pg_dump (custom format). Requires PostgreSQL client tools (same major version as Neon, or newer).</summary>
    public async Task<string> BackupAsync(string? folder = null, CancellationToken ct = default)
    {
        session.Demand(Perm.BackupManage);
        var s = await settings.GetAsync(true);
        folder ??= DefaultFolder(s.Backup);
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, $"FurniShop-{DateTime.Now:yyyyMMdd-HHmmss}.dump");
        var exe = FindTool(s.Backup.PgDumpPath, "pg_dump");
        var cs = new NpgsqlConnectionStringBuilder(db.ConnectionString);
        await RunAsync(exe, new[] { "--format=custom", "--no-owner", "--no-privileges", "--file", path, "--host", cs.Host!, "--port", cs.Port.ToString(),
            "--username", cs.Username!, "--dbname", cs.Database! }, cs, ct);
        await audit.LogAsync("BACKUP", "Backup", $"created database backup {Path.GetFileName(path)}");
        await MarkBackupAsync(s);
        return path;
    }

    /// <summary>Restores a pg_dump backup into the connected database, replacing its contents. Admin only.</summary>
    public async Task RestoreAsync(string dumpPath, CancellationToken ct = default)
    {
        session.Demand(Perm.BackupManage);
        if (!session.IsAdmin) throw new PermissionDeniedException("Only an admin can restore a backup");
        if (!File.Exists(dumpPath)) throw new ValidationException("File", "Backup file not found.");
        var s = await settings.GetAsync(true);
        var exe = FindTool(s.Backup.PgRestorePath, "pg_restore");
        var cs = new NpgsqlConnectionStringBuilder(db.ConnectionString);
        await audit.LogAsync("RESTORE", "Backup", $"started restore from {Path.GetFileName(dumpPath)}");
        await RunAsync(exe, new[] { "--clean", "--if-exists", "--no-owner", "--no-privileges", "--single-transaction", "--host", cs.Host!,
            "--port", cs.Port.ToString(), "--username", cs.Username!, "--dbname", cs.Database!, dumpPath }, cs, ct);
        await audit.LogAsync("RESTORE", "Backup", $"restored database from {Path.GetFileName(dumpPath)}");
    }

    private async Task MarkBackupAsync(Core.Settings.AppSettingsSnapshot s)
    {
        s.Backup.LastBackupAt = DateTime.Now;
        await settings.SaveAsync("backup", s.Backup);
    }

    private static string FindTool(string? configured, string name)
    {
        if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured)) return configured;
        var exe = OperatingSystem.IsWindows() ? name + ".exe" : name;
        var candidates = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator)
            .Concat(OperatingSystem.IsWindows()
                ? Directory.Exists(@"C:\Program Files\PostgreSQL") ? Directory.GetDirectories(@"C:\Program Files\PostgreSQL").OrderDescending().Select(d => Path.Combine(d, "bin")) : Array.Empty<string>()
                : new[] { "/usr/bin", "/usr/local/bin", "/usr/lib/postgresql/17/bin", "/usr/lib/postgresql/16/bin" });
        foreach (var dir in candidates)
        {
            var p = Path.Combine(dir.Trim('"'), exe);
            if (File.Exists(p)) return p;
        }
        throw new BusinessRuleException($"{name} was not found. Install the PostgreSQL command-line tools and set the path in Settings → Backup, or use Export data instead.");
    }

    private static async Task RunAsync(string exe, IEnumerable<string> args, NpgsqlConnectionStringBuilder cs, CancellationToken ct)
    {
        var psi = new ProcessStartInfo(exe) { RedirectStandardError = true, RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true };
        foreach (var a in args) psi.ArgumentList.Add(a);
        // Password via environment, never on the command line (visible in the process list).
        psi.Environment["PGPASSWORD"] = cs.Password ?? "";
        psi.Environment["PGSSLMODE"] = cs.SslMode switch
        {
            SslMode.Disable => "disable", SslMode.Allow => "allow", SslMode.Prefer => "prefer", SslMode.VerifyCA => "verify-ca", SslMode.VerifyFull => "verify-full", _ => "require",
        };
        using var p = Process.Start(psi) ?? throw new BusinessRuleException($"Could not start {exe}.");
        var stderr = p.StandardError.ReadToEndAsync(ct);
        await p.WaitForExitAsync(ct);
        if (p.ExitCode != 0) throw new BusinessRuleException($"{Path.GetFileName(exe)} failed: {(await stderr).Trim()}");
    }
}
