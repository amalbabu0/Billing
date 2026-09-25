using System.Windows;
using System.Windows.Controls;

namespace FurniShop.Wpf.Controls;

/// <summary>Allows binding PasswordBox.Password (write-only to the view model) without exposing it as a dependency property.</summary>
public static class PasswordHelper
{
    public static readonly DependencyProperty BoundPasswordProperty = DependencyProperty.RegisterAttached("BoundPassword", typeof(string), typeof(PasswordHelper),
        new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.BindsTwoWayByDefault, OnChanged));

    private static readonly DependencyProperty HookedProperty = DependencyProperty.RegisterAttached("Hooked", typeof(bool), typeof(PasswordHelper));

    public static string? GetBoundPassword(DependencyObject d) => (string?)d.GetValue(BoundPasswordProperty);
    public static void SetBoundPassword(DependencyObject d, string v) => d.SetValue(BoundPasswordProperty, v);

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is not PasswordBox box) return;
        if (!(bool)box.GetValue(HookedProperty))
        {
            box.SetValue(HookedProperty, true);
            box.PasswordChanged += (_, _) => SetBoundPassword(box, box.Password);
        }
        if (box.Password != ((string?)e.NewValue ?? "")) box.Password = (string?)e.NewValue ?? "";
    }
}
