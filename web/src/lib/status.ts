/** Client mirror of the server's StatusStyle: tone + icon so status is never colour-only. */
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted' | 'brand';

const OK = ['COMPLETED', 'PAID', 'DELIVERED', 'FINAL', 'CONVERTED', 'ACTIVE', 'IN_STOCK', 'RESTOCK', 'GOOD', 'RECEIVED_PAYMENT'];
const WARN = ['PENDING', 'RESERVED', 'PARTIAL', 'PARTIALLY_PAID', 'SCHEDULED', 'OUT_FOR_DELIVERY', 'ASSIGNED', 'SENT', 'LOW_STOCK', 'READY', 'DISPATCHED', 'QUALITY_CHECK', 'UNPAID', 'LOCKED'];
const BAD = ['CANCELLED', 'OVERDUE', 'DAMAGED', 'FAILED', 'REJECTED', 'EXPIRED', 'OUT_OF_STOCK', 'VOID', 'VOIDED', 'DISCONTINUED', 'DEFECTIVE', 'INACTIVE'];
const INFO = ['CONFIRMED', 'DESIGN', 'PRODUCTION', 'MANUFACTURING', 'PROCESSING', 'DELIVERY', 'INSTALLATION', 'RECEIVED', 'REFUND'];

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
