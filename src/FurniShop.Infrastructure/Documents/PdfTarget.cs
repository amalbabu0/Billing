using System.Globalization;
using PdfSharp.Drawing;
using PdfSharp.Fonts;
using PdfSharp.Pdf;

namespace FurniShop.Infrastructure.Documents;

/// <summary>Renders <see cref="IDocCanvas"/> pages into a PDF document using PDFsharp (MIT licence).</summary>
public sealed class PdfTarget : IDocTarget, IDisposable
{
    private readonly PdfDocument _doc = new();
    private XGraphics? _current;

    static PdfTarget()
    {
        if (GlobalFontSettings.FontResolver is null) GlobalFontSettings.FontResolver = new AppFontResolver();
    }

    public PdfTarget(string title)
    {
        _doc.Info.Title = title;
        _doc.Info.Creator = "FurniShop ERP";
    }

    public IDocCanvas NewPage(double width, double height)
    {
        _current?.Dispose();
        var page = _doc.AddPage();
        page.Width = XUnit.FromPoint(width);
        page.Height = XUnit.FromPoint(height);
        _current = XGraphics.FromPdfPage(page);
        return new PdfCanvas(_current, width, height);
    }

    public byte[] ToBytes()
    {
        _current?.Dispose();
        _current = null;
        using var ms = new MemoryStream();
        _doc.Save(ms, false);
        return ms.ToArray();
    }

    public void Dispose()
    {
        _current?.Dispose();
        _doc.Dispose();
    }

    /// <summary>Stand-alone canvas for text measurement (e.g. to size a thermal receipt).</summary>
    public static IDocCanvas Measurer()
    {
        var doc = new PdfDocument();
        var page = doc.AddPage();
        return new PdfCanvas(XGraphics.FromPdfPage(page), page.Width.Point, page.Height.Point);
    }

    private sealed class PdfCanvas(XGraphics g, double width, double height) : IDocCanvas
    {
        private readonly Dictionary<(double, bool), XFont> _fonts = new();
        public double Width => width;
        public double Height => height;

        private XFont Font(double size, bool bold)
        {
            if (!_fonts.TryGetValue((size, bold), out var f))
                _fonts[(size, bold)] = f = new XFont(AppFontResolver.Family, size, bold ? XFontStyleEx.Bold : XFontStyleEx.Regular);
            return f;
        }

        private static XColor Color(string hex)
        {
            var h = hex.TrimStart('#');
            var v = int.Parse(h, NumberStyles.HexNumber);
            return h.Length == 8
                ? XColor.FromArgb((v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF)
                : XColor.FromArgb((v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF);
        }

        public void Text(string text, double x, double y, double size, bool bold = false, string color = "#222222", TextAlign align = TextAlign.Left, double w = 0)
        {
            if (string.IsNullOrEmpty(text)) return;
            var font = Font(size, bold);
            var brush = new XSolidBrush(Color(color));
            var tw = g.MeasureString(text, font).Width;
            var px = align switch
            {
                TextAlign.Right => x + w - tw,
                TextAlign.Center => x + (w - tw) / 2,
                _ => x,
            };
            // y is the top of the line; PDFsharp draws at the baseline for TopLeft format.
            g.DrawString(text, font, brush, new XPoint(px, y), XStringFormats.TopLeft);
        }

        public double MeasureWidth(string text, double size, bool bold = false) =>
            string.IsNullOrEmpty(text) ? 0 : g.MeasureString(text, Font(size, bold)).Width;

        public void Line(double x1, double y1, double x2, double y2, string color = "#CCCCCC", double thickness = 0.6) =>
            g.DrawLine(new XPen(Color(color), thickness), x1, y1, x2, y2);

        public void Rect(double x, double y, double w, double h, string? fill, string? stroke = null, double thickness = 0.6)
        {
            XBrush? b = fill is null ? null : new XSolidBrush(Color(fill));
            XPen? p = stroke is null ? null : new XPen(Color(stroke), thickness);
            if (b is not null && p is not null) g.DrawRectangle(p, b, x, y, w, h);
            else if (b is not null) g.DrawRectangle(b, x, y, w, h);
            else if (p is not null) g.DrawRectangle(p, x, y, w, h);
        }

        public void Image(byte[] data, double x, double y, double w, double h)
        {
            try
            {
                using var ms = new MemoryStream(data);
                using var img = XImage.FromStream(ms);
                // keep aspect ratio inside the box
                var ratio = Math.Min(w / img.PointWidth, h / img.PointHeight);
                var iw = img.PointWidth * ratio; var ih = img.PointHeight * ratio;
                g.DrawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
            }
            catch
            {
                // A corrupt logo must never block printing an invoice.
            }
        }
    }
}

/// <summary>
/// Resolves fonts for PDFs: Segoe UI on Windows (has the ₹ glyph), DejaVu Sans / Liberation Sans elsewhere.
/// </summary>
public sealed class AppFontResolver : IFontResolver
{
    public const string Family = "AppSans";

    private static readonly string[] RegularCandidates =
    {
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Fonts), "segoeui.ttf"),
        @"C:\Windows\Fonts\segoeui.ttf", @"C:\Windows\Fonts\arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/Library/Fonts/Arial.ttf",
    };

    private static readonly string[] BoldCandidates =
    {
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Fonts), "segoeuib.ttf"),
        @"C:\Windows\Fonts\segoeuib.ttf", @"C:\Windows\Fonts\arialbd.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
    };

    private static readonly Lazy<byte[]> Regular = new(() => Load(RegularCandidates));
    private static readonly Lazy<byte[]> Bold = new(() => Load(BoldCandidates));

    private static byte[] Load(IEnumerable<string> candidates)
    {
        foreach (var path in candidates)
            if (!string.IsNullOrEmpty(path) && File.Exists(path)) return File.ReadAllBytes(path);
        throw new FileNotFoundException("No usable TrueType font found for PDF generation (looked for Segoe UI / Arial / DejaVu Sans).");
    }

    public FontResolverInfo ResolveTypeface(string familyName, bool isBold, bool isItalic) =>
        new(isBold ? "AppSans-Bold" : "AppSans-Regular");

    public byte[] GetFont(string faceName) => faceName == "AppSans-Bold" ? Bold.Value : Regular.Value;
}
