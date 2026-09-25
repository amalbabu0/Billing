using System.Text;
using System.Text.RegularExpressions;
using FurniShop.Core.Validation;

namespace FurniShop.Core.Messaging;

public static partial class MessageTemplates
{
    [GeneratedRegex(@"\{([a-z_]+)\}")]
    private static partial Regex Placeholder();

    /// <summary>Replaces {placeholders}. Unknown placeholders are left as-is so mistakes are visible.</summary>
    public static string Render(string template, IReadOnlyDictionary<string, string?> values) =>
        Placeholder().Replace(template, m => values.TryGetValue(m.Groups[1].Value, out var v) ? v ?? "" : m.Value);

    public static IReadOnlyList<string> PlaceholdersIn(string template) =>
        Placeholder().Matches(template).Select(m => m.Groups[1].Value).Distinct().ToList();

    /// <summary>
    /// Builds a WhatsApp click-to-chat link. Opening it launches WhatsApp (desktop app or web)
    /// with the message pre-filled; staff press Send. Attachments must be added manually.
    /// </summary>
    public static string WhatsAppLink(string? mobile, string message, string countryCode = "91", bool desktopApp = false)
    {
        var number = Validators.NormaliseMobile(mobile)
            ?? throw new BusinessRuleException("The customer does not have a valid WhatsApp / mobile number.");
        var text = Uri.EscapeDataString(message);
        return desktopApp
            ? $"whatsapp://send?phone={countryCode}{number}&text={text}"
            : $"https://wa.me/{countryCode}{number}?text={text}";
    }

    public static string Sample(string template)
    {
        var sample = new Dictionary<string, string?>
        {
            ["customer"] = "Rahul", ["shop"] = "My Furniture Showroom", ["shop_phone"] = "98450 12345",
            ["number"] = "INV-2026-1024", ["total"] = "₹85,000.00", ["paid"] = "₹30,000.00", ["balance"] = "₹55,000.00",
            ["amount"] = "₹25,000.00", ["method"] = "UPI", ["date"] = DateTime.Today.ToString("dd-MMM-yyyy"),
            ["due_date"] = DateTime.Today.AddDays(15).ToString("dd-MMM-yyyy"), ["valid_until"] = DateTime.Today.AddDays(15).ToString("dd-MMM-yyyy"),
            ["slot"] = "10 AM - 1 PM", ["driver"] = "Ramesh", ["vehicle"] = "KA-01-AB-1234", ["otp"] = "4821",
        };
        return Render(template, sample);
    }

    public static string Normalise(string text)
    {
        var sb = new StringBuilder(text.Replace("\r\n", "\n"));
        return sb.ToString().Trim();
    }
}
