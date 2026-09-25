using FurniShop.Core;
using FurniShop.Core.Security;
using FurniShop.Wpf.Services;

namespace FurniShop.Wpf.ViewModels;

public enum EditorMode { Invoice, Quotation, SalesOrder }

/// <summary>Parameters for the POS-style document editor.</summary>
public sealed record EditorArgs(EditorMode Mode, long? Id = null, long? CustomerId = null)
{
    public static EditorArgs NewInvoice(long? customerId = null) => new(EditorMode.Invoice, null, customerId);
    public override string ToString() => $"{Mode}:{Id}";
}

/// <summary>Route table. Every route declares the permission needed to open it (checked again by the services).</summary>
public static class Routes
{
    public const string Dashboard = "dashboard", Pos = "pos", Invoices = "invoices", Invoice = "invoice", Quotations = "quotations",
        Quotation = "quotation", SalesOrders = "salesorders", SalesOrder = "salesorder", Payments = "payments", Returns = "returns",
        ReturnNew = "return-new", Exchanges = "exchanges", ExchangeNew = "exchange-new", Customers = "customers", Customer = "customer",
        Ledger = "ledger", Outstanding = "outstanding", Products = "products", Product = "product", ProductNew = "product-new",
        Categories = "categories", Variants = "variants", Barcodes = "barcodes", Stock = "stock", StockIn = "stock-in",
        StockAdjust = "stock-adjust", Reserved = "reserved", Movements = "movements", Purchase = "purchase", Purchases = "purchases",
        PurchaseDetail = "purchase-detail", Suppliers = "suppliers", Supplier = "supplier", SupplierPayments = "supplier-payments",
        CustomOrder = "customorder", CustomOrders = "customorders", CustomOrderDetail = "customorder-detail", Deliveries = "deliveries",
        Delivery = "delivery", Installations = "installations", Expenses = "expenses", Reports = "reports", Users = "users",
        Roles = "roles", Activity = "activity", Settings = "settings";

    private static long Id(object? p) => p switch { long l => l, int i => i, string s when long.TryParse(s, out var v) => v, _ => 0 };

    public static PageViewModel Create(string route, object? p)
    {
        var s = AppHost.App.Session;
        void Need(params string[] perms)
        {
            if (!perms.Any(s.Has)) throw new PermissionDeniedException(perms[0]);
        }

        switch (route)
        {
            case Dashboard: Need(Perm.DashboardView); return new DashboardViewModel();
            case Pos:
                var args = p as EditorArgs ?? EditorArgs.NewInvoice();
                Need(args.Mode switch { EditorMode.Quotation => Perm.QuotationManage, EditorMode.SalesOrder => Perm.SalesOrderManage, _ => Perm.InvoiceCreate });
                return new SalesEditorViewModel(args);
            case Invoices: Need(Perm.InvoiceView, Perm.InvoiceCreate); return new InvoiceListViewModel(p as string);
            case Invoice: Need(Perm.InvoiceView, Perm.InvoiceCreate); return new InvoiceDetailViewModel(Id(p));
            case Quotations: Need(Perm.QuotationView); return new QuotationListViewModel();
            case Quotation: Need(Perm.QuotationView); return new QuotationDetailViewModel(Id(p));
            case SalesOrders: Need(Perm.SalesOrderView); return new SalesOrderListViewModel();
            case SalesOrder: Need(Perm.SalesOrderView, Perm.DeliveryView); return new SalesOrderDetailViewModel(Id(p));
            case Payments: Need(Perm.PaymentView); return new PaymentListViewModel();
            case Returns: Need(Perm.ReturnView); return new ReturnListViewModel();
            case ReturnNew: Need(Perm.ReturnManage); return new ReturnEditorViewModel(Id(p) == 0 ? null : Id(p));
            case Exchanges: Need(Perm.ReturnView); return new ExchangeListViewModel();
            case ExchangeNew: Need(Perm.ReturnManage); return new ExchangeEditorViewModel(Id(p) == 0 ? null : Id(p));
            case Customers: Need(Perm.CustomerView); return new CustomerListViewModel();
            case Customer: Need(Perm.CustomerView); return new CustomerDetailViewModel(Id(p));
            case Ledger: Need(Perm.CustomerView); return new LedgerViewModel(Id(p) == 0 ? null : Id(p));
            case Outstanding: Need(Perm.PaymentView); return new OutstandingViewModel();
            case Products: Need(Perm.ProductView); return new ProductListViewModel();
            case Product: Need(Perm.ProductView); return new ProductEditorViewModel(Id(p));
            case ProductNew: Need(Perm.ProductManage); return new ProductEditorViewModel(0);
            case Categories: Need(Perm.ProductView); return new CategoriesViewModel();
            case Variants: Need(Perm.ProductView); return new VariantListViewModel();
            case Barcodes: Need(Perm.ProductView); return new BarcodeViewModel();
            case Stock: Need(Perm.InventoryView); return new StockViewModel(p as string);
            case StockIn: case StockAdjust: Need(Perm.InventoryAdjust); return new StockAdjustViewModel(p as string ?? Core.Domain.AdjustmentType.Increase, route == StockIn);
            case Reserved: Need(Perm.InventoryView); return new ReservedStockViewModel();
            case Movements: Need(Perm.InventoryView); return new MovementListViewModel(Id(p) == 0 ? null : Id(p));
            case Purchase: Need(Perm.PurchaseManage); return new PurchaseEditorViewModel(Id(p));
            case Purchases: Need(Perm.PurchaseView); return new PurchaseListViewModel();
            case PurchaseDetail: Need(Perm.PurchaseView); return new PurchaseDetailViewModel(Id(p));
            case Suppliers: Need(Perm.SupplierView, Perm.PurchaseView); return new SupplierListViewModel();
            case Supplier: Need(Perm.SupplierView, Perm.PurchaseView); return new SupplierDetailViewModel(Id(p));
            case SupplierPayments: Need(Perm.SupplierPay, Perm.PurchaseView); return new SupplierPaymentListViewModel();
            case CustomOrder: Need(Perm.CustomOrderManage); return new CustomOrderEditorViewModel(Id(p));
            case CustomOrders: Need(Perm.CustomOrderView); return new CustomOrderListViewModel(p as string ?? "ACTIVE");
            case CustomOrderDetail: Need(Perm.CustomOrderView); return new CustomOrderDetailViewModel(Id(p));
            case Deliveries: Need(Perm.DeliveryView); return new DeliveryListViewModel(p as string);
            case Delivery: Need(Perm.DeliveryView); return new DeliveryDetailViewModel(Id(p));
            case Installations: Need(Perm.InstallationView); return new InstallationListViewModel();
            case Expenses: Need(Perm.ExpenseView); return new ExpenseListViewModel();
            case Reports: return new ReportsViewModel(p as string);
            case Users: Need(Perm.UserManage); return new UserListViewModel();
            case Roles: Need(Perm.RoleManage); return new RolesViewModel();
            case Activity: Need(Perm.AuditView); return new ActivityLogViewModel();
            case Settings: Need(Perm.SettingsManage, Perm.BackupManage); return new SettingsViewModel(p as string ?? "shop");
            default: throw new ArgumentException($"Unknown route {route}");
        }
    }
}
