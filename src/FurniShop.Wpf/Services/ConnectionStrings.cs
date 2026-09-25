using Npgsql;

namespace FurniShop.Wpf.Services;

public static class ConnectionStrings
{
    /// <summary>
    /// Accepts either an Npgsql connection string or the postgresql:// URL that Neon shows in its dashboard,
    /// and returns a normalised Npgsql connection string (SSL required for Neon hosts).
    /// </summary>
    public static string Normalise(string input)
    {
        input = input.Trim().Trim('"', '\'');
        if (input.StartsWith("psql ", StringComparison.OrdinalIgnoreCase)) input = input[5..].Trim().Trim('\'', '"');
        NpgsqlConnectionStringBuilder b;
        if (input.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) || input.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
        {
            var uri = new Uri(input);
            var userInfo = uri.UserInfo.Split(':', 2);
            b = new NpgsqlConnectionStringBuilder
            {
                Host = uri.Host, Port = uri.Port > 0 ? uri.Port : 5432, Database = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')),
                Username = Uri.UnescapeDataString(userInfo[0]), Password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : null,
            };
            var query = System.Web.HttpUtility.ParseQueryString(uri.Query);
            if (query["sslmode"] is { } ssl && Enum.TryParse<SslMode>(ssl.Replace("-", ""), true, out var mode)) b.SslMode = mode;
        }
        else b = new NpgsqlConnectionStringBuilder(input);

        if (b.Host?.Contains("neon.tech", StringComparison.OrdinalIgnoreCase) == true && b.SslMode is SslMode.Disable or SslMode.Allow or SslMode.Prefer)
            b.SslMode = SslMode.Require;
        if (string.IsNullOrWhiteSpace(b.Database)) b.Database = "neondb";
        b.Timeout = Math.Max(b.Timeout, 30);
        b.KeepAlive = 30;
        return b.ConnectionString;
    }

    public static string Describe(string cs)
    {
        var b = new NpgsqlConnectionStringBuilder(cs);
        return $"{b.Username}@{b.Host}/{b.Database}";
    }
}
