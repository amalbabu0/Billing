using System.Collections;
using System.Globalization;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;
using FurniShop.Core;
using FurniShop.Core.Domain;

namespace FurniShop.Wpf.Converters;

public sealed class MoneyConverter : IValueConverter
{
    public object Convert(object? value, Type t, object? p, CultureInfo c)
    {
        if (value is null) return p as string == "dash" ? "—" : "";
        var d = System.Convert.ToDecimal(value, CultureInfo.InvariantCulture);
        return (p as string) switch
        {
            "compact" => Money.Compact(d),
            "plain" => Money.Format(d, false),
            "words" => Money.InWords(d),
            _ => Money.Format(d),
        };
    }

    public object ConvertBack(object? value, Type t, object? p, CultureInfo c) => Binding.DoNothing;
}

public sealed class QtyConverter : IValueConverter
{
    public object Convert(object? value, Type t, object? p, CultureInfo c) => value is decimal d ? Money.Qty(d) : value?.ToString() ?? "";
    public object ConvertBack(object? value, Type t, object? p, CultureInfo c) => Binding.DoNothing;
}

public sealed class DateConverter : IValueConverter
{
    public object Convert(object? value, Type t, object? p, CultureInfo c) => value switch
    {
        DateTime d when p as string == "time" => d.ToString("dd-MMM-yyyy HH:mm"),
        DateTime d when p as string == "short" => d.ToString("dd MMM"),
        DateTime d => d.ToString("dd-MMM-yyyy"),
        _ => p as string == "dash" ? "—" : "",
    };

    public object ConvertBack(object? value, Type t, object? p, CultureInfo c) => Binding.DoNothing;
}

public sealed class StatusLabelConverter : IValueConverter
{
    public object Convert(object? value, Type t, object? p, CultureInfo c) => StatusStyle.Label(value?.ToString());
    public object ConvertBack(object? value, Type t, object? p, CultureInfo c) => Binding.DoNothing;
}

/// <summary>true → Visible. Parameter "invert" flips it.</summary>
public sealed class BoolToVisibilityConverter : IValueConverter
{
    public object Convert(object? value, Type t, object? p, CultureInfo c)
    {
        var b = value is true;
        if (p as string == "invert") b = !b;
        return b ? Visibility.Visible : Visibility.Collapsed;
    }

    public object ConvertBack(object? value, Type t, object? p, CultureInfo c) => value is Visibility.Visible;
}

public sealed class InverseBoolConverter : IValueConverter
{
    public object Convert(object? value, Type t, object? p, CultureInfo c) => value is not true;
    public object ConvertBack(object? value, Type t, object? p, CultureInfo c) => value is not true;
}

/// <summary>Non-null / non-empty → Visible. Parameter "invert" flips it.</summary>
public sealed class NullToVisibilityConverter : IValueConverter
{
    public object Convert(object? value, Type t, object? p, CultureInfo c)
    {
        var has = value switch
        {
            null => false,
            string s => !string.IsNullOrWhiteSpace(s),
            ICollection col => col.Count > 0,
            decimal d => d != 0,
            int i => i != 0,
            long l => l != 0,
            _ => true,
        };
        if (p as string == "invert") has = !has;
        return has ? Visibility.Visible : Visibility.Collapsed;
    }

    public object ConvertBack(object? value, Type t, object? p, CultureInfo c) => Binding.DoNothing;
}

/// <summary>value.ToString() == parameter → true (for radio buttons / selected tabs).</summary>
public sealed class EqualsConverter : IValueConverter
{
    public object Convert(object? value, Type t, object? p, CultureInfo c) => string.Equals(value?.ToString(), p?.ToString(), StringComparison.OrdinalIgnoreCase);
    public object ConvertBack(object? value, Type t, object? p, CultureInfo c) => value is true ? p! : Binding.DoNothing;
}

/// <summary>Positive amount → red (money owed), zero → green, negative (advance) → neutral.</summary>
public sealed class BalanceBrushConverter : IValueConverter
{
    public object Convert(object? value, Type t, object? p, CultureInfo c)
    {
        var d = value is null ? 0 : System.Convert.ToDecimal(value, CultureInfo.InvariantCulture);
        var key = d > 0 ? "ErrorFg" : d == 0 ? "SuccessFg" : "TextSecondary";
        return Application.Current.TryFindResource(key) as Brush ?? Brushes.Black;
    }

    public object ConvertBack(object? value, Type t, object? p, CultureInfo c) => Binding.DoNothing;
}

/// <summary>Looks up a field error from the view model's Errors dictionary: {Binding Errors, ConverterParameter=Field}.</summary>
public sealed class ErrorConverter : IValueConverter
{
    public object? Convert(object? value, Type t, object? p, CultureInfo c) =>
        value is IDictionary<string, string> d && p is string key && d.TryGetValue(key, out var e) ? e : null;

    public object ConvertBack(object? value, Type t, object? p, CultureInfo c) => Binding.DoNothing;
}

public sealed class ToneBrushConverter : IValueConverter
{
    public object Convert(object? value, Type t, object? p, CultureInfo c)
    {
        var tone = value is StatusTone st ? st : StatusStyle.ToneOf(value?.ToString());
        var bg = p as string == "bg";
        var key = tone switch
        {
            StatusTone.Success => bg ? "SuccessBg" : "SuccessFg",
            StatusTone.Warning => bg ? "WarningBg" : "WarningFg",
            StatusTone.Error => bg ? "ErrorBg" : "ErrorFg",
            StatusTone.Info => bg ? "InfoBg" : "InfoFg",
            _ => bg ? "NeutralBg" : "NeutralFg",
        };
        return Application.Current.TryFindResource(key) as Brush ?? Brushes.Gray;
    }

    public object ConvertBack(object? value, Type t, object? p, CultureInfo c) => Binding.DoNothing;
}

/// <summary>Decimal ↔ text for editable number boxes (accepts "1,25,000" and blanks as 0).</summary>
public sealed class DecimalTextConverter : IValueConverter
{
    public object Convert(object? value, Type t, object? p, CultureInfo c) => value switch
    {
        null => "",
        decimal d => d == 0 && p as string == "blank0" ? "" : d.ToString("0.##", CultureInfo.InvariantCulture),
        _ => value.ToString()!,
    };

    public object ConvertBack(object? value, Type t, object? p, CultureInfo c)
    {
        var s = (value as string ?? "").Replace(",", "").Replace("₹", "").Trim();
        if (s.Length == 0) return Nullable.GetUnderlyingType(t) is not null ? null! : 0m;
        return decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture, out var d)
            ? d
            : DependencyProperty.UnsetValue;
    }
}
