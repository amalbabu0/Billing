using System.Windows;
using System.Windows.Input;
using FurniShop.Wpf.ViewModels;

namespace FurniShop.Wpf.Views;

public partial class MainWindow : Window
{
    private bool? _lastNarrow;

    public MainWindow(ShellViewModel shell)
    {
        InitializeComponent();
        DataContext = shell;
        PreviewKeyDown += OnPreviewKeyDown;
        SizeChanged += (_, _) => Adapt();
        Loaded += (_, _) => Adapt();
    }

    private ShellViewModel Shell => (ShellViewModel)DataContext;

    /// <summary>Tablet / small laptop: collapse the sidebar to icons and shorten the top bar.</summary>
    private void Adapt()
    {
        var narrow = ActualWidth < 1100;
        NewInvoiceText.Visibility = ActualWidth < 700 ? Visibility.Collapsed : Visibility.Visible;
        if (_lastNarrow == narrow) return;
        _lastNarrow = narrow;
        Shell.IsSidebarCollapsed = narrow;
    }

    private void OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.K && Keyboard.Modifiers == ModifierKeys.Control)
        {
            GlobalSearchBox.Focus();
            GlobalSearchBox.SelectAll();
            e.Handled = true;
        }
        else if (e.Key == Key.Escape && Shell.IsSearchOpen)
        {
            Shell.IsSearchOpen = false;
            e.Handled = true;
        }
    }

    private void Toast_Click(object sender, MouseButtonEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: ToastItem t })
        {
            Shell.Toasts.Remove(t);
            t.OnClick?.Invoke();
        }
    }
}
