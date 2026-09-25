using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Wpf.Services;

namespace FurniShop.Wpf.ViewModels;

// ============================================================================ Invoices
public sealed class InvoiceListViewModel : ListPageViewModel<InvoiceListItem>
{
    private readonly string? _paymentState;

    public InvoiceListViewModel(string? paymentState)
    {
        _paymentState = paymentState;
        Title = "Invoices";
        Subtitle = "All GST invoices. Drafts have no number until they are finalised.";
        StatusOptions = new[]
        {
            new Option(null, "All invoices"), new Option("PAY:PAID", "Paid"), new Option("PAY:PARTIALLY_PAID", "Partially paid"),
            new Option("PAY:UNPAID", "Unpaid"), new Option("PAY:OVERDUE", "Overdue"), new Option(InvoiceStatus.Draft, "Drafts"), new Option(InvoiceStatus.Cancelled, "Cancelled"),
        };
        SelectedStatus = paymentState is null ? StatusOptions[0] : StatusOptions.FirstOrDefault(o => o.Value == "PAY:" + paymentState) ?? StatusOptions[0];
    }

    public override bool ShowDateFilter => true;
    public override string SearchHint => "Invoice no, customer, mobile…";
    public override string EmptyTitle => "No invoices";

    protected override Task<PagedResult<InvoiceListItem>> FetchAsync(ListQuery q)
    {
        string? pay = null;
        if (q.Status?.StartsWith("PAY:") == true) { pay = q.Status[4..]; q.Status = null; }
        return App.Invoices.ListAsync(q, pay);
    }

    protected override void OnOpen(InvoiceListItem item) => Shell.Navigate(Routes.Invoice, item.Id);

    protected override IReadOnlyList<ExportColumn<InvoiceListItem>> ExportColumns => new ExportColumn<InvoiceListItem>[]
    {
        new("Invoice", i => i.Number), new("Date", i => i.InvoiceDate), new("Customer", i => i.CustomerName), new("Mobile", i => i.CustomerMobile),
        new("Status", i => i.Status), new("Total", i => i.GrandTotal), new("Returned", i => i.ReturnedAmount), new("Paid", i => i.Paid),
        new("Balance", i => i.Balance), new("Due date", i => i.DueDate), new("Created by", i => i.CreatedByName),
    };
}

public sealed partial class InvoiceDetailViewModel(long id) : PageViewModel
{
    public long Id { get; } = id;
    [ObservableProperty] private Invoice? _invoice;
    public ObservableCollection<Payment> Payments { get; } = new();
    public ObservableCollection<SalesReturn> Returns { get; } = new();
    public ObservableCollection<Delivery> Deliveries { get; } = new();
    public ObservableCollection<AuditLog> History { get; } = new();

    public bool IsFinal => Invoice?.Status == InvoiceStatus.Final;
    public bool IsDraft => Invoice?.Status == InvoiceStatus.Draft;
    public bool CanReceive => IsFinal && Invoice!.Balance > 0 && Can(Perm.PaymentReceive);
    public bool CanCancel => IsFinal && Can(Perm.InvoiceCancel);
    public bool CanReturn => IsFinal && Can(Perm.ReturnManage) && Invoice!.Lines.Any(l => l.ReturnableQty > 0);
    public bool CanDeliver => IsFinal && Can(Perm.DeliveryManage) && Deliveries.All(d => d.Status is DeliveryStatus.Cancelled or DeliveryStatus.Failed);
    public bool CanRefund => IsFinal && Invoice!.Balance < 0 && Can(Perm.PaymentRefund);

    public override async Task LoadAsync()
    {
        Invoice = await App.Invoices.GetAsync(Id);
        Title = Invoice.Number is null ? $"Draft invoice #{Invoice.Id}" : $"Invoice {Invoice.Number}";
        Subtitle = $"{Invoice.CustomerName} · {Invoice.Date:dd-MMM-yyyy}";
        Payments.Clear(); Returns.Clear(); Deliveries.Clear(); History.Clear();
        if (IsFinal || Invoice.Status == InvoiceStatus.Cancelled)
        {
            foreach (var p in await App.Payments.ForDocumentAsync(DocType.Invoice, Id)) Payments.Add(p);
            foreach (var r in await App.Invoices.ReturnsForAsync(Id)) Returns.Add(r);
            if (Can(Perm.DeliveryView)) foreach (var d in await App.Deliveries.ForDocumentAsync("invoice_id", Id)) Deliveries.Add(d);
        }
        if (Can(Perm.AuditView)) foreach (var a in await App.Audit.ForRecordAsync("invoice", Id)) History.Add(a);
        foreach (var n in new[] { nameof(IsFinal), nameof(IsDraft), nameof(CanReceive), nameof(CanCancel), nameof(CanReturn), nameof(CanDeliver), nameof(CanRefund) })
            OnPropertyChanged(n);
    }

    [RelayCommand] private Task PrintAsync() => RunAsync(() => DocumentActions.PrintInvoiceAsync(Id, false));
    [RelayCommand] private Task PrintThermalAsync() => RunAsync(() => DocumentActions.PrintInvoiceAsync(Id, true));
    [RelayCommand] private Task PreviewAsync() => RunAsync(() => DocumentActions.PrintInvoiceAsync(Id, false, preview: true));
    [RelayCommand] private Task PdfAsync() => RunAsync(() => DocumentActions.InvoicePdfAsync(Id));

    [RelayCommand]
    private Task WhatsAppAsync() => RunAsync(async () =>
        await DocumentActions.WhatsAppAsync(await App.Documents.InvoiceMessageAsync(Id), async () => (await App.Documents.InvoicePdfAsync(Id), Invoice!.Number ?? "Invoice")));

    [RelayCommand]
    private Task ReminderAsync() => RunAsync(async () => await DocumentActions.WhatsAppAsync(await App.Documents.InvoiceMessageAsync(Id, reminder: true)));

    [RelayCommand]
    private async Task ReceivePaymentAsync()
    {
        if (await Shell.ShowDialogAsync(new ReceivePaymentDialogViewModel(Invoice!.CustomerId, DocType.Invoice, Id))) await RunAsync(LoadAsync);
    }

    [RelayCommand]
    private async Task RefundAsync()
    {
        if (await Shell.ShowDialogAsync(new RefundDialogViewModel(Invoice!.CustomerId, DocType.Invoice, Id, -Invoice.Balance))) await RunAsync(LoadAsync);
    }

    [RelayCommand]
    private async Task CancelInvoiceAsync()
    {
        var reason = await Shell.AskReasonAsync("Cancel invoice",
            $"Invoice {Invoice!.Number} will be marked CANCELLED (it stays in the register). Stock returns to inventory and any money received is kept as the customer's advance.",
            "Cancel invoice");
        if (reason is null) return;
        await RunAsync(async () => { await App.Invoices.CancelAsync(Id, reason); await LoadAsync(); }, "Invoice cancelled.");
    }

    [RelayCommand]
    private async Task DeleteDraftAsync()
    {
        if (!await Shell.ConfirmAsync("Discard draft", "Delete this draft invoice? Nothing else is affected.", "Delete draft", true)) return;
        if (await RunAsync(() => App.Invoices.DeleteDraftAsync(Id), "Draft deleted.")) Shell.Navigate(Routes.Invoices);
    }

    [RelayCommand] private void EditDraft() => Shell.Navigate(Routes.Pos, new EditorArgs(EditorMode.Invoice, Id));

    [RelayCommand]
    private async Task FinalizeDraftAsync()
    {
        var d = new ReceivePaymentDialogViewModel(Invoice!.CustomerId, null, null) { FinalizeInvoiceId = Id, DefaultAmount = Invoice.GrandTotal };
        if (await Shell.ShowDialogAsync(d)) await RunAsync(LoadAsync);
    }

    [RelayCommand] private void NewReturn() => Shell.Navigate(Routes.ReturnNew, Id);
    [RelayCommand] private void NewExchange() => Shell.Navigate(Routes.ExchangeNew, Id);

    [RelayCommand]
    private Task CreateDeliveryAsync() => RunAsync(async () =>
    {
        var did = await App.Deliveries.CreateForInvoiceAsync(Id);
        Shell.Navigate(Routes.Delivery, did);
    }, "Delivery created.");

    [RelayCommand] private void OpenCustomer() => Shell.Navigate(Routes.Customer, Invoice!.CustomerId);
    [RelayCommand] private void OpenPayment(Payment? p) { if (p is not null) _ = Shell.ShowDialogAsync(new PaymentDetailDialogViewModel(p.Id)); }
    [RelayCommand] private void OpenDelivery(Delivery? d) { if (d is not null) Shell.Navigate(Routes.Delivery, d.Id); }
    [RelayCommand] private void OpenSalesOrder() { if (Invoice?.SalesOrderId is { } so) Shell.Navigate(Routes.SalesOrder, so); }
}

// ============================================================================ Quotations
public sealed class QuotationListViewModel : ListPageViewModel<Quotation>
{
    public QuotationListViewModel()
    {
        Title = "Quotations";
        Subtitle = "Estimates for customers. Convert a confirmed quotation into a sales order without re-entering anything.";
        StatusOptions = new[] { new Option(null, "All statuses") }.Concat(QuotationStatus.All.Select(s => new Option(s, StatusStyle.Label(s)))).ToList();
        SelectedStatus = StatusOptions[0];
    }

    public override bool ShowDateFilter => true;
    public override string SearchHint => "Quotation no, customer, mobile…";
    public bool CanCreate => Can(Perm.QuotationManage);
    protected override Task<PagedResult<Quotation>> FetchAsync(ListQuery q) => App.Quotations.ListAsync(q);
    protected override void OnOpen(Quotation item) => Shell.Navigate(Routes.Quotation, item.Id);
    public IRelayCommand NewCommand => new RelayCommand(() => Shell.Navigate(Routes.Pos, new EditorArgs(EditorMode.Quotation)));

    protected override IReadOnlyList<ExportColumn<Quotation>> ExportColumns => new ExportColumn<Quotation>[]
    {
        new("Quotation", q => q.Number), new("Date", q => q.Date), new("Valid until", q => q.ValidUntil), new("Customer", q => q.CustomerName),
        new("Status", q => q.Status), new("Total", q => q.GrandTotal), new("Sales order", q => q.SalesOrderNumber),
    };
}

public sealed partial class QuotationDetailViewModel(long id) : PageViewModel
{
    public long Id { get; } = id;
    [ObservableProperty] private Quotation? _quotation;
    public bool IsOpen => Quotation?.Status is QuotationStatus.Draft or QuotationStatus.Sent or QuotationStatus.Confirmed or QuotationStatus.Expired;
    public bool CanEdit => Quotation?.Status is QuotationStatus.Draft or QuotationStatus.Sent or QuotationStatus.Expired && Can(Perm.QuotationManage);
    public bool CanConvert => IsOpen && Quotation?.Status != QuotationStatus.Expired && Can(Perm.SalesOrderManage);
    [ObservableProperty] private DateTime? _expectedDelivery = DateTime.Today.AddDays(7);

    public override async Task LoadAsync()
    {
        Quotation = await App.Quotations.GetAsync(Id);
        Title = $"Quotation {Quotation.Number}";
        Subtitle = $"{Quotation.CustomerName} · valid until {Quotation.ValidUntil:dd-MMM-yyyy}";
        OnPropertyChanged(nameof(IsOpen)); OnPropertyChanged(nameof(CanEdit)); OnPropertyChanged(nameof(CanConvert));
    }

    [RelayCommand] private void Edit() => Shell.Navigate(Routes.Pos, new EditorArgs(EditorMode.Quotation, Id));
    [RelayCommand] private Task PrintAsync() => RunAsync(() => DocumentActions.PrintQuotationAsync(Id));
    [RelayCommand] private Task PreviewAsync() => RunAsync(() => DocumentActions.PrintQuotationAsync(Id, true));
    [RelayCommand] private Task PdfAsync() => RunAsync(async () => await DocumentActions.SavePdfAsync(await App.Documents.QuotationPdfAsync(Id), $"{Quotation!.Number} {Quotation.CustomerName}"));

    [RelayCommand]
    private Task WhatsAppAsync() => RunAsync(async () =>
    {
        await DocumentActions.WhatsAppAsync(await App.Documents.QuotationMessageAsync(Id), async () => (await App.Documents.QuotationPdfAsync(Id), Quotation!.Number ?? "Quotation"));
        if (Quotation!.Status == QuotationStatus.Draft) { await App.Quotations.SetStatusAsync(Id, QuotationStatus.Sent, "Shared on WhatsApp"); await LoadAsync(); }
    });

    [RelayCommand]
    private Task SetStatusAsync(string status) => RunAsync(async () => { await App.Quotations.SetStatusAsync(Id, status); await LoadAsync(); }, $"Marked {StatusStyle.Label(status)}.");

    [RelayCommand]
    private Task ConvertAsync() => RunAsync(async () =>
    {
        var soId = await App.Quotations.ConvertToSalesOrderAsync(Id, ExpectedDelivery);
        Shell.Toast.Success("Sales order created and confirmed. Collect the advance next.");
        Shell.Navigate(Routes.SalesOrder, soId);
    });

    [RelayCommand] private void OpenSalesOrder() { if (Quotation?.SalesOrderId is { } so) Shell.Navigate(Routes.SalesOrder, so); }
}

// ============================================================================ Sales orders
public sealed class SalesOrderListViewModel : ListPageViewModel<SalesOrder>
{
    public SalesOrderListViewModel()
    {
        Title = "Sales Orders";
        Subtitle = "Confirmed orders with advances, stock reservations, production and delivery status.";
        StatusOptions = new[] { new Option(null, "All statuses") }.Concat(SalesOrderStatus.All.Select(s => new Option(s, StatusStyle.Label(s)))).ToList();
        SelectedStatus = StatusOptions[0];
    }

    public override bool ShowDateFilter => true;
    public override string SearchHint => "Order no, customer, mobile…";
    public bool CanCreate => Can(Perm.SalesOrderManage);
    public IRelayCommand NewCommand => new RelayCommand(() => Shell.Navigate(Routes.Pos, new EditorArgs(EditorMode.SalesOrder)));
    protected override Task<PagedResult<SalesOrder>> FetchAsync(ListQuery q) => App.SalesOrders.ListAsync(q);
    protected override void OnOpen(SalesOrder item) => Shell.Navigate(Routes.SalesOrder, item.Id);

    protected override IReadOnlyList<ExportColumn<SalesOrder>> ExportColumns => new ExportColumn<SalesOrder>[]
    {
        new("Order", o => o.Number), new("Date", o => o.Date), new("Customer", o => o.CustomerName), new("Status", o => o.Status),
        new("Expected delivery", o => o.ExpectedDeliveryDate), new("Total", o => o.GrandTotal), new("Advance", o => o.AdvancePaid),
        new("Balance", o => o.Balance), new("Invoice", o => o.InvoiceNumber),
    };
}

public sealed partial class SalesOrderDetailViewModel(long id) : PageViewModel
{
    public long Id { get; } = id;
    [ObservableProperty] private SalesOrder? _order;
    public ObservableCollection<StatusHistoryEntry> History { get; } = new();
    public ObservableCollection<Payment> Payments { get; } = new();
    public ObservableCollection<Delivery> Deliveries { get; } = new();
    public ObservableCollection<StepItem> Steps { get; } = new();

    public bool IsOpen => Order is not null && SalesOrderStatus.IsOpen(Order.Status);
    public bool CanManage => IsOpen && Can(Perm.SalesOrderManage);
    public bool IsDraft => Order?.Status == SalesOrderStatus.Draft;
    public bool CanEdit => CanManage && Order!.InvoiceId is null && Order.Status is SalesOrderStatus.Draft or SalesOrderStatus.Confirmed or SalesOrderStatus.Processing;
    public bool CanInvoice => IsOpen && !IsDraft && Order!.InvoiceId is null && Can(Perm.InvoiceCreate);
    public bool CanAdvance => IsOpen && Can(Perm.PaymentReceive) && Order!.Balance > 0;
    public bool CanDeliver => IsOpen && !IsDraft && Order!.RequiresDelivery && Can(Perm.DeliveryManage) && Deliveries.All(d => d.Status is DeliveryStatus.Cancelled or DeliveryStatus.Failed);
    public bool HasShortage => Order?.Lines.Any(l => l.VariantId.HasValue && l.ReservedQty < l.Quantity) == true && Order.InvoiceId is null;
    public string? NextStatus => Order is null ? null : Order.Status switch
    {
        SalesOrderStatus.Confirmed => SalesOrderStatus.Processing,
        SalesOrderStatus.Processing => SalesOrderStatus.Manufacturing,
        SalesOrderStatus.Manufacturing => SalesOrderStatus.Ready,
        SalesOrderStatus.Delivered when Order.InvoiceId.HasValue => SalesOrderStatus.Completed,
        SalesOrderStatus.Ready when !Order.RequiresDelivery && Order.InvoiceId.HasValue => SalesOrderStatus.Completed,
        _ => null,
    };
    public string NextStatusLabel => NextStatus is null ? "" : "Mark " + StatusStyle.Label(NextStatus);

    public override async Task LoadAsync()
    {
        Order = await App.SalesOrders.GetAsync(Id);
        Title = $"Sales order {Order.Number}";
        Subtitle = $"{Order.CustomerName} · ordered {Order.Date:dd-MMM-yyyy}" + (Order.ExpectedDeliveryDate.HasValue ? $" · delivery {Order.ExpectedDeliveryDate:dd-MMM-yyyy}" : "");
        History.Clear(); Payments.Clear(); Deliveries.Clear();
        foreach (var h in await App.SalesOrders.HistoryAsync(Id)) History.Add(h);
        if (Can(Perm.PaymentView)) foreach (var p in await App.Payments.ForDocumentAsync(DocType.SalesOrder, Id)) Payments.Add(p);
        if (Can(Perm.DeliveryView)) foreach (var d in await App.Deliveries.ForDocumentAsync("sales_order_id", Id)) Deliveries.Add(d);
        Steps.Clear();
        var idx = Array.IndexOf(SalesOrderStatus.Flow, Order.Status);
        foreach (var (s, i) in SalesOrderStatus.Flow.Select((s, i) => (s, i)))
            Steps.Add(new StepItem(StatusStyle.Label(s), Order.Status == SalesOrderStatus.Cancelled ? false : i <= idx, i == idx));
        foreach (var n in new[] { nameof(IsOpen), nameof(CanManage), nameof(IsDraft), nameof(CanEdit), nameof(CanInvoice), nameof(CanAdvance), nameof(CanDeliver),
                     nameof(HasShortage), nameof(NextStatus), nameof(NextStatusLabel) })
            OnPropertyChanged(n);
    }

    [RelayCommand] private void Edit() => Shell.Navigate(Routes.Pos, new EditorArgs(EditorMode.SalesOrder, Id));

    [RelayCommand]
    private Task ConfirmAsync() => RunAsync(async () =>
    {
        var r = await App.SalesOrders.ConfirmAsync(Id);
        if (!r.FullyReserved) Shell.Toast.Warning("Short of stock: " + string.Join(", ", r.Shortages));
        await LoadAsync();
    }, "Order confirmed.");

    [RelayCommand]
    private Task ReserveAsync() => RunAsync(async () =>
    {
        var r = await App.SalesOrders.ReserveAsync(Id);
        if (r.FullyReserved) Shell.Toast.Success("All stock reserved.");
        else Shell.Toast.Warning("Still short: " + string.Join(", ", r.Shortages));
        await LoadAsync();
    });

    [RelayCommand]
    private Task AdvanceStatusAsync() => NextStatus is null ? Task.CompletedTask
        : RunAsync(async () => { await App.SalesOrders.ChangeStatusAsync(Id, NextStatus); await LoadAsync(); }, "Status updated.");

    [RelayCommand]
    private async Task CancelOrderAsync()
    {
        var reason = await Shell.AskReasonAsync("Cancel sales order",
            "Reserved stock is released. Any advance received stays with the customer as an advance (you can refund it from Payments).", "Cancel order");
        if (reason is null) return;
        await RunAsync(async () => { await App.SalesOrders.ChangeStatusAsync(Id, SalesOrderStatus.Cancelled, reason); await LoadAsync(); }, "Order cancelled.");
    }

    [RelayCommand]
    private async Task CollectAdvanceAsync()
    {
        if (await Shell.ShowDialogAsync(new ReceivePaymentDialogViewModel(Order!.CustomerId, DocType.SalesOrder, Id) { DefaultAmount = Order.Balance }))
            await RunAsync(LoadAsync);
    }

    [RelayCommand]
    private async Task GenerateInvoiceAsync()
    {
        var d = new ReceivePaymentDialogViewModel(Order!.CustomerId, null, null)
        {
            ConvertSalesOrderId = Id, DefaultAmount = Order.Balance,
        };
        if (await Shell.ShowDialogAsync(d)) await RunAsync(LoadAsync);
    }

    [RelayCommand]
    private Task ScheduleDeliveryAsync() => RunAsync(async () =>
    {
        var did = await App.Deliveries.CreateForSalesOrderAsync(Id, Order!.ExpectedDeliveryDate);
        Shell.Navigate(Routes.Delivery, did);
    }, "Delivery created — schedule the driver and vehicle.");

    [RelayCommand] private Task PrintAsync() => RunAsync(() => DocumentActions.PrintSalesOrderAsync(Id));
    [RelayCommand] private Task PdfAsync() => RunAsync(async () => await DocumentActions.SavePdfAsync(await App.Documents.SalesOrderPdfAsync(Id), $"{Order!.Number} {Order.CustomerName}"));

    [RelayCommand]
    private Task WhatsAppAsync() => RunAsync(async () =>
        await DocumentActions.WhatsAppAsync(await App.Documents.OrderConfirmationMessageAsync(Id), async () => (await App.Documents.SalesOrderPdfAsync(Id), Order!.Number ?? "Order")));

    [RelayCommand] private void OpenInvoice() { if (Order?.InvoiceId is { } i) Shell.Navigate(Routes.Invoice, i); }
    [RelayCommand] private void OpenQuotation() { if (Order?.QuotationId is { } q) Shell.Navigate(Routes.Quotation, q); }
    [RelayCommand] private void OpenCustomer() => Shell.Navigate(Routes.Customer, Order!.CustomerId);
    [RelayCommand] private void OpenDelivery(Delivery? d) { if (d is not null) Shell.Navigate(Routes.Delivery, d.Id); }
    [RelayCommand] private void OpenPayment(Payment? p) { if (p is not null) _ = Shell.ShowDialogAsync(new PaymentDetailDialogViewModel(p.Id)); }
}

public sealed record StepItem(string Label, bool Done, bool Current);

// ============================================================================ Payments
public sealed class PaymentListViewModel : ListPageViewModel<Payment>
{
    public PaymentListViewModel()
    {
        Title = "Payments";
        Subtitle = "Receipts and refunds. Payments cannot be edited — a wrong entry is voided (with a reason) and entered again.";
        StatusOptions = new[] { new Option(null, "All"), new Option("RECEIVED", "Received"), new Option("REFUND", "Refunds"), new Option("VOIDED", "Voided") };
        SelectedStatus = StatusOptions[0];
    }

    public override bool ShowDateFilter => true;
    public override string SearchHint => "Receipt no, customer, mobile…";
    public bool CanReceive => Can(Perm.PaymentReceive);
    protected override Task<PagedResult<Payment>> FetchAsync(ListQuery q) => App.Payments.ListAsync(q);
    protected override void OnOpen(Payment item) => _ = OpenAsync(item);

    private async Task OpenAsync(Payment p)
    {
        if (await Shell.ShowDialogAsync(new PaymentDetailDialogViewModel(p.Id))) await RunAsync(LoadAsync);
    }

    public IAsyncRelayCommand NewCommand => new AsyncRelayCommand(async () =>
    {
        if (await Shell.ShowDialogAsync(new ReceivePaymentDialogViewModel(null, null, null))) await RunAsync(LoadAsync);
    });

    protected override IReadOnlyList<ExportColumn<Payment>> ExportColumns => new ExportColumn<Payment>[]
    {
        new("Receipt", p => p.Number), new("Date", p => p.PaymentDate), new("Customer", p => p.CustomerName), new("Type", p => p.Direction == "IN" ? "Received" : "Refund"),
        new("Methods", p => p.Methods), new("Amount", p => p.Amount), new("Applied to", p => p.AppliedTo), new("Voided", p => p.IsVoided ? "Yes: " + p.VoidReason : ""),
        new("By", p => p.CreatedByName),
    };
}

/// <summary>Receive a payment (optionally split across methods). Also used to finalise a draft or generate an invoice from an order.</summary>
public sealed partial class ReceivePaymentDialogViewModel : DialogViewModel
{
    private readonly long? _customerId;

    public ReceivePaymentDialogViewModel(long? customerId, string? docType, long? docId)
    {
        _customerId = customerId; DocType = docType; DocId = docId;
        DialogTitle = "Receive payment";
    }

    public string? DocType { get; }
    public long? DocId { get; }
    public long? FinalizeInvoiceId { get; init; }
    public long? ConvertSalesOrderId { get; init; }
    public decimal DefaultAmount { get; init; }
    public override double DialogWidth => 620;
    public override string AcceptText => FinalizeInvoiceId.HasValue ? "Finalise invoice" : ConvertSalesOrderId.HasValue ? "Generate invoice" : "Save payment";
    public bool IsDocumentAction => FinalizeInvoiceId.HasValue || ConvertSalesOrderId.HasValue;

    public ObservableCollection<PaymentMethod> Methods { get; } = new();
    public ObservableCollection<PaymentEntry> Entries { get; } = new();
    public ObservableCollection<Customer> Customers { get; } = new();
    public ObservableCollection<InvoiceListItem> OpenInvoices { get; } = new();

    [ObservableProperty] private Customer? _customer;
    [ObservableProperty] private string? _customerSearch;
    [ObservableProperty] private string? _notes;
    [ObservableProperty] private DateTime _date = DateTime.Today;
    [ObservableProperty] private decimal _total;
    [ObservableProperty] private string? _targetText;
    [ObservableProperty] private decimal _outstanding;

    public bool CanPickCustomer => _customerId is null;
    public bool PrintReceipt { get; set; } = true;

    public override async Task InitAsync()
    {
        foreach (var m in (await App.Settings.PaymentMethodsAsync(true)).Where(m => m.IsMoney)) Methods.Add(m);
        if (_customerId is { } cid) await SelectCustomerAsync(await App.Customers.GetAsync(cid));
        if (FinalizeInvoiceId.HasValue) { DialogTitle = "Finalise invoice"; TargetText = "The draft gets its invoice number and stock is removed. Enter any payment received now (leave empty for a credit sale)."; }
        else if (ConvertSalesOrderId.HasValue) { DialogTitle = "Generate invoice from order"; TargetText = "The advance already received is applied automatically. Enter any balance collected now."; }
        else if (DocType == Core.Domain.DocType.SalesOrder) TargetText = "Advance against the sales order.";
        else if (DocType == Core.Domain.DocType.CustomOrder) TargetText = "Advance against the custom order.";
        else if (DocType == Core.Domain.DocType.Invoice) TargetText = "Payment against this invoice. Anything extra is held as advance.";
        else TargetText = "Applied to the oldest outstanding invoices first; anything extra is held as advance.";
        var first = Methods.FirstOrDefault(m => m.Code == PaymentMethodCode.Cash) ?? Methods.FirstOrDefault();
        if (first is not null && !IsDocumentAction) Entries.Add(new PaymentEntry(first.Code, first.Name, DefaultAmount > 0 ? DefaultAmount : Outstanding, Recalc));
        Recalc();
    }

    partial void OnCustomerSearchChanged(string? value) => _ = SearchAsync(value);

    private async Task SearchAsync(string? text)
    {
        try
        {
            var list = await App.Customers.SearchAsync(text, 12);
            Customers.Clear();
            foreach (var c in list.Where(c => !c.IsWalkIn)) Customers.Add(c);
        }
        catch (Exception ex) { HandleError(ex); }
    }

    [RelayCommand]
    private Task PickCustomerAsync(Customer? c) => c is null ? Task.CompletedTask : RunAsync(() => SelectCustomerAsync(c));

    private async Task SelectCustomerAsync(Customer c)
    {
        Customer = c;
        var summary = c.IsWalkIn ? null : await App.Customers.SummaryAsync(c.Id);
        Outstanding = summary?.Outstanding ?? 0;
        OpenInvoices.Clear();
        if (!c.IsWalkIn)
            foreach (var i in (await App.Invoices.ListAsync(new ListQuery { CustomerId = c.Id, PageSize = 20, SortBy = "date", SortDescending = false }, "OUTSTANDING")).Items)
                OpenInvoices.Add(i);
    }

    [RelayCommand]
    private void AddMethod(PaymentMethod? m)
    {
        if (m is null) return;
        Entries.Add(new PaymentEntry(m.Code, m.Name, 0, Recalc));
        Recalc();
    }

    [RelayCommand]
    private void RemoveEntry(PaymentEntry? e)
    {
        if (e is null) return;
        Entries.Remove(e);
        Recalc();
    }

    private void Recalc() => Total = Entries.Sum(e => e.Amount);

    protected override async Task OnAcceptAsync()
    {
        var lines = Entries.Where(e => e.Amount > 0).Select(e => new PaymentLineInput { MethodCode = e.MethodCode, Amount = Money.R2(e.Amount), Reference = e.Reference }).ToList();
        if (FinalizeInvoiceId is { } inv)
        {
            var r = await App.Invoices.FinalizeAsync(inv, lines);
            Shell.Toast.Success($"Invoice {r.InvoiceNumber} finalised.");
            return;
        }
        if (ConvertSalesOrderId is { } so)
        {
            var r = await App.SalesOrders.ConvertToInvoiceAsync(so, lines);
            Shell.Toast.Success($"Invoice {r.InvoiceNumber} generated.", () => Shell.Navigate(Routes.Invoice, r.InvoiceId));
            return;
        }
        if (Customer is null) throw new Core.ValidationException("CustomerId", "Select the customer.");
        if (lines.Count == 0) throw new Core.ValidationException("Payments", "Enter the amount received.");
        var (id, number) = await App.Payments.ReceiveAsync(new PaymentInput
        {
            CustomerId = Customer.Id, Date = Date, Lines = lines, Notes = Notes, DocType = DocType, DocId = DocId,
        });
        Shell.Toast.Success($"Payment {number} recorded.", () => _ = Shell.ShowDialogAsync(new PaymentDetailDialogViewModel(id)));
        if (PrintReceipt) await DocumentActions.PrintReceiptAsync(id, preview: true);
    }
}

public sealed partial class PaymentDetailDialogViewModel(long paymentId) : DialogViewModel
{
    [ObservableProperty] private Payment? _payment;
    public override double DialogWidth => 600;
    public override bool ShowFooter => false;
    public bool CanVoid => Payment is { IsVoided: false } && Can(Perm.PaymentVoid);

    public override async Task InitAsync()
    {
        Payment = await App.Payments.GetAsync(paymentId);
        DialogTitle = $"{(Payment.Direction == PaymentDirection.In ? "Receipt" : "Refund")} {Payment.Number}";
        OnPropertyChanged(nameof(CanVoid));
    }

    [RelayCommand] private Task PrintAsync() => RunAsync(() => DocumentActions.PrintReceiptAsync(paymentId));
    [RelayCommand] private Task PreviewAsync() => RunAsync(() => DocumentActions.PrintReceiptAsync(paymentId, true));
    [RelayCommand] private Task PdfAsync() => RunAsync(async () => await DocumentActions.SavePdfAsync(await App.Documents.ReceiptPdfAsync(paymentId), $"{Payment!.Number} {Payment.CustomerName}"));

    [RelayCommand]
    private Task WhatsAppAsync() => RunAsync(async () =>
        await DocumentActions.WhatsAppAsync(await App.Documents.ReceiptMessageAsync(paymentId), async () => (await App.Documents.ReceiptPdfAsync(paymentId), Payment!.Number)));

    [RelayCommand]
    private async Task VoidAsync()
    {
        var reason = await Shell.AskReasonAsync("Void payment",
            $"Void {Payment!.Number} ({Money.Format(Payment.Amount)})? The amount is removed from the customer's paid total and the balances update. This is recorded in the activity log.",
            "Void payment");
        if (reason is null) return;
        if (await RunAsync(() => App.Payments.VoidAsync(paymentId, reason), "Payment voided.")) Close(true);
    }

    [RelayCommand] private void Done() => Close(false);
}

public sealed partial class RefundDialogViewModel : DialogViewModel
{
    private readonly long _customerId;
    private readonly string _docType;
    private readonly long? _docId;

    public RefundDialogViewModel(long customerId, string docType, long? docId, decimal max)
    {
        _customerId = customerId; _docType = docType; _docId = docId; Max = max; Amount = max;
        DialogTitle = "Refund to customer";
    }

    public decimal Max { get; }
    public override string AcceptText => "Record refund";
    public ObservableCollection<PaymentMethod> Methods { get; } = new();
    [ObservableProperty] private decimal _amount;
    [ObservableProperty] private PaymentMethod? _method;
    [ObservableProperty] private string? _reference;
    [ObservableProperty] private string? _notes;

    public override async Task InitAsync()
    {
        foreach (var m in (await App.Settings.PaymentMethodsAsync(true)).Where(m => m.IsMoney)) Methods.Add(m);
        Method = Methods.FirstOrDefault();
    }

    protected override async Task OnAcceptAsync()
    {
        var (_, number) = await App.Payments.RefundAsync(_customerId, Amount,
            new PaymentLineInput { MethodCode = Method?.Code ?? PaymentMethodCode.Cash, Reference = Reference }, Notes, _docType, _docId);
        Shell.Toast.Success($"Refund {number} recorded.");
    }
}

public sealed partial class WhatsAppDialogViewModel : DialogViewModel
{
    public WhatsAppDialogViewModel(string mobile, string message, bool hasAttachment)
    {
        DialogTitle = "Send on WhatsApp";
        _mobile = mobile; _message = message; HasAttachment = hasAttachment; _attachPdf = hasAttachment;
    }

    public bool HasAttachment { get; }
    public override string AcceptText => "Open WhatsApp";
    [ObservableProperty] private string _mobile;
    [ObservableProperty] private string _message;
    [ObservableProperty] private bool _attachPdf;

    protected override Task OnAcceptAsync()
    {
        if (!Core.Validation.Validators.IsValidMobile(Mobile)) throw new Core.ValidationException("Mobile", "Enter a valid 10-digit WhatsApp number.");
        if (string.IsNullOrWhiteSpace(Message)) throw new Core.ValidationException("Message", "The message is empty.");
        return Task.CompletedTask;
    }
}

// ============================================================================ Returns & exchanges
public sealed class ReturnListViewModel : ListPageViewModel<SalesReturn>
{
    public ReturnListViewModel()
    {
        Title = "Sales Returns";
        Subtitle = "Credit notes against invoices. Good items go back to stock; damaged / defective items go to damaged stock.";
    }

    public override bool ShowDateFilter => true;
    public override string SearchHint => "Return no, invoice no, customer…";
    public bool CanCreate => Can(Perm.ReturnManage);
    public IRelayCommand NewCommand => new RelayCommand(() => Shell.Navigate(Routes.ReturnNew));
    protected override Task<PagedResult<SalesReturn>> FetchAsync(ListQuery q) => App.Returns.ListAsync(q);
    protected override void OnOpen(SalesReturn item) => Shell.Navigate(Routes.Invoice, item.InvoiceId);

    protected override IReadOnlyList<ExportColumn<SalesReturn>> ExportColumns => new ExportColumn<SalesReturn>[]
    {
        new("Return", r => r.Number), new("Date", r => r.ReturnDate), new("Invoice", r => r.InvoiceNumber), new("Customer", r => r.CustomerName),
        new("Reason", r => r.Reason), new("Credit", r => r.CreditAmount), new("Refunded", r => r.RefundAmount), new("By", r => r.CreatedByName),
    };
}

public sealed partial class ReturnLineVm : ObservableObject
{
    public required DocumentLine Line { get; init; }
    public decimal Max => Line.ReturnableQty;
    [ObservableProperty] private decimal _quantity;
    [ObservableProperty] private string _condition = ItemCondition.Good;
    [ObservableProperty] private string _restockAction = Core.Domain.RestockAction.Restock;
    public decimal Credit => Line.Quantity == 0 ? 0 : Money.R2(Line.LineTotal * Quantity / Line.Quantity);
    public IReadOnlyList<string> Conditions => ItemCondition.All;
    public IReadOnlyList<string> Actions => Core.Domain.RestockAction.All;
    public Action? Changed { get; set; }
    partial void OnQuantityChanged(decimal value) { OnPropertyChanged(nameof(Credit)); Changed?.Invoke(); }
    partial void OnConditionChanged(string value) => RestockAction = Core.Domain.RestockAction.ForCondition(value);
}

/// <summary>Shared "pick an invoice and choose what comes back" part of returns and exchanges.</summary>
public abstract partial class InvoicePickerPageViewModel : PageViewModel
{
    public ObservableCollection<InvoiceListItem> InvoiceResults { get; } = new();
    public ObservableCollection<ReturnLineVm> ReturnLines { get; } = new();
    [ObservableProperty] private string? _invoiceSearch;
    [ObservableProperty] private Invoice? _invoice;
    [ObservableProperty] private decimal _creditTotal;

    protected async Task LoadInvoiceAsync(long id)
    {
        Invoice = await App.Invoices.GetAsync(id);
        if (Invoice.Status != InvoiceStatus.Final) throw new BusinessRuleException("Returns and exchanges need a finalised invoice.");
        ReturnLines.Clear();
        foreach (var l in Invoice.Lines.Where(l => l.ReturnableQty > 0))
            ReturnLines.Add(new ReturnLineVm { Line = l, Changed = () => { CreditTotal = ReturnLines.Sum(x => x.Credit); OnLinesChanged(); } });
        InvoiceResults.Clear();
        CreditTotal = 0;
        OnLinesChanged();
    }

    protected virtual void OnLinesChanged() { }

    partial void OnInvoiceSearchChanged(string? value) => _ = RunAsync(async () =>
    {
        InvoiceResults.Clear();
        if (string.IsNullOrWhiteSpace(value) || value.Trim().Length < 2) return;
        foreach (var i in (await App.Invoices.ListAsync(new ListQuery { Search = value, Status = InvoiceStatus.Final, PageSize = 10 })).Items) InvoiceResults.Add(i);
    }, showBusy: false);

    [RelayCommand] private Task PickInvoiceAsync(InvoiceListItem? i) => i is null ? Task.CompletedTask : RunAsync(() => LoadInvoiceAsync(i.Id));

    protected List<ReturnLineInput> ReturnInputs() => ReturnLines.Where(l => l.Quantity > 0)
        .Select(l => new ReturnLineInput { InvoiceItemId = l.Line.Id, Quantity = l.Quantity, Condition = l.Condition, RestockAction = l.RestockAction }).ToList();
}

public sealed partial class ReturnEditorViewModel(long? invoiceId) : InvoicePickerPageViewModel
{
    public ObservableCollection<PaymentMethod> Methods { get; } = new();
    public IReadOnlyList<Option> Reasons { get; } = ReturnReason.Selectable.Select(r => new Option(r, StatusStyle.Label(r))).ToList();
    [ObservableProperty] private Option? _reason;
    [ObservableProperty] private DateTime _date = DateTime.Today;
    [ObservableProperty] private decimal _refundAmount;
    [ObservableProperty] private decimal _refundable;
    [ObservableProperty] private PaymentMethod? _refundMethod;
    [ObservableProperty] private string? _refundReference;
    [ObservableProperty] private string? _notes;
    public bool CanRefund => Can(Perm.PaymentRefund);

    public override async Task LoadAsync()
    {
        Title = "New sales return";
        Subtitle = "Find the invoice, choose the items coming back and their condition.";
        Reason = Reasons[3];
        foreach (var m in (await App.Settings.PaymentMethodsAsync(true)).Where(m => m.IsMoney)) Methods.Add(m);
        RefundMethod = Methods.FirstOrDefault();
        if (invoiceId is { } id) await LoadInvoiceAsync(id);
    }

    protected override void OnLinesChanged()
    {
        if (Invoice is null) return;
        // Money the customer paid beyond the invoice value after this return can be refunded.
        Refundable = Math.Max(0, Invoice.Paid - (Invoice.NetTotal - CreditTotal));
        RefundAmount = Refundable;
    }

    [RelayCommand]
    private Task SaveAsync() => RunAsync(async () =>
    {
        if (Invoice is null) throw new Core.ValidationException("Invoice", "Select the invoice.");
        var r = await App.Returns.CreateAsync(new ReturnInput
        {
            InvoiceId = Invoice.Id, Date = Date, Reason = Reason?.Value ?? ReturnReason.Other, Lines = ReturnInputs(), RefundAmount = RefundAmount,
            RefundMethod = RefundMethod?.Code ?? PaymentMethodCode.Cash, RefundReference = RefundReference, Notes = Notes,
        });
        Shell.Toast.Success($"Return {r.Number} recorded — credit {Money.Format(r.Credit)}.");
        Shell.Navigate(Routes.Invoice, Invoice.Id, addToHistory: false);
    });
}

public sealed class ExchangeListViewModel : ListPageViewModel<Exchange>
{
    public ExchangeListViewModel()
    {
        Title = "Exchanges";
        Subtitle = "Old item returned against a new invoice; the customer pays only the difference.";
    }

    public override string SearchHint => "Exchange no, customer, invoice…";
    public bool CanCreate => Can(Perm.ReturnManage) && Can(Perm.InvoiceCreate);
    public IRelayCommand NewCommand => new RelayCommand(() => Shell.Navigate(Routes.ExchangeNew));
    protected override Task<PagedResult<Exchange>> FetchAsync(ListQuery q) => App.Returns.ListExchangesAsync(q);
    protected override void OnOpen(Exchange item) { if (item.NewInvoiceId is { } id) Shell.Navigate(Routes.Invoice, id); }

    protected override IReadOnlyList<ExportColumn<Exchange>> ExportColumns => new ExportColumn<Exchange>[]
    {
        new("Exchange", e => e.Number), new("Date", e => e.CreatedAt), new("Customer", e => e.CustomerName), new("Old invoice", e => e.OriginalInvoiceNumber),
        new("New invoice", e => e.NewInvoiceNumber), new("Returned value", e => e.OldValue), new("New value", e => e.NewValue),
        new("Adjusted", e => e.TransferredAmount), new("Difference paid", e => e.Difference),
    };
}

public sealed partial class ExchangeEditorViewModel(long? invoiceId) : InvoicePickerPageViewModel
{
    public ObservableCollection<SellableItem> ProductResults { get; } = new();
    public ObservableCollection<EditorLine> NewLines { get; } = new();
    public ObservableCollection<PaymentMethod> Methods { get; } = new();
    [ObservableProperty] private string? _productSearch;
    [ObservableProperty] private decimal _newTotal;
    [ObservableProperty] private ExchangePreview? _preview;
    [ObservableProperty] private PaymentMethod? _payMethod;
    [ObservableProperty] private string? _payReference;
    [ObservableProperty] private string? _notes;
    private Core.Settings.AppSettingsSnapshot _settings = new();

    public override async Task LoadAsync()
    {
        Title = "New exchange";
        Subtitle = "Return the old item and bill the new one in a single step.";
        _settings = await App.Settings.GetAsync();
        foreach (var m in (await App.Settings.PaymentMethodsAsync(true)).Where(m => m.IsMoney)) Methods.Add(m);
        PayMethod = Methods.FirstOrDefault();
        if (invoiceId is { } id) await LoadInvoiceAsync(id);
    }

    partial void OnProductSearchChanged(string? value) => _ = RunAsync(async () =>
    {
        ProductResults.Clear();
        if (string.IsNullOrWhiteSpace(value)) return;
        foreach (var p in await App.Catalog.SearchSellableAsync(value, null, 10)) ProductResults.Add(p);
    }, showBusy: false);

    [RelayCommand]
    private void AddProduct(SellableItem? item)
    {
        if (item is null) return;
        var line = new EditorLine(Recalc) { VariantId = item.VariantId, Sku = item.Sku, HsnCode = item.HsnCode, Available = item.Available, IsStockItem = item.IsStockItem, ListPrice = item.SellingPrice };
        line.Description = item.DisplayName; line.UnitPrice = item.SellingPrice; line.GstRate = item.GstRate; line.PriceIncludesGst = item.PriceIncludesGst;
        NewLines.Add(line);
        ProductSearch = null;
        Recalc();
    }

    [RelayCommand] private void RemoveNewLine(EditorLine? l) { if (l is not null) { NewLines.Remove(l); Recalc(); } }

    protected override void OnLinesChanged() => Recalc();

    private void Recalc()
    {
        var inter = Core.Tax.GstCalculator.IsInterState(_settings.Shop.StateCode, Invoice?.PlaceOfSupply);
        try
        {
            NewTotal = NewLines.Count == 0 ? 0 : Core.Tax.GstCalculator.ComputeDocument(NewLines.Select(l => l.ToTaxInput()), inter,
                new Core.Tax.DocumentChargesInput(0, 0, _settings.Tax.ChargesGstRate), _settings.Invoice.RoundOff).GrandTotal;
        }
        catch (ArgumentOutOfRangeException) { }
        if (Invoice is null) return;
        _ = RunAsync(async () => Preview = await App.Returns.PreviewExchangeAsync(new ExchangeInput { OriginalInvoiceId = Invoice.Id, ReturnLines = ReturnInputs() }, NewTotal), showBusy: false);
    }

    [RelayCommand]
    private Task SaveAsync() => RunAsync(async () =>
    {
        if (Invoice is null) throw new Core.ValidationException("Invoice", "Select the original invoice.");
        if (NewLines.Count == 0) throw new Core.ValidationException("Lines", "Add the new item(s).");
        var diff = Preview?.Difference ?? NewTotal;
        var input = new ExchangeInput
        {
            OriginalInvoiceId = Invoice.Id, ReturnLines = ReturnInputs(), Notes = Notes,
            NewInvoice = new SalesDocumentInput { Date = DateTime.Today, Lines = NewLines.Select(l => l.ToInput()).ToList(), PlaceOfSupply = Invoice.PlaceOfSupply },
        };
        if (diff > 0) input.Payments.Add(new PaymentLineInput { MethodCode = PayMethod?.Code ?? PaymentMethodCode.Cash, Amount = diff, Reference = PayReference });
        var ex = await App.Returns.ExchangeAsync(input);
        Shell.Toast.Success($"Exchange {ex.Number} done. New invoice {ex.NewInvoiceNumber}; difference {Money.Format(ex.Difference)}.");
        if (ex.NewInvoiceId is { } nid) Shell.Navigate(Routes.Invoice, nid, addToHistory: false);
    });
}
