using System.Collections.ObjectModel;
using System.Data;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Core.Validation;
using FurniShop.Infrastructure.Documents;
using FurniShop.Wpf.Services;

namespace FurniShop.Wpf.ViewModels;

public sealed class CustomerListViewModel : ListPageViewModel<Customer>
{
    public CustomerListViewModel()
    {
        Title = "Customers";
        Subtitle = "Customer profiles with purchase history, payments and outstanding balance.";
        StatusOptions = new[] { new Option(null, "All customers"), new Option("OUTSTANDING", "With outstanding") };
        SelectedStatus = StatusOptions[0];
    }

    public override string SearchHint => "Name, mobile, code, GSTIN, city…";
    public bool CanCreate => Can(Perm.CustomerManage);
    protected override Task<PagedResult<Customer>> FetchAsync(ListQuery q) => App.Customers.ListAsync(q, q.Status == "OUTSTANDING");
    protected override void OnOpen(Customer item) => Shell.Navigate(Routes.Customer, item.Id);

    public IAsyncRelayCommand NewCommand => new AsyncRelayCommand(async () =>
    {
        var d = new CustomerEditDialogViewModel(null, null);
        if (await Shell.ShowDialogAsync(d) && d.SavedId is { } id) Shell.Navigate(Routes.Customer, id);
    });

    protected override IReadOnlyList<ExportColumn<Customer>> ExportColumns => new ExportColumn<Customer>[]
    {
        new("Code", c => c.Code), new("Name", c => c.Name), new("Mobile", c => c.Mobile), new("WhatsApp", c => c.Whatsapp), new("Email", c => c.Email),
        new("Address", c => c.BillingAddress), new("City", c => c.City), new("State", c => c.State), new("PIN", c => c.Pincode), new("GSTIN", c => c.Gstin),
        new("Total purchases", c => c.TotalPurchases), new("Outstanding", c => c.Outstanding), new("Last purchase", c => c.LastPurchaseDate),
    };
}

public sealed partial class AddressVm : ObservableObject
{
    public long Id { get; init; }
    [ObservableProperty] private string _label = "Delivery";
    [ObservableProperty] private string _address = "";
    [ObservableProperty] private string? _city;
    [ObservableProperty] private IndianState? _state;
    [ObservableProperty] private string? _pincode;
    [ObservableProperty] private string? _landmark;
    [ObservableProperty] private bool _isDefault;
}

public sealed partial class CustomerEditDialogViewModel : DialogViewModel
{
    private readonly long? _id;

    public CustomerEditDialogViewModel(long? id, string? prefill)
    {
        _id = id;
        DialogTitle = id.HasValue ? "Edit customer" : "New customer";
        if (!string.IsNullOrWhiteSpace(prefill))
        {
            if (prefill.Count(char.IsDigit) >= 6) Mobile = prefill.Trim(); else Name = prefill.Trim();
        }
    }

    public override double DialogWidth => 720;
    public long? SavedId { get; private set; }
    public IReadOnlyList<IndianState> States => IndianStates.All;
    public ObservableCollection<AddressVm> Addresses { get; } = new();

    [ObservableProperty] private string _name = "";
    [ObservableProperty] private string? _mobile;
    [ObservableProperty] private string? _whatsapp;
    [ObservableProperty] private string? _email;
    [ObservableProperty] private string? _billingAddress;
    [ObservableProperty] private string? _city;
    [ObservableProperty] private IndianState? _state;
    [ObservableProperty] private string? _pincode;
    [ObservableProperty] private string? _gstin;
    [ObservableProperty] private string? _notes;
    [ObservableProperty] private decimal _creditLimit;
    [ObservableProperty] private bool _isWalkIn;

    public override async Task InitAsync()
    {
        var shopState = (await App.Settings.GetAsync()).Shop.StateCode;
        if (_id is not { } id) { State = IndianStates.ByCode(shopState); return; }
        var c = await App.Customers.GetAsync(id);
        Name = c.Name; Mobile = c.Mobile; Whatsapp = c.Whatsapp; Email = c.Email; BillingAddress = c.BillingAddress; City = c.City;
        State = IndianStates.ByCode(c.StateCode); Pincode = c.Pincode; Gstin = c.Gstin; Notes = c.Notes; CreditLimit = c.CreditLimit; IsWalkIn = c.IsWalkIn;
        foreach (var a in c.Addresses)
            Addresses.Add(new AddressVm { Id = a.Id, Label = a.Label, Address = a.Address, City = a.City, State = IndianStates.ByCode(a.StateCode), Pincode = a.Pincode, Landmark = a.Landmark, IsDefault = a.IsDefault });
    }

    partial void OnGstinChanged(string? value)
    {
        if (value is { Length: >= 2 } && IndianStates.ByCode(value[..2]) is { } st) State = st;
    }

    [RelayCommand] private void AddAddress() => Addresses.Add(new AddressVm { Address = BillingAddress ?? "", City = City, State = State, Pincode = Pincode, IsDefault = Addresses.Count == 0 });
    [RelayCommand] private void RemoveAddress(AddressVm? a) { if (a is not null) Addresses.Remove(a); }

    protected override async Task OnAcceptAsync()
    {
        SavedId = await App.Customers.SaveAsync(new Customer
        {
            Id = _id ?? 0, Name = Name, Mobile = Mobile, Whatsapp = Whatsapp, Email = Email, BillingAddress = BillingAddress, City = City,
            StateCode = State?.Code, Pincode = Pincode, Gstin = Gstin, Notes = Notes, CreditLimit = CreditLimit, IsWalkIn = IsWalkIn,
            Addresses = Addresses.Select(a => new CustomerAddress { Id = a.Id, Label = a.Label, Address = a.Address, City = a.City, StateCode = a.State?.Code, Pincode = a.Pincode, Landmark = a.Landmark, IsDefault = a.IsDefault }).ToList(),
        });
        Shell.Toast.Success("Customer saved.");
    }
}

public sealed partial class CustomerDetailViewModel(long id) : PageViewModel
{
    public long Id { get; } = id;
    [ObservableProperty] private Customer? _customer;
    [ObservableProperty] private CustomerSummary? _summary;
    public ObservableCollection<InvoiceListItem> Invoices { get; } = new();
    public ObservableCollection<Payment> Payments { get; } = new();
    public ObservableCollection<SalesOrder> Orders { get; } = new();
    public ObservableCollection<CustomOrder> CustomOrders { get; } = new();
    public ObservableCollection<Delivery> Deliveries { get; } = new();
    public ObservableCollection<SalesReturn> Returns { get; } = new();
    public ObservableCollection<LedgerEntry> Ledger { get; } = new();
    public ObservableCollection<Quotation> Quotations { get; } = new();

    public bool CanEdit => Can(Perm.CustomerManage);
    public bool CanDelete => Can(Perm.CustomerDelete) && Customer?.IsWalkIn == false;
    public bool CanSell => Can(Perm.InvoiceCreate);
    public bool CanReceive => Can(Perm.PaymentReceive) && Customer?.IsWalkIn == false;
    public bool CanRefundAdvance => Can(Perm.PaymentRefund) && Summary?.AdvanceAmount > 0;

    public override async Task LoadAsync()
    {
        Customer = await App.Customers.GetAsync(Id);
        Summary = await App.Customers.SummaryAsync(Id);
        Title = Customer.Name;
        Subtitle = $"{Customer.Code} · {Customer.Mobile} · customer since {Customer.CreatedAt:MMM yyyy}";
        var q = new ListQuery { CustomerId = Id, PageSize = 200 };
        Fill(Invoices, (await App.Invoices.ListAsync(q)).Items);
        if (Can(Perm.PaymentView)) Fill(Payments, (await App.Payments.ListAsync(q)).Items);
        if (Can(Perm.SalesOrderView)) Fill(Orders, (await App.SalesOrders.ListAsync(q)).Items);
        if (Can(Perm.QuotationView)) Fill(Quotations, (await App.Quotations.ListAsync(q)).Items);
        if (Can(Perm.CustomOrderView)) Fill(CustomOrders, (await App.CustomOrders.ListAsync(q)).Items);
        if (Can(Perm.DeliveryView)) Fill(Deliveries, await App.Deliveries.ForDocumentAsync("customer_id", Id));
        if (Can(Perm.ReturnView)) Fill(Returns, (await App.Returns.ListAsync(q)).Items);
        Fill(Ledger, (await App.Customers.LedgerAsync(Id)).Reverse());
        foreach (var n in new[] { nameof(CanEdit), nameof(CanDelete), nameof(CanSell), nameof(CanReceive), nameof(CanRefundAdvance) }) OnPropertyChanged(n);
    }

    private static void Fill<T>(ObservableCollection<T> target, IEnumerable<T> items)
    {
        target.Clear();
        foreach (var i in items) target.Add(i);
    }

    [RelayCommand]
    private async Task EditAsync()
    {
        if (await Shell.ShowDialogAsync(new CustomerEditDialogViewModel(Id, null))) await RunAsync(LoadAsync);
    }

    [RelayCommand]
    private async Task DeleteAsync()
    {
        if (!await Shell.ConfirmAsync("Delete customer", $"Delete {Customer!.Name}? Customers with invoices, orders or payments cannot be deleted.", "Delete", true)) return;
        if (await RunAsync(() => App.Customers.DeleteAsync(Id), "Customer deleted.")) Shell.Navigate(Routes.Customers, addToHistory: false);
    }

    [RelayCommand] private void NewInvoice() => Shell.Navigate(Routes.Pos, EditorArgs.NewInvoice(Id));
    [RelayCommand] private void NewQuotation() => Shell.Navigate(Routes.Pos, new EditorArgs(EditorMode.Quotation, null, Id));
    [RelayCommand] private void NewOrder() => Shell.Navigate(Routes.Pos, new EditorArgs(EditorMode.SalesOrder, null, Id));
    [RelayCommand] private void OpenLedger() => Shell.Navigate(Routes.Ledger, Id);

    [RelayCommand]
    private async Task ReceivePaymentAsync()
    {
        if (await Shell.ShowDialogAsync(new ReceivePaymentDialogViewModel(Id, null, null) { DefaultAmount = Summary?.Outstanding ?? 0 })) await RunAsync(LoadAsync);
    }

    [RelayCommand]
    private async Task RefundAdvanceAsync()
    {
        var onAccount = await App.Payments.OnAccountBalanceAsync(Id);
        if (onAccount <= 0) { Shell.Toast.Warning("The advance is held against an open order. Cancel the order first to refund it."); return; }
        if (await Shell.ShowDialogAsync(new RefundDialogViewModel(Id, DocType.OnAccount, null, onAccount))) await RunAsync(LoadAsync);
    }

    [RelayCommand]
    private Task ReminderAsync() => RunAsync(async () => await DocumentActions.WhatsAppAsync(await App.Documents.OutstandingReminderAsync(Id)));

    [RelayCommand] private void OpenInvoice(InvoiceListItem? i) { if (i is not null) Shell.Navigate(Routes.Invoice, i.Id); }
    [RelayCommand] private void OpenOrder(SalesOrder? o) { if (o is not null) Shell.Navigate(Routes.SalesOrder, o.Id); }
    [RelayCommand] private void OpenQuotation(Quotation? o) { if (o is not null) Shell.Navigate(Routes.Quotation, o.Id); }
    [RelayCommand] private void OpenCustomOrder(CustomOrder? o) { if (o is not null) Shell.Navigate(Routes.CustomOrderDetail, o.Id); }
    [RelayCommand] private void OpenDelivery(Delivery? d) { if (d is not null) Shell.Navigate(Routes.Delivery, d.Id); }
    [RelayCommand] private void OpenPayment(Payment? p) { if (p is not null) _ = Shell.ShowDialogAsync(new PaymentDetailDialogViewModel(p.Id)); }
}

public sealed partial class LedgerViewModel : PageViewModel
{
    public LedgerViewModel(long? customerId)
    {
        _customerId = customerId;
        Title = "Customer Ledger";
        Subtitle = "Invoices and refunds are debits; payments and returns are credits. A positive balance is money the customer owes.";
    }

    private long? _customerId;
    public ObservableCollection<Customer> CustomerResults { get; } = new();
    public ObservableCollection<LedgerEntry> Entries { get; } = new();
    [ObservableProperty] private Customer? _customer;
    [ObservableProperty] private string? _customerSearch;
    [ObservableProperty] private DateTime? _from;
    [ObservableProperty] private DateTime? _to;
    [ObservableProperty] private decimal _totalDebit;
    [ObservableProperty] private decimal _totalCredit;
    [ObservableProperty] private decimal _closing;
    public bool CanExport => Can(Perm.ExportData);

    public override async Task LoadAsync()
    {
        if (_customerId is { } id) Customer = await App.Customers.GetAsync(id);
        if (Customer is null) return;
        var rows = await App.Customers.LedgerAsync(Customer.Id, From, To);
        Entries.Clear();
        foreach (var r in rows) Entries.Add(r);
        TotalDebit = rows.Where(r => r.DocType != "OPENING").Sum(r => r.Debit);
        TotalCredit = rows.Where(r => r.DocType != "OPENING").Sum(r => r.Credit);
        Closing = rows.LastOrDefault()?.Balance ?? 0;
    }

    partial void OnCustomerSearchChanged(string? value) => _ = RunAsync(async () =>
    {
        CustomerResults.Clear();
        if (string.IsNullOrWhiteSpace(value)) return;
        foreach (var c in await App.Customers.SearchAsync(value, 10)) CustomerResults.Add(c);
    }, showBusy: false);

    [RelayCommand]
    private Task PickAsync(Customer? c)
    {
        if (c is null) return Task.CompletedTask;
        _customerId = c.Id;
        CustomerSearch = null;
        CustomerResults.Clear();
        return RunAsync(LoadAsync);
    }

    partial void OnFromChanged(DateTime? value) { if (Customer is not null) _ = RunAsync(LoadAsync); }
    partial void OnToChanged(DateTime? value) { if (Customer is not null) _ = RunAsync(LoadAsync); }

    [RelayCommand]
    private Task ExportAsync(string format) => RunAsync(async () =>
    {
        App.Documents.DemandExport();
        var t = DocumentService.ToTable(Entries, ("Date", e => e.Date), ("Type", e => e.DocType), ("Document", e => e.DocNumber), ("Particulars", e => e.Particulars),
            ("Debit", e => e.Debit), ("Credit", e => e.Credit), ("Balance", e => e.Balance));
        await ListPageViewModel<LedgerEntry>.ExportTableAsync(t, $"Ledger {Customer!.Name}", $"{Customer.Code} · {Customer.Mobile}",
            new HashSet<string> { "Debit", "Credit", "Balance" }, new[] { ("Closing balance", Money.Format(Closing)) }, format);
    });
}

public sealed partial class OutstandingViewModel : ListPageViewModel<InvoiceListItem>
{
    public OutstandingViewModel()
    {
        Title = "Outstanding Payments";
        Subtitle = "Every invoice with a balance due, oldest first. Send reminders on WhatsApp or record payments.";
        StatusOptions = new[] { new Option("OUTSTANDING", "All outstanding"), new Option("OVERDUE", "Overdue only") };
        SelectedStatus = StatusOptions[0];
        SortBy = "due";
        SortDescending = false;
    }

    [ObservableProperty] private decimal _totalOutstanding;
    public override string SearchHint => "Invoice, customer, mobile…";
    public bool CanReceive => Can(Perm.PaymentReceive);

    protected override async Task<PagedResult<InvoiceListItem>> FetchAsync(ListQuery q)
    {
        var state = q.Status;
        q.Status = null;
        var r = await App.Invoices.ListAsync(q, state);
        TotalOutstanding = (await App.Invoices.ListAsync(new ListQuery { PageSize = 100_000, Search = q.Search }, state)).Items.Sum(i => i.Balance);
        return r;
    }

    protected override void OnOpen(InvoiceListItem item) => Shell.Navigate(Routes.Invoice, item.Id);

    [RelayCommand]
    private Task RemindAsync(InvoiceListItem? i) => i is null ? Task.CompletedTask
        : RunAsync(async () => await DocumentActions.WhatsAppAsync(await App.Documents.InvoiceMessageAsync(i.Id, reminder: true)));

    [RelayCommand]
    private async Task CollectAsync(InvoiceListItem? i)
    {
        if (i is null) return;
        if (await Shell.ShowDialogAsync(new ReceivePaymentDialogViewModel(i.CustomerId, DocType.Invoice, i.Id) { DefaultAmount = i.Balance })) await RunAsync(LoadAsync);
    }

    protected override IReadOnlyList<ExportColumn<InvoiceListItem>> ExportColumns => new ExportColumn<InvoiceListItem>[]
    {
        new("Customer", i => i.CustomerName), new("Mobile", i => i.CustomerMobile), new("Invoice", i => i.Number), new("Date", i => i.InvoiceDate),
        new("Due date", i => i.DueDate), new("Total", i => i.GrandTotal), new("Paid", i => i.Paid), new("Balance", i => i.Balance), new("Days overdue", i => i.DaysOverdue),
    };
}
