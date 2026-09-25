using System.Collections.ObjectModel;
using System.IO;
using System.Windows.Media.Imaging;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Wpf.Services;

namespace FurniShop.Wpf.ViewModels;

// ============================================================================ Custom orders
public sealed class CustomOrderListViewModel : ListPageViewModel<CustomOrder>
{
    private readonly string _stage;

    public CustomOrderListViewModel(string stage)
    {
        _stage = stage;
        (Title, Subtitle) = stage switch
        {
            "READY" => ("Ready for Delivery", "Finished custom pieces waiting for invoice, delivery or installation."),
            "COMPLETED" => ("Completed Orders", "Delivered / installed and cancelled custom orders."),
            _ => ("Production", "Custom furniture being made: received → production → quality check."),
        };
    }

    public override string SearchHint => "Order no, customer, mobile, product type…";
    public bool CanCreate => Can(Perm.CustomOrderManage);
    public IRelayCommand NewCommand => new RelayCommand(() => Shell.Navigate(Routes.CustomOrder));
    protected override Task<PagedResult<CustomOrder>> FetchAsync(ListQuery q) => App.CustomOrders.ListAsync(q, _stage);
    protected override void OnOpen(CustomOrder item) => Shell.Navigate(Routes.CustomOrderDetail, item.Id);

    protected override IReadOnlyList<ExportColumn<CustomOrder>> ExportColumns => new ExportColumn<CustomOrder>[]
    {
        new("Order", o => o.Number), new("Date", o => o.OrderDate), new("Customer", o => o.CustomerName), new("Product", o => o.ProductType),
        new("Size", o => o.DimensionsText), new("Material", o => o.Material), new("Status", o => o.Status), new("Due", o => o.ExpectedCompletionDate),
        new("Estimate", o => o.EstimatedCost), new("Final price", o => o.FinalPrice), new("Advance", o => o.AdvancePaid), new("Balance", o => o.Balance),
    };
}

public sealed partial class CustomOrderEditorViewModel(long id) : PageViewModel
{
    public long Id { get; private set; } = id;
    public ObservableCollection<Customer> CustomerResults { get; } = new();
    public ObservableCollection<decimal> GstRates { get; } = new();
    public IReadOnlyList<string> Units { get; } = new[] { "ft", "in", "cm", "mm" };
    public IReadOnlyList<string> ProductTypes { get; } = new[] { "Wardrobe", "Bed", "Sofa", "Dining Table", "TV Unit", "Modular Kitchen Cabinets", "Study Table", "Bookshelf", "Shoe Rack", "Pooja Mandir", "Office Workstation", "Other" };
    [ObservableProperty] private CustomOrder _order = new() { GstRate = 18, ExpectedCompletionDate = DateTime.Today.AddDays(21) };
    [ObservableProperty] private Customer? _customer;
    [ObservableProperty] private string? _customerSearch;
    [ObservableProperty] private BitmapImage? _referenceImage;
    [ObservableProperty] private decimal _advance;
    [ObservableProperty] private string _advanceMethod = PaymentMethodCode.Upi;
    [ObservableProperty] private string? _advanceReference;
    public IReadOnlyList<string> Methods => PaymentMethodCode.Money;
    public bool IsNew => Id == 0;
    public bool CanTakeAdvance => IsNew && Can(Perm.PaymentReceive);

    public override async Task LoadAsync()
    {
        Title = IsNew ? "New Custom Order" : "Edit custom order";
        Subtitle = "Capture the customer's design, measurements and materials. The order then moves through production.";
        GstRates.Clear(); foreach (var r in await App.Settings.GstRatesAsync(true)) GstRates.Add(r.Rate);
        if (IsNew) { Order.HsnCode = (await App.Settings.GetAsync()).Tax.DefaultHsn; OnPropertyChanged(nameof(Order)); return; }
        Order = await App.CustomOrders.GetAsync(Id);
        Customer = await App.Customers.GetAsync(Order.CustomerId);
        await LoadImageAsync();
    }

    private async Task LoadImageAsync()
    {
        ReferenceImage = null;
        if (Order.ReferenceAttachmentId is not { } aid) return;
        var a = await App.Attachments.GetAsync(aid);
        if (a is null || !a.Value.Info.ContentType.StartsWith("image/")) return;
        var bmp = new BitmapImage();
        bmp.BeginInit(); bmp.CacheOption = BitmapCacheOption.OnLoad; bmp.StreamSource = new MemoryStream(a.Value.Data); bmp.DecodePixelWidth = 500; bmp.EndInit();
        bmp.Freeze();
        ReferenceImage = bmp;
    }

    partial void OnCustomerSearchChanged(string? value) => _ = RunAsync(async () =>
    {
        CustomerResults.Clear();
        if (string.IsNullOrWhiteSpace(value)) return;
        foreach (var c in (await App.Customers.SearchAsync(value, 10)).Where(c => !c.IsWalkIn)) CustomerResults.Add(c);
    }, showBusy: false);

    [RelayCommand]
    private async Task PickCustomerAsync(Customer? c)
    {
        if (c is null) return;
        Customer = await App.Customers.GetAsync(c.Id);
        Order.CustomerId = c.Id;
        Order.DeliveryAddress ??= Customer.Addresses.FirstOrDefault()?.FullText ?? Infrastructure.Services.InvoiceService.FullAddress(Customer);
        OnPropertyChanged(nameof(Order));
        CustomerSearch = null;
        CustomerResults.Clear();
    }

    [RelayCommand]
    private async Task NewCustomerAsync()
    {
        var d = new CustomerEditDialogViewModel(null, CustomerSearch);
        if (await Shell.ShowDialogAsync(d) && d.SavedId is { } cid) await PickCustomerAsync(new Customer { Id = cid });
    }

    [RelayCommand]
    private Task UploadReferenceAsync() => RunAsync(async () =>
    {
        var path = AppHost.AskOpenPath("Images or PDF|*.png;*.jpg;*.jpeg;*.pdf");
        if (path is null) return;
        Order.ReferenceAttachmentId = await App.Attachments.SaveAsync(await File.ReadAllBytesAsync(path), Path.GetFileName(path), "CUSTOM_ORDER", Id == 0 ? null : Id, "REFERENCE");
        await LoadImageAsync();
        Shell.Toast.Success("Reference attached.");
    });

    [RelayCommand]
    private Task SaveAsync() => RunAsync(async () =>
    {
        Order.CustomerId = Customer?.Id ?? 0;
        var wasNew = IsNew;
        Id = await App.CustomOrders.SaveAsync(Order);
        if (wasNew && Advance > 0)
            await App.Payments.ReceiveAsync(new PaymentInput
            {
                CustomerId = Order.CustomerId, DocType = DocType.CustomOrder, DocId = Id,
                Lines = { new PaymentLineInput { MethodCode = AdvanceMethod, Amount = Advance, Reference = AdvanceReference } },
            });
        Shell.Toast.Success("Custom order saved.");
        Shell.Navigate(Routes.CustomOrderDetail, Id, addToHistory: false);
    });
}

public sealed partial class CustomOrderDetailViewModel(long id) : PageViewModel
{
    [ObservableProperty] private CustomOrder? _order;
    [ObservableProperty] private BitmapImage? _referenceImage;
    public ObservableCollection<StatusHistoryEntry> History { get; } = new();
    public ObservableCollection<Payment> Payments { get; } = new();
    public ObservableCollection<Delivery> Deliveries { get; } = new();
    public ObservableCollection<StepItem> Steps { get; } = new();

    public bool IsOpen => Order?.Status is not (CustomOrderStatus.Completed or CustomOrderStatus.Cancelled);
    public bool CanManage => IsOpen && Can(Perm.CustomOrderManage);
    public string? NextStatus => Order is null ? null : Order.Status is CustomOrderStatus.Received or CustomOrderStatus.Production or CustomOrderStatus.QualityCheck
        ? CustomOrderStatus.Next(Order.Status, Order.RequiresInstallation) : null;
    public string NextLabel => NextStatus is null ? "" : "Move to " + StatusStyle.Label(NextStatus);
    public bool CanInvoice => Order is { InvoiceId: null } o && o.Status is CustomOrderStatus.Ready or CustomOrderStatus.Delivery or CustomOrderStatus.Installation && Can(Perm.InvoiceCreate);
    public bool CanDeliver => Order?.Status is CustomOrderStatus.Ready && Can(Perm.DeliveryManage);
    public bool CanAdvance => IsOpen && Can(Perm.PaymentReceive) && Order!.InvoiceId is null;

    public override async Task LoadAsync()
    {
        Order = await App.CustomOrders.GetAsync(id);
        Title = $"Custom order {Order.Number}";
        Subtitle = $"{Order.CustomerName} · {Order.ProductType} · due {Order.ExpectedCompletionDate:dd-MMM-yyyy}";
        History.Clear(); foreach (var h in await App.CustomOrders.HistoryAsync(id)) History.Add(h);
        Payments.Clear(); if (Can(Perm.PaymentView)) foreach (var p in await App.Payments.ForDocumentAsync(DocType.CustomOrder, id)) Payments.Add(p);
        Deliveries.Clear(); if (Can(Perm.DeliveryView)) foreach (var d in await App.Deliveries.ForDocumentAsync("custom_order_id", id)) Deliveries.Add(d);
        Steps.Clear();
        var flow = CustomOrderStatus.Flow.Where(s => s != CustomOrderStatus.Installation || Order.RequiresInstallation).ToList();
        var idx = flow.IndexOf(Order.Status);
        for (var i = 0; i < flow.Count; i++) Steps.Add(new StepItem(StatusStyle.Label(flow[i]), Order.Status != CustomOrderStatus.Cancelled && i <= idx, i == idx));
        ReferenceImage = null;
        if (Order.ReferenceAttachmentId is { } aid && await App.Attachments.GetAsync(aid) is { } a && a.Info.ContentType.StartsWith("image/"))
        {
            var bmp = new BitmapImage();
            bmp.BeginInit(); bmp.CacheOption = BitmapCacheOption.OnLoad; bmp.StreamSource = new MemoryStream(a.Data); bmp.DecodePixelWidth = 500; bmp.EndInit();
            bmp.Freeze();
            ReferenceImage = bmp;
        }
        foreach (var n in new[] { nameof(IsOpen), nameof(CanManage), nameof(NextStatus), nameof(NextLabel), nameof(CanInvoice), nameof(CanDeliver), nameof(CanAdvance) }) OnPropertyChanged(n);
    }

    [RelayCommand] private void Edit() => Shell.Navigate(Routes.CustomOrder, id);

    [RelayCommand]
    private Task MoveNextAsync() => RunAsync(async () =>
    {
        var s = await App.CustomOrders.AdvanceAsync(id);
        Shell.Toast.Success($"Moved to {StatusStyle.Label(s)}.");
        await LoadAsync();
    });

    [RelayCommand]
    private async Task CollectAdvanceAsync()
    {
        if (await Shell.ShowDialogAsync(new ReceivePaymentDialogViewModel(Order!.CustomerId, DocType.CustomOrder, id) { DefaultAmount = Order.Balance })) await RunAsync(LoadAsync);
    }

    [RelayCommand]
    private async Task InvoiceAsync()
    {
        if (!await Shell.ConfirmAsync("Generate invoice", $"Create the GST invoice for {Money.Format(Order!.FinalPrice)}? The advance of {Money.Format(Order.AdvancePaid)} is applied automatically.", "Generate invoice")) return;
        await RunAsync(async () =>
        {
            var r = await App.CustomOrders.GenerateInvoiceAsync(id, Array.Empty<PaymentLineInput>());
            Shell.Toast.Success($"Invoice {r.InvoiceNumber} created.", () => Shell.Navigate(Routes.Invoice, r.InvoiceId));
            await LoadAsync();
        });
    }

    [RelayCommand]
    private Task ScheduleDeliveryAsync() => RunAsync(async () =>
    {
        var did = await App.Deliveries.CreateForCustomOrderAsync(id);
        Shell.Navigate(Routes.Delivery, did);
    }, "Delivery created.");

    [RelayCommand]
    private async Task CancelOrderAsync()
    {
        var reason = await Shell.AskReasonAsync("Cancel custom order", "Any advance received is kept as the customer's advance (refundable from the customer page).", "Cancel order");
        if (reason is null) return;
        await RunAsync(async () => { await App.CustomOrders.CancelAsync(id, reason); await LoadAsync(); }, "Order cancelled.");
    }

    [RelayCommand]
    private Task WhatsAppAsync() => RunAsync(async () => await DocumentActions.WhatsAppAsync(await App.Documents.CustomOrderConfirmationMessageAsync(id)));

    [RelayCommand] private void OpenInvoice() { if (Order?.InvoiceId is { } i) Shell.Navigate(Routes.Invoice, i); }
    [RelayCommand] private void OpenCustomer() => Shell.Navigate(Routes.Customer, Order!.CustomerId);
    [RelayCommand] private void OpenDelivery(Delivery? d) { if (d is not null) Shell.Navigate(Routes.Delivery, d.Id); }
}

// ============================================================================ Deliveries
public sealed class DeliveryListViewModel : ListPageViewModel<Delivery>
{
    public DeliveryListViewModel(string? status)
    {
        Title = status switch
        {
            DeliveryStatus.Scheduled => "Scheduled Deliveries",
            DeliveryStatus.OutForDelivery => "Out for Delivery",
            DeliveryStatus.Delivered => "Delivered",
            DeliveryStatus.Pending => "Pending Deliveries",
            _ => "Deliveries",
        };
        Subtitle = "Pending → Scheduled → Out for delivery → Delivered (with receiver name and proof).";
        StatusOptions = new[] { new Option(null, "All statuses") }.Concat(DeliveryStatus.All.Select(s => new Option(s, StatusStyle.Label(s)))).ToList();
        SelectedStatus = StatusOptions.FirstOrDefault(o => o.Value == status) ?? StatusOptions[0];
    }

    public override bool ShowDateFilter => true;
    public override string SearchHint => "Delivery no, customer, invoice / order no, driver…";
    protected override Task<PagedResult<Delivery>> FetchAsync(ListQuery q) => App.Deliveries.ListAsync(q);
    protected override void OnOpen(Delivery item) => Shell.Navigate(Routes.Delivery, item.Id);

    protected override IReadOnlyList<ExportColumn<Delivery>> ExportColumns => new ExportColumn<Delivery>[]
    {
        new("Delivery", d => d.Number), new("Customer", d => d.CustomerName), new("Mobile", d => d.ContactMobile), new("Address", d => d.DeliveryAddress),
        new("For", d => d.SourceNumber), new("Items", d => d.ItemsSummary), new("Date", d => d.ScheduledDate), new("Slot", d => d.TimeSlot),
        new("Driver", d => d.DriverName), new("Vehicle", d => d.VehicleNo), new("Status", d => d.Status), new("Delivered at", d => d.DeliveredAt),
    };
}

public sealed partial class DeliveryDetailViewModel(long id) : PageViewModel
{
    [ObservableProperty] private Delivery? _delivery;
    public ObservableCollection<StatusHistoryEntry> History { get; } = new();
    public ObservableCollection<User> Drivers { get; } = new();
    public IReadOnlyList<string> Slots { get; } = new[] { "9 AM - 12 PM", "10 AM - 1 PM", "12 PM - 3 PM", "2 PM - 5 PM", "4 PM - 7 PM", "Evening" };
    [ObservableProperty] private DateTime? _scheduleDate = DateTime.Today.AddDays(1);
    [ObservableProperty] private string? _timeSlot = "10 AM - 1 PM";
    [ObservableProperty] private string? _driverName;
    [ObservableProperty] private User? _driver;
    [ObservableProperty] private string? _vehicleNo;
    [ObservableProperty] private decimal? _deliveryCost;
    [ObservableProperty] private string? _lastOtp;
    [ObservableProperty] private BitmapImage? _signature;
    [ObservableProperty] private BitmapImage? _photo;

    public bool CanManage => Can(Perm.DeliveryManage);
    public bool CanSchedule => CanManage && Delivery?.Status is DeliveryStatus.Pending or DeliveryStatus.Scheduled or DeliveryStatus.Failed;
    public bool CanDispatch => CanManage && Delivery?.Status == DeliveryStatus.Scheduled;
    public bool CanComplete => CanManage && Delivery?.Status == DeliveryStatus.OutForDelivery;
    public bool CanCancel => CanManage && Delivery?.Status is not (DeliveryStatus.Delivered or DeliveryStatus.Cancelled);
    public bool IsDelivered => Delivery?.Status == DeliveryStatus.Delivered;

    partial void OnDriverChanged(User? value) { if (value is not null) DriverName = value.FullName; }

    public override async Task LoadAsync()
    {
        Delivery = await App.Deliveries.GetAsync(id);
        Title = $"Delivery {Delivery.Number}";
        Subtitle = $"{Delivery.CustomerName} · {Delivery.SourceNumber}";
        if (Delivery.ScheduledDate.HasValue) ScheduleDate = Delivery.ScheduledDate;
        TimeSlot = Delivery.TimeSlot ?? TimeSlot; DriverName = Delivery.DriverName; VehicleNo = Delivery.VehicleNo;
        DeliveryCost = CanSeeCost ? Delivery.DeliveryCost : null;
        History.Clear(); foreach (var h in await App.Deliveries.HistoryAsync(id)) History.Add(h);
        if (Drivers.Count == 0) foreach (var u in await App.Users.ActiveStaffAsync("DELIVERY")) Drivers.Add(u);
        Signature = await ImageAsync(Delivery.SignatureAttachmentId);
        Photo = await ImageAsync(Delivery.PhotoAttachmentId);
        foreach (var n in new[] { nameof(CanSchedule), nameof(CanDispatch), nameof(CanComplete), nameof(CanCancel), nameof(IsDelivered) }) OnPropertyChanged(n);
    }

    private static async Task<BitmapImage?> ImageAsync(long? attachmentId)
    {
        if (attachmentId is not { } aid || await App.Attachments.GetAsync(aid) is not { } a || !a.Info.ContentType.StartsWith("image/")) return null;
        var bmp = new BitmapImage();
        bmp.BeginInit(); bmp.CacheOption = BitmapCacheOption.OnLoad; bmp.StreamSource = new MemoryStream(a.Data); bmp.DecodePixelWidth = 400; bmp.EndInit();
        bmp.Freeze();
        return bmp;
    }

    [RelayCommand]
    private Task ScheduleAsync() => RunAsync(async () =>
    {
        if (ScheduleDate is null) throw new ValidationException("ScheduledDate", "Choose the delivery date.");
        LastOtp = await App.Deliveries.ScheduleAsync(id, ScheduleDate.Value, TimeSlot, DriverName, Driver?.Id, VehicleNo, DeliveryCost);
        await LoadAsync();
        Shell.Toast.Success($"Delivery scheduled. Customer OTP: {LastOtp}");
    });

    [RelayCommand]
    private Task SendScheduleAsync() => RunAsync(async () => await DocumentActions.WhatsAppAsync(await App.Documents.DeliveryMessageAsync(id, LastOtp)));

    [RelayCommand] private Task DispatchAsync() => RunAsync(async () => { await App.Deliveries.DispatchAsync(id); await LoadAsync(); }, "Marked out for delivery.");

    [RelayCommand]
    private async Task CompleteAsync()
    {
        if (await Shell.ShowDialogAsync(new CompleteDeliveryDialogViewModel(id, Delivery!.CustomerName))) await RunAsync(LoadAsync);
    }

    [RelayCommand]
    private async Task FailAsync()
    {
        var reason = await Shell.AskReasonAsync("Delivery failed", "Why could the delivery not be completed? (customer not home, wrong address…). You can reschedule it.", "Mark failed");
        if (reason is null) return;
        await RunAsync(async () => { await App.Deliveries.FailAsync(id, reason); await LoadAsync(); });
    }

    [RelayCommand]
    private async Task CancelDeliveryAsync()
    {
        var reason = await Shell.AskReasonAsync("Cancel delivery", "Cancel this delivery? (e.g. customer will pick up)", "Cancel delivery");
        if (reason is null) return;
        await RunAsync(async () => { await App.Deliveries.CancelAsync(id, reason); await LoadAsync(); });
    }

    [RelayCommand]
    private void OpenSource()
    {
        if (Delivery?.InvoiceId is { } i) Shell.Navigate(Routes.Invoice, i);
        else if (Delivery?.SalesOrderId is { } s) Shell.Navigate(Routes.SalesOrder, s);
        else if (Delivery?.CustomOrderId is { } c) Shell.Navigate(Routes.CustomOrderDetail, c);
    }

    [RelayCommand] private void Call() { if (Delivery?.ContactMobile is { } m) AppHost.OpenExternal($"tel:{m}"); }
    [RelayCommand] private void Map() { if (Delivery is not null) AppHost.OpenExternal("https://www.google.com/maps/search/?api=1&query=" + Uri.EscapeDataString(Delivery.DeliveryAddress)); }
}

/// <summary>Proof of delivery: receiver + (OTP | signature | photo | remarks).</summary>
public sealed partial class CompleteDeliveryDialogViewModel : DialogViewModel
{
    private readonly long _deliveryId;

    public CompleteDeliveryDialogViewModel(long deliveryId, string? customerName)
    {
        _deliveryId = deliveryId;
        ReceiverName = customerName ?? "";
        DialogTitle = "Complete delivery";
    }

    public override double DialogWidth => 600;
    public override string AcceptText => "Mark delivered";
    [ObservableProperty] private string _receiverName;
    [ObservableProperty] private string? _otp;
    [ObservableProperty] private string? _remarks;
    [ObservableProperty] private string? _photoPath;
    /// <summary>Set by the view from the signature pad just before accepting.</summary>
    public Func<byte[]?>? SignatureProvider { get; set; }

    [RelayCommand]
    private void PickPhoto() => PhotoPath = AppHost.AskOpenPath("Photos|*.jpg;*.jpeg;*.png") ?? PhotoPath;

    protected override async Task OnAcceptAsync()
    {
        await App.Deliveries.CompleteAsync(new DeliveryCompletion
        {
            DeliveryId = _deliveryId, ReceiverName = ReceiverName, Otp = Otp, Remarks = Remarks, SignaturePng = SignatureProvider?.Invoke(),
            PhotoBytes = PhotoPath is null ? null : await File.ReadAllBytesAsync(PhotoPath), PhotoFileName = PhotoPath is null ? null : Path.GetFileName(PhotoPath),
        });
        Shell.Toast.Success("Delivery completed.");
    }
}

// ============================================================================ Installations
public sealed class InstallationListViewModel : ListPageViewModel<Installation>
{
    public InstallationListViewModel()
    {
        Title = "Installation";
        Subtitle = "Assembly and fitting jobs: Pending → Scheduled → Assigned → Completed.";
        StatusOptions = new[] { new Option(null, "All statuses") }.Concat(InstallationStatus.All.Select(s => new Option(s, StatusStyle.Label(s)))).ToList();
        SelectedStatus = StatusOptions[0];
    }

    public override string SearchHint => "Job no, customer, technician…";
    public bool CanManage => Can(Perm.InstallationManage);
    protected override Task<PagedResult<Installation>> FetchAsync(ListQuery q) => App.Installations.ListAsync(q);
    protected override void OnOpen(Installation item) => _ = OpenAsync(item);

    private async Task OpenAsync(Installation i)
    {
        if (!CanManage || i.Status is InstallationStatus.Completed or InstallationStatus.Cancelled) return;
        if (await Shell.ShowDialogAsync(new InstallationDialogViewModel(i))) await RunAsync(LoadAsync);
    }

    public IAsyncRelayCommand<Installation> ManageCommand => new AsyncRelayCommand<Installation>(i => i is null ? Task.CompletedTask : OpenAsync(i));

    protected override IReadOnlyList<ExportColumn<Installation>> ExportColumns => new ExportColumn<Installation>[]
    {
        new("Job", i => i.Number), new("Customer", i => i.CustomerName), new("Mobile", i => i.CustomerMobile), new("Address", i => i.Address),
        new("For", i => i.InvoiceNumber ?? i.CustomOrderNumber), new("Technician", i => i.TechnicianName), new("Scheduled", i => i.ScheduledDate),
        new("Status", i => i.Status), new("Completed", i => i.CompletedAt),
    };
}

public sealed partial class InstallationDialogViewModel : DialogViewModel
{
    public InstallationDialogViewModel(Installation i)
    {
        Job = i;
        DialogTitle = $"Installation {i.Number}";
        Date = i.ScheduledDate ?? DateTime.Today;
        Technician = i.TechnicianName;
        Cost = i.InstallationCost;
    }

    public Installation Job { get; }
    public override string AcceptText => "Save schedule";
    [ObservableProperty] private DateTime? _date;
    [ObservableProperty] private string? _technician;
    [ObservableProperty] private decimal? _cost;
    [ObservableProperty] private string? _completionNotes;
    public bool CanComplete => Job.Status is InstallationStatus.Scheduled or InstallationStatus.Assigned;

    protected override async Task OnAcceptAsync()
    {
        if (Date is null) throw new ValidationException("Date", "Choose a date.");
        await App.Installations.ScheduleAsync(Job.Id, Date.Value, Technician, null, CanSeeCost ? Cost : null);
        Shell.Toast.Success("Installation scheduled.");
    }

    [RelayCommand]
    private async Task CompleteJobAsync()
    {
        if (await RunAsync(() => App.Installations.CompleteAsync(Job.Id, CompletionNotes), "Installation completed.")) Close(true);
    }

    [RelayCommand]
    private async Task CancelJobAsync()
    {
        var reason = await Shell.AskReasonAsync("Cancel installation", "Cancel this installation job?", "Cancel job");
        if (reason is null) return;
        if (await RunAsync(() => App.Installations.CancelAsync(Job.Id, reason), "Installation cancelled.")) Close(true);
    }
}

// ============================================================================ Expenses
public sealed class ExpenseListViewModel : ListPageViewModel<Expense>
{
    public ExpenseListViewModel()
    {
        Title = "Expenses";
        Subtitle = "Rent, salaries, electricity, transport and other running costs. Used in the profit & loss report.";
    }

    public override bool ShowDateFilter => true;
    public override string SearchHint => "Number, description, category…";
    public bool CanManage => Can(Perm.ExpenseManage);
    protected override Task<PagedResult<Expense>> FetchAsync(ListQuery q) => App.Expenses.ListAsync(q);
    protected override void OnOpen(Expense item) => _ = EditAsync(item);

    private async Task EditAsync(Expense? e)
    {
        if (!CanManage) return;
        if (await Shell.ShowDialogAsync(new ExpenseDialogViewModel(e))) await RunAsync(LoadAsync);
    }

    public IAsyncRelayCommand NewCommand => new AsyncRelayCommand(() => EditAsync(null));

    public IAsyncRelayCommand<Expense> DeleteCommand => new AsyncRelayCommand<Expense>(async e =>
    {
        if (e is null || !await Shell.ConfirmAsync("Delete expense", $"Delete {e.Number} ({Money.Format(e.Amount)})? It is kept in the activity log.", "Delete", true)) return;
        await RunAsync(async () => { await App.Expenses.DeleteAsync(e.Id); await LoadAsync(); }, "Expense deleted.");
    });

    protected override IReadOnlyList<ExportColumn<Expense>> ExportColumns => new ExportColumn<Expense>[]
    {
        new("Number", e => e.Number), new("Date", e => e.ExpenseDate), new("Category", e => e.CategoryName), new("Amount", e => e.Amount),
        new("Method", e => e.MethodCode), new("Description", e => e.Description), new("Reference", e => e.Reference), new("Added by", e => e.CreatedByName),
    };
}

public sealed partial class ExpenseDialogViewModel : DialogViewModel
{
    public ExpenseDialogViewModel(Expense? e)
    {
        Model = e is null ? new Expense() : new Expense { Id = e.Id, Number = e.Number, CategoryId = e.CategoryId, ExpenseDate = e.ExpenseDate, Amount = e.Amount, MethodCode = e.MethodCode, Description = e.Description, Reference = e.Reference };
        DialogTitle = e is null ? "New expense" : $"Edit expense {e.Number}";
    }

    public Expense Model { get; }
    public ObservableCollection<ExpenseCategory> Categories { get; } = new();
    public IReadOnlyList<string> Methods => PaymentMethodCode.Money;
    [ObservableProperty] private ExpenseCategory? _category;

    public override async Task InitAsync()
    {
        foreach (var c in (await App.Expenses.CategoriesAsync()).Where(c => c.IsActive)) Categories.Add(c);
        Category = Categories.FirstOrDefault(c => c.Id == Model.CategoryId);
    }

    protected override async Task OnAcceptAsync()
    {
        Model.CategoryId = Category?.Id ?? 0;
        await App.Expenses.SaveAsync(Model);
        Shell.Toast.Success("Expense saved.");
    }
}
