using System.Collections;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using FurniShop.Core;
using FurniShop.Infrastructure.Services;

namespace FurniShop.Wpf.Controls;

public enum ChartKind { Column, Area, Donut, HorizontalBar }

/// <summary>
/// Lightweight, dependency-free charts drawn with WPF primitives. Single series use one hue;
/// the donut uses the fixed categorical order with a legend and values, so identity is never colour-alone.
/// Hovering a mark shows its exact value.
/// </summary>
public sealed class Chart : FrameworkElement
{
    private static readonly string[] Palette = { "#2A78D6", "#EB6834", "#1BAF7A", "#EDA100", "#E87BA4", "#008300", "#4A3AA7", "#E34948" };

    public static readonly DependencyProperty ItemsSourceProperty = DependencyProperty.Register(nameof(ItemsSource), typeof(IEnumerable), typeof(Chart),
        new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.AffectsRender));
    public static readonly DependencyProperty KindProperty = DependencyProperty.Register(nameof(Kind), typeof(ChartKind), typeof(Chart),
        new FrameworkPropertyMetadata(ChartKind.Column, FrameworkPropertyMetadataOptions.AffectsRender));
    public static readonly DependencyProperty IsMoneyProperty = DependencyProperty.Register(nameof(IsMoney), typeof(bool), typeof(Chart),
        new FrameworkPropertyMetadata(true, FrameworkPropertyMetadataOptions.AffectsRender));
    public static readonly DependencyProperty SeriesColorProperty = DependencyProperty.Register(nameof(SeriesColor), typeof(string), typeof(Chart),
        new FrameworkPropertyMetadata("#2A78D6", FrameworkPropertyMetadataOptions.AffectsRender));

    private readonly List<(Rect Hit, string Tip)> _hits = new();
    private readonly ToolTip _tip = new() { Placement = System.Windows.Controls.Primitives.PlacementMode.Relative };
    private int _hover = -1;

    public Chart()
    {
        ToolTip = _tip;
        ToolTipService.SetInitialShowDelay(this, 0);
        ToolTipService.SetBetweenShowDelay(this, 0);
        SnapsToDevicePixels = true;
        MinHeight = 160;
    }

    public IEnumerable? ItemsSource { get => (IEnumerable?)GetValue(ItemsSourceProperty); set => SetValue(ItemsSourceProperty, value); }
    public ChartKind Kind { get => (ChartKind)GetValue(KindProperty); set => SetValue(KindProperty, value); }
    public bool IsMoney { get => (bool)GetValue(IsMoneyProperty); set => SetValue(IsMoneyProperty, value); }
    public string SeriesColor { get => (string)GetValue(SeriesColorProperty); set => SetValue(SeriesColorProperty, value); }

    private List<ChartPoint> Points => ItemsSource?.OfType<ChartPoint>().ToList() ?? new();
    private string Fmt(decimal v) => IsMoney ? Money.Compact(v) : Money.Qty(v);
    private string FmtFull(decimal v) => IsMoney ? Money.Format(v, true, 0) : Money.Qty(v);

    private static Brush Brush(string hex) { var b = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex)); b.Freeze(); return b; }

    private FormattedText Text(string s, double size, Brush brush, bool bold = false) =>
        new(s, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight, new Typeface(new FontFamily("Segoe UI"), FontStyles.Normal, bold ? FontWeights.SemiBold : FontWeights.Normal, FontStretches.Normal),
            size, brush, VisualTreeHelper.GetDpi(this).PixelsPerDip);

    protected override void OnRender(DrawingContext dc)
    {
        _hits.Clear();
        var pts = Points;
        var w = ActualWidth; var h = ActualHeight;
        dc.DrawRectangle(Brushes.Transparent, null, new Rect(0, 0, w, h)); // makes the whole area hit-testable
        if (pts.Count == 0 || pts.All(p => p.Value == 0))
        {
            var t = Text("No data for this period", 12, Res.B("TextMuted"));
            dc.DrawText(t, new Point((w - t.Width) / 2, (h - t.Height) / 2));
            return;
        }
        switch (Kind)
        {
            case ChartKind.Donut: Donut(dc, pts, w, h); break;
            case ChartKind.HorizontalBar: HBars(dc, pts, w, h); break;
            default: Cartesian(dc, pts, w, h); break;
        }
    }

    private static decimal NiceMax(decimal max)
    {
        if (max <= 0) return 1;
        var exp = Math.Pow(10, Math.Floor(Math.Log10((double)max)));
        foreach (var m in new[] { 1, 2, 2.5, 5, 10 })
            if (m * exp >= (double)max) return (decimal)(m * exp);
        return max;
    }

    private void Cartesian(DrawingContext dc, List<ChartPoint> pts, double w, double h)
    {
        var muted = Res.B("TextMuted");
        var grid = new Pen(Res.B("ChartGrid"), 1);
        var min = Math.Min(0, pts.Min(p => p.Value));
        var max = NiceMax(pts.Max(p => p.Value));
        const double left = 56, bottom = 24, top = 8;
        var plotW = Math.Max(10, w - left - 8);
        var plotH = Math.Max(10, h - bottom - top);
        double Y(decimal v) => top + plotH - (double)((v - min) / (max - min == 0 ? 1 : max - min)) * plotH;

        for (var i = 0; i <= 4; i++)
        {
            var v = min + (max - min) * i / 4;
            var y = Y(v);
            dc.DrawLine(grid, new Point(left, y), new Point(left + plotW, y));
            var t = Text(Fmt(v), 11, muted);
            dc.DrawText(t, new Point(left - t.Width - 6, y - t.Height / 2));
        }

        var n = pts.Count;
        var step = plotW / n;
        var labelEvery = Math.Max(1, (int)Math.Ceiling(n / Math.Max(1, plotW / 64)));
        for (var i = 0; i < n; i++)
            if (i % labelEvery == 0 || i == n - 1)
            {
                var t = Text(pts[i].Label, 11, muted);
                dc.DrawText(t, new Point(left + step * i + step / 2 - t.Width / 2, top + plotH + 6));
            }

        var brush = Brush(SeriesColor);
        if (Kind == ChartKind.Column)
        {
            var barW = Math.Max(2, Math.Min(36, step * 0.62));
            for (var i = 0; i < n; i++)
            {
                var x = left + step * i + (step - barW) / 2;
                var y = Y(Math.Max(0, pts[i].Value));
                var y0 = Y(Math.Min(0, pts[i].Value));
                var bh = Math.Max(0, y0 - y);
                if (bh > 0)
                {
                    var b = i == _hover ? Brush("#1D5FB0") : brush;
                    dc.DrawRoundedRectangle(b, null, new Rect(x, y, barW, bh), Math.Min(4, barW / 2), Math.Min(4, barW / 2));
                    if (bh > 4) dc.DrawRectangle(b, null, new Rect(x, y + bh - 4, barW, 4)); // square base on the axis
                }
                _hits.Add((new Rect(left + step * i, top, step, plotH), $"{pts[i].Label}: {FmtFull(pts[i].Value)}"));
            }
        }
        else
        {
            var geo = new StreamGeometry();
            var area = new StreamGeometry();
            using (var g = geo.Open())
            using (var a = area.Open())
            {
                for (var i = 0; i < n; i++)
                {
                    var p = new Point(left + step * i + step / 2, Y(pts[i].Value));
                    if (i == 0) { g.BeginFigure(p, false, false); a.BeginFigure(new Point(p.X, Y(0)), true, true); a.LineTo(p, false, false); }
                    else g.LineTo(p, true, true);
                    if (i > 0) a.LineTo(p, false, false);
                    if (i == n - 1) a.LineTo(new Point(p.X, Y(0)), false, false);
                    _hits.Add((new Rect(left + step * i, top, step, plotH), $"{pts[i].Label}: {FmtFull(pts[i].Value)}"));
                }
            }
            var fill = new SolidColorBrush(((SolidColorBrush)brush).Color) { Opacity = 0.12 };
            dc.DrawGeometry(fill, null, area);
            dc.DrawGeometry(null, new Pen(brush, 2) { LineJoin = PenLineJoin.Round }, geo);
            if (_hover >= 0 && _hover < n)
            {
                var hx = left + step * _hover + step / 2;
                dc.DrawLine(new Pen(Res.B("BorderStrong"), 1), new Point(hx, top), new Point(hx, top + plotH));
                dc.DrawEllipse(Brushes.White, new Pen(brush, 2), new Point(hx, Y(pts[_hover].Value)), 4.5, 4.5);
            }
        }
    }

    private void HBars(DrawingContext dc, List<ChartPoint> pts, double w, double h)
    {
        var brush = Brush(SeriesColor);
        var max = pts.Max(p => p.Value);
        var rowH = Math.Min(34, h / pts.Count);
        var labelW = Math.Min(170, w * 0.42);
        for (var i = 0; i < pts.Count; i++)
        {
            var y = i * rowH;
            var label = Text(pts[i].Label, 12, Res.B("TextSecondary"));
            label.MaxTextWidth = labelW - 8; label.MaxLineCount = 1; label.Trimming = TextTrimming.CharacterEllipsis;
            dc.DrawText(label, new Point(0, y + (rowH - label.Height) / 2));
            var valueText = Text(Fmt(pts[i].Value), 12, Res.B("TextPrimary"), true);
            var barMax = Math.Max(10, w - labelW - valueText.Width - 12);
            var bw = max == 0 ? 0 : (double)(pts[i].Value / max) * barMax;
            var barH = Math.Min(14, rowH * 0.5);
            dc.DrawRoundedRectangle(i == _hover ? Brush("#1D5FB0") : brush, null, new Rect(labelW, y + (rowH - barH) / 2, Math.Max(2, bw), barH), 3, 3);
            dc.DrawText(valueText, new Point(labelW + bw + 6, y + (rowH - valueText.Height) / 2));
            _hits.Add((new Rect(0, y, w, rowH), $"{pts[i].Label}: {FmtFull(pts[i].Value)}"));
        }
    }

    private void Donut(DrawingContext dc, List<ChartPoint> pts, double w, double h)
    {
        // Fold anything past 7 slices into "Other" — never generate extra hues.
        if (pts.Count > 8)
            pts = pts.Take(7).Append(new ChartPoint("Other", pts.Skip(7).Sum(p => p.Value))).ToList();
        var total = pts.Sum(p => p.Value);
        var legendW = Math.Min(200, w * 0.5);
        var size = Math.Min(h - 8, w - legendW - 16);
        var r = size / 2; var center = new Point(r + 4, h / 2);
        var inner = r * 0.62;
        double angle = -90;
        for (var i = 0; i < pts.Count; i++)
        {
            var sweep = total == 0 ? 0 : (double)(pts[i].Value / total) * 360;
            if (sweep <= 0) continue;
            var gap = pts.Count > 1 ? Math.Min(1.2, sweep / 3) : 0;
            var geo = Arc(center, r - (i == _hover ? 0 : 2), inner, angle + gap / 2, sweep - gap);
            dc.DrawGeometry(Brush(Palette[i % Palette.Length]), null, geo);
            angle += sweep;
        }
        var totalText = Text(Fmt(total), 15, Res.B("TextPrimary"), true);
        dc.DrawText(totalText, new Point(center.X - totalText.Width / 2, center.Y - totalText.Height / 2));

        var lx = size + 20;
        var rowH = Math.Min(24, h / pts.Count);
        var ly = (h - rowH * pts.Count) / 2;
        for (var i = 0; i < pts.Count; i++)
        {
            var y = ly + i * rowH;
            dc.DrawRoundedRectangle(Brush(Palette[i % Palette.Length]), null, new Rect(lx, y + rowH / 2 - 5, 10, 10), 2, 2);
            var pct = total == 0 ? 0 : pts[i].Value * 100 / total;
            var label = Text($"{pts[i].Label}", 12, Res.B("TextSecondary"));
            label.MaxTextWidth = Math.Max(20, w - lx - 80); label.MaxLineCount = 1; label.Trimming = TextTrimming.CharacterEllipsis;
            dc.DrawText(label, new Point(lx + 16, y + (rowH - label.Height) / 2));
            var val = Text($"{pct:0}%", 12, Res.B("TextPrimary"), true);
            dc.DrawText(val, new Point(w - val.Width - 2, y + (rowH - val.Height) / 2));
            _hits.Add((new Rect(lx, y, w - lx, rowH), $"{pts[i].Label}: {FmtFull(pts[i].Value)} ({pct:0.#}%)"));
        }
        _hits.Add((new Rect(center.X - r, center.Y - r, size, size), $"Total: {FmtFull(total)}"));
    }

    private static Geometry Arc(Point c, double r, double inner, double startDeg, double sweepDeg)
    {
        sweepDeg = Math.Min(sweepDeg, 359.99);
        Point P(double rad, double deg) => new(c.X + rad * Math.Cos(deg * Math.PI / 180), c.Y + rad * Math.Sin(deg * Math.PI / 180));
        var large = sweepDeg > 180;
        var g = new StreamGeometry();
        using (var ctx = g.Open())
        {
            ctx.BeginFigure(P(r, startDeg), true, true);
            ctx.ArcTo(P(r, startDeg + sweepDeg), new Size(r, r), 0, large, SweepDirection.Clockwise, true, false);
            ctx.LineTo(P(inner, startDeg + sweepDeg), true, false);
            ctx.ArcTo(P(inner, startDeg), new Size(inner, inner), 0, large, SweepDirection.Counterclockwise, true, false);
        }
        g.Freeze();
        return g;
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        var p = e.GetPosition(this);
        var idx = _hits.FindIndex(x => x.Hit.Contains(p));
        if (idx >= 0)
        {
            _tip.Content = _hits[idx].Tip;
            _tip.HorizontalOffset = p.X + 12;
            _tip.VerticalOffset = p.Y - 28;
            _tip.IsOpen = true;
        }
        else _tip.IsOpen = false;
        var barIndex = Kind == ChartKind.Donut ? -1 : idx;
        if (barIndex != _hover) { _hover = barIndex; InvalidateVisual(); }
    }

    protected override void OnMouseLeave(MouseEventArgs e)
    {
        base.OnMouseLeave(e);
        _tip.IsOpen = false;
        if (_hover != -1) { _hover = -1; InvalidateVisual(); }
    }
}
