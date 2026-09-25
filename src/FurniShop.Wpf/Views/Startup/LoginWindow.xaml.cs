using System.Windows;
using FurniShop.Infrastructure.Services;
using FurniShop.Wpf.Services;

namespace FurniShop.Wpf.Views.Startup;

public partial class LoginWindow : Window
{
    public bool ChangeDatabaseRequested { get; private set; }
    public bool MustChangePassword { get; private set; }

    public LoginWindow(string shopName, string dbDescription, string? message = null)
    {
        InitializeComponent();
        ShopNameText.Text = shopName;
        DbText.Text = "Database: " + dbDescription;
        if (message is not null) ErrorText.Text = message;
        Loaded += (_, _) => UserBox.Focus();
        SizeChanged += (_, _) =>
        {
            var narrow = ActualWidth < 760;
            BrandPanel.Visibility = narrow ? Visibility.Collapsed : Visibility.Visible;
            BrandColumn.Width = narrow ? new GridLength(0) : new GridLength(1, GridUnitType.Star);
        };
    }

    private async void Login_Click(object sender, RoutedEventArgs e)
    {
        ErrorText.Text = "";
        LoginButton.IsEnabled = false;
        LoginButton.Content = "Signing in…";
        try
        {
            var r = await AppHost.App.Auth.LoginAsync(UserBox.Text, PasswordBox.Password);
            if (r.Outcome == LoginOutcome.Success)
            {
                MustChangePassword = r.MustChangePassword;
                DialogResult = true;
                return;
            }
            ErrorText.Text = r.Message;
            PasswordBox.Clear();
            PasswordBox.Focus();
        }
        catch (Exception ex)
        {
            ConnectionStore.LogError(ex);
            ErrorText.Text = "Cannot reach the database: " + ex.Message;
        }
        finally
        {
            LoginButton.IsEnabled = true;
            LoginButton.Content = "Sign in";
        }
    }

    private void ChangeDb_Click(object sender, RoutedEventArgs e)
    {
        ChangeDatabaseRequested = true;
        DialogResult = false;
    }
}
