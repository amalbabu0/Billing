namespace FurniShop.Infrastructure.Documents;

public enum TextAlign { Left, Center, Right }

/// <summary>
/// Minimal drawing surface in points (1/72 inch), origin top-left. Implemented for PDF (PDFsharp)
/// and for WPF printing, so every printed document has exactly one layout implementation.
/// </summary>
public interface IDocCanvas
{
    double Width { get; }
    double Height { get; }
    void Text(string text, double x, double y, double size, bool bold = false, string color = "#222222", TextAlign align = TextAlign.Left, double width = 0);
    double MeasureWidth(string text, double size, bool bold = false);
    void Line(double x1, double y1, double x2, double y2, string color = "#CCCCCC", double thickness = 0.6);
    void Rect(double x, double y, double w, double h, string? fill, string? stroke = null, double thickness = 0.6);
    void Image(byte[] data, double x, double y, double w, double h);
}

/// <summary>Creates pages. Page size in points.</summary>
public interface IDocTarget
{
    IDocCanvas NewPage(double width, double height);
}

public static class PageSizes
{
    public const double A4Width = 595.28, A4Height = 841.89;
    public const double A5Width = 419.53, A5Height = 595.28;
    public static double Mm(double mm) => mm * 72.0 / 25.4;
}

public static class CanvasExtensions
{
    /// <summary>Word-wraps text to a width; returns the lines.</summary>
    public static List<string> Wrap(this IDocCanvas c, string? text, double size, double width, bool bold = false)
    {
        var result = new List<string>();
        if (string.IsNullOrEmpty(text)) return result;
        foreach (var para in text.Replace("\r\n", "\n").Split('\n'))
        {
            var line = "";
            foreach (var word in para.Split(' '))
            {
                var candidate = line.Length == 0 ? word : line + " " + word;
                if (c.MeasureWidth(candidate, size, bold) <= width || line.Length == 0)
                {
                    // Hard-break a single word that is wider than the column.
                    if (line.Length == 0 && c.MeasureWidth(candidate, size, bold) > width)
                    {
                        var chunk = "";
                        foreach (var ch in word)
                        {
                            if (c.MeasureWidth(chunk + ch, size, bold) > width && chunk.Length > 0) { result.Add(chunk); chunk = ""; }
                            chunk += ch;
                        }
                        line = chunk;
                    }
                    else line = candidate;
                }
                else
                {
                    result.Add(line);
                    line = word;
                }
            }
            result.Add(line);
        }
        return result;
    }

    /// <summary>Draws wrapped text and returns the height used.</summary>
    public static double Paragraph(this IDocCanvas c, string? text, double x, double y, double width, double size, bool bold = false,
        string color = "#222222", TextAlign align = TextAlign.Left, double lineHeight = 1.3)
    {
        var lines = c.Wrap(text, size, width, bold);
        var lh = size * lineHeight;
        for (var i = 0; i < lines.Count; i++) c.Text(lines[i], x, y + i * lh, size, bold, color, align, width);
        return lines.Count * lh;
    }

    public static double ParagraphHeight(this IDocCanvas c, string? text, double width, double size, bool bold = false, double lineHeight = 1.3) =>
        c.Wrap(text, size, width, bold).Count * size * lineHeight;
}

/// <summary>A canvas that draws nothing — used to measure how tall a receipt will be before rendering it.</summary>
public sealed class MeasuringCanvas(IDocCanvas measurer, double width, double height) : IDocCanvas
{
    public double Width => width;
    public double Height => height;
    public void Text(string text, double x, double y, double size, bool bold = false, string color = "#222222", TextAlign align = TextAlign.Left, double w = 0) { }
    public double MeasureWidth(string text, double size, bool bold = false) => measurer.MeasureWidth(text, size, bold);
    public void Line(double x1, double y1, double x2, double y2, string color = "#CCCCCC", double thickness = 0.6) { }
    public void Rect(double x, double y, double w, double h, string? fill, string? stroke = null, double thickness = 0.6) { }
    public void Image(byte[] data, double x, double y, double w, double h) { }
}
