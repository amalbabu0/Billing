// Shapes returned by the API (server entities, camelCased). Dates arrive as ISO strings.

export interface Paged<T> { items: T[]; totalCount: number; page: number; pageSize: number; pageCount?: number }

export interface Me {
  user: { id: number; username: string; fullName: string; roleCode: string; roleName: string };
  permissions: string[];
  isAdmin: boolean;
  canSeeCost: boolean;
  mustChangePassword: boolean;
  shop: { name: string; tagline?: string; stateCode: string; stateName?: string; gstin?: string; logoAttachmentId?: number; city?: string; phone?: string; gstRegistered: boolean };
  security: { idleTimeoutMinutes: number; minPasswordLength: number };
}

export interface Category { id: number; name: string; parentId?: number; description?: string; defaultHsn?: string; defaultGstRate?: number; isActive: boolean; productCount: number }
export interface Brand { id: number; name: string; isActive: boolean; productCount?: number }
export interface GstRate { id: number; name: string; rate: number; isActive: boolean; isDefault: boolean }
export interface HsnCode { code: string; description: string; defaultGstRate: number; isActive: boolean }
export interface PaymentMethod { code: string; name: string; isActive: boolean; sortOrder: number; isMoney: boolean; isSystem: boolean }
export interface State { code: string; name: string }
export interface ExpenseCategory { id: number; name: string; isActive: boolean }

export type PricingMode = 'FIXED' | 'PER_UNIT' | 'PER_SQFT' | 'PER_RFT' | 'PER_SQM' | 'PER_KG' | 'CUSTOM';
export interface CustomerGroup { code: string; name: string; discountPercent: number }
export interface Lookups {
  customerGroups?: CustomerGroup[];
  states: State[];
  categories: Category[];
  brands: Brand[];
  gstRates: GstRate[];
  hsnCodes: HsnCode[];
  paymentMethods: PaymentMethod[];
  expenseCategories: ExpenseCategory[];
  staff: { id: number; fullName: string; roleCode: string; mobile?: string }[];
  defaults: {
    shopStateCode: string; gstRegistered: boolean; defaultGstRate: number; chargesGstRate: number; defaultPriceIncludesGst: boolean; defaultHsn: string;
    defaultDueDays: number; quotationValidityDays: number; roundOff: boolean; defaultPrintFormat: string;
    defaultDeliveryCharge: number; defaultInstallationCharge: number; requireOtp: boolean; allowNegativeStock: boolean; thermalWidthMm: number;
  };
}

export interface ProductRow {
  id: number; code: string; name: string; categoryId: number; categoryName?: string; brandName?: string; material?: string; finish?: string; color?: string;
  dimensions?: string; sku: string; defaultVariantId?: number; variantCount: number; variantNames?: string; sellingPrice: number; maxPrice?: number;
  costPrice?: number | null; gstRate: number; priceIncludesGst: boolean; onHand: number; reserved: number; available: number; minStock: number;
  isStockItem: boolean; status: string; imageAttachmentId?: number; stockState: string;
}

export interface Variant {
  id: number; productId: number; variantName: string; sku: string; barcode?: string; size?: string; color?: string; material?: string; fabric?: string;
  finish?: string; configuration?: string; design?: string; dimensions?: string; costPrice?: number | null; sellingPrice?: number | null; minStock?: number | null;
  imageAttachmentId?: number; isDefault: boolean; isActive: boolean; onHand: number; reserved: number; damaged: number; available: number; openingStock: number;
  pricingMode?: PricingMode; pricingRate?: number | null;
}

export interface Product {
  id: number; code: string; name: string; categoryId: number; categoryName?: string; brandId?: number | null; brandName?: string; material?: string; color?: string;
  size?: string; dimensions?: string; weightKg?: number | null; finish?: string; fabric?: string; warrantyMonths: number; hsnCode?: string; gstRate: number;
  priceIncludesGst: boolean; costPrice?: number | null; sellingPrice: number; discountPercent: number; minStock: number; description?: string; status: string;
  isStockItem: boolean; imageAttachmentId?: number | null; createdAt?: string; updatedAt?: string; onHand: number; reserved: number; available: number; variants: Variant[];
  warrantyTerms?: string;
}

export interface Sellable {
  variantId: number; productId: number; productName: string; variantName: string; sku: string; barcode?: string; categoryName?: string; categoryId: number;
  hsnCode?: string; gstRate: number; priceIncludesGst: boolean; sellingPrice: number; costPrice?: number | null; discountPercent: number; onHand: number;
  reserved: number; available: number; isStockItem: boolean; material?: string; color?: string; dimensions?: string; imageAttachmentId?: number;
  displayName: string; stockState: string; pricingMode?: PricingMode; pricingRate?: number | null;
}

export interface InventoryRow {
  variantId: number; productId: number; sku: string; barcode?: string; variantName: string; productName: string; productCode: string; categoryId: number;
  categoryName: string; onHand: number; reserved: number; damaged: number; displayQty: number; available: number; minStock: number; costPrice?: number | null;
  sellingPrice: number; isStockItem: boolean; stockValue?: number | null; stockState: string; displayName: string;
}

export interface Movement {
  id: number; variantId: number; sku?: string; productName?: string; movementType: string; onHandDelta: number; reservedDelta: number; damagedDelta: number;
  onHandAfter: number; reservedAfter: number; damagedAfter: number; unitCost?: number | null; refType?: string; refId?: number; refNumber?: string; note?: string;
  createdByName?: string; createdAt: string;
}

export interface Customer {
  id: number; code: string; name: string; mobile?: string; whatsapp?: string; email?: string; billingAddress?: string; city?: string; state?: string; stateCode?: string;
  pincode?: string; gstin?: string; notes?: string; isWalkIn: boolean; creditLimit: number; createdAt?: string; totalPurchases: number; outstanding: number;
  lastPurchaseDate?: string; display?: string; customerGroup?: string; customerGroupName?: string; groupDiscount?: number;
}

export interface CustomerSummary {
  customerId: number; totalPurchases: number; totalReturns: number; totalPaid: number; outstanding: number; advanceAmount: number; invoiceCount: number;
  openOrderCount: number; customOrderCount: number;
}

export interface LedgerEntry { date: string; docType: string; docNumber: string; docId: number; particulars: string; debit: number; credit: number; balance: number; createdAt: string }

export interface Supplier {
  id: number; code: string; name: string; contactPerson?: string; mobile?: string; whatsapp?: string; email?: string; address?: string; state?: string; stateCode?: string;
  gstin?: string; bankName?: string; bankAccount?: string; bankIfsc?: string; upiId?: string; notes?: string; totalPurchases: number; totalPaid: number; outstanding: number;
}

export interface DocLine {
  id: number; lineNo: number; variantId?: number; description: string; sku?: string; hsnCode?: string; quantity: number; unitPrice: number; priceIncludesGst: boolean;
  discountPercent: number; discountAmount: number; taxableAmount: number; gstRate: number; cgst: number; sgst: number; igst: number; lineTotal: number;
  unitCost?: number | null; reservedQty: number; returnedQty: number; sourceItemId?: number; tax: number; returnableQty: number;
}

export interface SalesDoc {
  id: number; number?: string; status: string; date: string; customerId: number; customerName: string; customerMobile?: string; customerGstin?: string;
  billingAddress?: string; deliveryAddress?: string; placeOfSupply?: string; isInterState: boolean; subtotal: number; discountTotal: number; taxableTotal: number;
  cgstTotal: number; sgstTotal: number; igstTotal: number; deliveryCharge: number; installationCharge: number; chargesTax: number; roundOff: number; grandTotal: number;
  notes?: string; terms?: string; createdByName?: string; createdAt: string; lines: DocLine[]; taxTotal: number;
}
export interface Quotation extends SalesDoc { validUntil?: string; salesOrderId?: number; salesOrderNumber?: string }
export interface SalesOrder extends SalesDoc {
  expectedDeliveryDate?: string; quotationId?: number; quotationNumber?: string; invoiceId?: number; invoiceNumber?: string; requiresDelivery: boolean;
  requiresInstallation: boolean; cancelReason?: string; advancePaid: number; balance: number; stockReserved: boolean;
}
export interface Invoice extends SalesDoc {
  dueDate?: string; salesOrderId?: number; salesOrderNumber?: string; quotationId?: number; quotationNumber?: string; customOrderId?: number; customOrderNumber?: string;
  costTotal?: number | null; requiresDelivery: boolean; requiresInstallation: boolean; finalizedAt?: string; cancelledAt?: string; cancelReason?: string;
  cancelledByName?: string; returnedAmount: number; paid: number; netTotal: number; balance: number; paymentState: string; margin?: number | null;
}
export interface InvoiceRow {
  id: number; number?: string; status: string; invoiceDate: string; dueDate?: string; customerId: number; customerName: string; customerMobile?: string;
  grandTotal: number; returnedAmount: number; paid: number; balance: number; createdByName?: string; daysOverdue: number; paymentState: string; displayNumber: string;
}

export interface PaymentLine { id: number; paymentId: number; methodCode: string; amount: number; reference?: string; chequeDate?: string; bankName?: string }
export interface PaymentAllocation { id: number; paymentId: number; docType: string; docId?: number; docNumber?: string; amount: number; note?: string; createdAt: string }
export interface Payment {
  id: number; number: string; direction: 'IN' | 'OUT'; customerId: number; customerName?: string; customerMobile?: string; paymentDate: string; amount: number;
  notes?: string; methods?: string; appliedTo?: string; createdByName?: string; createdAt: string; isVoided: boolean; voidedAt?: string; voidReason?: string;
  lines: PaymentLine[]; allocations: PaymentAllocation[]; state: string;
}
export interface DocumentPosition { docType: string; docId: number; number?: string; customerId: number; total: number; returned: number; paid: number; balance: number; customerAdvance: number }

export interface SalesReturn {
  id: number; number: string; invoiceId: number; invoiceNumber?: string; customerId: number; customerName?: string; returnDate: string; reason: string;
  creditAmount: number; refundAmount: number; refundPaymentId?: number; exchangeId?: number; notes?: string; createdByName?: string; createdAt: string;
  items: { id: number; invoiceItemId: number; variantId?: number; description?: string; quantity: number; condition: string; restockAction: string; creditAmount: number }[];
}
export interface Exchange {
  id: number; number: string; customerId: number; customerName?: string; originalInvoiceId: number; originalInvoiceNumber?: string; newInvoiceId?: number;
  newInvoiceNumber?: string; returnId?: number; returnNumber?: string; oldValue: number; newValue: number; transferredAmount: number; difference: number;
  notes?: string; createdAt: string; createdByName?: string;
}

export interface CustomOrder {
  id: number; number: string; customerId: number; customerName?: string; customerMobile?: string; orderDate: string; productType: string; design?: string;
  width?: number | null; height?: number | null; depth?: number | null; dimensionUnit: string; material?: string; color?: string; fabric?: string; finish?: string;
  doors?: number | null; drawers?: number | null; specialRequirements?: string; referenceAttachmentId?: number | null; estimatedCost: number; finalPrice: number;
  productionCost?: number | null; hsnCode?: string; gstRate: number; priceIncludesGst: boolean; expectedCompletionDate?: string; status: string;
  requiresInstallation: boolean; deliveryAddress?: string; notes?: string; invoiceId?: number; invoiceNumber?: string; cancelReason?: string; createdAt: string;
  createdByName?: string; advancePaid: number; balance: number; dimensionsText: string; isOverdue: boolean;
}
export interface StatusHistory { id: number; docType: string; docId: number; fromStatus?: string; toStatus: string; note?: string; changedByName?: string; changedAt: string }

export interface Purchase {
  id: number; number: string; supplierId: number; supplierName?: string; supplierInvoiceNo?: string; purchaseDate: string; dueDate?: string; status: string;
  isInterState: boolean; subtotal: number; discountTotal: number; taxableTotal: number; cgstTotal: number; sgstTotal: number; igstTotal: number; otherCharges: number;
  roundOff: number; grandTotal: number; notes?: string; returnedTotal: number; paid: number; netTotal: number; balance: number; createdAt: string; completedAt?: string;
  createdByName?: string; cancelReason?: string; paymentState: string;
  lines: { id: number; lineNo: number; variantId: number; description: string; sku?: string; hsnCode?: string; quantity: number; unitCost: number; discountPercent: number;
    discountAmount: number; taxableAmount: number; gstRate: number; cgst: number; sgst: number; igst: number; lineTotal: number; returnedQty: number; returnableQty: number }[];
  warehouseId?: number; warehouseName?: string;
}
export interface SupplierPayment {
  id: number; number: string; supplierId: number; supplierName?: string; paymentDate: string; amount: number; methodCode: string; reference?: string; notes?: string;
  appliedTo?: string; isVoided: boolean; voidReason?: string; createdByName?: string; createdAt: string;
}
export interface PurchaseReturn {
  id: number; number: string; purchaseId: number; purchaseNumber?: string; supplierId: number; supplierName?: string; returnDate: string; reason: string;
  taxableTotal: number; cgstTotal: number; sgstTotal: number; igstTotal: number; grandTotal: number; notes?: string; createdByName?: string; createdAt: string;
}

export interface Delivery {
  id: number; number: string; customerId: number; customerName?: string; customerMobile?: string; invoiceId?: number; invoiceNumber?: string; salesOrderId?: number;
  salesOrderNumber?: string; customOrderId?: number; customOrderNumber?: string; deliveryAddress: string; contactMobile?: string; scheduledDate?: string;
  timeSlot?: string; driverName?: string; driverUserId?: number; vehicleNo?: string; deliveryCharge: number; deliveryCost?: number | null; status: string;
  otpVerified: boolean; hasOtp: boolean; receiverName?: string; signatureAttachmentId?: number; photoAttachmentId?: number; remarks?: string; notes?: string;
  deliveredAt?: string; createdAt: string; itemsSummary?: string; items: { id: number; description: string; quantity: number }[]; sourceNumber: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'; route?: string; routeOrder?: number;
}
export interface Installation {
  id: number; number: string; customerId: number; customerName?: string; customerMobile?: string; deliveryId?: number; deliveryNumber?: string; invoiceId?: number;
  invoiceNumber?: string; salesOrderId?: number; customOrderId?: number; customOrderNumber?: string; address: string; technicianName?: string; technicianUserId?: number;
  scheduledDate?: string; completedAt?: string; status: string; installationCost?: number | null; notes?: string; completionNotes?: string; createdAt: string;
  completionPhotoId?: number; customerConfirmedBy?: string;
}
export interface Expense {
  id: number; number: string; categoryId: number; categoryName?: string; expenseDate: string; amount: number; methodCode: string; description?: string; reference?: string;
  createdByName?: string; createdAt: string;
}

export interface User {
  id: number; username: string; fullName: string; mobile?: string; email?: string; roleId: number; roleName?: string; roleCode?: string; mustChangePassword: boolean;
  isActive: boolean; failedLoginCount: number; lockedUntil?: string; lastLoginAt?: string; createdAt: string; commissionPercent?: number;
}
export interface Role { id: number; code: string; name: string; description?: string; isSystem: boolean; userCount: number }
export interface PermissionInfo { code: string; module: string; description: string }
export interface AuditLog {
  id: number; occurredAt: string; userId?: number; username?: string; action: string; module: string; recordType?: string; recordId?: number; recordRef?: string;
  summary: string; oldValue?: string; newValue?: string; machine?: string; ipAddress?: string;
}
export interface Notification { id: number; userId?: number; kind: string; title: string; message: string; refType?: string; refId?: number; isRead: boolean; createdAt: string }
export interface SearchResult { kind: string; id: number; title: string; subtitle?: string; status?: string }

export interface Totals {
  subtotal: number; discountTotal: number; itemsTaxable: number; deliveryCharge: number; installationCharge: number; taxableTotal: number;
  cgstTotal: number; sgstTotal: number; igstTotal: number; chargesTax: number; roundOff: number; grandTotal: number; taxTotal: number;
}
export interface Preview { lines: DocLine[]; totals: Totals; isInterState: boolean; placeOfSupply?: string; placeOfSupplyName?: string; discountWarning?: string }
export interface CheckoutResult { invoiceId: number; invoiceNumber?: string; paymentId?: number; paymentNumber?: string; deliveryId?: number }

export interface LineInput {
  variantId?: number | null; description: string; sku?: string; hsnCode?: string; quantity: number; unitPrice: number; priceIncludesGst: boolean; gstRate: number;
  discountPercent: number; discountAmount: number; sourceItemId?: number | null;
}
export interface SalesDocInput {
  id?: number; customerId: number; date?: string; lines: LineInput[]; deliveryCharge: number; installationCharge: number; deliveryAddress?: string; placeOfSupply?: string;
  notes?: string; terms?: string; validUntil?: string; expectedDeliveryDate?: string; dueDate?: string; requiresDelivery?: boolean; requiresInstallation?: boolean;
}
export interface PaymentLineInput { methodCode: string; amount: number; reference?: string }

// ---------------------------------------------------------------- operations extension
export interface Warehouse { id: number; code: string; name: string; kind: 'SHOWROOM' | 'WAREHOUSE' | 'FACTORY'; address?: string; isDefault: boolean; isActive: boolean; units: number; stockValue?: number | null; products: number }
export interface LocationStockRow { warehouseId: number; warehouseName: string; variantId: number; sku: string; productName: string; variantName?: string; onHand: number; damaged: number; inTransit: number }
export interface TransferLine { id: number; variantId: number; sku?: string; description?: string; quantity: number; fromStock?: number | null }
export interface StockTransfer {
  id: number; number: string; fromWarehouseId: number; fromName?: string; toWarehouseId: number; toName?: string; status: string; transferDate: string; vehicleNo?: string;
  notes?: string; dispatchedAt?: string; receivedAt?: string; cancelReason?: string; createdByName?: string; createdAt: string; totalQty: number; lineCount: number; lines: TransferLine[];
}
export interface RawMaterial {
  id: number; code: string; name: string; category: string; unit: string; costPrice?: number | null; stock: number; minStock: number; reorderQty: number; supplierId?: number;
  supplierName?: string; warehouseId?: number; warehouseName?: string; notes?: string; isActive: boolean; stockValue?: number | null; isLow: boolean; openingStock?: number;
}
export interface RawMaterialMovement {
  id: number; rawMaterialId: number; materialName?: string; unit?: string; movementType: string; quantityDelta: number; stockAfter: number; unitCost?: number | null;
  supplierName?: string; refType?: string; refId?: number; refNumber?: string; note?: string; createdByName?: string; createdAt: string;
}
export interface BomLine { rawMaterialId: number; code?: string; name?: string; unit?: string; quantity: number; wastagePercent: number; unitCost?: number | null; stock?: number; grossQuantity: number; lineCost?: number | null }
export interface Bom { variantId: number; productName?: string; sku?: string; labourCost: number; otherCost: number; notes?: string; lines: BomLine[]; materialCost: number; totalCost: number; sellingPrice?: number; netPrice?: number; gstRate: number }
export interface BomSummary { variantId: number; productName: string; sku: string; materials: number; totalCost?: number | null; sellingPrice?: number; netPrice?: number; updatedAt: string }
export interface ProductionMaterial { id: number; rawMaterialId: number; code?: string; name?: string; unit?: string; quantityRequired: number; quantityIssued: number; stock?: number; pending: number }
export interface ProductionOrder {
  id: number; number: string; customOrderId?: number; customOrderNumber?: string; customerName?: string; variantId?: number; sku?: string; description: string; quantity: number;
  status: string; priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'; dueDate?: string; assignedTo?: string; warehouseId?: number; warehouseName?: string; labourCost?: number | null;
  otherCost?: number | null; materialCost?: number | null; totalCost?: number | null; notes?: string; startedAt?: string; completedAt?: string; cancelReason?: string;
  createdByName?: string; createdAt: string; materialLines: number; materialsShort: number; materials: ProductionMaterial[];
}

export interface WarrantyRecord {
  id: number; number: string; customerId: number; customerName?: string; customerMobile?: string; invoiceId?: number; invoiceNumber?: string; invoiceItemId?: number;
  customOrderId?: number; customOrderNumber?: string; variantId?: number; productName: string; serialNo?: string; startDate: string; endDate: string; terms?: string;
  isVoid: boolean; voidReason?: string; createdAt: string; serviceTickets: number; daysLeft: number; state: 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'VOID';
}
export interface ServiceTicket {
  id: number; number: string; customerId: number; customerName?: string; customerMobile?: string; warrantyId?: number; warrantyNumber?: string; warrantyEnd?: string;
  invoiceId?: number; invoiceNumber?: string; productName: string; serialNo?: string; issue: string; address?: string; status: string; priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  underWarranty: boolean; technicianName?: string; technicianUserId?: number; visitDate?: string; partsUsed?: string; serviceCharge: number; resolution?: string;
  serviceInvoiceId?: number; serviceInvoiceNumber?: string; completedAt?: string; cancelReason?: string; createdByName?: string; createdAt: string;
}
export interface Lead {
  id: number; number: string; name: string; mobile?: string; email?: string; city?: string; source?: string; status: string; salespersonId?: number; salespersonName?: string;
  interestedProducts?: string; expectedValue: number; nextFollowUp?: string; customerId?: number; customerName?: string; quotationId?: number; lostReason?: string; notes?: string;
  createdAt: string; updatedAt: string; openFollowUps: number;
}
export interface FollowUp {
  id: number; refType: string; refId: number; refLabel?: string; customerId?: number; customerName?: string; mobile?: string; title: string; dueDate: string; assignedTo?: number;
  assignedName?: string; note?: string; doneAt?: string; outcome?: string; createdByName?: string; createdAt: string; isOverdue: boolean;
}
export interface CashSession {
  id: number; businessDate: string; openingCash: number; openedByName?: string; openedAt: string; cashSales?: number; cashRefunds?: number; cashExpenses?: number; cashSupplier?: number;
  expectedCash?: number; countedCash?: number; difference?: number; status: 'OPEN' | 'CLOSED' | 'APPROVED'; closedByName?: string; closedAt?: string; closeNote?: string;
  approvedByName?: string; approvedAt?: string; approvalNote?: string; needsApproval: boolean;
}
export interface CashDay {
  session?: CashSession | null; suggestedOpening?: number | null; expected?: number | null;
  figures: { date: string; cashSales: number; cashRefunds: number; cashExpenses: number; cashSupplier: number; receipts: number; nonCash: number; net: number };
  movements: { at: string; kind: string; number?: string; party?: string; amount: number; byName?: string }[];
}
