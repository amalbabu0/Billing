using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;

namespace FurniShop.Wpf.Controls;

public interface ISortable
{
    void Sort(string? key);
}

/// <summary>DataGrid helpers: server-side sorting and open-on-double-click / Enter.</summary>
public static class GridBehaviors
{
    public static readonly DependencyProperty ServerSortProperty = DependencyProperty.RegisterAttached("ServerSort", typeof(bool), typeof(GridBehaviors),
        new PropertyMetadata(false, (d, e) =>
        {
            if (d is DataGrid g && e.NewValue is true) g.Sorting += OnSorting;
        }));

    public static bool GetServerSort(DependencyObject o) => (bool)o.GetValue(ServerSortProperty);
    public static void SetServerSort(DependencyObject o, bool v) => o.SetValue(ServerSortProperty, v);

    private static void OnSorting(object sender, DataGridSortingEventArgs e)
    {
        if (sender is not DataGrid { DataContext: ISortable s }) return;
        e.Handled = true;
        var key = e.Column.SortMemberPath;
        if (string.IsNullOrEmpty(key)) return;
        s.Sort(key);
        var dir = e.Column.SortDirection == System.ComponentModel.ListSortDirection.Ascending
            ? System.ComponentModel.ListSortDirection.Descending : System.ComponentModel.ListSortDirection.Ascending;
        foreach (var c in ((DataGrid)sender).Columns) c.SortDirection = null;
        e.Column.SortDirection = dir;
    }

    public static readonly DependencyProperty OpenCommandProperty = DependencyProperty.RegisterAttached("OpenCommand", typeof(ICommand), typeof(GridBehaviors),
        new PropertyMetadata(null, (d, e) =>
        {
            if (d is not Selector s) return;
            s.MouseDoubleClick -= OnDouble;
            s.KeyDown -= OnKey;
            if (e.NewValue is not null)
            {
                s.MouseDoubleClick += OnDouble;
                s.KeyDown += OnKey;
            }
        }));

    public static ICommand? GetOpenCommand(DependencyObject o) => (ICommand?)o.GetValue(OpenCommandProperty);
    public static void SetOpenCommand(DependencyObject o, ICommand? v) => o.SetValue(OpenCommandProperty, v);

    private static void Exec(Selector s)
    {
        var cmd = GetOpenCommand(s);
        if (s.SelectedItem is { } item && cmd?.CanExecute(item) == true) cmd.Execute(item);
    }

    private static void OnDouble(object sender, MouseButtonEventArgs e)
    {
        if (e.OriginalSource is DependencyObject src && FindParent<DataGridColumnHeader>(src) is not null) return;
        Exec((Selector)sender);
    }

    private static void OnKey(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        Exec((Selector)sender);
        e.Handled = true;
    }

    private static T? FindParent<T>(DependencyObject o) where T : DependencyObject
    {
        while (o is not null and not T) o = System.Windows.Media.VisualTreeHelper.GetParent(o);
        return o as T;
    }
}

/// <summary>
/// Shows its first child (usually a DataGrid) on wide screens and its second child (a card list) when narrower
/// than <see cref="Breakpoint"/> — tables become cards on tablets / phones.
/// </summary>
public sealed class AdaptiveList : Grid
{
    public double Breakpoint { get; set; } = 720;

    public AdaptiveList()
    {
        SizeChanged += (_, _) => Update();
        Loaded += (_, _) => Update();
    }

    private void Update()
    {
        if (Children.Count < 2) return;
        var narrow = ActualWidth > 0 && ActualWidth < Breakpoint;
        Children[0].Visibility = narrow ? Visibility.Collapsed : Visibility.Visible;
        Children[1].Visibility = narrow ? Visibility.Visible : Visibility.Collapsed;
    }
}

/// <summary>A wrap panel whose children share the row evenly (KPI tiles).</summary>
public sealed class ResponsiveTiles : Panel
{
    public double MinTileWidth { get; set; } = 220;

    protected override Size MeasureOverride(Size available)
    {
        var width = double.IsInfinity(available.Width) ? MinTileWidth * 4 : available.Width;
        var cols = Math.Max(1, (int)(width / MinTileWidth));
        var tileW = width / cols;
        double rowH = 0, total = 0;
        for (var i = 0; i < InternalChildren.Count; i++)
        {
            var c = InternalChildren[i];
            c.Measure(new Size(tileW, double.PositiveInfinity));
            rowH = Math.Max(rowH, c.DesiredSize.Height);
            if ((i + 1) % cols == 0 || i == InternalChildren.Count - 1) { total += rowH; rowH = 0; }
        }
        return new Size(width, total);
    }

    protected override Size ArrangeOverride(Size final)
    {
        var cols = Math.Max(1, (int)(final.Width / MinTileWidth));
        var tileW = final.Width / cols;
        double y = 0, rowH = 0;
        for (var i = 0; i < InternalChildren.Count; i++)
        {
            var c = InternalChildren[i];
            rowH = Math.Max(rowH, c.DesiredSize.Height);
            if ((i + 1) % cols == 0 || i == InternalChildren.Count - 1)
            {
                for (var j = i - i % cols; j <= i; j++) InternalChildren[j].Arrange(new Rect((j % cols) * tileW, y, tileW, rowH));
                y += rowH; rowH = 0;
            }
        }
        return final;
    }
}
