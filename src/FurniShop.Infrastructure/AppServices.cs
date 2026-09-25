using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Documents;
using FurniShop.Infrastructure.Security;
using FurniShop.Infrastructure.Services;

namespace FurniShop.Infrastructure;

/// <summary>Composition root: one instance per running application (and per test database).</summary>
public sealed class AppServices : IAsyncDisposable
{
    public AppServices(string connectionString)
    {
        Db = new Db(connectionString);
        Session = new UserSession();
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
        Installations = new InstallationService(Db, Session, Audit);
        Expenses = new ExpenseService(Db, Session, Audit);
        Auth = new AuthService(Db, Session, Audit);
        Users = new UserService(Db, Session, Audit);
        Reports = new ReportService(Db, Session);
        Dashboard = new DashboardService(Db, Session);
        Search = new SearchService(Db, Session);
        Notifications = new NotificationService(Db, Session);
        Backup = new BackupService(Db, Session, Audit, Settings);
        Documents = new DocumentService(this);
        Migrator = new Migrator(Db);
    }

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
    public DocumentService Documents { get; }
    public Migrator Migrator { get; }

    public ValueTask DisposeAsync() => Db.DisposeAsync();
}
