import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Warehouse } from '@/lib/types';
import { Select } from './ui/form';

export function useWarehouses() {
  return useQuery({ queryKey: ['warehouses'], queryFn: () => api.get<Warehouse[]>('/api/warehouses'), staleTime: 60_000 });
}

/** Location picker. Hidden when the shop has a single location (nothing to choose). */
export function WarehouseSelect({ value, onChange, label = 'Location', optional, hint, allowDefault = true }: {
  value: number | null | undefined; onChange: (id: number | null) => void; label?: string; optional?: boolean; hint?: string; allowDefault?: boolean;
}) {
  const { data = [] } = useWarehouses();
  if (data.length <= 1) return null;
  const def = data.find(w => w.isDefault);
  return (
    <Select label={label} optional={optional} hint={hint} value={value ?? ''} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
      options={[...(allowDefault ? [{ value: '', label: `Default — ${def?.name ?? 'main'}` }] : [{ value: '', label: 'Choose…' }]), ...data.map(w => ({ value: w.id, label: w.name }))]} />
  );
}

export const KIND_LABEL: Record<string, string> = { SHOWROOM: 'Showroom', WAREHOUSE: 'Warehouse / godown', FACTORY: 'Factory / workshop' };
