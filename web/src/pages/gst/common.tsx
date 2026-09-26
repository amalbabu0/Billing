import { useSearchParams } from 'react-router-dom';
import { useMe } from '@/app/providers';
import { rangeFor } from '@/lib/hooks';
import { Notice } from '@/components/ui/display';
import { DateRange } from '@/components/pickers';

export interface TaxAmounts { count: number; taxable: number; cgst: number; sgst: number; igst: number; total: number; tax: number }
export interface GstRateRow { supply: string; rate?: number | null; invoices: number; taxable: number; cgst: number; sgst: number; igst: number; totalTax: number }
export interface GstPage<T> { items: T[]; totalCount: number; page: number; pageSize: number; totals: TaxAmounts }

/** GST filing periods are months; the range lives in the URL so links and Back keep it. */
export function useGstRange(defaultPreset = 'month') {
  const [params, setParams] = useSearchParams();
  const def = rangeFor(defaultPreset);
  const value = { preset: params.get('preset') ?? (params.get('from') ? 'custom' : defaultPreset), from: params.get('from') ?? def.from, to: params.get('to') ?? def.to };
  const onChange = (v: { preset: string; from: string; to: string }) => {
    const n = new URLSearchParams(params);
    n.set('from', v.from); n.set('to', v.to); n.set('preset', v.preset); n.delete('page');
    setParams(n, { replace: true });
  };
  return { value, onChange, from: value.from, to: value.to };
}

export function GstRangeBar({ range, children }: { range: ReturnType<typeof useGstRange>; children?: React.ReactNode }) {
  return (
    <div className="row between wrap gap-3">
      <DateRange value={range.value} onChange={range.onChange} presets={['month', 'lastMonth', 'quarter', 'fy', 'custom']} />
      {children}
    </div>
  );
}

export function UnregisteredNotice() {
  const me = useMe();
  if (me.shop.gstRegistered) return null;
  return <Notice tone="warn">GST registration is switched off in Settings → GST, so new invoices carry no tax. Figures below include only past taxed documents.</Notice>;
}

export const rateLabel = (r?: number | null) => (r === null || r === undefined ? 'Exempt / nil' : `${r}%`);

const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit' });
export const monthLabel = (v: string) => monthFmt.format(new Date(v));
