/** Client mirror of the server's StatusStyle: tone + icon so status is never colour-only. */
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted' | 'brand';

const OK = ['APPROVED', 'CONVERTED', 'COMPLETED', 'PAID', 'DELIVERED', 'FINAL', 'CONVERTED', 'ACTIVE', 'IN_STOCK', 'RESTOCK', 'GOOD', 'RECEIVED_PAYMENT'];
const WARN = ['IN_TRANSIT', 'MATERIAL_READY', 'QC', 'NEGOTIATION', 'CONTACTED', 'VISIT', 'REPAIR', 'EXPIRING', 'OPEN', 'CLOSED', 'PENDING', 'RESERVED', 'PARTIAL', 'PARTIALLY_PAID', 'SCHEDULED', 'OUT_FOR_DELIVERY', 'ASSIGNED', 'SENT', 'LOW_STOCK', 'READY', 'DISPATCHED', 'QUALITY_CHECK', 'UNPAID', 'LOCKED'];
const BAD = ['LOST', 'CANCELLED', 'OVERDUE', 'DAMAGED', 'FAILED', 'REJECTED', 'EXPIRED', 'OUT_OF_STOCK', 'VOID', 'VOIDED', 'DISCONTINUED', 'DEFECTIVE', 'INACTIVE'];
const INFO = ['NEW', 'PLANNING', 'CUTTING', 'ASSEMBLY', 'FINISHING', 'QUOTATION', 'CONFIRMED', 'DESIGN', 'PRODUCTION', 'MANUFACTURING', 'PROCESSING', 'DELIVERY', 'INSTALLATION', 'RECEIVED', 'REFUND'];

export function toneOf(status?: string | null): Tone {
  if (!status) return 'muted';
  if (OK.includes(status)) return 'ok';
  if (WARN.includes(status)) return 'warn';
  if (BAD.includes(status)) return 'bad';
  if (INFO.includes(status)) return 'info';
  if (status === 'MADE_TO_ORDER') return 'brand';
  return 'muted';
}

export const CUSTOM_ORDER_FLOW = ['RECEIVED', 'DESIGN', 'PRODUCTION', 'QUALITY_CHECK', 'READY', 'DELIVERY', 'INSTALLATION', 'COMPLETED'] as const;
export const CUSTOM_ORDER_LABELS: Record<string, string> = {
  RECEIVED: 'Order received', DESIGN: 'Design', PRODUCTION: 'Production', QUALITY_CHECK: 'Quality check', READY: 'Ready',
  DELIVERY: 'Delivery', INSTALLATION: 'Installation', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
};
export const DELIVERY_FLOW = ['PENDING', 'SCHEDULED', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;
export const ORDER_FLOW = ['CONFIRMED', 'PROCESSING', 'READY', 'DISPATCHED', 'DELIVERED', 'COMPLETED'] as const;

export const PRODUCTION_FLOW = ['NEW', 'PLANNING', 'MATERIAL_READY', 'CUTTING', 'ASSEMBLY', 'FINISHING', 'QC', 'READY'] as const;
export const PRODUCTION_LABELS: Record<string, string> = {
  NEW: 'New', PLANNING: 'Planning', MATERIAL_READY: 'Material ready', CUTTING: 'Cutting', ASSEMBLY: 'Assembly', FINISHING: 'Finishing', QC: 'Quality check',
  READY: 'Ready', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
};
export const TRANSFER_LABELS: Record<string, string> = { DRAFT: 'Draft', DISPATCHED: 'Dispatched', IN_TRANSIT: 'In transit', RECEIVED: 'Received', CANCELLED: 'Cancelled' };
export const PRIORITY_TONE: Record<string, Tone> = { LOW: 'muted', NORMAL: 'muted', HIGH: 'warn', URGENT: 'bad' };
export const SERVICE_FLOW = ['NEW', 'ASSIGNED', 'VISIT', 'REPAIR', 'QC', 'COMPLETED'] as const;
export const SERVICE_LABELS: Record<string, string> = { NEW: 'New', ASSIGNED: 'Technician assigned', VISIT: 'Technician visit', REPAIR: 'Repair', QC: 'Quality check', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
export const LEAD_FLOW = ['NEW', 'CONTACTED', 'QUOTATION', 'NEGOTIATION', 'CONFIRMED'] as const;
export const LEAD_LABELS: Record<string, string> = { NEW: 'New lead', CONTACTED: 'Contacted', QUOTATION: 'Quotation', NEGOTIATION: 'Negotiation', CONFIRMED: 'Confirmed', CONVERTED: 'Converted', LOST: 'Lost' };
export const WARRANTY_LABELS: Record<string, string> = { ACTIVE: 'Active', EXPIRING: 'Expiring soon', EXPIRED: 'Expired', VOID: 'Void' };
export const WARRANTY_TONE: Record<string, Tone> = { ACTIVE: 'ok', EXPIRING: 'warn', EXPIRED: 'muted', VOID: 'bad' };
