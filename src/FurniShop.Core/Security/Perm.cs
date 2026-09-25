namespace FurniShop.Core.Security;

/// <summary>Permission codes. Must match the rows in the <c>permissions</c> table.</summary>
public static class Perm
{
    public const string DashboardView = "dashboard.view";
    public const string InvoiceView = "invoice.view";
    public const string InvoiceCreate = "invoice.create";
    public const string InvoiceDiscount = "invoice.discount";
    public const string InvoiceCancel = "invoice.cancel";
    public const string QuotationView = "quotation.view";
    public const string QuotationManage = "quotation.manage";
    public const string SalesOrderView = "salesorder.view";
    public const string SalesOrderManage = "salesorder.manage";
    public const string PaymentView = "payment.view";
    public const string PaymentReceive = "payment.receive";
    public const string PaymentVoid = "payment.void";
    public const string PaymentRefund = "payment.refund";
    public const string ReturnView = "return.view";
    public const string ReturnManage = "return.manage";
    public const string CustomerView = "customer.view";
    public const string CustomerManage = "customer.manage";
    public const string CustomerDelete = "customer.delete";
    public const string ProductView = "product.view";
    public const string ProductManage = "product.manage";
    public const string ProductDelete = "product.delete";
    public const string CostView = "cost.view";
    public const string InventoryView = "inventory.view";
    public const string InventoryAdjust = "inventory.adjust";
    public const string PurchaseView = "purchase.view";
    public const string PurchaseManage = "purchase.manage";
    public const string SupplierView = "supplier.view";
    public const string SupplierManage = "supplier.manage";
    public const string SupplierPay = "supplier.pay";
    public const string CustomOrderView = "customorder.view";
    public const string CustomOrderManage = "customorder.manage";
    public const string DeliveryView = "delivery.view";
    public const string DeliveryManage = "delivery.manage";
    public const string InstallationView = "installation.view";
    public const string InstallationManage = "installation.manage";
    public const string ExpenseView = "expense.view";
    public const string ExpenseManage = "expense.manage";
    public const string ReportSales = "report.sales";
    public const string ReportInventory = "report.inventory";
    public const string ReportPurchase = "report.purchase";
    public const string ReportPayment = "report.payment";
    public const string ReportGst = "report.gst";
    public const string ReportProfit = "report.profit";
    public const string ExportData = "export.data";
    public const string UserManage = "user.manage";
    public const string RoleManage = "role.manage";
    public const string AuditView = "audit.view";
    public const string SettingsManage = "settings.manage";
    public const string BackupManage = "backup.manage";
}
