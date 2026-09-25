using System.Collections.ObjectModel;
using System.IO;
using System.Windows.Media.Imaging;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Infrastructure.Documents;
using FurniShop.Wpf.Services;

namespace FurniShop.Wpf.ViewModels;

public sealed class ProductListViewModel : ListPageViewModel<Product>
{
    public ProductListViewModel()
    {
        Title = "Products";
        Subtitle = "Furniture catalogue with variants, GST, pricing and stock.";
        StatusOptions = new[] { new Option(null, "All statuses"), new Option("ACTIVE", "Active"), new Option("INACTIVE", "Inactive"), new Option("DISCONTINUED", "Discontinued") };
        SelectedStatus = StatusOptions[0];
    }

    public ObservableCollection<Category> Categories { get; } = new();
    private Category? _category;
    public Category? Category
    {
        get => _category;
        set { if (SetProperty(ref _category, value) && HasLoaded) _ = ReloadFirstPageAsync(); }
    }

    public override string SearchHint => "Name, code, SKU, barcode…";
    public bool CanCreate => Can(Perm.ProductManage);

    public override async Task LoadAsync()
    {
        if (Categories.Count == 0)
        {
            Categories.Add(new Category { Id = 0, Name = "All categories" });
            foreach (var c in await App.Catalog.CategoriesAsync()) Categories.Add(c);
            _category = Categories[0];
            OnPropertyChanged(nameof(Category));
        }
        await base.LoadAsync();
    }

    protected override Task<PagedResult<Product>> FetchAsync(ListQuery q)
    {
        q.CategoryId = Category?.Id is > 0 ? Category.Id : null;
        return App.Catalog.ListProductsAsync(q);
    }

    protected override void OnOpen(Product item) => Shell.Navigate(Routes.Product, item.Id);
    public IRelayCommand NewCommand => new RelayCommand(() => Shell.Navigate(Routes.ProductNew));

    protected override IReadOnlyList<ExportColumn<Product>> ExportColumns => new ExportColumn<Product>[]
    {
        new("Code", p => p.Code), new("Name", p => p.Name), new("Category", p => p.CategoryName), new("Brand", p => p.BrandName), new("Material", p => p.Material),
        new("Color", p => p.Color), new("HSN", p => p.HsnCode), new("GST %", p => p.GstRate), new("Selling price", p => p.SellingPrice),
        new("Cost price", p => p.CostPrice), new("On hand", p => p.OnHand), new("Reserved", p => p.Reserved), new("Available", p => p.Available),
        new("Status", p => p.Status),
    };
}

public sealed partial class VariantVm : ObservableObject
{
    public long Id { get; init; }
    [ObservableProperty] private string _variantName = "Standard";
    [ObservableProperty] private string _sku = "";
    [ObservableProperty] private string? _barcode;
    [ObservableProperty] private string? _size;
    [ObservableProperty] private string? _color;
    [ObservableProperty] private string? _material;
    [ObservableProperty] private string? _fabric;
    [ObservableProperty] private string? _finish;
    [ObservableProperty] private string? _configuration;
    [ObservableProperty] private string? _design;
    [ObservableProperty] private string? _dimensions;
    [ObservableProperty] private decimal? _costPrice;
    [ObservableProperty] private decimal? _sellingPrice;
    [ObservableProperty] private decimal? _minStock;
    [ObservableProperty] private decimal _openingStock;
    [ObservableProperty] private bool _isDefault;
    [ObservableProperty] private bool _isActive = true;
    public decimal OnHand { get; init; }
    public decimal Reserved { get; init; }
    public decimal Damaged { get; init; }
    public bool IsNew => Id == 0;
    public long? ImageAttachmentId { get; set; }

    public ProductVariant ToModel() => new()
    {
        Id = Id, VariantName = VariantName, Sku = Sku, Barcode = Barcode, Size = Size, Color = Color, Material = Material, Fabric = Fabric, Finish = Finish,
        Configuration = Configuration, Design = Design, Dimensions = Dimensions, CostPrice = CostPrice, SellingPrice = SellingPrice, MinStock = MinStock,
        OpeningStock = OpeningStock, IsDefault = IsDefault, IsActive = IsActive, ImageAttachmentId = ImageAttachmentId,
    };
}

public sealed partial class ProductEditorViewModel(long id) : PageViewModel
{
    public long Id { get; private set; } = id;
    public ObservableCollection<Category> Categories { get; } = new();
    public ObservableCollection<Brand> Brands { get; } = new();
    public ObservableCollection<decimal> GstRates { get; } = new();
    public ObservableCollection<HsnCode> HsnCodes { get; } = new();
    public ObservableCollection<VariantVm> Variants { get; } = new();
    public IReadOnlyList<Option> Statuses { get; } = new[] { new Option("ACTIVE", "Active"), new Option("INACTIVE", "Inactive"), new Option("DISCONTINUED", "Discontinued") };

    [ObservableProperty] private string _code = "";
    [ObservableProperty] private string _name = "";
    [ObservableProperty] private Category? _category;
    [ObservableProperty] private Brand? _brand;
    [ObservableProperty] private string? _material;
    [ObservableProperty] private string? _color;
    [ObservableProperty] private string? _size;
    [ObservableProperty] private string? _dimensions;
    [ObservableProperty] private decimal? _weightKg;
    [ObservableProperty] private string? _finish;
    [ObservableProperty] private string? _fabric;
    [ObservableProperty] private int _warrantyMonths;
    [ObservableProperty] private string? _hsnCode;
    [ObservableProperty] private decimal _gstRate = 18;
    [ObservableProperty] private bool _priceIncludesGst = true;
    [ObservableProperty] private decimal? _costPrice;
    [ObservableProperty] private decimal _sellingPrice;
    [ObservableProperty] private decimal _discountPercent;
    [ObservableProperty] private decimal _minStock;
    [ObservableProperty] private string? _description;
    [ObservableProperty] private Option? _status;
    [ObservableProperty] private bool _isStockItem = true;
    [ObservableProperty] private long? _imageAttachmentId;
    [ObservableProperty] private BitmapImage? _image;
    [ObservableProperty] private decimal _onHand;
    [ObservableProperty] private decimal _available;

    public bool IsNew => Id == 0;
    public bool CanEdit => Can(Perm.ProductManage);
    public bool CanDelete => !IsNew && Can(Perm.ProductDelete);
    public bool CanStock => Can(Perm.InventoryAdjust);
    public decimal? Margin => CostPrice is { } c && SellingPrice > 0
        ? Math.Round((Core.Tax.GstCalculator.ExcludeTax(SellingPrice * (1 - DiscountPercent / 100), PriceIncludesGst ? GstRate : 0) - c) * 100 / Math.Max(1, Core.Tax.GstCalculator.ExcludeTax(SellingPrice * (1 - DiscountPercent / 100), PriceIncludesGst ? GstRate : 0)), 1)
        : null;

    partial void OnCostPriceChanged(decimal? value) => OnPropertyChanged(nameof(Margin));
    partial void OnSellingPriceChanged(decimal value) => OnPropertyChanged(nameof(Margin));
    partial void OnDiscountPercentChanged(decimal value) => OnPropertyChanged(nameof(Margin));

    partial void OnCategoryChanged(Category? value)
    {
        if (value is null || !IsNew) return;
        if (value.DefaultHsn is not null) HsnCode = value.DefaultHsn;
        if (value.DefaultGstRate is { } r) GstRate = r;
    }

    partial void OnHsnCodeChanged(string? value)
    {
        if (IsNew && HsnCodes.FirstOrDefault(h => h.Code == value) is { } h) GstRate = h.DefaultGstRate;
    }

    public override async Task LoadAsync()
    {
        var s = await App.Settings.GetAsync();
        Categories.Clear(); foreach (var c in await App.Catalog.CategoriesAsync(true)) Categories.Add(c);
        Brands.Clear(); Brands.Add(new Brand { Id = 0, Name = "(none)" }); foreach (var b in await App.Catalog.BrandsAsync()) Brands.Add(b);
        GstRates.Clear(); foreach (var r in await App.Settings.GstRatesAsync(true)) GstRates.Add(r.Rate);
        HsnCodes.Clear(); foreach (var h in await App.Settings.HsnCodesAsync()) HsnCodes.Add(h);
        Variants.Clear();
        if (IsNew)
        {
            Title = "New product";
            Subtitle = "Add a product. Use variants for sizes, colours or seating options that have their own price or stock.";
            Status = Statuses[0];
            GstRate = s.Tax.DefaultGstRate;
            PriceIncludesGst = s.Tax.DefaultPriceIncludesGst;
            HsnCode = s.Tax.DefaultHsn;
            Brand = Brands[0];
            return;
        }
        var p = await App.Catalog.GetProductAsync(Id);
        Title = p.Name;
        Subtitle = $"{p.Code} · {p.CategoryName}";
        Code = p.Code; Name = p.Name; Category = Categories.FirstOrDefault(c => c.Id == p.CategoryId); Brand = Brands.FirstOrDefault(b => b.Id == p.BrandId) ?? Brands[0];
        Material = p.Material; Color = p.Color; Size = p.Size; Dimensions = p.Dimensions; WeightKg = p.WeightKg; Finish = p.Finish; Fabric = p.Fabric;
        WarrantyMonths = p.WarrantyMonths; HsnCode = p.HsnCode; GstRate = p.GstRate; PriceIncludesGst = p.PriceIncludesGst; CostPrice = p.CostPrice;
        SellingPrice = p.SellingPrice; DiscountPercent = p.DiscountPercent; MinStock = p.MinStock; Description = p.Description;
        Status = Statuses.FirstOrDefault(x => x.Value == p.Status); IsStockItem = p.IsStockItem; ImageAttachmentId = p.ImageAttachmentId;
        OnHand = p.OnHand; Available = p.Available;
        foreach (var v in p.Variants)
            Variants.Add(new VariantVm
            {
                Id = v.Id, VariantName = v.VariantName, Sku = v.Sku, Barcode = v.Barcode, Size = v.Size, Color = v.Color, Material = v.Material, Fabric = v.Fabric,
                Finish = v.Finish, Configuration = v.Configuration, Design = v.Design, Dimensions = v.Dimensions, CostPrice = v.CostPrice, SellingPrice = v.SellingPrice,
                MinStock = v.MinStock, IsDefault = v.IsDefault, IsActive = v.IsActive, OnHand = v.OnHand, Reserved = v.Reserved, Damaged = v.Damaged,
                ImageAttachmentId = v.ImageAttachmentId,
            });
        await LoadImageAsync();
        OnPropertyChanged(nameof(IsNew)); OnPropertyChanged(nameof(CanDelete));
    }

    private async Task LoadImageAsync()
    {
        Image = null;
        if (ImageAttachmentId is not { } aid) return;
        var a = await App.Attachments.GetAsync(aid);
        if (a is null || !a.Value.Info.ContentType.StartsWith("image/")) return;
        var bmp = new BitmapImage();
        bmp.BeginInit(); bmp.CacheOption = BitmapCacheOption.OnLoad; bmp.StreamSource = new MemoryStream(a.Value.Data); bmp.DecodePixelWidth = 400; bmp.EndInit();
        bmp.Freeze();
        Image = bmp;
    }

    [RelayCommand]
    private void AddVariant()
    {
        var n = Variants.Count + 1;
        Variants.Add(new VariantVm { VariantName = $"Variant {n}", Sku = $"{Code}-{n}", SellingPrice = SellingPrice, CostPrice = CostPrice, IsDefault = Variants.Count == 0 });
    }

    [RelayCommand]
    private void RemoveVariant(VariantVm? v)
    {
        if (v is null) return;
        if (v.OnHand != 0 || v.Reserved != 0) { Shell.Toast.Error("This variant holds stock. Adjust stock to zero first."); return; }
        Variants.Remove(v);
    }

    [RelayCommand]
    private Task UploadImageAsync() => RunAsync(async () =>
    {
        var path = AppHost.AskOpenPath("Images|*.png;*.jpg;*.jpeg");
        if (path is null) return;
        ImageAttachmentId = await App.Attachments.SaveAsync(await File.ReadAllBytesAsync(path), Path.GetFileName(path), "PRODUCT", Id == 0 ? null : Id, "IMAGE");
        await LoadImageAsync();
    });

    [RelayCommand]
    private Task SaveAsync() => RunAsync(async () =>
    {
        var p = new Product
        {
            Id = Id, Code = Code, Name = Name, CategoryId = Category?.Id ?? 0, BrandId = Brand?.Id is > 0 ? Brand.Id : null, Material = Material, Color = Color,
            Size = Size, Dimensions = Dimensions, WeightKg = WeightKg, Finish = Finish, Fabric = Fabric, WarrantyMonths = WarrantyMonths, HsnCode = HsnCode,
            GstRate = GstRate, PriceIncludesGst = PriceIncludesGst, CostPrice = CanSeeCost ? CostPrice : null, SellingPrice = SellingPrice,
            DiscountPercent = DiscountPercent, MinStock = MinStock, Description = Description, Status = Status?.Value ?? "ACTIVE", IsStockItem = IsStockItem,
            ImageAttachmentId = ImageAttachmentId, Variants = Variants.Select(v => v.ToModel()).ToList(),
        };
        Id = await App.Catalog.SaveProductAsync(p);
        Shell.Toast.Success("Product saved.");
        await LoadAsync();
    });

    [RelayCommand]
    private async Task DeleteAsync()
    {
        if (!await Shell.ConfirmAsync("Delete product", $"Delete {Name}? Products with stock cannot be deleted — mark them Discontinued instead. Sales history is kept.", "Delete", true)) return;
        if (await RunAsync(() => App.Catalog.DeleteProductAsync(Id), "Product deleted.")) Shell.Navigate(Routes.Products, addToHistory: false);
    }

    [RelayCommand] private void StockMovement(VariantVm? v) { if (v is not null) Shell.Navigate(Routes.Movements, v.Id); }

    [RelayCommand]
    private Task PrintLabelsAsync() => RunAsync(async () =>
    {
        var items = await App.Documents.LabelItemsAsync(Variants.Where(v => !v.IsNew).Select(v => (v.Id, 1)));
        await DocumentActions.PrintLabelsAsync(items, LabelFormat.A4Sheet3x8, false, preview: true);
    });
}

public sealed partial class CategoriesViewModel : PageViewModel
{
    public CategoriesViewModel()
    {
        Title = "Categories & Brands";
        Subtitle = "Categories set the default HSN code and GST rate for new products.";
    }

    public ObservableCollection<Category> Categories { get; } = new();
    public ObservableCollection<Brand> Brands { get; } = new();
    public ObservableCollection<decimal> GstRates { get; } = new();
    public bool CanEdit => Can(Perm.ProductManage);
    [ObservableProperty] private Category _editing = new();
    [ObservableProperty] private Brand _editingBrand = new();

    public override async Task LoadAsync()
    {
        Categories.Clear(); foreach (var c in await App.Catalog.CategoriesAsync()) Categories.Add(c);
        Brands.Clear(); foreach (var b in await App.Catalog.BrandsAsync()) Brands.Add(b);
        GstRates.Clear(); foreach (var r in await App.Settings.GstRatesAsync(true)) GstRates.Add(r.Rate);
    }

    [RelayCommand] private void EditCategory(Category? c) => Editing = c is null ? new Category() : new Category { Id = c.Id, Name = c.Name, Description = c.Description, DefaultHsn = c.DefaultHsn, DefaultGstRate = c.DefaultGstRate, IsActive = c.IsActive };
    [RelayCommand] private void NewCategory() => Editing = new Category { DefaultGstRate = 18 };

    [RelayCommand]
    private Task SaveCategoryAsync() => RunAsync(async () =>
    {
        await App.Catalog.SaveCategoryAsync(Editing);
        Editing = new Category();
        await LoadAsync();
    }, "Category saved.");

    [RelayCommand]
    private async Task DeleteCategoryAsync(Category? c)
    {
        if (c is null || !await Shell.ConfirmAsync("Delete category", $"Delete {c.Name}?", "Delete", true)) return;
        await RunAsync(async () => { await App.Catalog.DeleteCategoryAsync(c.Id); await LoadAsync(); }, "Category deleted.");
    }

    [RelayCommand] private void EditBrand(Brand? b) => EditingBrand = b is null ? new Brand() : new Brand { Id = b.Id, Name = b.Name, IsActive = b.IsActive };

    [RelayCommand]
    private Task SaveBrandAsync() => RunAsync(async () =>
    {
        await App.Catalog.SaveBrandAsync(EditingBrand);
        EditingBrand = new Brand();
        await LoadAsync();
    }, "Brand saved.");

    [RelayCommand]
    private async Task DeleteBrandAsync(Brand? b)
    {
        if (b is null || !await Shell.ConfirmAsync("Delete brand", $"Delete {b.Name}? Products keep working without a brand.", "Delete", true)) return;
        await RunAsync(async () => { await App.Catalog.DeleteBrandAsync(b.Id); await LoadAsync(); }, "Brand deleted.");
    }
}

public sealed class VariantListViewModel : ListPageViewModel<SellableItem>
{
    public VariantListViewModel()
    {
        Title = "Variants";
        Subtitle = "Every sellable variant (size / colour / configuration) with its own SKU, barcode, price and stock.";
    }

    public override string SearchHint => "Product, variant, SKU, barcode…";
    protected override Task<PagedResult<SellableItem>> FetchAsync(ListQuery q) => App.Catalog.ListVariantsAsync(q);
    protected override void OnOpen(SellableItem item) => Shell.Navigate(Routes.Product, item.ProductId);
    public bool CanManage => Can(Perm.ProductManage);

    public IAsyncRelayCommand AssignBarcodesCommand => new AsyncRelayCommand(() => RunAsync(async () =>
    {
        var n = await App.Catalog.AssignMissingBarcodesAsync();
        Shell.Toast.Success(n == 0 ? "Every variant already has a barcode." : $"Generated barcodes for {n} variant(s).");
        await LoadAsync();
    }));

    protected override IReadOnlyList<ExportColumn<SellableItem>> ExportColumns => new ExportColumn<SellableItem>[]
    {
        new("Product", v => v.ProductName), new("Variant", v => v.VariantName), new("SKU", v => v.Sku), new("Barcode", v => v.Barcode),
        new("Category", v => v.CategoryName), new("Price", v => v.SellingPrice), new("Cost", v => v.CostPrice), new("On hand", v => v.OnHand), new("Available", v => v.Available),
    };
}

public sealed partial class LabelRow : ObservableObject
{
    public required SellableItem Item { get; init; }
    [ObservableProperty] private bool _selected;
    [ObservableProperty] private int _copies = 1;
}

public sealed partial class BarcodeViewModel : PageViewModel
{
    public BarcodeViewModel()
    {
        Title = "Barcode / QR labels";
        Subtitle = "Print price tags with barcodes for scanning at the billing counter. USB / Bluetooth scanners work as keyboards — scan into the POS box.";
    }

    public ObservableCollection<LabelRow> Rows { get; } = new();
    public IReadOnlyList<Option> Formats { get; } = new[] { new Option("A4", "A4 sheet — 24 labels (70 × 37 mm)"), new Option("ROLL", "Label printer roll — 50 × 25 mm") };
    [ObservableProperty] private string? _search;
    [ObservableProperty] private Option? _format;
    [ObservableProperty] private bool _useQr;

    public override async Task LoadAsync()
    {
        Format ??= Formats[0];
        var list = await App.Catalog.ListVariantsAsync(new ListQuery { Search = Search, PageSize = 300 });
        Rows.Clear();
        foreach (var v in list.Items) Rows.Add(new LabelRow { Item = v });
    }

    partial void OnSearchChanged(string? value) => _ = RunAsync(LoadAsync, showBusy: false);

    [RelayCommand] private void SelectAll() { foreach (var r in Rows) r.Selected = true; }
    [RelayCommand] private void SelectNone() { foreach (var r in Rows) r.Selected = false; }

    private async Task<List<LabelItem>> ItemsAsync()
    {
        var sel = Rows.Where(r => r.Selected && r.Copies > 0).ToList();
        if (sel.Count == 0) throw new BusinessRuleException("Tick the products to print labels for.");
        return await App.Documents.LabelItemsAsync(sel.Select(r => (r.Item.VariantId, r.Copies)));
    }

    private LabelFormat Fmt => Format?.Value == "ROLL" ? LabelFormat.Roll50x25 : LabelFormat.A4Sheet3x8;

    [RelayCommand] private Task PreviewAsync() => RunAsync(async () => await DocumentActions.PrintLabelsAsync(await ItemsAsync(), Fmt, UseQr, true));
    [RelayCommand] private Task PrintAsync() => RunAsync(async () => await DocumentActions.PrintLabelsAsync(await ItemsAsync(), Fmt, UseQr, false));
    [RelayCommand] private Task PdfAsync() => RunAsync(async () => await DocumentActions.SavePdfAsync(DocumentService.LabelsPdf(await ItemsAsync(), Fmt, UseQr), $"Labels {DateTime.Now:yyyyMMdd-HHmm}"));
}
