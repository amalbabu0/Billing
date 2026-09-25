using System.Windows;
using FurniShop.Core;
using FurniShop.Infrastructure.Database;
using FurniShop.Wpf.Services;

namespace FurniShop.Wpf.Views.Startup;

public partial class SetupWindow : Window
{
    public SetupWindow() => InitializeComponent();

    private async void Create_Click(object sender, RoutedEventArgs e)
    {
        ErrorText.Text = "";
        if (PasswordBox.Password != ConfirmBox.Password) { ErrorText.Text = "The passwords do not match."; return; }
        CreateButton.IsEnabled = false;
        try
        {
            ProgressText.Text = "Creating the owner account…";
            await AppHost.App.Auth.CreateInitialAdminAsync(UserBox.Text, NameBox.Text, PasswordBox.Password);
            if (DemoCheck.IsChecked == true)
            {
                var login = await AppHost.App.Auth.LoginAsync(UserBox.Text, PasswordBox.Password);
                if (login.Outcome == Infrastructure.Services.LoginOutcome.Success)
                {
                    await new DemoDataSeeder(AppHost.App).SeedAsync(new Progress<string>(m => ProgressText.Text = "Loading demo data: " + m));
                    await AppHost.App.Auth.LogoutAsync();
                    MessageBox.Show(this, $"Demo data loaded.\n\nStaff demo logins: manager, sales1, sales2, delivery1, accounts\nPassword: {DemoDataSeeder.DemoPassword}",
                        "FurniShop", MessageBoxButton.OK, MessageBoxImage.Information);
                }
            }
            DialogResult = true;
        }
        catch (ValidationException ex) { ErrorText.Text = ex.Message; }
        catch (Exception ex)
        {
            ConnectionStore.LogError(ex);
            ErrorText.Text = ex.Message;
        }
        finally
        {
            CreateButton.IsEnabled = true;
        }
    }

    private void Exit_Click(object sender, RoutedEventArgs e) => DialogResult = false;
}
