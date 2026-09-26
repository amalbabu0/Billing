import {
  BarChart3, Boxes, ClipboardList, Factory, Hammer, LifeBuoy, IndianRupee, LayoutDashboard, Package, Receipt, Settings, ShoppingBag, Truck, UserCog, Users, Wallet, Wrench,
  type LucideIcon,
} from 'lucide-react';
import { P } from '@/lib/perms';

export interface NavLeaf { label: string; to: string; perms?: string[]; end?: boolean }
export interface NavGroup { label: string; icon: LucideIcon; to?: string; perms?: string[]; children?: NavLeaf[] }

/** Sidebar structure. Items a role cannot use are hidden (the server still enforces every rule). */
export const NAV: NavGroup[] = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/', perms: [P.DashboardView] },
  {
    label: 'Sales', icon: Receipt, children: [
      { label: 'New invoice', to: '/pos', perms: [P.InvoiceCreate] },
      { label: 'Invoices', to: '/sales/invoices', perms: [P.InvoiceView] },
      { label: 'Quotations', to: '/sales/quotations', perms: [P.QuotationView] },
      { label: 'Sales orders', to: '/sales/orders', perms: [P.SalesOrderView] },
      { label: 'Payments', to: '/sales/payments', perms: [P.PaymentView] },
      { label: 'Cash register', to: '/cash', perms: [P.CashManage, P.CashApprove] },
      { label: 'Sales returns', to: '/sales/returns', perms: [P.ReturnView] },
      { label: 'Exchanges', to: '/sales/exchanges', perms: [P.ReturnView] },
    ],
  },
  {
    label: 'Customers', icon: Users, children: [
      { label: 'Customers', to: '/customers', perms: [P.CustomerView], end: true },
      { label: 'Customer ledger', to: '/customers/ledger', perms: [P.CustomerView] },
      { label: 'Outstanding payments', to: '/customers/outstanding', perms: [P.CustomerView, P.InvoiceView] },
      { label: 'Leads', to: '/crm/leads', perms: [P.LeadView] },
      { label: 'Follow-ups', to: '/crm/follow-ups', perms: [P.LeadView, P.CustomerView] },
    ],
  },
  {
    label: 'Products', icon: Package, children: [
      { label: 'Products', to: '/products', perms: [P.ProductView], end: true },
      { label: 'Categories', to: '/products/categories', perms: [P.ProductView] },
      { label: 'Brands', to: '/products/brands', perms: [P.ProductView] },
      { label: 'Variants', to: '/products/variants', perms: [P.ProductView] },
      { label: 'Barcode / QR', to: '/products/barcodes', perms: [P.ProductView] },
      { label: 'Import products', to: '/products/import', perms: [P.ProductImport] },
    ],
  },
  {
    label: 'Inventory', icon: Boxes, children: [
      { label: 'Current stock', to: '/inventory', perms: [P.InventoryView, P.ProductView], end: true },
      { label: 'Stock in', to: '/inventory/in', perms: [P.InventoryView] },
      { label: 'Stock movement', to: '/inventory/movements', perms: [P.InventoryView] },
      { label: 'Stock adjustment', to: '/inventory/adjustments', perms: [P.InventoryView] },
      { label: 'Reserved stock', to: '/inventory/reserved', perms: [P.InventoryView] },
      { label: 'Damaged stock', to: '/inventory/damaged', perms: [P.InventoryView] },
      { label: 'Low stock', to: '/inventory/low', perms: [P.InventoryView, P.ProductView] },
      { label: 'Locations', to: '/inventory/locations', perms: [P.InventoryView] },
      { label: 'Stock transfers', to: '/inventory/transfers', perms: [P.InventoryView, P.WarehouseManage] },
    ],
  },
  {
    label: 'Purchases', icon: ShoppingBag, children: [
      { label: 'New purchase', to: '/purchases/new', perms: [P.PurchaseManage] },
      { label: 'Purchase history', to: '/purchases', perms: [P.PurchaseView], end: true },
      { label: 'Suppliers', to: '/purchases/suppliers', perms: [P.SupplierView, P.PurchaseView] },
      { label: 'Supplier ledger', to: '/purchases/ledger', perms: [P.SupplierView, P.PurchaseView] },
      { label: 'Supplier payments', to: '/purchases/payments', perms: [P.SupplierPay, P.PurchaseView] },
    ],
  },
  {
    label: 'Custom orders', icon: Hammer, children: [
      { label: 'New custom order', to: '/custom-orders/new', perms: [P.CustomOrderManage] },
      { label: 'Production', to: '/custom-orders', perms: [P.CustomOrderView], end: true },
      { label: 'Ready for delivery', to: '/custom-orders/ready', perms: [P.CustomOrderView] },
      { label: 'Completed orders', to: '/custom-orders/completed', perms: [P.CustomOrderView] },
    ],
  },
  {
    label: 'Production', icon: Factory, children: [
      { label: 'Production board', to: '/production', perms: [P.ProductionView], end: true },
      { label: 'Production orders', to: '/production/orders', perms: [P.ProductionView] },
      { label: 'Raw materials', to: '/production/materials', perms: [P.RawMaterialView, P.ProductionView], end: true },
      { label: 'Material movements', to: '/production/materials/movements', perms: [P.RawMaterialView, P.ProductionView] },
      { label: 'Bills of material', to: '/production/boms', perms: [P.RawMaterialView, P.ProductionView] },
    ],
  },
  {
    label: 'Delivery', icon: Truck, children: [
      { label: 'Delivery board', to: '/delivery/all', perms: [P.DeliveryView] },
      { label: 'Pending', to: '/delivery/pending', perms: [P.DeliveryView] },
      { label: 'Scheduled', to: '/delivery/scheduled', perms: [P.DeliveryView] },
      { label: 'Out for delivery', to: '/delivery/out', perms: [P.DeliveryView] },
      { label: 'Delivered', to: '/delivery/delivered', perms: [P.DeliveryView] },
    ],
  },
  { label: 'Installation', icon: Wrench, to: '/installation', perms: [P.InstallationView] },
  {
    label: 'Service', icon: LifeBuoy, children: [
      { label: 'Service tickets', to: '/service/tickets', perms: [P.ServiceView] },
      { label: 'Warranties', to: '/service/warranties', perms: [P.WarrantyView, P.ServiceView] },
    ],
  },
  {
    label: 'GST & Tax', icon: IndianRupee, children: [
      { label: 'GST dashboard', to: '/gst', perms: [P.ReportGst], end: true },
      { label: 'GST sales listing', to: '/gst/sales', perms: [P.ReportGst] },
      { label: 'GST purchase listing', to: '/gst/purchases', perms: [P.ReportGst] },
      { label: 'Output tax', to: '/gst/output', perms: [P.ReportGst] },
      { label: 'Input tax', to: '/gst/input', perms: [P.ReportGst] },
      { label: 'CGST', to: '/gst/cgst', perms: [P.ReportGst] },
      { label: 'SGST', to: '/gst/sgst', perms: [P.ReportGst] },
      { label: 'IGST', to: '/gst/igst', perms: [P.ReportGst] },
      { label: 'HSN summary', to: '/gst/hsn', perms: [P.ReportGst] },
      { label: 'Tax rate summary', to: '/gst/rates', perms: [P.ReportGst] },
      { label: 'Invoice register', to: '/gst/register', perms: [P.ReportGst] },
      { label: 'Credit notes', to: '/gst/credit-notes', perms: [P.ReportGst] },
      { label: 'Debit notes', to: '/gst/debit-notes', perms: [P.ReportGst] },
      { label: 'GST reports', to: '/reports/gst', perms: [P.ReportGst] },
      { label: 'Export GST data', to: '/gst/export', perms: [P.ReportGst] },
    ],
  },
  { label: 'Expenses', icon: Wallet, to: '/expenses', perms: [P.ExpenseView] },
  {
    label: 'Reports', icon: BarChart3, children: [
      { label: 'Analytics', to: '/analytics', perms: [P.ReportSales] },
      { label: 'Sales', to: '/reports/sales', perms: [P.ReportSales] },
      { label: 'Purchases', to: '/reports/purchases', perms: [P.ReportPurchase] },
      { label: 'Profit', to: '/reports/profit', perms: [P.ReportProfit] },
      { label: 'Inventory', to: '/reports/inventory', perms: [P.ReportInventory] },
      { label: 'Customers', to: '/reports/customers', perms: [P.ReportSales] },
      { label: 'Suppliers', to: '/reports/suppliers', perms: [P.ReportPurchase] },
      { label: 'Payments', to: '/reports/payments', perms: [P.ReportPayment] },
      { label: 'Outstanding', to: '/reports/outstanding', perms: [P.ReportPayment] },
      { label: 'Expenses', to: '/reports/expenses', perms: [P.ReportProfit] },
      { label: 'GST', to: '/reports/gst', perms: [P.ReportGst] },
    ],
  },
  {
    label: 'Employees', icon: UserCog, children: [
      { label: 'Users', to: '/employees/users', perms: [P.UserManage] },
      { label: 'Roles', to: '/employees/roles', perms: [P.RoleManage] },
      { label: 'Permissions', to: '/employees/permissions', perms: [P.RoleManage] },
      { label: 'Activity logs', to: '/employees/activity', perms: [P.AuditView] },
    ],
  },
  {
    label: 'Settings', icon: Settings, children: [
      { label: 'Shop', to: '/settings/shop', perms: [P.SettingsManage] },
      { label: 'GST', to: '/settings/gst', perms: [P.SettingsManage] },
      { label: 'Invoice', to: '/settings/invoice', perms: [P.SettingsManage] },
      { label: 'Tax', to: '/settings/tax', perms: [P.SettingsManage] },
      { label: 'Payments', to: '/settings/payments', perms: [P.SettingsManage] },
      { label: 'Printer', to: '/settings/printer', perms: [P.SettingsManage] },
      { label: 'WhatsApp', to: '/settings/whatsapp', perms: [P.SettingsManage] },
      { label: 'Backup', to: '/settings/backup', perms: [P.BackupManage] },
      { label: 'Security', to: '/settings/security', perms: [P.SettingsManage] },
    ],
  },
];

export const QUICK_ICONS = { ClipboardList };
