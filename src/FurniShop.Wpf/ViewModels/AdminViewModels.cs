using System.Collections.ObjectModel;
using System.Data;
using System.IO;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Messaging;
using FurniShop.Core.Security;
using FurniShop.Core.Settings;
using FurniShop.Core.Validation;
using FurniShop.Infrastructure.Services;
using FurniShop.Wpf.Printing;
using FurniShop.Wpf.Services;

namespace FurniShop.Wpf.ViewModels;

// ============================================================================ Dashboard
public sealed partial class DashboardViewModel : PageViewModel
{
    public DashboardViewModel()
    {
        Title = "Dashboard";
    }

    [ObservableProperty] private DashboardData? _data;
    public string Greeting => DateTime.Now.Hour switch { < 12 => "Good morning", < 17 => "Good afternoon", _ => "Good evening" } + ", " + App.Session.FullName.Split(' ')[0];
    public string MonthChange
    {
        get
        {
            if (Data is null || Data.LastMonthSales == 0) return "This month";
            var pct = (Data.MonthSales - Data.LastMonthSales) * 100 / Data.LastMonthSales;
            return $"{(pct >= 0 ? "▲" : "▼")} {Math.Abs(pct):0}% vs last month (full)";
        }
    }

    public override async Task LoadAsync()
    {
        Subtitle = $"{DateTime.Today:dddd, dd MMMM yyyy}";
        Data = await App.Dashboard.LoadAsync();
        OnPropertyChanged(nameof(MonthChange));
        OnPropertyChanged(nameof(Greeting));
    }

    [RelayCommand]
    private void Go(string target)
    {
        switch (target)
        {
            case "invoices": Shell.Navigate(Routes.Invoices); break;
            case "outstanding": Shell.Navigate(Routes.Outstanding); break;
            case "overdue": Shell.Navigate(Routes.Invoices, "OVERDUE"); break;
            case "payments": Shell.Navigate(Routes.Payments); break;
            case "deliveries": Shell.Navigate(Routes.Deliveries, DeliveryStatus.Pending); break;
            case "custom": Shell.Navigate(Routes.CustomOrders, "ACTIVE"); break;
            case "low": Shell.Navigate(Routes.Stock, "LOW"); break;
            case "out": Shell.Navigate(Routes.Stock, "OUT"); break;
            case "reserved": Shell.Navigate(Routes.Reserved); break;
            case "orders": Shell.Navigate(Routes.SalesOrders); break;
            case "quotations": Shell.Navigate(Routes.Quotations); break;
            case "profit": Shell.Navigate(Routes.Reports, "profit.summary"); break;
            case "customers": Shell.Navigate(Routes.Customers); break;
        }
    }

    [RelayCommand] private void OpenInvoice(InvoiceListItem? i) { if (i is not null) Shell.Navigate(Routes.Invoice, i.Id); }
    [RelayCommand] private void OpenCustomer(Customer? c) { if (c is not null) Shell.Navigate(Routes.Customer, c.Id); }
    [RelayCommand] private void OpenPayment(Payment? p) { if (p is not null) _ = Shell.ShowDialogAsync(new PaymentDetailDialogViewModel(p.Id)); }
}

// ============================================================================ Reports
public sealed partial class ReportsViewModel : PageViewModel
{
    public ReportsViewModel(string? key)
    {
        Title = "Reports";
        Subtitle = "Pick a report, set the filters and export to Excel, CSV or PDF.";
        Definitions = App.Reports.Available();
        Selected = Definitions.FirstOrDefault(d => d.Key == key) ?? Definitions.FirstOrDefault();
    }

    public IReadOnlyList<ReportDefinition> Definitions { get; }
    public IEnumerable<IGrouping<string, ReportDefinition>> Groups => Definitions.GroupBy(d => d.Group);
    public ObservableCollection<Category> Categories { get; } = new();
    public ObservableCollection<Customer> Customers { get; } = new();
    public ObservableCollection<Supplier> Suppliers { get; } = new();
    public ObservableCollection<SellableItem> Products { get; } = new();
    public IReadOnlyList<Option> Groupings { get; } = new[] { new Option("day", "Daily"), new Option("week", "Weekly"), new Option("month", "Monthly"), new Option("year", "Yearly") };
    public IReadOnlyList<Option> Presets { get; } = new[]
    {
        new Option("today", "Today"), new Option("yesterday", "Yesterday"), new Option("week", "This week"), new Option("month", "This month"),
        new Option("lastmonth", "Last month"), new Option("fy", "This financial year"), new Option("year", "This calendar year"),
    };

    [ObservableProperty] private ReportDefinition? _selected;
    [ObservableProperty] private DateTime _from = new(DateTime.Today.Year, DateTime.Today.Month, 1);
    [ObservableProperty] private DateTime _to = DateTime.Today;
    [ObservableProperty] private Category? _category;
    [ObservableProperty] private Customer? _customer;
    [ObservableProperty] private Supplier? _supplier;
    [ObservableProperty] private SellableItem? _product;
    [ObservableProperty] private Option? _grouping;
    [ObservableProperty] private ReportResult? _result;
    [ObservableProperty] private DataView? _view;
    public bool CanExport => Can(Perm.ExportData);

    public override async Task LoadAsync()
    {
        Grouping ??= Selected?.Key == "profit.summary" ? Groupings[2] : Groupings[0];
        if (Categories.Count == 0)
        {
            Categories.Add(new Category { Id = 0, Name = "All categories" });
            foreach (var c in await App.Catalog.CategoriesAsync()) Categories.Add(c);
            Category = Categories[0];
            if (Can(Perm.CustomerView))
            {
                Customers.Add(new Customer { Id = 0, Name = "All customers" });
                foreach (var c in (await App.Customers.ListAsync(new ListQuery { PageSize = 1000 })).Items) Customers.Add(c);
                Customer = Customers[0];
            }
            if (Can(Perm.SupplierView) || Can(Perm.PurchaseView))
            {
                Suppliers.Add(new Supplier { Id = 0, Name = "All suppliers" });
                foreach (var s in (await App.Suppliers.ListAsync(new ListQuery { PageSize = 1000 })).Items) Suppliers.Add(s);
                Supplier = Suppliers[0];
            }
            Products.Add(new SellableItem { VariantId = 0, ProductId = 0, ProductName = "All products" });
            foreach (var p in (await App.Catalog.ListProductsAsync(new ListQuery { PageSize = 2000 })).Items)
                Products.Add(new SellableItem { ProductId = p.Id, ProductName = p.Name, Sku = p.Code });
            Product = Products[0];
        }
        await RunReportAsync();
    }

    partial void OnSelectedChanged(ReportDefinition? value) { if (Categories.Count > 0) _ = RunAsync(RunReportAsync); }

    [RelayCommand]
    private Task ApplyPresetAsync(string preset)
    {
        var t = DateTime.Today;
        (From, To) = preset switch
        {
            "today" => (t, t),
            "yesterday" => (t.AddDays(-1), t.AddDays(-1)),
            "week" => (t.AddDays(-(((int)t.DayOfWeek + 6) % 7)), t),
            "lastmonth" => (new DateTime(t.Year, t.Month, 1).AddMonths(-1), new DateTime(t.Year, t.Month, 1).AddDays(-1)),
            "fy" => (new DateTime(t.Month >= 4 ? t.Year : t.Year - 1, 4, 1), t),
            "year" => (new DateTime(t.Year, 1, 1), t),
            _ => (new DateTime(t.Year, t.Month, 1), t),
        };
        return RunAsync(RunReportAsync);
    }

    [RelayCommand] private Task RunAsync() => RunAsync(RunReportAsync);

    private async Task RunReportAsync()
    {
        if (Selected is null) return;
        Result = await App.Reports.RunAsync(Selected.Key, new ReportFilter
        {
            From = From, To = To, CategoryId = Category?.Id is > 0 ? Category.Id : null, CustomerId = Customer?.Id is > 0 ? Customer.Id : null,
            SupplierId = Supplier?.Id is > 0 ? Supplier.Id : null, ProductId = Product?.ProductId is > 0 ? Product.ProductId : null, GroupBy = Grouping?.Value ?? "day",
        });
        // Format for display: money columns as ₹, statuses as labels.
        var display = new DataTable();
        foreach (DataColumn c in Result.Table.Columns) display.Columns.Add(c.ColumnName, typeof(string));
        foreach (DataRow r in Result.Table.Rows)
            display.Rows.Add(Result.Table.Columns.Cast<DataColumn>().Select(c => (object)Infrastructure.Documents.Layouts.FormatCell(r[c], Result.MoneyColumns.Contains(c.ColumnName))).ToArray());
        View = display.DefaultView;
    }

    [RelayCommand]
    private Task ExportAsync(string format) => RunAsync(async () =>
    {
        if (Result is null) return;
        App.Documents.DemandExport();
        await ListPageViewModel<object>.ExportTableAsync(Result.Table, Result.Definition.Title, Result.Subtitle, Result.MoneyColumns, Result.Totals, format);
        await App.Audit.LogAsync("EXPORT", "Reports", $"exported report {Result.Definition.Title} as {format.ToUpperInvariant()}");
    });

    [RelayCommand]
    private Task PrintAsync() => RunAsync(async () =>
    {
        if (Result is null) return;
        var s = await App.Settings.GetAsync();
        PrintService.Preview(Result.Definition.Title, t => Infrastructure.Documents.Layouts.Table(t, s.Shop.ShopName, Result.Definition.Title, Result.Subtitle, Result.Table, Result.MoneyColumns, Result.Totals));
    });
}

// ============================================================================ Employees
public sealed partial class UserListViewModel : PageViewModel
{
    public UserListViewModel()
    {
        Title = "Users";
        Subtitle = "Staff accounts. Each person signs in with their own account so every action is traceable.";
    }

    public ObservableCollection<User> Users { get; } = new();
    public override async Task LoadAsync()
    {
        Users.Clear();
        foreach (var u in await App.Users.ListAsync()) Users.Add(u);
    }

    [RelayCommand]
    private async Task EditAsync(User? u)
    {
        if (await Shell.ShowDialogAsync(new UserDialogViewModel(u))) await RunAsync(LoadAsync);
    }

    [RelayCommand] private Task NewAsync() => EditAsync(null);

    [RelayCommand]
    private Task UnlockAsync(User? u) => u is null ? Task.CompletedTask : RunAsync(async () => { await App.Users.UnlockAsync(u.Id); await LoadAsync(); }, "User unlocked.");

    [RelayCommand]
    private async Task DeleteAsync(User? u)
    {
        if (u is null || !await Shell.ConfirmAsync("Delete user", $"Delete {u.FullName}? Their history stays in the activity log.", "Delete", true)) return;
        await RunAsync(async () => { await App.Users.DeleteAsync(u.Id); await LoadAsync(); }, "User deleted.");
    }
}

public sealed partial class UserDialogViewModel : DialogViewModel
{
    public UserDialogViewModel(User? u)
    {
        Model = u is null ? new User { IsActive = true } : new User { Id = u.Id, Username = u.Username, FullName = u.FullName, Mobile = u.Mobile, Email = u.Email, RoleId = u.RoleId, IsActive = u.IsActive };
        DialogTitle = u is null ? "New user" : $"Edit {u.FullName}";
    }

    public User Model { get; }
    public bool IsNew => Model.Id == 0;
    public ObservableCollection<Role> Roles { get; } = new();
    [ObservableProperty] private Role? _role;
    [ObservableProperty] private string _password = "";
    public string PasswordHint => IsNew ? "The user must change it at first sign-in." : "Leave empty to keep the current password. Setting one forces a change at next sign-in.";

    public override async Task InitAsync()
    {
        foreach (var r in await App.Users.RolesAsync()) Roles.Add(r);
        Role = Roles.FirstOrDefault(r => r.Id == Model.RoleId) ?? Roles.FirstOrDefault(r => r.Code == "SALES");
    }

    protected override async Task OnAcceptAsync()
    {
        Model.RoleId = Role?.Id ?? 0;
        await App.Users.SaveAsync(Model, string.IsNullOrEmpty(Password) ? null : Password);
        Shell.Toast.Success("User saved.");
    }
}

public sealed partial class PermissionRow : ObservableObject
{
    public required PermissionInfo Info { get; init; }
    [ObservableProperty] private bool _granted;
}

public sealed partial class RolesViewModel : PageViewModel
{
    public RolesViewModel()
    {
        Title = "Roles & Permissions";
        Subtitle = "What each role may do. Permissions are enforced by the server-side services, not just by hiding buttons.";
    }

    public ObservableCollection<Role> Roles { get; } = new();
    public ObservableCollection<PermissionRow> Permissions { get; } = new();
    public IEnumerable<IGrouping<string, PermissionRow>> Grouped => Permissions.GroupBy(p => p.Info.Module);
    [ObservableProperty] private Role? _selectedRole;
    [ObservableProperty] private string? _roleName;
    [ObservableProperty] private string? _roleDescription;

    public override async Task LoadAsync()
    {
        var selected = SelectedRole?.Id;
        Roles.Clear();
        foreach (var r in await App.Users.RolesAsync()) Roles.Add(r);
        if (Permissions.Count == 0) foreach (var p in await App.Users.PermissionsAsync()) Permissions.Add(new PermissionRow { Info = p });
        OnPropertyChanged(nameof(Grouped));
        SelectedRole = Roles.FirstOrDefault(r => r.Id == selected) ?? Roles.FirstOrDefault();
    }

    partial void OnSelectedRoleChanged(Role? value) => _ = RunAsync(async () =>
    {
        if (value is null) return;
        RoleName = value.Name; RoleDescription = value.Description;
        var granted = (await App.Users.RolePermissionsAsync(value.Id)).ToHashSet();
        foreach (var p in Permissions) p.Granted = granted.Contains(p.Info.Code);
    }, showBusy: false);

    [RelayCommand]
    private void NewRole()
    {
        SelectedRole = null;
        RoleName = "New role"; RoleDescription = null;
        foreach (var p in Permissions) p.Granted = false;
    }

    [RelayCommand]
    private Task SaveAsync() => RunAsync(async () =>
    {
        var id = await App.Users.SaveRoleAsync(new Role { Id = SelectedRole?.Id ?? 0, Name = RoleName ?? "", Description = RoleDescription },
            Permissions.Where(p => p.Granted).Select(p => p.Info.Code).ToList());
        await App.Auth.RefreshPermissionsAsync();
        Shell.BuildMenu();
        SelectedRole = new Role { Id = id };
        await LoadAsync();
    }, "Role saved. Users of this role get the new permissions at their next action / sign-in.");

    [RelayCommand]
    private async Task DeleteAsync()
    {
        if (SelectedRole is null || !await Shell.ConfirmAsync("Delete role", $"Delete role {SelectedRole.Name}?", "Delete", true)) return;
        await RunAsync(async () => { await App.Users.DeleteRoleAsync(SelectedRole.Id); SelectedRole = null; await LoadAsync(); }, "Role deleted.");
    }
}

public sealed class ActivityLogViewModel : ListPageViewModel<AuditLog>
{
    public ActivityLogViewModel()
    {
        Title = "Activity Logs";
        Subtitle = "Who did what and when — invoices, payments, stock changes, settings, sign-ins. Logs cannot be edited or deleted.";
        StatusOptions = new[] { "Sales", "Payments", "Inventory", "Products", "Customers", "Purchases", "Delivery", "Installation", "Custom Orders", "Expenses", "Employees", "Settings", "Security", "Backup", "Reports", "Export" }
            .Select(m => new Option(m, m)).Prepend(new Option(null, "All modules")).ToList();
        SelectedStatus = StatusOptions[0];
    }

    public override bool ShowDateFilter => true;
    public override string SearchHint => "Text, document number…";
    protected override Task<PagedResult<AuditLog>> FetchAsync(ListQuery q) => App.Audit.ListAsync(q, q.Status);

    protected override IReadOnlyList<ExportColumn<AuditLog>> ExportColumns => new ExportColumn<AuditLog>[]
    {
        new("Time", a => a.OccurredAt), new("User", a => a.Username), new("Module", a => a.Module), new("Action", a => a.Action), new("Summary", a => a.Summary),
        new("Record", a => a.RecordRef), new("Old value", a => a.OldValue), new("New value", a => a.NewValue), new("Machine", a => a.Machine), new("IP", a => a.IpAddress),
    };

    protected override void OnOpen(AuditLog item) =>
        _ = Shell.ShowDialogAsync(new ConfirmDialogViewModel($"{item.Action} — {item.Module}",
            $"{item.Summary}\n\nWhen: {item.OccurredAt:dd-MMM-yyyy HH:mm:ss}\nUser: {item.Username}\nMachine: {item.Machine} {item.IpAddress}\n\nBefore: {item.OldValue ?? "—"}\n\nAfter: {item.NewValue ?? "—"}",
            "Close", false, false));
}

// ============================================================================ Settings
public sealed partial class SettingsViewModel : PageViewModel
{
    public SettingsViewModel(string tab)
    {
        Title = "Settings";
        Subtitle = "Shop details, GST, numbering, payments, printers, WhatsApp templates, security and backups.";
        SelectedTab = tab switch
        {
            "gst" or "tax" => 1, "invoice" => 2, "payments" => 3, "printer" => 4, "whatsapp" => 5, "security" => 6, "backup" => 7, _ => 0,
        };
    }

    [ObservableProperty] private int _selectedTab;
    [ObservableProperty] private ShopSettings _shop = new();
    [ObservableProperty] private InvoiceSettings _invoice = new();
    [ObservableProperty] private TaxSettings _tax = new();
    [ObservableProperty] private DeliverySettings _delivery = new();
    [ObservableProperty] private InventorySettings _inventory = new();
    [ObservableProperty] private PrinterSettings _printer = new();
    [ObservableProperty] private WhatsAppSettings _whatsApp = new();
    [ObservableProperty] private SecuritySettings _security = new();
    [ObservableProperty] private BackupSettings _backup = new();
    [ObservableProperty] private IndianState? _shopState;
    [ObservableProperty] private string? _templatePreview;
    [ObservableProperty] private string? _backupStatus;

    public IReadOnlyList<IndianState> States => IndianStates.All;
    public ObservableCollection<GstRate> GstRates { get; } = new();
    public ObservableCollection<HsnCode> HsnCodes { get; } = new();
    public ObservableCollection<PaymentMethod> PaymentMethods { get; } = new();
    public ObservableCollection<DocumentSequence> Sequences { get; } = new();
    public ObservableCollection<ExpenseCategory> ExpenseCategories { get; } = new();
    public IReadOnlyList<string> Printers { get; } = PrintService.InstalledPrinters().Prepend("").ToList();
    public IReadOnlyList<string> PrintFormats { get; } = new[] { "A4", "THERMAL" };
    public IReadOnlyList<int> ThermalWidths { get; } = new[] { 80, 58 };
    public bool CanSettings => Can(Perm.SettingsManage);
    public bool CanBackup => Can(Perm.BackupManage);
    public bool IsAdmin => App.Session.IsAdmin;
    [ObservableProperty] private GstRate _newRate = new() { IsActive = true };
    [ObservableProperty] private HsnCode _newHsn = new() { DefaultGstRate = 18, IsActive = true };
    [ObservableProperty] private PaymentMethod _newMethod = new() { IsActive = true, IsMoney = true, SortOrder = 10 };
    [ObservableProperty] private ExpenseCategory _newExpenseCategory = new() { IsActive = true };

    public override async Task LoadAsync()
    {
        var s = await App.Settings.GetAsync(true);
        Shop = s.Shop; Invoice = s.Invoice; Tax = s.Tax; Delivery = s.Delivery; Inventory = s.Inventory; Printer = s.Printer; WhatsApp = s.WhatsApp;
        Security = s.Security; Backup = s.Backup;
        ShopState = IndianStates.ByCode(Shop.StateCode);
        Fill(GstRates, await App.Settings.GstRatesAsync());
        Fill(HsnCodes, await App.Settings.HsnCodesAsync());
        Fill(PaymentMethods, await App.Settings.PaymentMethodsAsync());
        Fill(Sequences, await App.Settings.SequencesAsync());
        Fill(ExpenseCategories, await App.Expenses.CategoriesAsync());
        BackupStatus = Backup.LastBackupAt is { } at ? $"Last backup / export: {at:dd-MMM-yyyy HH:mm}" : "No backup has been taken from this app yet.";
    }

    private static void Fill<T>(ObservableCollection<T> c, IEnumerable<T> items) { c.Clear(); foreach (var i in items) c.Add(i); }

    [RelayCommand]
    private Task SaveShopAsync() => RunAsync(async () =>
    {
        Shop.StateCode = ShopState?.Code ?? Shop.StateCode;
        await App.Settings.SaveAsync("shop", Shop);
        Shell.ShopName = Shop.ShopName;
    }, "Shop details saved.");

    [RelayCommand]
    private Task UploadLogoAsync() => RunAsync(async () =>
    {
        var path = AppHost.AskOpenPath("Images|*.png;*.jpg;*.jpeg");
        if (path is null) return;
        Shop.LogoAttachmentId = await App.Attachments.SaveAsync(await File.ReadAllBytesAsync(path), Path.GetFileName(path), "SHOP", null, "LOGO");
        await App.Settings.SaveAsync("shop", Shop);
        OnPropertyChanged(nameof(Shop));
    }, "Logo updated — it appears on invoices and receipts.");

    [RelayCommand] private Task SaveInvoiceAsync() => RunAsync(() => App.Settings.SaveAsync("invoice", Invoice), "Invoice settings saved.");
    [RelayCommand] private Task SaveTaxAsync() => RunAsync(() => App.Settings.SaveAsync("tax", Tax), "Tax settings saved.");
    [RelayCommand] private Task SaveDeliveryAsync() => RunAsync(async () => { await App.Settings.SaveAsync("delivery", Delivery); await App.Settings.SaveAsync("inventory", Inventory); }, "Delivery & stock settings saved.");
    [RelayCommand] private Task SavePrinterAsync() => RunAsync(() => App.Settings.SaveAsync("printer", Printer), "Printer settings saved.");
    [RelayCommand] private Task SaveWhatsAppAsync() => RunAsync(() => App.Settings.SaveAsync("whatsapp", WhatsApp), "WhatsApp templates saved.");
    [RelayCommand] private Task SaveSecurityAsync() => RunAsync(() => App.Settings.SaveAsync("security", Security), "Security settings saved.");
    [RelayCommand] private Task SaveBackupSettingsAsync() => RunAsync(() => App.Settings.SaveAsync("backup", Backup), "Backup settings saved.");

    [RelayCommand] private void PreviewTemplate(string template) => TemplatePreview = MessageTemplates.Sample(template);

    [RelayCommand]
    private Task SaveSequenceAsync(DocumentSequence? s) => s is null ? Task.CompletedTask
        : RunAsync(async () => { await App.Settings.SaveSequenceAsync(s); Fill(Sequences, await App.Settings.SequencesAsync()); }, $"Numbering for {s.DocType} saved.");

    [RelayCommand]
    private Task SaveRateAsync(GstRate? r) => RunAsync(async () =>
    {
        var rate = r ?? NewRate;
        if (string.IsNullOrWhiteSpace(rate.Name)) rate.Name = $"GST {rate.Rate:0.##}%";
        await App.Settings.SaveGstRateAsync(rate);
        NewRate = new GstRate { IsActive = true };
        Fill(GstRates, await App.Settings.GstRatesAsync());
    }, "GST rate saved.");

    [RelayCommand]
    private Task SaveHsnAsync(HsnCode? h) => RunAsync(async () =>
    {
        await App.Settings.SaveHsnAsync(h ?? NewHsn);
        NewHsn = new HsnCode { DefaultGstRate = 18, IsActive = true };
        Fill(HsnCodes, await App.Settings.HsnCodesAsync());
    }, "HSN code saved.");

    [RelayCommand]
    private Task SaveMethodAsync(PaymentMethod? m) => RunAsync(async () =>
    {
        await App.Settings.SavePaymentMethodAsync(m ?? NewMethod);
        NewMethod = new PaymentMethod { IsActive = true, IsMoney = true, SortOrder = 10 };
        Fill(PaymentMethods, await App.Settings.PaymentMethodsAsync());
    }, "Payment method saved.");

    [RelayCommand]
    private Task SaveExpenseCategoryAsync(ExpenseCategory? c) => RunAsync(async () =>
    {
        await App.Expenses.SaveCategoryAsync(c ?? NewExpenseCategory);
        NewExpenseCategory = new ExpenseCategory { IsActive = true };
        Fill(ExpenseCategories, await App.Expenses.CategoriesAsync());
    }, "Expense category saved.");

    [RelayCommand]
    private Task ExportDataAsync() => RunAsync(async () =>
    {
        var path = await App.Backup.ExportDataAsync(string.IsNullOrWhiteSpace(Backup.BackupFolder) ? null : Backup.BackupFolder, new Progress<string>(m => BackupStatus = m));
        BackupStatus = $"Data exported to {path}";
        AppHost.ShowInFolder(path);
    }, "Data export complete.");

    [RelayCommand]
    private Task BackupNowAsync() => RunAsync(async () =>
    {
        BackupStatus = "Running pg_dump…";
        var path = await App.Backup.BackupAsync(string.IsNullOrWhiteSpace(Backup.BackupFolder) ? null : Backup.BackupFolder);
        BackupStatus = $"Backup saved to {path}";
        AppHost.ShowInFolder(path);
    }, "Database backup complete.");

    [RelayCommand]
    private async Task RestoreAsync()
    {
        var path = AppHost.AskOpenPath("FurniShop backup|*.dump");
        if (path is null) return;
        if (!await Shell.ConfirmAsync("Restore backup",
                "This REPLACES all data in the connected database with the backup. Everyone must stop using the app. Take a fresh backup first if unsure. Continue?", "Restore", true))
            return;
        await RunAsync(async () =>
        {
            BackupStatus = "Restoring…";
            await App.Backup.RestoreAsync(path);
            BackupStatus = "Restore complete. Please sign in again.";
            Shell.SignOutCommand.Execute(null);
        }, "Database restored.");
    }

    [RelayCommand] private void BrowseBackupFolder() { var p = AppHost.AskSavePath("backup-folder-marker", "Folder|*.*"); if (p is not null) { Backup.BackupFolder = Path.GetDirectoryName(p)!; OnPropertyChanged(nameof(Backup)); } }
    [RelayCommand] private void BrowsePdfFolder() { var p = AppHost.AskSavePath("pdf-folder-marker", "Folder|*.*"); if (p is not null) { Printer.PdfFolder = Path.GetDirectoryName(p)!; OnPropertyChanged(nameof(Printer)); } }

    [RelayCommand]
    private async Task ChangeConnectionAsync()
    {
        if (!await Shell.ConfirmAsync("Change database", "Sign out and connect this computer to a different database?", "Continue")) return;
        ConnectionStore.Clear();
        Shell.SignOutCommand.Execute(null);
    }
}
