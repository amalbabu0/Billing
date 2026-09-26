import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { P } from '@/lib/perms';
import { SessionProvider, ToastProvider, useCan, useSession } from './providers';
import { ConfirmProvider } from '@/components/ui/overlay';
import { EmptyState, Skeleton } from '@/components/ui/display';
import { Shell } from './Shell';
import { ChangePasswordModal, LoginScreen, SetupScreen } from './auth';

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Pos = lazy(() => import('@/pages/pos/Pos'));
const Invoices = lazy(() => import('@/pages/sales/Invoices'));
const InvoiceDetail = lazy(() => import('@/pages/sales/InvoiceDetail'));
const Quotations = lazy(() => import('@/pages/sales/Quotations'));
const QuotationDetail = lazy(() => import('@/pages/sales/QuotationDetail'));
const DocEditor = lazy(() => import('@/pages/sales/DocEditor'));
const SalesOrders = lazy(() => import('@/pages/sales/SalesOrders'));
const SalesOrderDetail = lazy(() => import('@/pages/sales/SalesOrderDetail'));
const Payments = lazy(() => import('@/pages/sales/Payments'));
const Returns = lazy(() => import('@/pages/sales/Returns'));
const NewReturn = lazy(() => import('@/pages/sales/NewReturn'));
const Exchanges = lazy(() => import('@/pages/sales/Exchanges'));
const Customers = lazy(() => import('@/pages/customers/Customers'));
const CustomerProfile = lazy(() => import('@/pages/customers/CustomerProfile'));
const CustomerLedger = lazy(() => import('@/pages/customers/CustomerLedger'));
const Outstanding = lazy(() => import('@/pages/customers/Outstanding'));
const Products = lazy(() => import('@/pages/products/Products'));
const ProductEditor = lazy(() => import('@/pages/products/ProductEditor'));
const ProductDetail = lazy(() => import('@/pages/products/ProductDetail'));
const Categories = lazy(() => import('@/pages/products/Categories'));
const Brands = lazy(() => import('@/pages/products/Brands'));
const Variants = lazy(() => import('@/pages/products/Variants'));
const Barcodes = lazy(() => import('@/pages/products/Barcodes'));
const Stock = lazy(() => import('@/pages/inventory/Stock'));
const Movements = lazy(() => import('@/pages/inventory/Movements'));
const Reserved = lazy(() => import('@/pages/inventory/Reserved'));
const Purchases = lazy(() => import('@/pages/purchases/Purchases'));
const PurchaseEditor = lazy(() => import('@/pages/purchases/PurchaseEditor'));
const PurchaseDetail = lazy(() => import('@/pages/purchases/PurchaseDetail'));
const Suppliers = lazy(() => import('@/pages/purchases/Suppliers'));
const SupplierLedger = lazy(() => import('@/pages/purchases/SupplierLedger'));
const SupplierPayments = lazy(() => import('@/pages/purchases/SupplierPayments'));
const Locations = lazy(() => import('@/pages/inventory/Locations'));
const Transfers = lazy(() => import('@/pages/inventory/Transfers'));
const RawMaterials = lazy(() => import('@/pages/production/RawMaterials'));
const Boms = lazy(() => import('@/pages/production/Boms'));
const BomEditor = lazy(() => import('@/pages/production/Boms').then(m => ({ default: m.BomEditor })));
const Production = lazy(() => import('@/pages/production/Production'));
const CustomOrders = lazy(() => import('@/pages/custom/CustomOrders'));
const CustomOrderEditor = lazy(() => import('@/pages/custom/CustomOrderEditor'));
const CustomOrderDetail = lazy(() => import('@/pages/custom/CustomOrderDetail'));
const Deliveries = lazy(() => import('@/pages/delivery/Deliveries'));
const Installations = lazy(() => import('@/pages/Installations'));
const Expenses = lazy(() => import('@/pages/Expenses'));
const GstDashboard = lazy(() => import('@/pages/gst/GstDashboard'));
const GstListing = lazy(() => import('@/pages/gst/GstListing'));
const GstLedger = lazy(() => import('@/pages/gst/GstLedger'));
const GstSummaries = lazy(() => import('@/pages/gst/GstSummaries'));
const GstRegister = lazy(() => import('@/pages/gst/GstRegister'));
const GstExport = lazy(() => import('@/pages/gst/GstExport'));
const Reports = lazy(() => import('@/pages/reports/Reports'));
const Users = lazy(() => import('@/pages/employees/Users'));
const Roles = lazy(() => import('@/pages/employees/Roles'));
const Activity = lazy(() => import('@/pages/employees/Activity'));
const Settings = lazy(() => import('@/pages/settings/Settings'));

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <SessionProvider>
          <ConfirmProvider>
            <Gate />
          </ConfirmProvider>
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

function Gate() {
  const { me, loading } = useSession();
  const status = useQuery({ queryKey: ['auth-status'], queryFn: () => api.get<{ needsSetup: boolean }>('/api/auth/status'), enabled: !loading && !me, staleTime: Infinity });
  if (loading || (!me && status.isLoading)) return <Splash />;
  if (!me) return status.data?.needsSetup ? <SetupScreen /> : <LoginScreen />;
  return (
    <>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Page perms={[P.DashboardView]} fallback="/pos"><Dashboard /></Page>} />
          <Route path="pos" element={<Page perms={[P.InvoiceCreate]}><Pos /></Page>} />
          <Route path="pos/:draftId" element={<Page perms={[P.InvoiceCreate]}><Pos /></Page>} />

          <Route path="sales/invoices" element={<Page perms={[P.InvoiceView]}><Invoices /></Page>} />
          <Route path="sales/invoices/:id" element={<Page perms={[P.InvoiceView]}><InvoiceDetail /></Page>} />
          <Route path="sales/quotations" element={<Page perms={[P.QuotationView]}><Quotations /></Page>} />
          <Route path="sales/quotations/new" element={<Page perms={[P.QuotationManage]}><DocEditor kind="quotation" /></Page>} />
          <Route path="sales/quotations/:id" element={<Page perms={[P.QuotationView]}><QuotationDetail /></Page>} />
          <Route path="sales/quotations/:id/edit" element={<Page perms={[P.QuotationManage]}><DocEditor kind="quotation" /></Page>} />
          <Route path="sales/orders" element={<Page perms={[P.SalesOrderView]}><SalesOrders /></Page>} />
          <Route path="sales/orders/new" element={<Page perms={[P.SalesOrderManage]}><DocEditor kind="order" /></Page>} />
          <Route path="sales/orders/:id" element={<Page perms={[P.SalesOrderView]}><SalesOrderDetail /></Page>} />
          <Route path="sales/orders/:id/edit" element={<Page perms={[P.SalesOrderManage]}><DocEditor kind="order" /></Page>} />
          <Route path="sales/payments" element={<Page perms={[P.PaymentView]}><Payments /></Page>} />
          <Route path="sales/returns" element={<Page perms={[P.ReturnView]}><Returns /></Page>} />
          <Route path="sales/returns/new" element={<Page perms={[P.ReturnManage]}><NewReturn /></Page>} />
          <Route path="sales/exchanges" element={<Page perms={[P.ReturnView]}><Exchanges /></Page>} />

          <Route path="customers" element={<Page perms={[P.CustomerView]}><Customers /></Page>} />
          <Route path="customers/ledger" element={<Page perms={[P.CustomerView]}><CustomerLedger /></Page>} />
          <Route path="customers/outstanding" element={<Page perms={[P.CustomerView, P.InvoiceView]}><Outstanding /></Page>} />
          <Route path="customers/:id" element={<Page perms={[P.CustomerView]}><CustomerProfile /></Page>} />

          <Route path="products" element={<Page perms={[P.ProductView]}><Products /></Page>} />
          <Route path="products/new" element={<Page perms={[P.ProductManage]}><ProductEditor /></Page>} />
          <Route path="products/categories" element={<Page perms={[P.ProductView]}><Categories /></Page>} />
          <Route path="products/brands" element={<Page perms={[P.ProductView]}><Brands /></Page>} />
          <Route path="products/variants" element={<Page perms={[P.ProductView]}><Variants /></Page>} />
          <Route path="products/barcodes" element={<Page perms={[P.ProductView]}><Barcodes /></Page>} />
          <Route path="products/:id" element={<Page perms={[P.ProductView]}><ProductDetail /></Page>} />
          <Route path="products/:id/edit" element={<Page perms={[P.ProductManage]}><ProductEditor /></Page>} />

          <Route path="inventory" element={<Page perms={[P.InventoryView, P.ProductView]}><Stock mode="all" /></Page>} />
          <Route path="inventory/low" element={<Page perms={[P.InventoryView, P.ProductView]}><Stock mode="low" /></Page>} />
          <Route path="inventory/damaged" element={<Page perms={[P.InventoryView]}><Stock mode="damaged" /></Page>} />
          <Route path="inventory/in" element={<Page perms={[P.InventoryView]}><Movements mode="in" /></Page>} />
          <Route path="inventory/movements" element={<Page perms={[P.InventoryView]}><Movements mode="all" /></Page>} />
          <Route path="inventory/adjustments" element={<Page perms={[P.InventoryView]}><Movements mode="adjustments" /></Page>} />
          <Route path="inventory/reserved" element={<Page perms={[P.InventoryView]}><Reserved /></Page>} />
          <Route path="inventory/locations" element={<Page perms={[P.InventoryView]}><Locations /></Page>} />
          <Route path="inventory/transfers" element={<Page perms={[P.InventoryView, P.WarehouseManage]}><Transfers /></Page>} />
          <Route path="production" element={<Page perms={[P.ProductionView]}><Production mode="board" /></Page>} />
          <Route path="production/orders" element={<Page perms={[P.ProductionView]}><Production mode="list" /></Page>} />
          <Route path="production/materials" element={<Page perms={[P.RawMaterialView, P.ProductionView]}><RawMaterials view="materials" /></Page>} />
          <Route path="production/materials/movements" element={<Page perms={[P.RawMaterialView, P.ProductionView]}><RawMaterials view="movements" /></Page>} />
          <Route path="production/boms" element={<Page perms={[P.RawMaterialView, P.ProductionView]}><Boms /></Page>} />
          <Route path="production/boms/:variantId" element={<Page perms={[P.RawMaterialView, P.ProductionView]}><BomEditor /></Page>} />

          <Route path="purchases" element={<Page perms={[P.PurchaseView]}><Purchases /></Page>} />
          <Route path="purchases/new" element={<Page perms={[P.PurchaseManage]}><PurchaseEditor /></Page>} />
          <Route path="purchases/suppliers" element={<Page perms={[P.SupplierView, P.PurchaseView]}><Suppliers /></Page>} />
          <Route path="purchases/suppliers/:id" element={<Page perms={[P.SupplierView, P.PurchaseView]}><SupplierLedger /></Page>} />
          <Route path="purchases/ledger" element={<Page perms={[P.SupplierView, P.PurchaseView]}><SupplierLedger /></Page>} />
          <Route path="purchases/payments" element={<Page perms={[P.SupplierPay, P.PurchaseView]}><SupplierPayments /></Page>} />
          <Route path="purchases/:id" element={<Page perms={[P.PurchaseView]}><PurchaseDetail /></Page>} />
          <Route path="purchases/:id/edit" element={<Page perms={[P.PurchaseManage]}><PurchaseEditor /></Page>} />

          <Route path="custom-orders" element={<Page perms={[P.CustomOrderView]}><CustomOrders view="production" /></Page>} />
          <Route path="custom-orders/ready" element={<Page perms={[P.CustomOrderView]}><CustomOrders view="ready" /></Page>} />
          <Route path="custom-orders/completed" element={<Page perms={[P.CustomOrderView]}><CustomOrders view="completed" /></Page>} />
          <Route path="custom-orders/new" element={<Page perms={[P.CustomOrderManage]}><CustomOrderEditor /></Page>} />
          <Route path="custom-orders/:id" element={<Page perms={[P.CustomOrderView]}><CustomOrderDetail /></Page>} />
          <Route path="custom-orders/:id/edit" element={<Page perms={[P.CustomOrderManage]}><CustomOrderEditor /></Page>} />

          <Route path="delivery" element={<Navigate to="/delivery/all" replace />} />
          <Route path="delivery/:view" element={<Page perms={[P.DeliveryView]}><Deliveries /></Page>} />
          <Route path="installation" element={<Page perms={[P.InstallationView]}><Installations /></Page>} />
          <Route path="expenses" element={<Page perms={[P.ExpenseView]}><Expenses /></Page>} />

          <Route path="gst" element={<Page perms={[P.ReportGst]}><GstDashboard /></Page>} />
          <Route path="gst/sales" element={<Page perms={[P.ReportGst]}><GstListing kind="sales" /></Page>} />
          <Route path="gst/purchases" element={<Page perms={[P.ReportGst]}><GstListing kind="purchases" /></Page>} />
          <Route path="gst/credit-notes" element={<Page perms={[P.ReportGst]}><GstListing kind="credit" /></Page>} />
          <Route path="gst/debit-notes" element={<Page perms={[P.ReportGst]}><GstListing kind="debit" /></Page>} />
          <Route path="gst/output" element={<Page perms={[P.ReportGst]}><GstLedger view="output" /></Page>} />
          <Route path="gst/input" element={<Page perms={[P.ReportGst]}><GstLedger view="input" /></Page>} />
          <Route path="gst/cgst" element={<Page perms={[P.ReportGst]}><GstLedger view="CGST" /></Page>} />
          <Route path="gst/sgst" element={<Page perms={[P.ReportGst]}><GstLedger view="SGST" /></Page>} />
          <Route path="gst/igst" element={<Page perms={[P.ReportGst]}><GstLedger view="IGST" /></Page>} />
          <Route path="gst/hsn" element={<Page perms={[P.ReportGst]}><GstSummaries view="hsn" /></Page>} />
          <Route path="gst/rates" element={<Page perms={[P.ReportGst]}><GstSummaries view="rates" /></Page>} />
          <Route path="gst/register" element={<Page perms={[P.ReportGst]}><GstRegister /></Page>} />
          <Route path="gst/export" element={<Page perms={[P.ReportGst]}><GstExport /></Page>} />

          <Route path="reports" element={<Navigate to="/reports/sales" replace />} />
          <Route path="reports/:group" element={<Page><Reports /></Page>} />

          <Route path="employees/users" element={<Page perms={[P.UserManage]}><Users /></Page>} />
          <Route path="employees/roles" element={<Page perms={[P.RoleManage]}><Roles view="roles" /></Page>} />
          <Route path="employees/permissions" element={<Page perms={[P.RoleManage]}><Roles view="matrix" /></Page>} />
          <Route path="employees/activity" element={<Page perms={[P.AuditView]}><Activity /></Page>} />

          <Route path="settings" element={<Navigate to="/settings/shop" replace />} />
          <Route path="settings/:section" element={<Page perms={[P.SettingsManage, P.BackupManage]}><Settings /></Page>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <ChangePasswordModal open={me.mustChangePassword} onClose={() => {}} forced />
    </>
  );
}

/** Route guard: shows a clear message (not a blank page) when the role lacks access. */
function Page({ perms, children, fallback }: { perms?: string[]; children: ReactNode; fallback?: string }) {
  const can = useCan();
  if (perms && !can(...perms)) {
    if (fallback) return <Navigate to={fallback} replace />;
    return (
      <div className="page">
        <EmptyState icon={<ShieldAlert />} title="You don’t have access to this page" desc="Your role doesn’t include this area. Ask the owner or a manager if you need it." />
      </div>
    );
  }
  return <Suspense fallback={<PageSkeleton />}>{children}</Suspense>;
}

function PageSkeleton() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <div className="stack gap-2"><Skeleton w={220} h={26} /><Skeleton w={360} h={14} /></div>
      <div className="kpi-row">{[0, 1, 2, 3].map(i => <div key={i} className="kpi"><Skeleton w="50%" /><Skeleton w="70%" h={28} /><Skeleton w="40%" /></div>)}</div>
      <div className="card" style={{ height: 320 }} />
    </div>
  );
}

function Splash() {
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }} aria-busy="true"><span className="muted">Loading FurniShop…</span></div>;
}

function NotFound() {
  return <div className="page"><EmptyState title="Page not found" desc="The link may be old. Use the menu or search (Ctrl K) to find what you need." /></div>;
}
