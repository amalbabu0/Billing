using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace FurniShop.Wpf.Services;

/// <summary>
/// Stores the database connection string for this Windows user, encrypted with DPAPI
/// (only the same Windows account on the same PC can decrypt it). The FURNISHOP_DB
/// environment variable overrides it (useful for IT-managed deployments).
/// </summary>
public static class ConnectionStore
{
    private static readonly string Folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "FurniShop");
    private static readonly string FilePath = Path.Combine(Folder, "connection.dat");
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("FurniShop.ConnectionString.v1");

    public static string? Load()
    {
        var env = Environment.GetEnvironmentVariable("FURNISHOP_DB");
        if (!string.IsNullOrWhiteSpace(env)) return env;
        if (!File.Exists(FilePath)) return null;
        try
        {
            var data = ProtectedData.Unprotect(File.ReadAllBytes(FilePath), Entropy, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(data);
        }
        catch (CryptographicException)
        {
            return null; // copied from another PC / user: ask again
        }
    }

    public static void Save(string connectionString)
    {
        Directory.CreateDirectory(Folder);
        var data = ProtectedData.Protect(Encoding.UTF8.GetBytes(connectionString), Entropy, DataProtectionScope.CurrentUser);
        File.WriteAllBytes(FilePath, data);
    }

    public static void Clear()
    {
        if (File.Exists(FilePath)) File.Delete(FilePath);
    }

    public static string LogFolder
    {
        get
        {
            var p = Path.Combine(Folder, "logs");
            Directory.CreateDirectory(p);
            return p;
        }
    }

    public static void LogError(Exception ex)
    {
        try
        {
            File.AppendAllText(Path.Combine(LogFolder, $"errors-{DateTime.Today:yyyyMM}.log"),
                $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {ex}\n\n");
        }
        catch { /* logging must never crash the app */ }
    }
}
