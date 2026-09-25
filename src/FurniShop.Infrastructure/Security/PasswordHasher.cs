using System.Security.Cryptography;

namespace FurniShop.Infrastructure.Security;

/// <summary>PBKDF2-HMAC-SHA256 password hashing. Format: pbkdf2-sha256$iterations$salt$hash (base64).</summary>
public static class PasswordHasher
{
    private const int Iterations = 210_000;
    private const int SaltSize = 16;
    private const int KeySize = 32;
    private const string Scheme = "pbkdf2-sha256";

    public static string Hash(string password)
    {
        ArgumentException.ThrowIfNullOrEmpty(password);
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var key = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, KeySize);
        return $"{Scheme}${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(key)}";
    }

    public static bool Verify(string password, string stored)
    {
        if (string.IsNullOrEmpty(password) || string.IsNullOrEmpty(stored)) return false;
        var parts = stored.Split('$');
        if (parts.Length != 4 || parts[0] != Scheme || !int.TryParse(parts[1], out var iterations)) return false;
        try
        {
            var salt = Convert.FromBase64String(parts[2]);
            var expected = Convert.FromBase64String(parts[3]);
            var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    public static bool NeedsRehash(string stored)
    {
        var parts = stored.Split('$');
        return parts.Length != 4 || parts[0] != Scheme || !int.TryParse(parts[1], out var it) || it < Iterations;
    }

    /// <summary>Returns an error message or null when the password meets the policy.</summary>
    public static string? CheckPolicy(string password, int minLength)
    {
        if (password.Length < minLength) return $"Password must be at least {minLength} characters.";
        if (!password.Any(char.IsLetter) || !password.Any(char.IsDigit)) return "Password must contain letters and numbers.";
        return null;
    }

    /// <summary>SHA-256 of a short secret such as a delivery OTP (so OTPs are not stored in clear text).</summary>
    public static string HashOtp(string otp, long deliveryId) =>
        Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes($"{deliveryId}:{otp.Trim()}")));
}
