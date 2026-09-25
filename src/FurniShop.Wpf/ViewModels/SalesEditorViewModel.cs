using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Core.Settings;
using FurniShop.Core.Tax;
using FurniShop.Core.Validation;
using FurniShop.Wpf.Services;

namespace FurniShop.Wpf.ViewModels;

/// <summary>One editable line in the POS / quotation / order editor.</summary>
public sealed partial class EditorLine : ObservableObject
{
    private readonly Action _changed;

    public EditorLine(Action changed) => _changed = changed;

    public long? VariantId { get; init; }
    public string? Sku { get; init; }
    public string? HsnCode { get; set; }
    public decimal ListPrice { get; init; }
    public decimal AllowedDiscount { get; init; }
    public decimal Available { get; set; }
    public bool IsStockItem { get; init; }
    public long? SourceItemId { get; init; }
    public decimal? UnitCost { get; init; }

    [ObservableProperty] private string _description = "";
    [ObservableProperty] private decimal _quantity = 1;
    [ObservableProperty] private decimal _unitPrice;
    [ObservableProperty] private decimal _discountPercent;
    [ObservableProperty] private decimal _discountAmount;
    [ObservableProperty] private decimal _gstRate;
    [ObservableProperty] private bool _priceIncludesGst = true;
    [ObservableProperty] private decimal _lineTotal;
    [ObservableProperty] private decimal _taxable;
    [ObservableProperty] private string? _lineError;

    public bool StockWarning => VariantId.HasValue && IsStockItem && Quantity > Available;
    public string StockText => !VariantId.HasValue ? "Custom item" : !IsStockItem ? "Made to order" : $"{Money.Qty(Available)} available";

    partial void OnQuantityChanged(decimal value) => Recalc();
    partial void OnUnitPriceChanged(decimal value) => Recalc();
    partial void OnDiscountPercentChanged(decimal value) => Recalc();
    partial void OnDiscountAmountChanged(decimal value) => Recalc();
    partial void OnGstRateChanged(decimal value) => Recalc();
    partial void OnPriceIncludesGstChanged(bool value) => Recalc();

    public TaxLineInput ToTaxInput() => new(Quantity, UnitPrice, PriceIncludesGst, GstRate, DiscountPercent, DiscountAmount);

    public void Recalc(bool interState = false)
    {
        try
        {
            var r = GstCalculator.ComputeLine(ToTaxInput(), interState);
            LineTotal = r.Total; Taxable = r.Taxable; LineError = null;
        }
        catch (ArgumentOutOfRangeException ex)
        {
            LineError = ex.Message.Split(" (Parameter")[0];
        }
        OnPropertyChanged(nameof(StockWarning));
        _changed();
    }

    public LineInput ToInput() => new()
    {
        VariantId = VariantId, Description = Description, Sku = Sku, HsnCode = HsnCode, Quantity = Quantity, UnitPrice = UnitPrice,
        PriceIncludesGst = PriceIncludesGst, GstRate = GstRate, DiscountPercent = DiscountPercent, DiscountAmount = DiscountAmount, SourceItemId = SourceItemId,
    };
}

public sealed partial class PaymentEntry : ObservableObject
{
    private readonly Action _changed;

    public PaymentEntry(string method, string label, decimal amount, Action changed)
    {
        MethodCode = method; MethodLabel = label; _amount = amount; _changed = changed;
    }

    public string MethodCode { get; }
    public string MethodLabel { get; }
    public bool NeedsReference => MethodCode is not PaymentMethodCode.Cash;
    [ObservableProperty] private decimal _amount;
    [ObservableProperty] private string? _reference;
    partial void OnAmountChanged(decimal value) => _changed();
}

/// <summary>
/// POS-style editor used for invoices (counter billing), quotations and sales orders.
/// Left: product search / barcode / categories. Centre: items. Right: customer, totals, payment.
/// Totals are previewed with the same GST calculator the server uses; the server recalculates and validates on save.
/// </summary>
public sealed partial class SalesEditorViewModel : PageViewModel
{
    private AppSettingsSnapshot _settings = new();
    private CancellationTokenSource? _productCts, _customerCts;

    public SalesEditorViewModel(EditorArgs args)
    {
        Args = args;
        Title = args.Mode switch
        {
            EditorMode.Quotation => args.Id.HasValue ? "Edit quotation" : "New quotation",
            EditorMode.SalesOrder => args.Id.HasValue ? "Edit sales order" : "New sales order",
            _ => args.Id.HasValue ? "Edit draft invoice" : "New invoice",
        };
        Lines.CollectionChanged += (_, _) => Recalculate();
    }

    public EditorArgs Args { get; }
    public bool IsInvoice => Args.Mode == EditorMode.Invoice;
    public bool IsQuotation => Args.Mode == EditorMode.Quotation;
    public bool IsSalesOrder => Args.Mode == EditorMode.SalesOrder;
    public bool ShowPayments => IsInvoice && Can(Perm.PaymentReceive);

    public ObservableCollection<SellableItem> Products { get; } = new();
    public ObservableCollection<Category> Categories { get; } = new();
    public ObservableCollection<EditorLine> Lines { get; } = new();
    public ObservableCollection<Customer> CustomerResults { get; } = new();
    public ObservableCollection<PaymentEntry> PaymentEntries { get; } = new();
    public ObservableCollection<PaymentMethod> PaymentMethods { get; } = new();
    public ObservableCollection<decimal> GstRates { get; } = new();
    public IReadOnlyList<IndianState> States => IndianStates.All;

    [ObservableProperty] private string? _productSearch;
    [ObservableProperty] private string? _scanCode;
    [ObservableProperty] private Category? _selectedCategory;
    [ObservableProperty] private Customer? _customer;
    [ObservableProperty] private string? _customerSearch;
    [ObservableProperty] private bool _isCustomerSearchOpen;
    [ObservableProperty] private CustomerSummary? _customerSummary;
    [ObservableProperty] private IndianState? _placeOfSupply;
    [ObservableProperty] private decimal _deliveryCharge;
    [ObservableProperty] private decimal _installationCharge;
    [ObservableProperty] private bool _requiresDelivery;
    [ObservableProperty] private bool _requiresInstallation;
    [ObservableProperty] private string? _deliveryAddress;
    [ObservableProperty] private string? _notes;
    [ObservableProperty] private DateTime _documentDate = DateTime.Today;
    [ObservableProperty] private DateTime? _dueDate;
    [ObservableProperty] private DateTime? _validUntil;
    [ObservableProperty] private DateTime? _expectedDeliveryDate;
    [ObservableProperty] private bool _useAdvance;
    [ObservableProperty] private bool _isCredit;

    [ObservableProperty] private DocumentTotals? _totals;
    [ObservableProperty] private string? _totalsError;
    [ObservableProperty] private decimal _paidNow;
    [ObservableProperty] private decimal _advanceApplied;
    [ObservableProperty] private decimal _balance;
    [ObservableProperty] private decimal _change;
    [ObservableProperty] private bool _isInterState;

    public bool HasLines => Lines.Count > 0;
    public decimal GrandTotal => Totals?.GrandTotal ?? 0;
    public decimal AdvanceAvailable => CustomerSummary?.AdvanceAmount is > 0 and var a && !(Customer?.IsWalkIn ?? true) ? a : 0;
    public string CustomerLine => Customer is null ? "No customer selected" : Customer.IsWalkIn ? "Walk-in (cash counter)" : $"{Customer.Mobile} · {Customer.City}";

    public override async Task LoadAsync()
    {
        _settings = await App.Settings.GetAsync(true);
        Categories.Clear();
        Categories.Add(new Category { Id = 0, Name = "All" });
        foreach (var c in await App.Catalog.CategoriesAsync(true)) Categories.Add(c);
        SelectedCategory = Categories[0];
        PaymentMethods.Clear();
        foreach (var m in (await App.Settings.PaymentMethodsAsync(true))) PaymentMethods.Add(m);
        GstRates.Clear();
        foreach (var r in await App.Settings.GstRatesAsync(true)) GstRates.Add(r.Rate);

        if (Args.Id is { } id) await LoadExistingAsync(id);
        else
        {
            if (Args.CustomerId is { } cid) await SetCustomerAsync(await App.Customers.GetAsync(cid));
            else if (IsInvoice) await SetCustomerAsync(await App.Customers.WalkInAsync());
            ValidUntil = DateTime.Today.AddDays(_settings.Invoice.QuotationValidityDays);
            RequiresDelivery = IsSalesOrder;
        }
        await SearchProductsAsync();
        Recalculate();
    }

    private async Task LoadExistingAsync(long id)
    {
        SalesDocument doc = Args.Mode switch
        {
            EditorMode.Quotation => await App.Quotations.GetAsync(id),
            EditorMode.SalesOrder => await App.SalesOrders.GetAsync(id),
            _ => await App.Invoices.GetAsync(id),
        };
        await SetCustomerAsync(await App.Customers.GetAsync(doc.CustomerId));
        PlaceOfSupply = IndianStates.ByCode(doc.PlaceOfSupply);
        DocumentDate = doc.Date;
        DeliveryCharge = doc.DeliveryCharge;
        InstallationCharge = doc.InstallationCharge;
        Notes = doc.Notes;
        switch (doc)
        {
            case Quotation q: ValidUntil = q.ValidUntil; break;
            case SalesOrder so:
                ExpectedDeliveryDate = so.ExpectedDeliveryDate; RequiresDelivery = so.RequiresDelivery; RequiresInstallation = so.RequiresInstallation;
                DeliveryAddress = so.DeliveryAddress; break;
            case Invoice inv:
                DueDate = inv.DueDate; RequiresDelivery = inv.RequiresDelivery; RequiresInstallation = inv.RequiresInstallation; DeliveryAddress = inv.DeliveryAddress; break;
        }
        foreach (var l in doc.Lines)
        {
            var item = l.VariantId.HasValue ? await App.Catalog.GetSellableAsync(l.VariantId.Value) : null;
            var line = new EditorLine(Recalculate)
            {
                VariantId = l.VariantId, Sku = l.Sku, HsnCode = l.HsnCode, ListPrice = item?.SellingPrice ?? l.UnitPrice, AllowedDiscount = item?.DiscountPercent ?? 0,
                Available = item?.Available ?? 0, IsStockItem = item?.IsStockItem ?? false, SourceItemId = l.SourceItemId,
            };
            line.Description = l.Description; line.Quantity = l.Quantity; line.UnitPrice = l.UnitPrice; line.DiscountPercent = l.DiscountPercent;
            line.DiscountAmount = l.DiscountAmount; line.GstRate = l.GstRate; line.PriceIncludesGst = l.PriceIncludesGst;
            Lines.Add(line);
        }
    }

    // ---------------------------------------------------------------- products
    partial void OnProductSearchChanged(string? value) => DebounceProducts();
    partial void OnSelectedCategoryChanged(Category? value) => DebounceProducts();

    private void DebounceProducts()
    {
        _productCts?.Cancel();
        _productCts = new CancellationTokenSource();
        var t = _productCts.Token;
        _ = Task.Delay(250, t).ContinueWith(async _ => { if (!t.IsCancellationRequested) await RunAsync(SearchProductsAsync, showBusy: false); },
            t, TaskContinuationOptions.OnlyOnRanToCompletion, TaskScheduler.FromCurrentSynchronizationContext());
    }

    private async Task SearchProductsAsync()
    {
        var list = await App.Catalog.SearchSellableAsync(ProductSearch, SelectedCategory?.Id is > 0 ? SelectedCategory.Id : null, 80);
        Products.Clear();
        foreach (var p in list) Products.Add(p);
    }

    /// <summary>Barcode scanners type the code followed by Enter.</summary>
    [RelayCommand]
    private Task ScanAsync() => RunAsync(async () =>
    {
        var code = ScanCode?.Trim();
        if (string.IsNullOrEmpty(code)) return;
        var item = await App.Catalog.FindByCodeAsync(code);
        ScanCode = null;
        if (item is null) { Shell.Toast.Warning($"No product with barcode / SKU '{code}'."); return; }
        AddItem(item);
    }, showBusy: false);

    [RelayCommand]
    private void AddItem(SellableItem? item)
    {
        if (item is null) return;
        var existing = Lines.FirstOrDefault(l => l.VariantId == item.VariantId && l.SourceItemId is null);
        if (existing is not null) { existing.Quantity += 1; Warn(existing); return; }
        var line = new EditorLine(Recalculate)
        {
            VariantId = item.VariantId, Sku = item.Sku, HsnCode = item.HsnCode, ListPrice = item.SellingPrice, AllowedDiscount = item.DiscountPercent,
            Available = item.Available, IsStockItem = item.IsStockItem, UnitCost = item.CostPrice,
        };
        line.Description = item.DisplayName;
        line.UnitPrice = item.SellingPrice;
        line.PriceIncludesGst = item.PriceIncludesGst;
        line.GstRate = _settings.Tax.GstRegistered ? item.GstRate : 0;
        line.DiscountPercent = item.DiscountPercent;
        Lines.Add(line);
        Warn(line);
        OnPropertyChanged(nameof(HasLines));
    }

    private void Warn(EditorLine line)
    {
        if (line.StockWarning && IsInvoice)
            Shell.Toast.Warning($"Only {Money.Qty(line.Available)} of {line.Description} available. Consider a sales order to reserve / procure.");
    }

    [RelayCommand]
    private void AddCustomLine()
    {
        var line = new EditorLine(Recalculate) { HsnCode = _settings.Tax.DefaultHsn };
        line.Description = "Custom item / service";
        line.GstRate = _settings.Tax.GstRegistered ? _settings.Tax.DefaultGstRate : 0;
        line.PriceIncludesGst = _settings.Tax.DefaultPriceIncludesGst;
        Lines.Add(line);
        OnPropertyChanged(nameof(HasLines));
    }

    [RelayCommand]
    private void RemoveLine(EditorLine? line)
    {
        if (line is null) return;
        Lines.Remove(line);
        OnPropertyChanged(nameof(HasLines));
    }

    [RelayCommand]
    private void IncreaseQty(EditorLine? line) { if (line is not null) line.Quantity += 1; }

    [RelayCommand]
    private void DecreaseQty(EditorLine? line) { if (line is not null && line.Quantity > 1) line.Quantity -= 1; }

    // ---------------------------------------------------------------- customer
    partial void OnCustomerSearchChanged(string? value)
    {
        _customerCts?.Cancel();
        _customerCts = new CancellationTokenSource();
        var t = _customerCts.Token;
        _ = Task.Delay(250, t).ContinueWith(async _ =>
        {
            if (t.IsCancellationRequested) return;
            if (string.IsNullOrWhiteSpace(value)) { IsCustomerSearchOpen = false; return; }
            await RunAsync(async () =>
            {
                var list = await App.Customers.SearchAsync(value);
                CustomerResults.Clear();
                foreach (var c in list) CustomerResults.Add(c);
                IsCustomerSearchOpen = true;
            }, showBusy: false);
        }, t, TaskContinuationOptions.OnlyOnRanToCompletion, TaskScheduler.FromCurrentSynchronizationContext());
    }

    [RelayCommand]
    private Task PickCustomerAsync(Customer? c) => RunAsync(async () =>
    {
        if (c is null) return;
        IsCustomerSearchOpen = false;
        CustomerSearch = null;
        await SetCustomerAsync(await App.Customers.GetAsync(c.Id));
    }, showBusy: false);

    [RelayCommand]
    private async Task NewCustomerAsync()
    {
        var d = new CustomerEditDialogViewModel(null, CustomerSearch);
        if (await Shell.ShowDialogAsync(d) && d.SavedId is { } id)
        {
            CustomerSearch = null;
            IsCustomerSearchOpen = false;
            await RunAsync(async () => await SetCustomerAsync(await App.Customers.GetAsync(id)));
        }
    }

    [RelayCommand]
    private Task UseWalkInAsync() => RunAsync(async () => await SetCustomerAsync(await App.Customers.WalkInAsync()), showBusy: false);

    private async Task SetCustomerAsync(Customer c)
    {
        Customer = c;
        CustomerSummary = c.IsWalkIn ? null : await App.Customers.SummaryAsync(c.Id);
        PlaceOfSupply = IndianStates.ByCode(c.StateCode) ?? IndianStates.ByCode(_settings.Shop.StateCode);
        var addr = c.Addresses.FirstOrDefault(a => a.IsDefault) ?? c.Addresses.FirstOrDefault();
        DeliveryAddress = addr?.FullText ?? Infrastructure.Services.InvoiceService.FullAddress(c);
        OnPropertyChanged(nameof(CustomerLine));
        OnPropertyChanged(nameof(AdvanceAvailable));
        if (c.IsWalkIn) UseAdvance = false;
        Recalculate();
    }

    partial void OnPlaceOfSupplyChanged(IndianState? value) => Recalculate();
    partial void OnDeliveryChargeChanged(decimal value) => Recalculate();
    partial void OnInstallationChargeChanged(decimal value) => Recalculate();
    partial void OnUseAdvanceChanged(bool value) => Recalculate();

    partial void OnRequiresDeliveryChanged(bool value)
    {
        if (value && DeliveryCharge == 0) DeliveryCharge = _settings.Delivery.DefaultDeliveryCharge;
        if (!value) { DeliveryCharge = 0; RequiresInstallation = false; }
    }

    partial void OnRequiresInstallationChanged(bool value)
    {
        if (value && InstallationCharge == 0) InstallationCharge = _settings.Delivery.DefaultInstallationCharge;
        if (!value) InstallationCharge = 0;
    }

    // ---------------------------------------------------------------- payments
    [RelayCommand]
    private void AddPayment(PaymentMethod? m)
    {
        if (m is null) return;
        if (m.Code == PaymentMethodCode.Credit)
        {
            PaymentEntries.Clear();
            IsCredit = true;
            Recalculate();
            return;
        }
        IsCredit = false;
        var due = Math.Max(0, GrandTotal - AdvanceApplied - PaymentEntries.Sum(p => p.Amount));
        var existing = PaymentEntries.FirstOrDefault(p => p.MethodCode == m.Code);
        if (existing is not null) { existing.Amount += due; return; }
        PaymentEntries.Add(new PaymentEntry(m.Code, m.Name, due, Recalculate));
        Recalculate();
    }

    [RelayCommand]
    private void RemovePayment(PaymentEntry? p)
    {
        if (p is null) return;
        PaymentEntries.Remove(p);
        Recalculate();
    }

    // ---------------------------------------------------------------- totals
    private void Recalculate()
    {
        IsInterState = GstCalculator.IsInterState(_settings.Shop.StateCode, PlaceOfSupply?.Code);
        foreach (var l in Lines)
        {
            try { var r = GstCalculator.ComputeLine(l.ToTaxInput(), IsInterState); l.LineTotal = r.Total; l.Taxable = r.Taxable; }
            catch (ArgumentOutOfRangeException) { /* shown on the line */ }
        }
        try
        {
            Totals = GstCalculator.ComputeDocument(Lines.Where(l => l.LineError is null).Select(l => l.ToTaxInput()), IsInterState,
                new DocumentChargesInput(Math.Max(0, DeliveryCharge), Math.Max(0, InstallationCharge), _settings.Tax.GstRegistered ? _settings.Tax.ChargesGstRate : 0),
                _settings.Invoice.RoundOff);
            TotalsError = null;
        }
        catch (ArgumentOutOfRangeException ex) { TotalsError = ex.Message.Split(" (Parameter")[0]; }
        var grand = Totals?.GrandTotal ?? 0;
        AdvanceApplied = UseAdvance ? Math.Min(AdvanceAvailable, grand) : 0;
        var paid = PaymentEntries.Sum(p => p.Amount);
        var due = Math.Max(0, grand - AdvanceApplied);
        PaidNow = paid;
        Change = Math.Max(0, paid - due);
        Balance = Math.Max(0, due - paid);
        OnPropertyChanged(nameof(GrandTotal));
        OnPropertyChanged(nameof(HasLines));
    }

    private SalesDocumentInput BuildInput() => new()
    {
        Id = IsInvoice ? Args.Id ?? 0 : Args.Id ?? 0,
        CustomerId = Customer?.Id ?? throw new ValidationException("CustomerId", "Select a customer."),
        Date = DocumentDate, Lines = Lines.Select(l => l.ToInput()).ToList(), DeliveryCharge = DeliveryCharge, InstallationCharge = InstallationCharge,
        DeliveryAddress = DeliveryAddress, PlaceOfSupply = PlaceOfSupply?.Code, Notes = Notes, ValidUntil = ValidUntil, DueDate = DueDate,
        ExpectedDeliveryDate = ExpectedDeliveryDate, RequiresDelivery = RequiresDelivery, RequiresInstallation = RequiresInstallation,
    };

    /// <summary>Money actually recorded: cash tendered above the amount due is change, not a payment.</summary>
    private List<PaymentLineInput> BuildPayments()
    {
        var due = Math.Max(0, GrandTotal - AdvanceApplied);
        var list = PaymentEntries.Where(p => p.Amount > 0)
            .Select(p => new PaymentLineInput { MethodCode = p.MethodCode, Amount = Money.R2(p.Amount), Reference = p.Reference }).ToList();
        var excess = list.Sum(p => p.Amount) - due;
        foreach (var cash in list.Where(p => p.MethodCode == PaymentMethodCode.Cash))
        {
            if (excess <= 0) break;
            var cut = Math.Min(cash.Amount, excess);
            cash.Amount -= cut;
            excess -= cut;
        }
        return list.Where(p => p.Amount > 0).ToList();
    }

    // ---------------------------------------------------------------- save actions
    [RelayCommand] private Task SaveDraftAsync() => SaveAsync("draft");
    [RelayCommand] private Task SavePrintAsync() => SaveAsync("print");
    [RelayCommand] private Task SavePdfAsync() => SaveAsync("pdf");
    [RelayCommand] private Task SaveWhatsAppAsync() => SaveAsync("whatsapp");
    [RelayCommand] private Task SaveOnlyAsync() => SaveAsync("save");

    private Task SaveAsync(string action) => RunAsync(async () =>
    {
        if (Lines.Count == 0) throw new ValidationException("Lines", "Add at least one item.");
        if (Lines.FirstOrDefault(l => l.LineError is not null) is { } bad) throw new ValidationException("Lines", $"{bad.Description}: {bad.LineError}");
        var input = BuildInput();
        switch (Args.Mode)
        {
            case EditorMode.Quotation:
            {
                var id = await App.Quotations.SaveAsync(input);
                Shell.Toast.Success("Quotation saved.");
                await AfterSaveAsync(action, () => DocumentActions.PrintQuotationAsync(id),
                    async () => { var q = await App.Quotations.GetAsync(id); await DocumentActions.SavePdfAsync(await App.Documents.QuotationPdfAsync(id), $"{q.Number} {q.CustomerName}"); },
                    async () => { var q = await App.Quotations.GetAsync(id); await DocumentActions.WhatsAppAsync(await App.Documents.QuotationMessageAsync(id), async () => (await App.Documents.QuotationPdfAsync(id), $"{q.Number} {q.CustomerName}")); });
                Shell.Navigate(Routes.Quotation, id, addToHistory: false);
                break;
            }
            case EditorMode.SalesOrder:
            {
                var isNew = input.Id == 0;
                var id = await App.SalesOrders.SaveAsync(input);
                if (isNew)
                {
                    var r = await App.SalesOrders.ConfirmAsync(id);
                    if (!r.FullyReserved) Shell.Toast.Warning("Not enough stock to reserve: " + string.Join(", ", r.Shortages) + ". Purchase or manufacture these items.");
                }
                Shell.Toast.Success("Sales order saved.");
                await AfterSaveAsync(action, () => DocumentActions.PrintSalesOrderAsync(id),
                    async () => { var so = await App.SalesOrders.GetAsync(id); await DocumentActions.SavePdfAsync(await App.Documents.SalesOrderPdfAsync(id), $"{so.Number} {so.CustomerName}"); },
                    async () => { var so = await App.SalesOrders.GetAsync(id); await DocumentActions.WhatsAppAsync(await App.Documents.OrderConfirmationMessageAsync(id), async () => (await App.Documents.SalesOrderPdfAsync(id), $"{so.Number} {so.CustomerName}")); });
                Shell.Navigate(Routes.SalesOrder, id, addToHistory: false);
                break;
            }
            default:
            {
                if (action == "draft")
                {
                    var draft = await App.Invoices.SaveDraftAsync(input);
                    Shell.Toast.Success("Draft saved. It has no invoice number and does not change stock until finalised.",
                        () => Shell.Navigate(Routes.Invoice, draft));
                    Reset();
                    return;
                }
                if (Balance > 0 && Customer?.IsWalkIn == true)
                    throw new BusinessRuleException("Credit / partial payment needs a customer. Select or add the customer first.");
                if (Balance > 0 && !IsCredit && PaymentEntries.Count > 0 &&
                    !await Shell.ConfirmAsync("Balance pending", $"{Money.Format(Balance)} will remain outstanding on this invoice. Continue?", "Save with balance"))
                    return;
                if (PaymentEntries.Count == 0 && !IsCredit && Balance > 0 &&
                    !await Shell.ConfirmAsync("No payment entered", $"Save as a credit sale? The full {Money.Format(Balance)} will be outstanding.", "Credit sale"))
                    return;
                var change = Change;
                var result = await App.Invoices.CheckoutAsync(input, BuildPayments(), AdvanceApplied);
                Shell.Toast.Success($"Invoice {result.InvoiceNumber} saved{(change > 0 ? $" — give change {Money.Format(change)}" : "")}.",
                    () => Shell.Navigate(Routes.Invoice, result.InvoiceId));
                await AfterSaveAsync(action, () => DocumentActions.PrintInvoiceAsync(result.InvoiceId),
                    () => DocumentActions.InvoicePdfAsync(result.InvoiceId),
                    async () => await DocumentActions.WhatsAppAsync(await App.Documents.InvoiceMessageAsync(result.InvoiceId),
                        async () => (await App.Documents.InvoicePdfAsync(result.InvoiceId), $"{result.InvoiceNumber}")));
                if (Args.Id.HasValue) Shell.Navigate(Routes.Invoice, result.InvoiceId, addToHistory: false);
                else Reset();
                break;
            }
        }
    });

    private static async Task AfterSaveAsync(string action, Func<Task> print, Func<Task> pdf, Func<Task> whatsapp)
    {
        switch (action)
        {
            case "print": await print(); break;
            case "pdf": await pdf(); break;
            case "whatsapp": await whatsapp(); break;
        }
    }

    [RelayCommand]
    private async Task ClearAsync()
    {
        if (Lines.Count > 0 && !await Shell.ConfirmAsync("Clear bill", "Remove all items and start again?", "Clear", true)) return;
        Reset();
    }

    private void Reset()
    {
        Lines.Clear();
        PaymentEntries.Clear();
        IsCredit = false;
        UseAdvance = false;
        Notes = null;
        RequiresDelivery = false;
        RequiresInstallation = false;
        DeliveryCharge = 0;
        InstallationCharge = 0;
        DueDate = null;
        _ = RunAsync(async () =>
        {
            await SetCustomerAsync(await App.Customers.WalkInAsync());
            await SearchProductsAsync();
        }, showBusy: false);
        Recalculate();
    }
}
