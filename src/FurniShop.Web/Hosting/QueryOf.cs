using System.Globalization;
using System.Reflection;
using FurniShop.Core;

namespace FurniShop.Web.Hosting;

/// <summary>
/// Binds a filter object (ListQuery, ProductFilter, GstFilter…) from the query string. Every property is optional —
/// missing values keep the object's defaults — and malformed values are a 400 with the field named.
/// </summary>
public sealed class QueryOf<T> where T : new()
{
    private static readonly PropertyInfo[] Props = typeof(T).GetProperties(BindingFlags.Public | BindingFlags.Instance).Where(p => p.CanWrite).ToArray();

    public T Value { get; private init; } = new();

    public static ValueTask<QueryOf<T>> BindAsync(HttpContext ctx)
    {
        var value = new T();
        foreach (var p in Props)
        {
            if (!ctx.Request.Query.TryGetValue(p.Name, out var raw) && !ctx.Request.Query.TryGetValue(char.ToLowerInvariant(p.Name[0]) + p.Name[1..], out raw)) continue;
            var text = raw.ToString();
            if (string.IsNullOrWhiteSpace(text)) continue;
            var type = Nullable.GetUnderlyingType(p.PropertyType) ?? p.PropertyType;
            try
            {
                object parsed = type == typeof(string) ? text
                    : type == typeof(int) ? int.Parse(text, CultureInfo.InvariantCulture)
                    : type == typeof(long) ? long.Parse(text, CultureInfo.InvariantCulture)
                    : type == typeof(decimal) ? decimal.Parse(text, CultureInfo.InvariantCulture)
                    : type == typeof(bool) ? bool.Parse(text)
                    : type == typeof(DateTime) ? DateTime.Parse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal)
                    : throw new FormatException();
                p.SetValue(value, parsed);
            }
            catch (FormatException) { throw new ValidationException(p.Name, $"“{text}” is not a valid value for {p.Name}."); }
            catch (OverflowException) { throw new ValidationException(p.Name, $"“{text}” is out of range for {p.Name}."); }
        }
        return ValueTask.FromResult(new QueryOf<T> { Value = value });
    }
}
