import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, X } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import { addDays, iso, isoInput, money } from '@/lib/format';
import { P } from '@/lib/perms';
import type { CustomOrder, Customer } from '@/lib/types';
import { useCan, useLookups, useMe, useToast } from '@/app/providers';
import { Notice, PageHeader, SkeletonRows } from '@/components/ui/display';
import { NumberInput, Select, Switch, TextArea, TextInput } from '@/components/ui/form';
import { CustomerPicker } from '@/components/pickers';
import { QuickCustomerModal } from '@/components/CustomerForm';

const TYPES = ['Wardrobe', 'Modular kitchen', 'Bed', 'Sofa', 'Dining table', 'TV unit', 'Study table', 'Bookshelf', 'Shoe rack', 'Pooja mandir', 'Dressing table', 'Office table'];

export default function CustomOrderEditor() {
  const { id } = useParams();
  const editing = !!id;
  const [params] = useSearchParams();
  const nav = useNavigate();
  const can = useCan();
  const me = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: lookups } = useLookups();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [o, setO] = useState<Partial<CustomOrder>>({ dimensionUnit: 'ft', gstRate: 18, priceIncludesGst: true, hsnCode: '9403', estimatedCost: 0, finalPrice: 0, requiresInstallation: false, expectedCompletionDate: iso(addDays(new Date(), 21)) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [newCust, setNewCust] = useState<{ open: boolean; name?: string }>({ open: false });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const existing = useQuery({ queryKey: ['custom-order', Number(id)], queryFn: () => api.get<{ order: CustomOrder }>(`/api/custom-orders/${id}`), enabled: editing });
  useEffect(() => { const x = existing.data?.order; if (x) { setO({ ...x, expectedCompletionDate: isoInput(x.expectedCompletionDate) }); api.get<Customer>(`/api/customers/${x.customerId}`).then(setCustomer).catch(() => {}); } }, [existing.data]);
  useEffect(() => { const c = params.get('customerId'); if (c && !editing) api.get<Customer>(`/api/customers/${c}`).then(setCustomer).catch(() => {}); }, [params, editing]);
  const set = <K extends keyof CustomOrder>(k: K, v: CustomOrder[K] | undefined) => setO(x => ({ ...x, [k]: v }));

  const upload = async (file: File) => {
    setUploading(true);
    try { const f = new FormData(); f.append('file', file); const r = await api.upload<{ id: number }>(`/api/attachments?ownerType=custom_order&purpose=reference`, f); set('referenceAttachmentId', r.id); }
    catch (e) { toast.error('Upload failed', errorMessage(e)); } finally { setUploading(false); }
  };
  const save = useMutation({
    mutationFn: () => {
      const e: Record<string, string> = {};
      if (!customer) e.customerId = 'Choose the customer.';
      else if (customer.isWalkIn) e.customerId = 'Custom orders need a named customer.';
      if (!o.productType?.trim()) e.productType = 'What is being made?';
      if (!(o.estimatedCost || o.finalPrice)) e.estimatedCost = 'Enter the estimated price.';
      setErrors(e);
      if (Object.keys(e).length) throw new ApiError(400, 'Please correct the highlighted fields.');
      const body = { ...o, customerId: customer!.id, expectedCompletionDate: o.expectedCompletionDate || null };
      return editing ? api.put<{ id: number }>(`/api/custom-orders/${id}`, body) : api.post<{ id: number }>('/api/custom-orders', body);
    },
    onSuccess: r => { toast.success(editing ? 'Custom order saved' : 'Custom order created', 'Take the advance from the order page.'); qc.invalidateQueries({ queryKey: ['custom-orders-production'] }); qc.invalidateQueries({ queryKey: ['custom-order', r.id] }); nav(`/custom-orders/${r.id}`); },
    onError: e => { if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(x => ({ ...x, ...e.fieldErrors })); toast.error('Not saved', errorMessage(e)); },
  });
  if (editing && !existing.data) return <div className="page"><SkeletonRows rows={8} /></div>;
  const u = o.dimensionUnit ?? 'ft';
  const area = o.width && o.height ? o.width * o.height : null;

  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <PageHeader crumbs={[{ label: 'Custom orders', to: '/custom-orders' }, { label: editing ? o.number ?? 'Edit' : 'New' }]} title={editing ? `Edit ${o.number}` : 'New custom order'}
        desc="Capture exactly what the customer wants built. Everything here prints on the order confirmation." />
      <div className="card card-pad">
        <section className="form-section">
          <div className="form-section-head"><h3>Customer</h3><p>Custom orders always need a named customer.</p></div>
          <div style={{ maxWidth: 520 }}><CustomerPicker value={customer} onChange={setCustomer} error={errors.customerId} autoFocus={!editing} onCreate={can(P.CustomerManage) ? name => setNewCust({ open: true, name }) : undefined} /></div>
        </section>
        <section className="form-section">
          <div className="form-section-head"><h3>Furniture & design</h3><p>What is being made and how it should look.</p></div>
          <div className="stack gap-4">
            <div className="grid grid-2">
              <TextInput label="Furniture type" required value={o.productType ?? ''} onChange={e => set('productType', e.target.value)} error={errors.productType} list="co-types" placeholder="Sliding wardrobe" />
              <TextInput label="Design" optional value={o.design ?? ''} onChange={e => set('design', e.target.value)} placeholder="4 doors with mirror panel, loft above" />
            </div>
            <div className="row top gap-4 wrap">
              <div className="grow stack gap-4" style={{ minWidth: 260 }}>
                <div className="grid grid-4">
                  <NumberInput label={`Width (${u})`} value={o.width ?? null} min={0} onChange={v => set('width', v)} error={errors.width} />
                  <NumberInput label={`Height (${u})`} value={o.height ?? null} min={0} onChange={v => set('height', v)} />
                  <NumberInput label={`Depth (${u})`} value={o.depth ?? null} min={0} onChange={v => set('depth', v)} />
                  <Select label="Unit" value={u} onChange={e => set('dimensionUnit', e.target.value)} options={[{ value: 'ft', label: 'feet' }, { value: 'in', label: 'inch' }, { value: 'cm', label: 'cm' }, { value: 'mm', label: 'mm' }]} />
                </div>
                {area && <p className="text-xs muted">Front area {Math.round(area * 100) / 100} sq.{u}</p>}
                <div className="grid grid-4">
                  <TextInput label="Material" optional value={o.material ?? ''} onChange={e => set('material', e.target.value)} placeholder="BWP plywood" />
                  <TextInput label="Finish" optional value={o.finish ?? ''} onChange={e => set('finish', e.target.value)} placeholder="Acrylic gloss" />
                  <TextInput label="Colour" optional value={o.color ?? ''} onChange={e => set('color', e.target.value)} />
                  <TextInput label="Fabric" optional value={o.fabric ?? ''} onChange={e => set('fabric', e.target.value)} />
                </div>
                <div className="grid grid-4">
                  <NumberInput label="Doors" optional value={o.doors ?? null} min={0} onChange={v => set('doors', v)} />
                  <NumberInput label="Drawers" optional value={o.drawers ?? null} min={0} onChange={v => set('drawers', v)} />
                </div>
              </div>
              <div className="field" style={{ width: 220 }}>
                <span className="field-label">Reference image</span>
                {o.referenceAttachmentId ? (
                  <div className="ref-image" style={{ position: 'relative' }}><img src={`/api/attachments/${o.referenceAttachmentId}`} alt="Reference" />
                    <button className="btn btn-icon btn-sm" style={{ position: 'absolute', top: 6, right: 6 }} aria-label="Remove image" onClick={() => set('referenceAttachmentId', null)}><X /></button></div>
                ) : (
                  <button type="button" className="dropzone" style={{ aspectRatio: '4/3', display: 'grid', placeItems: 'center' }} onClick={() => fileRef.current?.click()} aria-busy={uploading}>
                    <span className="stack gap-1" style={{ alignItems: 'center' }}><ImagePlus aria-hidden /><span className="text-xs">{uploading ? 'Uploading…' : 'Sketch, photo or PDF'}</span></span>
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,application/pdf" hidden onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
              </div>
            </div>
            <TextArea label="Special requirements" optional rows={2} value={o.specialRequirements ?? ''} onChange={e => set('specialRequirements', e.target.value)} placeholder="Soft-close hinges, handle-less, internal LED" />
          </div>
        </section>
        <section className="form-section">
          <div className="form-section-head"><h3>Price & schedule</h3><p>Final price is required before the order can be marked ready.</p></div>
          <div className="stack gap-4">
            <div className="grid grid-4">
              <NumberInput label="Estimated price" money value={o.estimatedCost ?? 0} onChange={v => set('estimatedCost', v ?? 0)} error={errors.estimatedCost} />
              <NumberInput label="Final price" optional money value={o.finalPrice ?? 0} onChange={v => set('finalPrice', v ?? 0)} hint="Once agreed" />
              {me.canSeeCost && <NumberInput label="Production cost" optional money value={o.productionCost ?? null} onChange={v => set('productionCost', v)} hint={o.productionCost && (o.finalPrice || o.estimatedCost) ? `Margin ${money((o.finalPrice || o.estimatedCost || 0) - o.productionCost, { decimals: false })}` : 'Owners only'} />}
              <Select label="GST" value={o.gstRate ?? 18} onChange={e => set('gstRate', Number(e.target.value))} options={(lookups?.gstRates ?? []).map(r => ({ value: r.rate, label: `${r.rate}%` }))} />
            </div>
            <div className="grid grid-3">
              <TextInput label="Expected completion" type="date" value={o.expectedCompletionDate ?? ''} min={iso()} onChange={e => set('expectedCompletionDate', e.target.value)} />
              <div className="field" style={{ justifyContent: 'flex-end' }}><Switch label="Price includes GST" checked={o.priceIncludesGst ?? true} onChange={v => set('priceIncludesGst', v)} /></div>
              <div className="field" style={{ justifyContent: 'flex-end' }}><Switch label="Installation required" checked={o.requiresInstallation ?? false} onChange={v => set('requiresInstallation', v)} /></div>
            </div>
            <TextArea label="Delivery address" optional rows={2} value={o.deliveryAddress ?? ''} onChange={e => set('deliveryAddress', e.target.value)} placeholder={customer?.billingAddress ?? ''} />
            <TextArea label="Internal notes" optional rows={2} value={o.notes ?? ''} onChange={e => set('notes', e.target.value)} />
            {Object.keys(errors).length > 0 && <Notice tone="bad">Please correct the highlighted fields.</Notice>}
          </div>
        </section>
        <div className="sticky-actions" style={{ ['--page-pad' as string]: '20px' }}>
          <button className="btn" onClick={() => nav(-1)}>Cancel</button>
          <button className="btn btn-primary btn-lg" onClick={() => save.mutate()} disabled={save.isPending} aria-busy={save.isPending}>{editing ? 'Save order' : 'Create order'}</button>
        </div>
      </div>
      <datalist id="co-types">{TYPES.map(t => <option key={t} value={t} />)}</datalist>
      <QuickCustomerModal open={newCust.open} initialName={newCust.name} onClose={() => setNewCust({ open: false })} onSaved={setCustomer} />
    </div>
  );
}
