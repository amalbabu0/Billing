using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Infrastructure.Services;
using FurniShop.Wpf.Services;

namespace FurniShop.Wpf.ViewModels;

// ============================================================================ Inventory
public sealed partial class StockViewModel : ListPageViewModel<InventoryRow>
{
    public StockViewModel(string? state)
    {
        Title = state == "DAMAGED" ? "Damaged Stock" : "Current Stock";
        Subtitle = state == "DAMAGED"
            ? "Damaged units are not sellable. Repair them back into stock or write them off."
            : "Available = on hand − reserved. Reserved units are held for confirmed orders and cannot be sold to anyone else.";
        StatusOptions = new[]
        {
            new Option(null, "All items"), new Option("IN_STOCK", "In stock"), new Option("LOW", "Low stock"), new Option("OUT", "Out of stock"),
            new Option("RESERVED", "Has reservations"), new Option("DAMAGED", "Damaged"),
        };
        SelectedStatus = StatusOptions.FirstOrDefault(o => o.Value == state) ?? StatusOptions[0];
    }

    [ObservableProperty] private decimal? _stockValue;
    public override string SearchHint => "Product, SKU, barcode…";
    public bool CanAdjust => Can(Perm.InventoryAdjust);

    public override async Task LoadAsync()
    {
        await base.LoadAsync();
        if (CanSeeCost) StockValue = await App.Inventory.StockValueAsync();
    }

    protected override Task<PagedResult<InventoryRow>> FetchAsync(ListQuery q) => App.Inventory.ListAsync(q, q.Status);
    protected override void OnOpen(InventoryRow item) => Shell.Navigate(Routes.Movements, item.VariantId);

    [RelayCommand]
    private async Task AdjustAsync(InventoryRow? row)
    {
        if (row is null) return;
        if (await Shell.ShowDialogAsync(new AdjustStockDialogViewModel(row))) await RunAsync(LoadAsync);
    }

    protected override IReadOnlyList<ExportColumn<InventoryRow>> ExportColumns => new ExportColumn<InventoryRow>[]
    {
        new("SKU", r => r.Sku), new("Product", r => r.DisplayName), new("Category", r => r.CategoryName), new("On hand", r => r.OnHand),
        new("Reserved", r => r.Reserved), new("Available", r => r.Available), new("Damaged", r => r.Damaged), new("Display", r => r.DisplayQty),
        new("Min stock", r => r.MinStock), new("Cost", r => r.CostPrice), new("Stock value", r => r.StockValue), new("Status", r => r.StockState),
    };
}

public sealed partial class AdjustStockDialogViewModel : DialogViewModel
{
    public AdjustStockDialogViewModel(InventoryRow row)
    {
        Row = row;
        DialogTitle = $"Adjust stock — {row.DisplayName}";
        Type = Types.First(t => t.Value == (row.Damaged > 0 ? AdjustmentType.DamageRepaired : AdjustmentType.Increase));
    }

    public InventoryRow Row { get; }
    public IReadOnlyList<Option> Types { get; } = new[]
    {
        new Option(AdjustmentType.Increase, "Stock in / found (+)"), new Option(AdjustmentType.Decrease, "Stock out / lost (−)"),
        new Option(AdjustmentType.MarkDamaged, "Mark as damaged"), new Option(AdjustmentType.DamageRepaired, "Damaged → repaired (back to stock)"),
        new Option(AdjustmentType.DamageWriteOff, "Write off damaged"), new Option(AdjustmentType.SetDisplay, "Set display (showroom floor) quantity"),
    };
    public override string AcceptText => "Save adjustment";
    [ObservableProperty] private Option _type;
    [ObservableProperty] private decimal _quantity = 1;
    [ObservableProperty] private string _reason = "";
    [ObservableProperty] private decimal? _unitCost;

    protected override async Task OnAcceptAsync()
    {
        var no = await App.Inventory.AdjustAsync(new StockAdjustmentInput { VariantId = Row.VariantId, AdjustmentType = Type.Value!, Quantity = Quantity, Reason = Reason, UnitCost = UnitCost });
        Shell.Toast.Success($"Stock adjusted ({no}).");
    }
}

/// <summary>Stock In and Stock Adjustment screens: pick a product, record the change with a reason.</summary>
public sealed partial class StockAdjustViewModel : PageViewModel
{
    public StockAdjustViewModel(string type, bool stockIn)
    {
        IsStockIn = stockIn;
        Title = stockIn ? "Stock In" : "Stock Adjustment";
        Subtitle = stockIn
            ? "Receive stock without a supplier bill (opening stock, transfers, returns from repair). For supplier deliveries use New Purchase so the supplier ledger is updated."
            : "Correct stock after a count, mark items damaged, write off, or set the showroom display quantity. Every change needs a reason and is logged.";
        SelectedType = Types.FirstOrDefault(t => t.Value == type) ?? Types[0];
    }

    public bool IsStockIn { get; }
    public IReadOnlyList<Option> Types => IsStockIn
        ? new[] { new Option(AdjustmentType.Increase, "Stock in (+)"), new Option(AdjustmentType.DamageRepaired, "Repaired → back to stock") }
        : new[]
        {
            new Option(AdjustmentType.Decrease, "Reduce stock (−)"), new Option(AdjustmentType.Increase, "Increase stock (+)"), new Option(AdjustmentType.MarkDamaged, "Mark damaged"),
            new Option(AdjustmentType.DamageRepaired, "Damaged → repaired"), new Option(AdjustmentType.DamageWriteOff, "Write off damaged"), new Option(AdjustmentType.SetDisplay, "Set display qty"),
        };
    public ObservableCollection<SellableItem> Results { get; } = new();
    public ObservableCollection<InventoryMovement> Recent { get; } = new();
    [ObservableProperty] private string? _search;
    [ObservableProperty] private SellableItem? _item;
    [ObservableProperty] private StockLevels? _levels;
    [ObservableProperty] private Option? _selectedType;
    [ObservableProperty] private decimal _quantity = 1;
    [ObservableProperty] private decimal? _unitCost;
    [ObservableProperty] private string _reason = "";

    public override async Task LoadAsync()
    {
        Recent.Clear();
        foreach (var m in (await App.Inventory.MovementsAsync(new ListQuery { PageSize = 15 })).Items
                     .Where(m => m.RefType == DocType.Adjustment || m.MovementType == MovementType.Opening))
            Recent.Add(m);
    }

    partial void OnSearchChanged(string? value) => _ = RunAsync(async () =>
    {
        Results.Clear();
        if (string.IsNullOrWhiteSpace(value)) return;
        var exact = await App.Catalog.FindByCodeAsync(value);
        if (exact is not null) { await PickAsync(exact); return; }
        foreach (var p in (await App.Catalog.SearchSellableAsync(value, null, 12)).Where(p => p.IsStockItem)) Results.Add(p);
    }, showBusy: false);

    [RelayCommand]
    private async Task PickAsync(SellableItem? i)
    {
        if (i is null) return;
        Item = i;
        UnitCost = i.CostPrice;
        Levels = await App.Inventory.LevelsAsync(i.VariantId);
        Results.Clear();
        Search = null;
    }

    [RelayCommand]
    private Task SaveAsync() => RunAsync(async () =>
    {
        if (Item is null) throw new ValidationException("Item", "Select a product.");
        var no = await App.Inventory.AdjustAsync(new StockAdjustmentInput
        {
            VariantId = Item.VariantId, AdjustmentType = SelectedType!.Value!, Quantity = Quantity, Reason = Reason, UnitCost = CanSeeCost ? UnitCost : null,
        });
        Shell.Toast.Success($"Saved {no}.");
        Levels = await App.Inventory.LevelsAsync(Item.VariantId);
        Reason = "";
        Quantity = 1;
        await LoadAsync();
    });
}

public sealed partial class ReservedStockViewModel : PageViewModel
{
    public ReservedStockViewModel()
    {
        Title = "Reserved Stock";
        Subtitle = "Units held for confirmed sales orders. They leave stock when the order is invoiced, or return to available stock if the order is cancelled.";
    }

    public ObservableCollection<ReservedStockRow> Rows { get; } = new();
    public override async Task LoadAsync()
    {
        Rows.Clear();
        foreach (var r in await App.Inventory.ReservedAsync()) Rows.Add(r);
    }

    [RelayCommand] private void Open(ReservedStockRow? r) { if (r is not null) Shell.Navigate(Routes.SalesOrder, r.SalesOrderId); }
}

public sealed class MovementListViewModel : ListPageViewModel<InventoryMovement>
{
    private readonly long? _variantId;

    public MovementListViewModel(long? variantId)
    {
        _variantId = variantId;
        Title = "Stock Movement";
        Subtitle = variantId.HasValue ? "Complete history for this item." : "Every stock change with the document that caused it. Movements can never be edited or deleted.";
        StatusOptions = new[]
        {
            new Option(null, "All movements"), new Option(MovementType.PurchaseIn, "Purchases"), new Option(MovementType.SaleOut, "Sales"),
            new Option(MovementType.ReservedSaleOut, "Sales (reserved)"), new Option(MovementType.Reserve, "Reservations"), new Option(MovementType.Unreserve, "Releases"),
            new Option(MovementType.ReturnIn, "Returns"), new Option(MovementType.ReturnDamaged, "Damaged returns"), new Option(MovementType.AdjustmentIn, "Adjustment +"),
            new Option(MovementType.AdjustmentOut, "Adjustment −"), new Option(MovementType.Damage, "Marked damaged"), new Option(MovementType.Opening, "Opening stock"),
        };
        SelectedStatus = StatusOptions[0];
    }

    public override bool ShowDateFilter => true;
    public override string SearchHint => "SKU, product, document no…";
    protected override Task<PagedResult<InventoryMovement>> FetchAsync(ListQuery q) => App.Inventory.MovementsAsync(q, _variantId, q.Status);

    protected override void OnOpen(InventoryMovement m)
    {
        switch (m.RefType)
        {
            case DocType.Invoice when m.RefId.HasValue: Shell.Navigate(Routes.Invoice, m.RefId.Value); break;
            case DocType.SalesOrder when m.RefId.HasValue: Shell.Navigate(Routes.SalesOrder, m.RefId.Value); break;
            case DocType.Purchase when m.RefId.HasValue: Shell.Navigate(Routes.PurchaseDetail, m.RefId.Value); break;
        }
    }

    protected override IReadOnlyList<ExportColumn<InventoryMovement>> ExportColumns => new ExportColumn<InventoryMovement>[]
    {
        new("Date", m => m.CreatedAt), new("SKU", m => m.Sku), new("Product", m => m.ProductName), new("Movement", m => m.MovementType),
        new("Qty change", m => m.OnHandDelta), new("Reserved change", m => m.ReservedDelta), new("Damaged change", m => m.DamagedDelta),
        new("On hand after", m => m.OnHandAfter), new("Reference", m => m.RefNumber), new("Note", m => m.Note), new("By", m => m.CreatedByName),
    };
}

// ============================================================================ Purchases
public sealed partial class PurchaseLineVm : ObservableObject
{
    private readonly Action _changed;
    public PurchaseLineVm(Action changed) => _changed = changed;
    public long VariantId { get; init; }
    public string? Sku { get; init; }
    [ObservableProperty] private string _description = "";
    [ObservableProperty] private string? _hsnCode;
    [ObservableProperty] private decimal _quantity = 1;
    [ObservableProperty] private decimal _unitCost;
    [ObservableProperty] private decimal _discountPercent;
    [ObservableProperty] private decimal _gstRate = 18;
    [ObservableProperty] private decimal _lineTotal;
    partial void OnQuantityChanged(decimal value) => _changed();
    partial void OnUnitCostChanged(decimal value) => _changed();
    partial void OnDiscountPercentChanged(decimal value) => _changed();
    partial void OnGstRateChanged(decimal value) => _changed();
}

public sealed partial class PurchaseEditorViewModel(long id) : PageViewModel
{
    public long Id { get; private set; } = id;
    public ObservableCollection<Supplier> Suppliers { get; } = new();
    public ObservableCollection<SellableItem> Results { get; } = new();
    public ObservableCollection<PurchaseLineVm> Lines { get; } = new();
    public ObservableCollection<decimal> GstRates { get; } = new();
    public IReadOnlyList<Option> Methods { get; } = PaymentMethodCode.Money.Select(m => new Option(m, StatusStyle.Label(m))).ToList();
    [ObservableProperty] private Supplier? _supplier;
    [ObservableProperty] private string? _supplierInvoiceNo;
    [ObservableProperty] private DateTime _date = DateTime.Today;
    [ObservableProperty] private DateTime? _dueDate = DateTime.Today.AddDays(30);
    [ObservableProperty] private decimal _otherCharges;
    [ObservableProperty] private string? _notes;
    [ObservableProperty] private string? _search;
    [ObservableProperty] private decimal _taxable;
    [ObservableProperty] private decimal _tax;
    [ObservableProperty] private decimal _total;
    [ObservableProperty] private decimal _paidNow;
    [ObservableProperty] private Option? _paidMethod;
    [ObservableProperty] private string? _paidReference;
    [ObservableProperty] private bool _interState;
    public bool CanPay => Can(Perm.SupplierPay);
    private Core.Settings.AppSettingsSnapshot _settings = new();

    public override async Task LoadAsync()
    {
        _settings = await App.Settings.GetAsync();
        Title = Id == 0 ? "New Purchase" : "Edit draft purchase";
        Subtitle = "Record the supplier's bill. Completing the purchase adds the stock and updates cost prices.";
        PaidMethod = Methods.First(m => m.Value == PaymentMethodCode.Bank);
        Suppliers.Clear(); foreach (var s in (await App.Suppliers.ListAsync(new ListQuery { PageSize = 500 })).Items) Suppliers.Add(s);
        GstRates.Clear(); foreach (var r in await App.Settings.GstRatesAsync(true)) GstRates.Add(r.Rate);
        if (Id == 0) return;
        var p = await App.Purchases.GetAsync(Id);
        if (p.Status != PurchaseStatus.Draft) { Shell.Navigate(Routes.PurchaseDetail, Id, addToHistory: false); return; }
        Supplier = Suppliers.FirstOrDefault(s => s.Id == p.SupplierId); SupplierInvoiceNo = p.SupplierInvoiceNo; Date = p.PurchaseDate; DueDate = p.DueDate;
        OtherCharges = p.OtherCharges; Notes = p.Notes;
        Lines.Clear();
        foreach (var l in p.Lines)
            Lines.Add(new PurchaseLineVm(Recalc) { VariantId = l.VariantId, Sku = l.Sku, Description = l.Description, HsnCode = l.HsnCode, Quantity = l.Quantity, UnitCost = l.UnitCost, DiscountPercent = l.DiscountPercent, GstRate = l.GstRate });
        Recalc();
    }

    partial void OnSupplierChanged(Supplier? value) => Recalc();
    partial void OnOtherChargesChanged(decimal value) => Recalc();

    partial void OnSearchChanged(string? value) => _ = RunAsync(async () =>
    {
        Results.Clear();
        if (string.IsNullOrWhiteSpace(value)) return;
        var exact = await App.Catalog.FindByCodeAsync(value);
        if (exact is not null) { Add(exact); return; }
        foreach (var p in (await App.Catalog.SearchSellableAsync(value, null, 12)).Where(p => p.IsStockItem)) Results.Add(p);
    }, showBusy: false);

    [RelayCommand]
    private void Add(SellableItem? i)
    {
        if (i is null) return;
        Lines.Add(new PurchaseLineVm(Recalc) { VariantId = i.VariantId, Sku = i.Sku, Description = i.DisplayName, HsnCode = i.HsnCode, UnitCost = i.CostPrice ?? 0, GstRate = i.GstRate });
        Search = null;
        Results.Clear();
        Recalc();
    }

    [RelayCommand] private void Remove(PurchaseLineVm? l) { if (l is not null) { Lines.Remove(l); Recalc(); } }

    [RelayCommand]
    private async Task NewSupplierAsync()
    {
        var d = new SupplierEditDialogViewModel(null);
        if (await Shell.ShowDialogAsync(d) && d.SavedId is { } sid)
        {
            Suppliers.Clear(); foreach (var s in (await App.Suppliers.ListAsync(new ListQuery { PageSize = 500 })).Items) Suppliers.Add(s);
            Supplier = Suppliers.FirstOrDefault(s => s.Id == sid);
        }
    }

    private void Recalc()
    {
        InterState = Core.Tax.GstCalculator.IsInterState(_settings.Shop.StateCode, Supplier?.StateCode);
        decimal taxable = 0, tax = 0;
        foreach (var l in Lines)
        {
            try
            {
                var r = Core.Tax.GstCalculator.ComputeLine(new Core.Tax.TaxLineInput(l.Quantity, l.UnitCost, false, l.GstRate, l.DiscountPercent), InterState);
                l.LineTotal = r.Total; taxable += r.Taxable; tax += r.Tax;
            }
            catch (ArgumentOutOfRangeException) { l.LineTotal = 0; }
        }
        Taxable = taxable; Tax = tax;
        var exact = taxable + tax + OtherCharges;
        Total = _settings.Invoice.RoundOff ? Money.ToRupee(exact) : exact;
    }

    private PurchaseInput Build(bool complete) => new()
    {
        Id = Id, SupplierId = Supplier?.Id ?? 0, SupplierInvoiceNo = SupplierInvoiceNo, Date = Date, DueDate = DueDate, OtherCharges = OtherCharges, Notes = Notes,
        Complete = complete, PaidNow = complete ? PaidNow : 0, PaidMethod = PaidMethod?.Value ?? PaymentMethodCode.Bank, PaidReference = PaidReference,
        Lines = Lines.Select(l => new PurchaseLineInput { VariantId = l.VariantId, Description = l.Description, HsnCode = l.HsnCode, Quantity = l.Quantity, UnitCost = l.UnitCost, DiscountPercent = l.DiscountPercent, GstRate = l.GstRate }).ToList(),
    };

    [RelayCommand]
    private Task SaveDraftAsync() => RunAsync(async () =>
    {
        Id = await App.Purchases.SaveAsync(Build(false));
        Shell.Toast.Success("Draft saved — stock is added only when you complete the purchase.");
    });

    [RelayCommand]
    private async Task CompleteAsync()
    {
        if (!await Shell.ConfirmAsync("Complete purchase", $"Add the stock for {Lines.Count} item(s) and record {Money.Format(Total)} payable to {Supplier?.Name}?", "Complete purchase")) return;
        await RunAsync(async () =>
        {
            Id = await App.Purchases.SaveAsync(Build(true));
            Shell.Toast.Success("Purchase completed — stock updated.");
            Shell.Navigate(Routes.PurchaseDetail, Id, addToHistory: false);
        });
    }
}

public sealed class PurchaseListViewModel : ListPageViewModel<Purchase>
{
    public PurchaseListViewModel()
    {
        Title = "Purchase History";
        Subtitle = "Supplier bills. Completed purchases added stock; drafts have not.";
        StatusOptions = new[] { new Option(null, "All"), new Option(PurchaseStatus.Draft, "Draft"), new Option(PurchaseStatus.Completed, "Completed"), new Option(PurchaseStatus.Cancelled, "Cancelled") };
        SelectedStatus = StatusOptions[0];
    }

    public override bool ShowDateFilter => true;
    public override string SearchHint => "Purchase no, supplier, supplier bill no…";
    public bool CanCreate => Can(Perm.PurchaseManage);
    public IRelayCommand NewCommand => new RelayCommand(() => Shell.Navigate(Routes.Purchase));
    protected override Task<PagedResult<Purchase>> FetchAsync(ListQuery q) => App.Purchases.ListAsync(q);
    protected override void OnOpen(Purchase item) => Shell.Navigate(item.Status == PurchaseStatus.Draft ? Routes.Purchase : Routes.PurchaseDetail, item.Id);

    protected override IReadOnlyList<ExportColumn<Purchase>> ExportColumns => new ExportColumn<Purchase>[]
    {
        new("Purchase", p => p.Number), new("Date", p => p.PurchaseDate), new("Supplier", p => p.SupplierName), new("Supplier bill", p => p.SupplierInvoiceNo),
        new("Status", p => p.Status), new("Taxable", p => p.TaxableTotal), new("GST", p => p.CgstTotal + p.SgstTotal + p.IgstTotal), new("Total", p => p.GrandTotal),
        new("Paid", p => p.Paid), new("Balance", p => p.Balance),
    };
}

public sealed partial class PurchaseDetailViewModel(long id) : PageViewModel
{
    [ObservableProperty] private Purchase? _purchase;
    public bool CanPay => Purchase is { Status: PurchaseStatus.Completed } p && p.Balance > 0 && Can(Perm.SupplierPay);
    public bool CanCancel => Purchase?.Status != PurchaseStatus.Cancelled && Can(Perm.PurchaseManage);

    public override async Task LoadAsync()
    {
        Purchase = await App.Purchases.GetAsync(id);
        Title = $"Purchase {Purchase.Number}";
        Subtitle = $"{Purchase.SupplierName} · bill {Purchase.SupplierInvoiceNo} · {Purchase.PurchaseDate:dd-MMM-yyyy}";
        OnPropertyChanged(nameof(CanPay)); OnPropertyChanged(nameof(CanCancel));
    }

    [RelayCommand]
    private async Task PayAsync()
    {
        if (await Shell.ShowDialogAsync(new SupplierPayDialogViewModel(Purchase!.SupplierId, id, Purchase.Balance))) await RunAsync(LoadAsync);
    }

    [RelayCommand]
    private async Task CancelPurchaseAsync()
    {
        var reason = await Shell.AskReasonAsync("Cancel purchase", "Completed purchases remove the received stock again (only possible while it is still in stock).", "Cancel purchase");
        if (reason is null) return;
        await RunAsync(async () => { await App.Purchases.CancelAsync(id, reason); await LoadAsync(); }, "Purchase cancelled.");
    }

    [RelayCommand] private void OpenSupplier() => Shell.Navigate(Routes.Supplier, Purchase!.SupplierId);
}

public sealed class SupplierListViewModel : ListPageViewModel<Supplier>
{
    public SupplierListViewModel()
    {
        Title = "Suppliers";
        Subtitle = "Vendors with purchases, payments and amounts payable.";
    }

    public override string SearchHint => "Name, mobile, code, GSTIN…";
    public bool CanCreate => Can(Perm.SupplierManage);
    protected override Task<PagedResult<Supplier>> FetchAsync(ListQuery q) => App.Suppliers.ListAsync(q);
    protected override void OnOpen(Supplier item) => Shell.Navigate(Routes.Supplier, item.Id);

    public IAsyncRelayCommand NewCommand => new AsyncRelayCommand(async () =>
    {
        var d = new SupplierEditDialogViewModel(null);
        if (await Shell.ShowDialogAsync(d)) await RunAsync(LoadAsync);
    });

    protected override IReadOnlyList<ExportColumn<Supplier>> ExportColumns => new ExportColumn<Supplier>[]
    {
        new("Code", s => s.Code), new("Name", s => s.Name), new("Contact", s => s.ContactPerson), new("Mobile", s => s.Mobile), new("GSTIN", s => s.Gstin),
        new("Purchases", s => s.TotalPurchases), new("Paid", s => s.TotalPaid), new("Outstanding", s => s.Outstanding),
    };
}

public sealed partial class SupplierEditDialogViewModel : DialogViewModel
{
    private readonly long? _id;
    public SupplierEditDialogViewModel(long? id) { _id = id; DialogTitle = id.HasValue ? "Edit supplier" : "New supplier"; }
    public override double DialogWidth => 680;
    public long? SavedId { get; private set; }
    public IReadOnlyList<Core.Validation.IndianState> States => Core.Validation.IndianStates.All;
    [ObservableProperty] private Supplier _model = new();
    [ObservableProperty] private Core.Validation.IndianState? _state;

    public override async Task InitAsync()
    {
        if (_id is { } id) { Model = await App.Suppliers.GetAsync(id); State = Core.Validation.IndianStates.ByCode(Model.StateCode); }
        else State = Core.Validation.IndianStates.ByCode((await App.Settings.GetAsync()).Shop.StateCode);
    }

    protected override async Task OnAcceptAsync()
    {
        Model.StateCode = State?.Code;
        SavedId = await App.Suppliers.SaveAsync(Model);
        Shell.Toast.Success("Supplier saved.");
    }
}

public sealed partial class SupplierDetailViewModel(long id) : PageViewModel
{
    [ObservableProperty] private Supplier? _supplier;
    public ObservableCollection<LedgerEntry> Ledger { get; } = new();
    public ObservableCollection<Purchase> Purchases { get; } = new();
    public bool CanPay => Can(Perm.SupplierPay);
    public bool CanEdit => Can(Perm.SupplierManage);

    public override async Task LoadAsync()
    {
        Supplier = await App.Suppliers.GetAsync(id);
        Title = Supplier.Name;
        Subtitle = $"{Supplier.Code} · {Supplier.Mobile} · GSTIN {Supplier.Gstin}";
        Ledger.Clear(); foreach (var l in (await App.Suppliers.LedgerAsync(id)).Reverse()) Ledger.Add(l);
        Purchases.Clear(); foreach (var p in (await App.Purchases.ListAsync(new ListQuery { SupplierId = id, PageSize = 200 })).Items) Purchases.Add(p);
    }

    [RelayCommand]
    private async Task EditAsync() { if (await Shell.ShowDialogAsync(new SupplierEditDialogViewModel(id))) await RunAsync(LoadAsync); }

    [RelayCommand]
    private async Task PayAsync() { if (await Shell.ShowDialogAsync(new SupplierPayDialogViewModel(id, null, Supplier!.Outstanding))) await RunAsync(LoadAsync); }

    [RelayCommand]
    private async Task DeleteAsync()
    {
        if (!await Shell.ConfirmAsync("Delete supplier", "Suppliers with purchases cannot be deleted.", "Delete", true)) return;
        if (await RunAsync(() => App.Suppliers.DeleteAsync(id), "Supplier deleted.")) Shell.Navigate(Routes.Suppliers, addToHistory: false);
    }

    [RelayCommand] private void NewPurchase() => Shell.Navigate(Routes.Purchase);
    [RelayCommand] private void OpenPurchase(Purchase? p) { if (p is not null) Shell.Navigate(p.Status == PurchaseStatus.Draft ? Routes.Purchase : Routes.PurchaseDetail, p.Id); }
}

public sealed partial class SupplierPayDialogViewModel : DialogViewModel
{
    private readonly long _supplierId;
    private readonly long? _purchaseId;

    public SupplierPayDialogViewModel(long supplierId, long? purchaseId, decimal suggested)
    {
        _supplierId = supplierId; _purchaseId = purchaseId; Amount = Math.Max(0, suggested);
        DialogTitle = "Pay supplier";
        Method = Methods.First(m => m.Value == PaymentMethodCode.Bank);
    }

    public IReadOnlyList<Option> Methods { get; } = PaymentMethodCode.Money.Select(m => new Option(m, StatusStyle.Label(m))).ToList();
    public override string AcceptText => "Record payment";
    [ObservableProperty] private decimal _amount;
    [ObservableProperty] private Option _method;
    [ObservableProperty] private string? _reference;
    [ObservableProperty] private DateTime _date = DateTime.Today;
    [ObservableProperty] private string? _notes;

    protected override async Task OnAcceptAsync()
    {
        var no = await App.Purchases.PayAsync(new SupplierPaymentInput
        {
            SupplierId = _supplierId, PurchaseId = _purchaseId, Amount = Amount, MethodCode = Method.Value!, Reference = Reference, Date = Date, Notes = Notes,
        });
        Shell.Toast.Success($"Supplier payment {no} recorded.");
    }
}

public sealed class SupplierPaymentListViewModel : ListPageViewModel<SupplierPayment>
{
    public SupplierPaymentListViewModel()
    {
        Title = "Supplier Payments";
        Subtitle = "Money paid to suppliers, applied to their bills oldest first.";
    }

    public override bool ShowDateFilter => true;
    public override string SearchHint => "Payment no, supplier, reference…";
    public bool CanVoid => Can(Perm.PaymentVoid);
    public bool CanPay => Can(Perm.SupplierPay);
    protected override Task<PagedResult<SupplierPayment>> FetchAsync(ListQuery q) => App.Purchases.ListPaymentsAsync(q);
    protected override void OnOpen(SupplierPayment item) => Shell.Navigate(Routes.Supplier, item.SupplierId);

    public IAsyncRelayCommand VoidCommand => new AsyncRelayCommand<SupplierPayment>(async p =>
    {
        if (p is null || p.IsVoided) return;
        var reason = await Shell.AskReasonAsync("Void supplier payment", $"Void {p.Number} ({Money.Format(p.Amount)})?", "Void");
        if (reason is null) return;
        await RunAsync(async () => { await App.Purchases.VoidPaymentAsync(p.Id, reason); await LoadAsync(); }, "Payment voided.");
    });

    protected override IReadOnlyList<ExportColumn<SupplierPayment>> ExportColumns => new ExportColumn<SupplierPayment>[]
    {
        new("Number", p => p.Number), new("Date", p => p.PaymentDate), new("Supplier", p => p.SupplierName), new("Method", p => p.MethodCode),
        new("Reference", p => p.Reference), new("Amount", p => p.Amount), new("Applied to", p => p.AppliedTo), new("Voided", p => p.IsVoided ? "Yes" : ""),
    };
}
