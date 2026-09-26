using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Documents;
using FurniShop.Infrastructure.Security;
using FurniShop.Infrastructure.Services;

namespace FurniShop.Infrastructure;

/// <summary>
/// Composition root. The desktop app and CLI create one per process; the web server creates one per request
/// around a shared <see cref="Database.Db"/> (connection pool) and that request's signed-in <see cref="UserSession"/>.
/// </summary>
public sealed class AppServices : IAsyncDisposable
{
    private readonly bool _ownsDb;

    public AppServices(string connectionString) : this(new Db(connectionString), new UserSession(), ownsDb: true) { }

    public AppServices(Db db, UserSession session, bool ownsDb = false)
    {
        _ownsDb = ownsDb;
        Db = db;
        Session = session;
        Audit = new AuditService(Db, Session);
        Settings = new SettingsService(Db, Session, Audit);
        Inventory = new InventoryService(Db, Session, Audit, Settings);
        Attachments = new AttachmentService(Db, Session);
        Catalog = new CatalogService(Db, Session, Audit, Inventory);
        Customers = new CustomerService(Db, Session, Audit);
        Suppliers = new SupplierService(Db, Session, Audit);
        Payments = new PaymentService(Db, Session, Audit);
        Invoices = new InvoiceService(Db, Session, Audit, Settings, Inventory, Payments);
        SalesOrders = new SalesOrderService(Db, Session, Audit, Inventory, Payments, Invoices);
        Quotations = new QuotationService(Db, Session, Audit, SalesOrders);
        Returns = new ReturnService(Db, Session, Audit, Inventory, Payments, Invoices);
        CustomOrders = new CustomOrderService(Db, Session, Audit, Invoices, Payments);
        Purchases = new PurchaseService(Db, Session, Audit, Inventory);
        Deliveries = new DeliveryService(Db, Session, Audit, Attachments);
        Installations = new InstallationService(Db, Session, Audit, Attachments);
        Expenses = new ExpenseService(Db, Session, Audit);
        Auth = new AuthService(Db, Session, Audit);
        Users = new UserService(Db, Session, Audit);
        Reports = new ReportService(Db, Session);
        Dashboard = new DashboardService(Db, Session);
        Search = new SearchService(Db, Session);
        Notifications = new NotificationService(Db, Session, Settings);
        Backup = new BackupService(Db, Session, Audit, Settings);
        Gst = new GstService(Db, Session);
        PurchaseReturns = new PurchaseReturnService(Db, Session, Audit, Inventory);
        Workspace = new WorkspaceService(Db, Session, Catalog);
        Locations = new LocationService(Db, Session, Audit, Inventory);
        Production = new ProductionService(Db, Session, Audit, Inventory);
        ServiceDesk = new ServiceDeskService(Db, Session, Audit, Invoices);
        Crm = new CrmService(Db, Session, Audit, Customers);
        Cash = new CashRegisterService(Db, Session, Audit);
        Lifecycle = new LifecycleService(Db, Session);
        ProductImport = new ProductImportService(Db, Session, Audit, Catalog);
        Analytics = new AnalyticsService(Db, Session);
        Documents = new DocumentService(this);
        Migrator = new Migrator(Db);
    }

    public LocationService Locations { get; }
    public ProductionService Production { get; }
    public ServiceDeskService ServiceDesk { get; }
    public CrmService Crm { get; }
    public CashRegisterService Cash { get; }
    public LifecycleService Lifecycle { get; }
    public ProductImportService ProductImport { get; }
    public AnalyticsService Analytics { get; }
    public Db Db { get; }
    public UserSession Session { get; }
    public AuditService Audit { get; }
    public SettingsService Settings { get; }
    public InventoryService Inventory { get; }
    public AttachmentService Attachments { get; }
    public CatalogService Catalog { get; }
    public CustomerService Customers { get; }
    public SupplierService Suppliers { get; }
    public PaymentService Payments { get; }
    public InvoiceService Invoices { get; }
    public SalesOrderService SalesOrders { get; }
    public QuotationService Quotations { get; }
    public ReturnService Returns { get; }
    public CustomOrderService CustomOrders { get; }
    public PurchaseService Purchases { get; }
    public DeliveryService Deliveries { get; }
    public InstallationService Installations { get; }
    public ExpenseService Expenses { get; }
    public AuthService Auth { get; }
    public UserService Users { get; }
    public ReportService Reports { get; }
    public DashboardService Dashboard { get; }
    public SearchService Search { get; }
    public NotificationService Notifications { get; }
    public BackupService Backup { get; }
    public GstService Gst { get; }
    public PurchaseReturnService PurchaseReturns { get; }
    public WorkspaceService Workspace { get; }
    public DocumentService Documents { get; }
    public Migrator Migrator { get; }

    public ValueTask DisposeAsync() => _ownsDb ? Db.DisposeAsync() : ValueTask.CompletedTask;
}
