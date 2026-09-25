using FurniShop.Infrastructure.Database;

namespace FurniShop.Wpf.Services;

/// <summary>Thin alias kept for the desktop app; the parsing lives in Infrastructure so the web server shares it.</summary>
public static class ConnectionStrings
{
    public static string Normalise(string input) => ConnectionStringParser.Normalise(input);
    public static string Describe(string cs) => ConnectionStringParser.Describe(cs);
}
