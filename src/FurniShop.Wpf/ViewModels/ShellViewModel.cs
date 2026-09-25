using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Wpf.Services;

namespace FurniShop.Wpf.ViewModels;

public sealed partial class NavItem : ObservableObject
{
    public NavItem(string label, string route, string permission, object? parameter = null, string? icon = null)
    {
        Label = label; Route = route; Permission = permission; Parameter = parameter; Icon = icon;
    }

    public string Label { get; }
    public string Route { get; }
    public string Permission { get; }
    public object? Parameter { get; }
    public string? Icon { get; }
    [ObservableProperty] private bool _isActive;
}

public sealed partial class NavGroup : ObservableObject
{
    public NavGroup(string label, string icon, params NavItem[] items)
    {
        Label = label; Icon = icon; Items = new ObservableCollection<NavItem>(items);
    }

    public string Label { get; }
    public string Icon { get; }
    public ObservableCollection<NavItem> Items { get; }
    public bool IsSingle => Items.Count == 1;
    [ObservableProperty] private bool _isExpanded;
    [ObservableProperty] private bool _isActive;
}

public sealed record ToastItem(string Message, StatusTone Tone, Action? OnClick = null)
{
    public string Icon => Tone switch { StatusTone.Success => "", StatusTone.Error => "", StatusTone.Warning => "", _ => "" };
}

public sealed class ToastService(ObservableCollection<ToastItem> items)
{
    private void Show(string message, StatusTone tone, Action? onClick = null)
    {
        void Add()
        {
            var t = new ToastItem(message, tone, onClick);
            items.Add(t);
            while (items.Count > 4) items.RemoveAt(0);
            var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(tone == StatusTone.Error ? 7 : 4) };
            timer.Tick += (_, _) => { timer.Stop(); items.Remove(t); };
            timer.Start();
        }
        if (Application.Current?.Dispatcher.CheckAccess() == true) Add();
        else Application.Current?.Dispatcher.Invoke(Add);
    }

    public void Success(string m, Action? onClick = null) => Show(m, StatusTone.Success, onClick);
    public void Error(string m) => Show(m, StatusTone.Error);
    public void Info(string m, Action? onClick = null) => Show(m, StatusTone.Info, onClick);
    public void Warning(string m) => Show(m, StatusTone.Warning);
}

/// <summary>The main window: navigation, content area, global search, notifications, toasts and dialogs.</summary>
public sealed partial class ShellViewModel : ObservableObject
{
    private readonly Stack<(string Route, object? Param)> _history = new();
    private (string Route, object? Param) _current;

    public ShellViewModel()
    {
        Toast = new ToastService(Toasts);
    }

    public ObservableCollection<ToastItem> Toasts { get; } = new();
    public ToastService Toast { get; }
    public ObservableCollection<NavGroup> Menu { get; } = new();
    public ObservableCollection<DialogViewModel> Dialogs { get; } = new();
    public ObservableCollection<SearchResult> SearchResults { get; } = new();
    public ObservableCollection<Notification> Notifications { get; } = new();

    [ObservableProperty] private PageViewModel? _currentPage;
    [ObservableProperty] private string? _globalSearch;
    [ObservableProperty] private bool _isSearchOpen;
    [ObservableProperty] private bool _isNotificationsOpen;
    [ObservableProperty] private bool _isSidebarCollapsed;
    [ObservableProperty] private bool _isUserMenuOpen;
    [ObservableProperty] private string _shopName = "FurniShop";
    [ObservableProperty] private bool _canGoBack;

    public string UserName => AppHost.App.Session.FullName;
    public string UserRole => AppHost.App.Session.RoleName;
    public string UserInitials => string.Concat(UserName.Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(2).Select(w => char.ToUpperInvariant(w[0])));
    public bool HasDialog => Dialogs.Count > 0;
    public int UnreadCount => Notifications.Count;
    public bool CanCreateInvoice => AppHost.App.Session.Has(Perm.InvoiceCreate);

    public event EventHandler? SignOutRequested;

    public void BuildMenu()
    {
        Menu.Clear();
        var s = AppHost.App.Session;
        var groups = new[]
        {
            new NavGroup("Dashboard", "", new NavItem("Dashboard", Routes.Dashboard, Perm.DashboardView)),
            new NavGroup("Sales", "",
                new NavItem("New Invoice", Routes.Pos, Perm.InvoiceCreate, EditorArgs.NewInvoice()),
                new NavItem("Invoices", Routes.Invoices, Perm.InvoiceView),
                new NavItem("Quotations", Routes.Quotations, Perm.QuotationView),
                new NavItem("Sales Orders", Routes.SalesOrders, Perm.SalesOrderView),
                new NavItem("Payments", Routes.Payments, Perm.PaymentView),
                new NavItem("Sales Returns", Routes.Returns, Perm.ReturnView),
                new NavItem("Exchanges", Routes.Exchanges, Perm.ReturnView)),
            new NavGroup("Customers", "",
                new NavItem("Customers", Routes.Customers, Perm.CustomerView),
                new NavItem("Customer Ledger", Routes.Ledger, Perm.CustomerView),
                new NavItem("Outstanding Payments", Routes.Outstanding, Perm.PaymentView)),
            new NavGroup("Products", "",
                new NavItem("Products", Routes.Products, Perm.ProductView),
                new NavItem("Categories", Routes.Categories, Perm.ProductView),
                new NavItem("Variants", Routes.Variants, Perm.ProductView),
                new NavItem("Barcode / QR", Routes.Barcodes, Perm.ProductView)),
            new NavGroup("Inventory", "",
                new NavItem("Current Stock", Routes.Stock, Perm.InventoryView),
                new NavItem("Stock In", Routes.StockIn, Perm.InventoryAdjust, AdjustmentType.Increase),
                new NavItem("Stock Adjustment", Routes.StockAdjust, Perm.InventoryAdjust, AdjustmentType.Decrease),
                new NavItem("Reserved Stock", Routes.Reserved, Perm.InventoryView),
                new NavItem("Damaged Stock", Routes.Stock, Perm.InventoryView, "DAMAGED"),
                new NavItem("Stock Movement", Routes.Movements, Perm.InventoryView)),
            new NavGroup("Purchases", "",
                new NavItem("New Purchase", Routes.Purchase, Perm.PurchaseManage),
                new NavItem("Purchase History", Routes.Purchases, Perm.PurchaseView),
                new NavItem("Suppliers", Routes.Suppliers, Perm.SupplierView),
                new NavItem("Supplier Payments", Routes.SupplierPayments, Perm.SupplierPay)),
            new NavGroup("Custom Orders", "",
                new NavItem("New Custom Order", Routes.CustomOrder, Perm.CustomOrderManage),
                new NavItem("Production", Routes.CustomOrders, Perm.CustomOrderView, "ACTIVE"),
                new NavItem("Ready for Delivery", Routes.CustomOrders, Perm.CustomOrderView, "READY"),
                new NavItem("Completed Orders", Routes.CustomOrders, Perm.CustomOrderView, "COMPLETED")),
            new NavGroup("Delivery", "",
                new NavItem("Pending Deliveries", Routes.Deliveries, Perm.DeliveryView, DeliveryStatus.Pending),
                new NavItem("Scheduled Deliveries", Routes.Deliveries, Perm.DeliveryView, DeliveryStatus.Scheduled),
                new NavItem("Out for Delivery", Routes.Deliveries, Perm.DeliveryView, DeliveryStatus.OutForDelivery),
                new NavItem("Delivered", Routes.Deliveries, Perm.DeliveryView, DeliveryStatus.Delivered)),
            new NavGroup("Installation", "", new NavItem("Installation", Routes.Installations, Perm.InstallationView)),
            new NavGroup("Expenses", "", new NavItem("Expenses", Routes.Expenses, Perm.ExpenseView)),
            new NavGroup("Reports", "",
                new NavItem("Sales Report", Routes.Reports, Perm.ReportSales, "sales.period"),
                new NavItem("Purchase Report", Routes.Reports, Perm.ReportPurchase, "pur.register"),
                new NavItem("Profit Report", Routes.Reports, Perm.ReportProfit, "profit.summary"),
                new NavItem("Inventory Report", Routes.Reports, Perm.ReportInventory, "inv.current"),
                new NavItem("GST Report", Routes.Reports, Perm.ReportGst, "gst.rate"),
                new NavItem("Payment Report", Routes.Reports, Perm.ReportPayment, "pay.method"),
                new NavItem("Outstanding Report", Routes.Reports, Perm.ReportPayment, "pay.outstanding"),
                new NavItem("Customer Report", Routes.Reports, Perm.ReportSales, "sales.customer"),
                new NavItem("Supplier Report", Routes.Reports, Perm.ReportPurchase, "pur.supplier")),
            new NavGroup("Employees", "",
                new NavItem("Users", Routes.Users, Perm.UserManage),
                new NavItem("Roles", Routes.Roles, Perm.RoleManage),
                new NavItem("Permissions", Routes.Roles, Perm.RoleManage, "matrix"),
                new NavItem("Activity Logs", Routes.Activity, Perm.AuditView)),
            new NavGroup("Settings", "",
                new NavItem("Shop Settings", Routes.Settings, Perm.SettingsManage, "shop"),
                new NavItem("GST Settings", Routes.Settings, Perm.SettingsManage, "gst"),
                new NavItem("Invoice Settings", Routes.Settings, Perm.SettingsManage, "invoice"),
                new NavItem("Payment Methods", Routes.Settings, Perm.SettingsManage, "payments"),
                new NavItem("Tax Settings", Routes.Settings, Perm.SettingsManage, "tax"),
                new NavItem("Printer Settings", Routes.Settings, Perm.SettingsManage, "printer"),
                new NavItem("WhatsApp Settings", Routes.Settings, Perm.SettingsManage, "whatsapp"),
                new NavItem("Backup", Routes.Settings, Perm.BackupManage, "backup"),
                new NavItem("Security", Routes.Settings, Perm.SettingsManage, "security")),
        };
        foreach (var g in groups)
        {
            var visible = g.Items.Where(i => s.Has(i.Permission)).ToList();
            if (visible.Count == 0) continue;
            Menu.Add(new NavGroup(g.Label, g.Icon, visible.ToArray()));
        }
        OnPropertyChanged(nameof(UserName));
        OnPropertyChanged(nameof(UserRole));
        OnPropertyChanged(nameof(UserInitials));
        OnPropertyChanged(nameof(CanCreateInvoice));
    }

    /// <summary>The landing page is the first screen the user is allowed to see.</summary>
    public void NavigateHome()
    {
        var first = Menu.SelectMany(g => g.Items).FirstOrDefault();
        if (first is not null) Navigate(first.Route, first.Parameter, addToHistory: false);
    }

    [RelayCommand]
    private void NavigateTo(NavItem? item)
    {
        if (item is null) return;
        Navigate(item.Route, item.Parameter);
    }

    [RelayCommand]
    private void ToggleGroup(NavGroup group)
    {
        if (group.IsSingle) { Navigate(group.Items[0].Route, group.Items[0].Parameter); return; }
        if (IsSidebarCollapsed) { IsSidebarCollapsed = false; group.IsExpanded = true; return; }
        group.IsExpanded = !group.IsExpanded;
    }

    public void Navigate(string route, object? parameter = null, bool addToHistory = true)
    {
        PageViewModel page;
        try
        {
            page = Routes.Create(route, parameter);
        }
        catch (Core.PermissionDeniedException ex)
        {
            Toast.Error(ex.Message);
            return;
        }
        if (addToHistory && CurrentPage is not null) _history.Push(_current);
        CanGoBack = _history.Count > 0;
        _current = (route, parameter);
        CurrentPage = page;
        foreach (var g in Menu)
        {
            var any = false;
            foreach (var i in g.Items)
            {
                i.IsActive = i.Route == route && Equals(i.Parameter?.ToString(), parameter?.ToString())
                             || i.Route == route && g.Items.Count(x => x.Route == route) == 1;
                any |= i.IsActive;
            }
            g.IsActive = any;
            if (any && !g.IsSingle) g.IsExpanded = true;
        }
        IsSearchOpen = false;
        _ = LoadPageAsync(page);
    }

    private static async Task LoadPageAsync(PageViewModel page)
    {
        page.IsBusy = true;
        try { await page.LoadAsync(); }
        catch (Exception ex) { page.HandleError(ex); }
        finally { page.IsBusy = false; }
    }

    [RelayCommand]
    public void GoBack()
    {
        if (_history.Count == 0) return;
        var (route, param) = _history.Pop();
        CanGoBack = _history.Count > 0;
        Navigate(route, param, addToHistory: false);
        CanGoBack = _history.Count > 0;
    }

    /// <summary>Re-opens the current page (after an action changed its data).</summary>
    public void Reload()
    {
        if (CurrentPage is not null) _ = LoadPageAsync(CurrentPage);
    }

    [RelayCommand]
    private void NewInvoice() => Navigate(Routes.Pos, EditorArgs.NewInvoice());

    [RelayCommand]
    private void ToggleSidebar() => IsSidebarCollapsed = !IsSidebarCollapsed;

    // ---------------------------------------------------------------- global search
    private CancellationTokenSource? _searchCts;

    partial void OnGlobalSearchChanged(string? value)
    {
        _searchCts?.Cancel();
        _searchCts = new CancellationTokenSource();
        var token = _searchCts.Token;
        _ = SearchLaterAsync(value, token);
    }

    private async Task SearchLaterAsync(string? text, CancellationToken token)
    {
        try
        {
            await Task.Delay(300, token);
            if (string.IsNullOrWhiteSpace(text) || text.Trim().Length < 2) { SearchResults.Clear(); IsSearchOpen = false; return; }
            var results = await AppHost.App.Search.SearchAsync(text);
            if (token.IsCancellationRequested) return;
            SearchResults.Clear();
            foreach (var r in results) SearchResults.Add(r);
            IsSearchOpen = true;
        }
        catch (TaskCanceledException) { }
        catch (Exception ex) { ConnectionStore.LogError(ex); }
    }

    /// <summary>Enter in the search box: exact barcode / SKU jumps straight to the product.</summary>
    [RelayCommand]
    private async Task SearchEnterAsync()
    {
        if (string.IsNullOrWhiteSpace(GlobalSearch)) return;
        var first = SearchResults.FirstOrDefault() ?? (await AppHost.App.Search.SearchAsync(GlobalSearch)).FirstOrDefault();
        if (first is not null) OpenSearchResult(first);
    }

    [RelayCommand]
    private void OpenSearchResult(SearchResult? r)
    {
        if (r is null) return;
        IsSearchOpen = false;
        GlobalSearch = null;
        switch (r.Kind)
        {
            case "Product": Navigate(Routes.Product, r.Id); break;
            case "Customer": Navigate(Routes.Customer, r.Id); break;
            case "Invoice": Navigate(Routes.Invoice, r.Id); break;
            case "Quotation": Navigate(Routes.Quotation, r.Id); break;
            case "Sales order": Navigate(Routes.SalesOrder, r.Id); break;
            case "Custom order": Navigate(Routes.CustomOrderDetail, r.Id); break;
            case "Supplier": Navigate(Routes.Supplier, r.Id); break;
            case "Purchase": Navigate(Routes.PurchaseDetail, r.Id); break;
            case "Delivery": Navigate(Routes.Delivery, r.Id); break;
        }
    }

    // ---------------------------------------------------------------- notifications
    public async Task RefreshNotificationsAsync()
    {
        try
        {
            var list = await AppHost.App.Notifications.UnreadAsync();
            Notifications.Clear();
            foreach (var n in list) Notifications.Add(n);
            OnPropertyChanged(nameof(UnreadCount));
        }
        catch (Exception ex) { ConnectionStore.LogError(ex); }
    }

    [RelayCommand]
    private async Task OpenNotificationsAsync()
    {
        await RefreshNotificationsAsync();
        IsNotificationsOpen = !IsNotificationsOpen;
    }

    [RelayCommand]
    private async Task OpenNotificationAsync(Notification? n)
    {
        if (n is null) return;
        await AppHost.App.Notifications.MarkReadAsync(n.Id);
        Notifications.Remove(n);
        OnPropertyChanged(nameof(UnreadCount));
        IsNotificationsOpen = false;
        switch (n.RefType)
        {
            case "INVOICE" when n.RefId.HasValue: Navigate(Routes.Invoice, n.RefId.Value); break;
            case "CUSTOM_ORDER" when n.RefId.HasValue: Navigate(Routes.CustomOrderDetail, n.RefId.Value); break;
            case "VARIANT": Navigate(Routes.Stock, "LOW"); break;
        }
    }

    [RelayCommand]
    private async Task MarkAllReadAsync()
    {
        await AppHost.App.Notifications.MarkAllReadAsync();
        Notifications.Clear();
        OnPropertyChanged(nameof(UnreadCount));
        IsNotificationsOpen = false;
    }

    // ---------------------------------------------------------------- dialogs
    public Task<bool> ShowDialogAsync(DialogViewModel dialog)
    {
        Dialogs.Add(dialog);
        OnPropertyChanged(nameof(HasDialog));
        dialog.Closed += (_, _) =>
        {
            Dialogs.Remove(dialog);
            OnPropertyChanged(nameof(HasDialog));
        };
        _ = dialog.StartAsync();
        return dialog.Result;
    }

    public async Task<bool> ConfirmAsync(string title, string message, string confirmText = "Confirm", bool danger = false) =>
        await ShowDialogAsync(new ConfirmDialogViewModel(title, message, confirmText, danger, false));

    /// <summary>Confirmation that requires a reason (cancel invoice, void payment…). Returns null when cancelled.</summary>
    public async Task<string?> AskReasonAsync(string title, string message, string confirmText = "Confirm", bool danger = true)
    {
        var d = new ConfirmDialogViewModel(title, message, confirmText, danger, true);
        return await ShowDialogAsync(d) ? d.Reason : null;
    }

    // ---------------------------------------------------------------- user
    [RelayCommand]
    private void SignOut() => SignOutRequested?.Invoke(this, EventArgs.Empty);

    [RelayCommand]
    private async Task ChangePasswordAsync()
    {
        IsUserMenuOpen = false;
        await ShowDialogAsync(new ChangePasswordDialogViewModel(false));
    }
}
