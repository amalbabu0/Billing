import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Barcode, Printer, QrCode, Trash2, Wand2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { P } from '@/lib/perms';
import type { Sellable } from '@/lib/types';
import { useCan, useToast } from '@/app/providers';
import { Card, EmptyState, Notice, PageHeader, Segmented } from '@/components/ui/display';
import { NumberInput } from '@/components/ui/form';
import { ProductPicker } from '@/components/pickers';

interface Pick { item: Sellable; copies: number }

/** Print price tags with barcode or QR on A4 label sheets (3×8) or a 50×25 mm roll printer. */
export default function Barcodes() {
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const [items, setItems] = useState<Pick[]>([]);
  const [format, setFormat] = useState<'a4' | 'roll'>('a4');
  const [code, setCode] = useState<'barcode' | 'qr'>('barcode');
  const total = items.reduce((s, i) => s + i.copies, 0);
  const missing = items.filter(i => !i.item.barcode).length;

  const print = useMutation({
    mutationFn: async () => {
      const win = window.open('', '_blank'); // opened within the click so pop-up blockers allow it
      try {
        const blob = await api.blob('POST', '/api/barcodes/labels', { items: items.map(i => ({ variantId: i.item.variantId, copies: i.copies })), format, qr: code === 'qr' });
        const url = URL.createObjectURL(blob);
        if (win) win.location.href = url; else window.location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (e) { win?.close(); throw e; }
    },
    onError: e => toast.error('Labels not generated', errorMessage(e)),
  });
  const assign = useMutation({
    mutationFn: () => api.post<{ assigned: number }>('/api/barcodes/assign'),
    onSuccess: r => { toast.success(r.assigned ? `${r.assigned} barcodes assigned` : 'Every variant already has a barcode'); qc.invalidateQueries({ queryKey: ['sellable'] }); },
    onError: e => toast.error('Not assigned', errorMessage(e)),
  });

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <PageHeader title="Barcode / QR labels" desc="Print price tags for the showroom floor. Scanning a tag at the billing counter adds the item instantly."
        actions={can(P.ProductManage) && <button className="btn" onClick={() => assign.mutate()} aria-busy={assign.isPending}><Wand2 aria-hidden />Assign missing barcodes</button>} />
      <div className="doc-layout">
        <Card title="Items to print" bodyClass="">
          <div className="card-body" style={{ paddingBottom: 12 }}><ProductPicker onPick={s => setItems(x => (x.some(i => i.item.variantId === s.variantId) ? x : [...x, { item: s, copies: 1 }]))} label="Add item to print" /></div>
          {missing > 0 && <div style={{ padding: '0 20px 12px' }}><Notice tone="warn" action={can(P.ProductManage) && <button className="btn btn-sm" onClick={() => assign.mutate()}>Assign now</button>}>{missing} item(s) have no barcode yet; their label will use the SKU.</Notice></div>}
          {items.length === 0 ? <EmptyState compact icon={<Barcode />} title="Nothing selected" desc="Search products above and set how many tags you need." /> : (
            <table className="data line-editor">
              <thead><tr><th>Item</th><th>Code</th><th style={{ width: 110 }} className="num">Copies</th><th style={{ width: 40 }} /></tr></thead>
              <tbody>{items.map(i => (
                <tr key={i.item.variantId}>
                  <td><div className="cell-title">{i.item.displayName}</div><div className="cell-sub mono">{i.item.sku}</div></td>
                  <td className="mono text-sm">{i.item.barcode ?? <span className="muted">SKU</span>}</td>
                  <td><NumberInput value={i.copies} min={1} max={500} aria-label="Copies" onChange={v => setItems(x => x.map(y => (y === i ? { ...y, copies: v ?? 1 } : y)))} /></td>
                  <td><button className="btn btn-ghost btn-icon btn-sm" aria-label="Remove" onClick={() => setItems(x => x.filter(y => y !== i))}><Trash2 /></button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Card>
        <aside className="doc-side">
          <Card title="Label layout">
            <div className="stack gap-4">
              <div className="stack gap-2"><span className="field-label">Paper</span>
                <Segmented value={format} onChange={setFormat} label="Paper" options={[{ value: 'a4', label: 'A4 sheet · 24 per page' }, { value: 'roll', label: 'Roll 50×25 mm' }]} /></div>
              <div className="stack gap-2"><span className="field-label">Code type</span>
                <Segmented value={code} onChange={setCode} label="Code type" options={[{ value: 'barcode', label: 'Barcode', icon: <Barcode /> }, { value: 'qr', label: 'QR code', icon: <QrCode /> }]} /></div>
              <p className="text-sm muted">Each tag shows the shop name, product, variant, price (with GST note) and the code.</p>
              <button className="btn btn-primary btn-lg btn-block" disabled={!items.length || print.isPending} aria-busy={print.isPending} onClick={() => print.mutate()}><Printer aria-hidden />Print {total} label{total === 1 ? '' : 's'}</button>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
