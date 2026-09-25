using System.Globalization;
using System.Text;

namespace FurniShop.Core;

/// <summary>Money helpers. All amounts are decimal rupees rounded half-away-from-zero to paise.</summary>
public static class Money
{
    public static decimal R2(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);

    /// <summary>Round to the nearest rupee (used for invoice round-off).</summary>
    public static decimal ToRupee(decimal value) => Math.Round(value, 0, MidpointRounding.AwayFromZero);

    private static readonly CultureInfo India = CreateIndia();

    private static CultureInfo CreateIndia()
    {
        var c = (CultureInfo)CultureInfo.InvariantCulture.Clone();
        c.NumberFormat.NumberGroupSizes = new[] { 3, 2 };
        c.NumberFormat.CurrencyGroupSizes = new[] { 3, 2 };
        c.NumberFormat.NumberDecimalDigits = 2;
        return c;
    }

    /// <summary>Formats using Indian digit grouping: 1,00,000.00</summary>
    public static string Format(decimal value, bool symbol = true, int decimals = 2)
    {
        var s = Math.Abs(value).ToString("N" + decimals, India);
        var sign = value < 0 ? "-" : "";
        return symbol ? $"{sign}₹{s}" : sign + s;
    }

    /// <summary>Formats a quantity without trailing zeroes ("2", "1.5").</summary>
    public static string Qty(decimal q) => q == Math.Truncate(q) ? ((long)q).ToString(CultureInfo.InvariantCulture) : q.ToString("0.##", CultureInfo.InvariantCulture);

    /// <summary>Compact dashboard format: ₹1.25 L, ₹2.4 Cr.</summary>
    public static string Compact(decimal value)
    {
        var abs = Math.Abs(value);
        var sign = value < 0 ? "-" : "";
        if (abs >= 1_00_00_000m) return $"{sign}₹{(abs / 1_00_00_000m).ToString("0.##", CultureInfo.InvariantCulture)} Cr";
        if (abs >= 1_00_000m) return $"{sign}₹{(abs / 1_00_000m).ToString("0.##", CultureInfo.InvariantCulture)} L";
        if (abs >= 1_000m) return $"{sign}₹{(abs / 1_000m).ToString("0.#", CultureInfo.InvariantCulture)} K";
        return Format(value, true, 0);
    }

    private static readonly string[] Ones =
    {
        "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
        "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"
    };
    private static readonly string[] Tens = { "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety" };

    /// <summary>Indian-system amount in words, e.g. "Rupees One Lakh Twenty Thousand and Fifty Paise Only".</summary>
    public static string InWords(decimal amount)
    {
        amount = R2(Math.Abs(amount));
        var rupees = (long)Math.Truncate(amount);
        var paise = (int)((amount - rupees) * 100);
        var sb = new StringBuilder("Rupees ");
        sb.Append(rupees == 0 ? "Zero" : IndianWords(rupees));
        if (paise > 0) sb.Append(" and ").Append(TwoDigits(paise)).Append(" Paise");
        sb.Append(" Only");
        return sb.ToString();
    }

    private static string IndianWords(long n)
    {
        var parts = new List<string>();
        void Add(long value, string unit)
        {
            if (value > 0) parts.Add(unit.Length == 0 ? ThreeDigits((int)value) : $"{TwoDigits((int)value)} {unit}");
        }
        var crore = n / 1_00_00_000; n %= 1_00_00_000;
        if (crore > 0) parts.Add((crore > 99 ? IndianWords(crore) : TwoDigits((int)crore)) + " Crore");
        Add(n / 1_00_000, "Lakh"); n %= 1_00_000;
        Add(n / 1_000, "Thousand"); n %= 1_000;
        Add(n, "");
        return string.Join(" ", parts.Where(p => p.Length > 0));
    }

    private static string ThreeDigits(int n)
    {
        var h = n / 100; var r = n % 100;
        var s = h > 0 ? Ones[h] + " Hundred" : "";
        if (r > 0) s += (s.Length > 0 ? " " : "") + TwoDigits(r);
        return s;
    }

    private static string TwoDigits(int n) => n < 20 ? Ones[n] : Tens[n / 10] + (n % 10 > 0 ? " " + Ones[n % 10] : "");
}
