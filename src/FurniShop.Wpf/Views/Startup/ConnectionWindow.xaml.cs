using System.Windows;
using FurniShop.Infrastructure.Database;
using FurniShop.Wpf.Services;

namespace FurniShop.Wpf.Views.Startup;

public partial class ConnectionWindow : Window
{
    public string? ConnectionString { get; private set; }

    public ConnectionWindow(string? current, string? error)
    {
        InitializeComponent();
        if (current is not null) ConnectionBox.Text = current;
        if (error is not null) Show(error, false);
    }

    private void Show(string message, bool ok)
    {
        StatusPanel.Visibility = Visibility.Visible;
        StatusPanel.Background = (System.Windows.Media.Brush)FindResource(ok ? "SuccessBg" : "ErrorBg");
        StatusText.Foreground = (System.Windows.Media.Brush)FindResource(ok ? "SuccessFg" : "ErrorFg");
        StatusText.Text = message;
    }

    private async Task<string?> TestAsync()
    {
        string cs;
        try { cs = ConnectionStrings.Normalise(ConnectionBox.Text); }
        catch (Exception ex) { Show("That does not look like a connection string: " + ex.Message, false); return null; }
        TestButton.IsEnabled = SaveButton.IsEnabled = false;
        Show("Connecting… (a sleeping Neon database can take a few seconds to wake up)", true);
        try
        {
            var version = await Db.TestConnectionAsync(cs);
            Show($"Connected to {ConnectionStrings.Describe(cs)}\n{version.Split(',')[0]}", true);
            return cs;
        }
        catch (Exception ex)
        {
            Show("Could not connect: " + ex.Message, false);
            return null;
        }
        finally
        {
            TestButton.IsEnabled = SaveButton.IsEnabled = true;
        }
    }

    private async void Test_Click(object sender, RoutedEventArgs e) => await TestAsync();

    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        var cs = await TestAsync();
        if (cs is null) return;
        ConnectionStore.Save(cs);
        ConnectionString = cs;
        DialogResult = true;
    }

    private void Exit_Click(object sender, RoutedEventArgs e) => DialogResult = false;
}
