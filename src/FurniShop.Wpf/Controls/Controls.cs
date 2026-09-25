using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Ink;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using FurniShop.Core.Domain;

namespace FurniShop.Wpf.Controls;

internal static class Res
{
    public static Brush B(string key) => Application.Current.TryFindResource(key) as Brush ?? Brushes.Gray;
    public static FontFamily Icons => Application.Current.TryFindResource("IconFont") as FontFamily ?? new FontFamily("Segoe MDL2 Assets");
}

/// <summary>Status pill: icon + text + semantic colour (never colour alone).</summary>
public sealed class StatusBadge : Border
{
    public static readonly DependencyProperty StatusProperty = DependencyProperty.Register(nameof(Status), typeof(string), typeof(StatusBadge),
        new PropertyMetadata(null, (d, _) => ((StatusBadge)d).Update()));

    public static readonly DependencyProperty TextProperty = DependencyProperty.Register(nameof(Text), typeof(string), typeof(StatusBadge),
        new PropertyMetadata(null, (d, _) => ((StatusBadge)d).Update()));

    private readonly TextBlock _icon = new() { FontSize = 10, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 5, 0) };
    private readonly TextBlock _text = new() { FontSize = 11.5, FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center };

    public StatusBadge()
    {
        CornerRadius = new CornerRadius(10);
        Padding = new Thickness(8, 2, 9, 3);
        HorizontalAlignment = HorizontalAlignment.Left;
        VerticalAlignment = VerticalAlignment.Center;
        _icon.FontFamily = Res.Icons;
        Child = new StackPanel { Orientation = Orientation.Horizontal, Children = { _icon, _text } };
        Update();
    }

    public string? Status { get => (string?)GetValue(StatusProperty); set => SetValue(StatusProperty, value); }
    /// <summary>Optional label override (default: prettified status).</summary>
    public string? Text { get => (string?)GetValue(TextProperty); set => SetValue(TextProperty, value); }

    private void Update()
    {
        var tone = StatusStyle.ToneOf(Status);
        var (fg, bg, glyph) = tone switch
        {
            StatusTone.Success => ("SuccessFg", "SuccessBg", ""),
            StatusTone.Warning => ("WarningFg", "WarningBg", ""),
            StatusTone.Error => ("ErrorFg", "ErrorBg", ""),
            StatusTone.Info => ("InfoFg", "InfoBg", ""),
            _ => ("NeutralFg", "NeutralBg", ""),
        };
        Background = Res.B(bg);
        _icon.Foreground = _text.Foreground = Res.B(fg);
        _icon.Text = glyph;
        _text.Text = Text ?? StatusStyle.Label(Status);
        Visibility = string.IsNullOrEmpty(Status) && string.IsNullOrEmpty(Text) ? Visibility.Collapsed : Visibility.Visible;
        AutomationProperties_SetName(_text.Text);
    }

    private void AutomationProperties_SetName(string name) => System.Windows.Automation.AutomationProperties.SetName(this, "Status: " + name);
}

/// <summary>Dashboard KPI tile.</summary>
public sealed class KpiCard : Border
{
    public static readonly DependencyProperty TitleProperty = Reg(nameof(Title));
    public static readonly DependencyProperty ValueProperty = Reg(nameof(Value));
    public static readonly DependencyProperty NoteProperty = Reg(nameof(Note));
    public static readonly DependencyProperty IconProperty = Reg(nameof(Icon));
    public static readonly DependencyProperty ToneProperty = Reg(nameof(Tone));

    private static DependencyProperty Reg(string name) =>
        DependencyProperty.Register(name, typeof(string), typeof(KpiCard), new PropertyMetadata(null, (d, _) => ((KpiCard)d).Update()));

    private readonly TextBlock _title = new() { FontSize = 12.5, Foreground = Res.B("TextSecondary"), TextTrimming = TextTrimming.CharacterEllipsis };
    private readonly TextBlock _value = new() { FontSize = 24, FontWeight = FontWeights.SemiBold, Foreground = Res.B("TextPrimary"), Margin = new Thickness(0, 6, 0, 2) };
    private readonly TextBlock _note = new() { FontSize = 12, Foreground = Res.B("TextMuted"), TextTrimming = TextTrimming.CharacterEllipsis };
    private readonly TextBlock _icon = new() { FontSize = 16, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
    private readonly Border _iconBox = new() { Width = 36, Height = 36, CornerRadius = new CornerRadius(8), VerticalAlignment = VerticalAlignment.Top };

    public KpiCard()
    {
        Background = Res.B("Surface");
        BorderBrush = Res.B("Border");
        BorderThickness = new Thickness(1);
        CornerRadius = new CornerRadius(10);
        Padding = new Thickness(16, 14, 16, 14);
        Margin = new Thickness(0, 0, 12, 12);
        MinWidth = 200;
        Cursor = System.Windows.Input.Cursors.Hand;
        _icon.FontFamily = Res.Icons;
        _iconBox.Child = _icon;
        var text = new StackPanel { Children = { _title, _value, _note } };
        var grid = new Grid { ColumnDefinitions = { new ColumnDefinition(), new ColumnDefinition { Width = GridLength.Auto } } };
        grid.Children.Add(text);
        Grid.SetColumn(_iconBox, 1);
        grid.Children.Add(_iconBox);
        Child = grid;
    }

    public string? Title { get => (string?)GetValue(TitleProperty); set => SetValue(TitleProperty, value); }
    public string? Value { get => (string?)GetValue(ValueProperty); set => SetValue(ValueProperty, value); }
    public string? Note { get => (string?)GetValue(NoteProperty); set => SetValue(NoteProperty, value); }
    public string? Icon { get => (string?)GetValue(IconProperty); set => SetValue(IconProperty, value); }
    /// <summary>A status code or tone name (SUCCESS / WARNING / ERROR / INFO); default neutral brand.</summary>
    public string? Tone { get => (string?)GetValue(ToneProperty); set => SetValue(ToneProperty, value); }

    private void Update()
    {
        _title.Text = Title;
        _value.Text = Value;
        _note.Text = Note;
        _note.Visibility = string.IsNullOrEmpty(Note) ? Visibility.Collapsed : Visibility.Visible;
        _icon.Text = Icon;
        var (fg, bg) = Tone switch
        {
            "SUCCESS" => ("SuccessFg", "SuccessBg"), "WARNING" => ("WarningFg", "WarningBg"), "ERROR" => ("ErrorFg", "ErrorBg"),
            "INFO" => ("InfoFg", "InfoBg"), _ => ("Primary", "PrimarySoft"),
        };
        _icon.Foreground = Res.B(fg);
        _iconBox.Background = Res.B(bg);
        System.Windows.Automation.AutomationProperties.SetName(this, $"{Title}: {Value}. {Note}");
    }
}

/// <summary>Friendly empty state (icon, title, message).</summary>
public sealed class EmptyState : StackPanel
{
    public static readonly DependencyProperty TitleProperty = DependencyProperty.Register(nameof(Title), typeof(string), typeof(EmptyState),
        new PropertyMetadata("Nothing here yet", (d, e) => ((EmptyState)d)._title.Text = e.NewValue as string));
    public static readonly DependencyProperty MessageProperty = DependencyProperty.Register(nameof(Message), typeof(string), typeof(EmptyState),
        new PropertyMetadata(null, (d, e) => ((EmptyState)d)._message.Text = e.NewValue as string));
    public static readonly DependencyProperty IconProperty = DependencyProperty.Register(nameof(Icon), typeof(string), typeof(EmptyState),
        new PropertyMetadata("", (d, e) => ((EmptyState)d)._icon.Text = e.NewValue as string));

    private readonly TextBlock _icon = new() { FontSize = 34, HorizontalAlignment = HorizontalAlignment.Center, Text = "" };
    private readonly TextBlock _title = new() { FontSize = 15, FontWeight = FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 10, 0, 4), Text = "Nothing here yet" };
    private readonly TextBlock _message = new() { FontSize = 13, HorizontalAlignment = HorizontalAlignment.Center, TextAlignment = TextAlignment.Center, TextWrapping = TextWrapping.Wrap, MaxWidth = 380 };

    public EmptyState()
    {
        HorizontalAlignment = HorizontalAlignment.Center;
        VerticalAlignment = VerticalAlignment.Center;
        Margin = new Thickness(24, 48, 24, 48);
        _icon.FontFamily = Res.Icons;
        _icon.Foreground = Res.B("BorderStrong");
        _title.Foreground = Res.B("TextPrimary");
        _message.Foreground = Res.B("TextMuted");
        Children.Add(_icon); Children.Add(_title); Children.Add(_message);
    }

    public string? Title { get => (string?)GetValue(TitleProperty); set => SetValue(TitleProperty, value); }
    public string? Message { get => (string?)GetValue(MessageProperty); set => SetValue(MessageProperty, value); }
    public string? Icon { get => (string?)GetValue(IconProperty); set => SetValue(IconProperty, value); }
}

/// <summary>Signature capture for proof of delivery; exports a PNG. Hooks itself to the delivery dialog view model.</summary>
public sealed class SignaturePad : Border
{
    private readonly InkCanvas _ink = new() { Background = Brushes.White };

    public SignaturePad()
    {
        BorderBrush = Res.B("BorderStrong");
        BorderThickness = new Thickness(1);
        CornerRadius = new CornerRadius(8);
        Height = 150;
        ClipToBounds = true;
        _ink.DefaultDrawingAttributes = new DrawingAttributes { Color = Colors.Black, Width = 2.2, Height = 2.2, FitToCurve = true };
        var clear = new Button { Content = "Clear", HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(6), MinHeight = 26, Padding = new Thickness(8, 0, 8, 0) };
        clear.Click += (_, _) => Clear();
        var hint = new TextBlock { Text = "Customer signs here", Foreground = Res.B("TextMuted"), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 0, 8), IsHitTestVisible = false };
        Child = new Grid { Children = { _ink, hint, clear } };
        System.Windows.Automation.AutomationProperties.SetName(this, "Signature pad");
        DataContextChanged += (_, e) =>
        {
            if (e.NewValue is ViewModels.CompleteDeliveryDialogViewModel vm) vm.SignatureProvider = ToPng;
        };
    }

    public bool IsEmpty => _ink.Strokes.Count == 0;
    public void Clear() => _ink.Strokes.Clear();

    public byte[]? ToPng()
    {
        if (IsEmpty || _ink.ActualWidth < 1) return null;
        var rtb = new RenderTargetBitmap((int)_ink.ActualWidth, (int)_ink.ActualHeight, 96, 96, PixelFormats.Pbgra32);
        rtb.Render(_ink);
        var enc = new PngBitmapEncoder();
        enc.Frames.Add(BitmapFrame.Create(rtb));
        using var ms = new MemoryStream();
        enc.Save(ms);
        return ms.ToArray();
    }
}
