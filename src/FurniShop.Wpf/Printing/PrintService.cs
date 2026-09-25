using System.Globalization;
using System.IO;
using System.Printing;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using FurniShop.Infrastructure.Documents;
using FurniShop.Wpf.Services;
using Brush = System.Windows.Media.Brush;
using Point = System.Windows.Point;

namespace FurniShop.Wpf.Printing;

/// <summary>Renders the shared document layouts onto WPF drawings (for preview and Windows printing).</summary>
public sealed class WpfTarget : IDocTarget
{
    public List<(DrawingGroup Drawing, double Width, double Height)> Pages { get; } = new();

    public IDocCanvas NewPage(double width, double height)
    {
        var group = new DrawingGroup();
        var canvas = new WpfCanvas(group, width, height);
        Pages.Add((group, width, height));
        return canvas;
    }

    public void Finish()
    {
        foreach (var p in Pages) p.Drawing.Freeze();
    }

    /// <summary>Builds a FixedDocument (page sizes in DIPs) for preview / printing.</summary>
    public FixedDocument ToFixedDocument()
    {
        var doc = new FixedDocument();
        foreach (var (drawing, w, h) in Pages)
        {
            var pw = w * 96 / 72; var ph = h * 96 / 72;
            var page = new FixedPage { Width = pw, Height = ph, Background = Brushes.White };
            var img = new Image { Source = new DrawingImage(drawing), Width = pw, Height = ph, Stretch = Stretch.Fill };
            // DrawingImage bounds follow the drawn content; pin them to the page with a transparent full-page rectangle.
            page.Children.Add(img);
            var content = new PageContent();
            ((System.Windows.Markup.IAddChild)content).AddChild(page);
            doc.Pages.Add(content);
        }
        return doc;
    }

    private sealed class WpfCanvas : IDocCanvas
    {
        private readonly DrawingGroup _group;
        private readonly Dictionary<string, Brush> _brushes = new();
        private static readonly Typeface Regular = new(new FontFamily("Segoe UI"), FontStyles.Normal, FontWeights.Normal, FontStretches.Normal);
        private static readonly Typeface Bold = new(new FontFamily("Segoe UI"), FontStyles.Normal, FontWeights.Bold, FontStretches.Normal);

        public WpfCanvas(DrawingGroup group, double width, double height)
        {
            _group = group; Width = width; Height = height;
            // The layouts work in points; draw 1:1 in points and let the FixedPage scale (DrawingImage stretches to page size).
            using var dc = _group.Append();
            dc.DrawRectangle(Brushes.White, null, new Rect(0, 0, width, height));
        }

        public double Width { get; }
        public double Height { get; }

        private Brush B(string hex)
        {
            if (!_brushes.TryGetValue(hex, out var b))
            {
                b = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
                b.Freeze();
                _brushes[hex] = b;
            }
            return b;
        }

        private static FormattedText Ft(string text, double size, bool bold, Brush brush) =>
            new(text, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight, bold ? Bold : Regular, size, brush, 1.0);

        public void Text(string text, double x, double y, double size, bool bold = false, string color = "#222222", TextAlign align = TextAlign.Left, double width = 0)
        {
            if (string.IsNullOrEmpty(text)) return;
            var ft = Ft(text, size, bold, B(color));
            var px = align switch { TextAlign.Right => x + width - ft.WidthIncludingTrailingWhitespace, TextAlign.Center => x + (width - ft.WidthIncludingTrailingWhitespace) / 2, _ => x };
            using var dc = _group.Append();
            dc.DrawText(ft, new Point(px, y));
        }

        public double MeasureWidth(string text, double size, bool bold = false) =>
            string.IsNullOrEmpty(text) ? 0 : Ft(text, size, bold, Brushes.Black).WidthIncludingTrailingWhitespace;

        public void Line(double x1, double y1, double x2, double y2, string color = "#CCCCCC", double thickness = 0.6)
        {
            using var dc = _group.Append();
            dc.DrawLine(new Pen(B(color), thickness), new Point(x1, y1), new Point(x2, y2));
        }

        public void Rect(double x, double y, double w, double h, string? fill, string? stroke = null, double thickness = 0.6)
        {
            using var dc = _group.Append();
            dc.DrawRectangle(fill is null ? null : B(fill), stroke is null ? null : new Pen(B(stroke), thickness), new Rect(x, y, Math.Max(0, w), Math.Max(0, h)));
        }

        public void Image(byte[] data, double x, double y, double w, double h)
        {
            try
            {
                var bmp = new BitmapImage();
                bmp.BeginInit();
                bmp.CacheOption = BitmapCacheOption.OnLoad;
                bmp.StreamSource = new MemoryStream(data);
                bmp.EndInit();
                bmp.Freeze();
                var ratio = Math.Min(w / bmp.Width, h / bmp.Height);
                var iw = bmp.Width * ratio; var ih = bmp.Height * ratio;
                using var dc = _group.Append();
                dc.DrawImage(bmp, new Rect(x + (w - iw) / 2, y + (h - ih) / 2, iw, ih));
            }
            catch { /* ignore bad logo */ }
        }
    }
}

/// <summary>Print preview window and direct printing to a configured printer.</summary>
public static class PrintService
{
    public static WpfTarget Render(Action<IDocTarget> layout)
    {
        var target = new WpfTarget();
        layout(target);
        target.Finish();
        return target;
    }

    /// <summary>Opens a preview with the standard WPF viewer (zoom, print button).</summary>
    public static void Preview(string title, Action<IDocTarget> layout)
    {
        var doc = Render(layout).ToFixedDocument();
        var viewer = new DocumentViewer { Document = doc };
        var win = new Window
        {
            Title = $"Print preview — {title}", Content = viewer, Width = 900, Height = 1000, WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = Application.Current.MainWindow, Background = Brushes.White,
        };
        win.Show();
    }

    /// <summary>Prints directly. Uses the configured printer when set; otherwise shows the Windows print dialog.</summary>
    public static bool Print(string title, Action<IDocTarget> layout, string? printerName, int copies = 1)
    {
        var doc = Render(layout).ToFixedDocument();
        var dlg = new PrintDialog();
        if (!string.IsNullOrWhiteSpace(printerName))
        {
            try
            {
                dlg.PrintQueue = new LocalPrintServer().GetPrintQueue(printerName);
                if (copies > 1) dlg.PrintTicket.CopyCount = copies;
            }
            catch
            {
                AppHost.Shell.Toast.Warning($"Printer '{printerName}' was not found — choose a printer.");
                if (dlg.ShowDialog() != true) return false;
            }
        }
        else if (dlg.ShowDialog() != true) return false;
        dlg.PrintDocument(doc.DocumentPaginator, title);
        return true;
    }

    public static IReadOnlyList<string> InstalledPrinters()
    {
        try { return new LocalPrintServer().GetPrintQueues().Select(q => q.FullName).ToList(); }
        catch { return Array.Empty<string>(); }
    }
}
