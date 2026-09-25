using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;
using FurniShop.Infrastructure;
using FurniShop.Wpf.Services;
using FurniShop.Wpf.ViewModels;
using FurniShop.Wpf.Views;
using FurniShop.Wpf.Views.Startup;

namespace FurniShop.Wpf;

/// <summary>
/// Startup: connect (Neon) → migrate → first-run owner setup → sign in → main window.
/// Idle sessions are locked after the configured timeout.
/// </summary>
public partial class App : Application
{
    private MainWindow? _main;
    private DispatcherTimer? _idleTimer;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        DispatcherUnhandledException += (_, ex) =>
        {
            ConnectionStore.LogError(ex.Exception);
            AppHost.Shell?.Toast.Error("Unexpected error: " + ex.Exception.Message);
            ex.Handled = true;
        };
        TaskScheduler.UnobservedTaskException += (_, ex) => { ConnectionStore.LogError(ex.Exception); ex.SetObserved(); };
        FrameworkElement.LanguageProperty.OverrideMetadata(typeof(FrameworkElement),
            new FrameworkPropertyMetadata(System.Windows.Markup.XmlLanguage.GetLanguage("en-IN")));

        if (!await ConnectAsync()) { Shutdown(); return; }
        ShowLogin(null);
    }

    /// <summary>Loops until a working database connection is configured and migrated (or the user exits).</summary>
    private async Task<bool> ConnectAsync(bool forceAsk = false)
    {
        string? error = null;
        var cs = forceAsk ? null : ConnectionStore.Load();
        while (true)
        {
            if (cs is null)
            {
                var win = new ConnectionWindow(null, error);
                if (win.ShowDialog() != true) return false;
                cs = win.ConnectionString!;
            }
            try
            {
                if (AppHost.App is not null) await AppHost.App.DisposeAsync();
                AppHost.App = new AppServices(cs);
                await AppHost.App.Migrator.MigrateAsync();
                if (await AppHost.App.Auth.NeedsInitialSetupAsync())
                {
                    if (new SetupWindow().ShowDialog() != true) return false;
                }
                AppHost.Shell = new ShellViewModel();
                return true;
            }
            catch (Exception ex)
            {
                ConnectionStore.LogError(ex);
                error = "Could not open the database: " + ex.Message;
                cs = null;
            }
        }
    }

    private async void ShowLogin(string? message)
    {
        string shopName;
        try { shopName = (await AppHost.App.Settings.GetAsync(true)).Shop.ShopName; }
        catch { shopName = "FurniShop"; }

        var login = new LoginWindow(shopName, ConnectionStrings.Describe(AppHost.App.Db.ConnectionString), message);
        if (login.ShowDialog() != true)
        {
            if (login.ChangeDatabaseRequested && await ConnectAsync(forceAsk: true)) { ShowLogin(null); return; }
            Shutdown();
            return;
        }
        AppHost.Shell.ShopName = shopName;
        OpenMain(login.MustChangePassword);
    }

    private void OpenMain(bool mustChangePassword)
    {
        var shell = AppHost.Shell;
        shell.BuildMenu();
        shell.SignOutRequested -= OnSignOut;
        shell.SignOutRequested += OnSignOut;
        _main = new MainWindow(shell);
        MainWindow = _main;
        _main.Closed += (_, _) =>
        {
            if (_main is not null) { _ = AppHost.App.Auth.LogoutAsync(); Shutdown(); }
        };
        _main.Show();
        shell.NavigateHome();
        _ = shell.RefreshNotificationsAsync();
        _ = AppHost.App.Notifications.GenerateDailyAsync().ContinueWith(_ => shell.RefreshNotificationsAsync(), TaskScheduler.FromCurrentSynchronizationContext());
        if (mustChangePassword) _ = ForcePasswordChangeAsync();
        StartIdleWatch();
    }

    private async Task ForcePasswordChangeAsync()
    {
        while (!await AppHost.Shell.ShowDialogAsync(new ChangePasswordDialogViewModel(true)))
            AppHost.Shell.Toast.Warning("You need to set a new password to continue.");
    }

    private async void OnSignOut(object? sender, EventArgs e)
    {
        await AppHost.App.Auth.LogoutAsync();
        CloseMain();
        ShowLogin(null);
    }

    private void CloseMain()
    {
        _idleTimer?.Stop();
        var m = _main;
        _main = null;
        m?.Close();
        AppHost.Shell = new ShellViewModel();
    }

    private void StartIdleWatch()
    {
        InputManager.Current.PreProcessInput -= OnInput;
        InputManager.Current.PreProcessInput += OnInput;
        _idleTimer ??= new DispatcherTimer { Interval = TimeSpan.FromSeconds(30) };
        _idleTimer.Tick -= OnIdleTick;
        _idleTimer.Tick += OnIdleTick;
        _idleTimer.Start();
    }

    private static void OnInput(object sender, PreProcessInputEventArgs e)
    {
        if (e.StagingItem.Input is MouseButtonEventArgs or KeyEventArgs) AppHost.App?.Session.Touch();
    }

    private async void OnIdleTick(object? sender, EventArgs e)
    {
        var minutes = (await AppHost.App.Settings.GetAsync()).Security.IdleTimeoutMinutes;
        if (minutes <= 0 || !AppHost.App.Session.IsAuthenticated) return;
        if (DateTime.UtcNow - AppHost.App.Session.LastActivity < TimeSpan.FromMinutes(minutes)) return;
        await AppHost.App.Auth.LogoutAsync();
        CloseMain();
        ShowLogin($"Signed out after {minutes} minutes of inactivity.");
    }
}
