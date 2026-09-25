using System.Text.RegularExpressions;

namespace FurniShop.Core.Validation;

public static partial class Validators
{
    private const string GstinChars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    [GeneratedRegex(@"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")]
    private static partial Regex GstinPattern();

    [GeneratedRegex(@"^[6-9][0-9]{9}$")]
    private static partial Regex MobilePattern();

    [GeneratedRegex(@"^[1-9][0-9]{5}$")]
    private static partial Regex PincodePattern();

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex EmailPattern();

    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9\-_/\.]{0,39}$")]
    private static partial Regex CodePattern();

    /// <summary>Validates format, state code and the mod-36 checksum of a GSTIN.</summary>
    public static bool IsValidGstin(string? gstin)
    {
        if (string.IsNullOrWhiteSpace(gstin)) return false;
        gstin = gstin.Trim().ToUpperInvariant();
        if (!GstinPattern().IsMatch(gstin)) return false;
        if (IndianStates.ByCode(gstin[..2]) is null) return false;
        return GstinCheckChar(gstin[..14]) == gstin[14];
    }

    public static char GstinCheckChar(string first14)
    {
        var sum = 0;
        for (var i = 0; i < 14; i++)
        {
            var value = GstinChars.IndexOf(first14[i]);
            var product = value * (i % 2 == 0 ? 1 : 2);
            sum += product / 36 + product % 36;
        }
        return GstinChars[(36 - sum % 36) % 36];
    }

    /// <summary>Normalises an Indian mobile number to 10 digits (strips +91, 0, spaces). Returns null if invalid.</summary>
    public static string? NormaliseMobile(string? mobile)
    {
        if (string.IsNullOrWhiteSpace(mobile)) return null;
        var digits = new string(mobile.Where(char.IsDigit).ToArray());
        if (digits.Length == 12 && digits.StartsWith("91")) digits = digits[2..];
        else if (digits.Length == 11 && digits.StartsWith('0')) digits = digits[1..];
        return MobilePattern().IsMatch(digits) ? digits : null;
    }

    public static bool IsValidMobile(string? mobile) => NormaliseMobile(mobile) is not null;
    public static bool IsValidPincode(string? pin) => pin is not null && PincodePattern().IsMatch(pin.Trim());
    public static bool IsValidEmail(string? email) => email is not null && EmailPattern().IsMatch(email.Trim());
    public static bool IsValidCode(string? code) => code is not null && CodePattern().IsMatch(code.Trim());

    public static string? Clean(string? value)
    {
        if (value is null) return null;
        var t = value.Trim();
        return t.Length == 0 ? null : t;
    }
}

/// <summary>Collects field errors and throws a <see cref="ValidationException"/> if any were added.</summary>
public sealed class ValidationBuilder
{
    private readonly Dictionary<string, string> _errors = new();

    public ValidationBuilder Require(string? value, string field, string label)
    {
        if (string.IsNullOrWhiteSpace(value)) _errors.TryAdd(field, $"{label} is required.");
        return this;
    }

    public ValidationBuilder Check(bool ok, string field, string message)
    {
        if (!ok) _errors.TryAdd(field, message);
        return this;
    }

    public ValidationBuilder Optional(string? value, Func<string, bool> rule, string field, string message)
    {
        if (!string.IsNullOrWhiteSpace(value) && !rule(value)) _errors.TryAdd(field, message);
        return this;
    }

    public void ThrowIfInvalid()
    {
        if (_errors.Count > 0) throw new ValidationException(_errors);
    }
}
