import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import { money } from '@/lib/format';
import { P } from '@/lib/perms';
import type { PricingMode, Product, Variant } from '@/lib/types';
import { useCan, useLookups, useMe, useToast } from '@/app/providers';
import { Notice, PageHeader, SkeletonRows } from '@/components/ui/display';
import { NumberInput, Select, Switch, TextArea, TextInput } from '@/components/ui/form';

const PRICING_MODES: { value: PricingMode; label: string }[] = [
  { value: 'FIXED', label: 'Per piece (fixed price)' }, { value: 'PER_SQFT', label: 'Per square foot' }, { value: 'PER_SQM', label: 'Per square metre' },
  { value: 'PER_RFT', label: 'Per running foot' }, { value: 'PER_KG', label: 'Per kg' }, { value: 'PER_UNIT', label: 'Per unit (quantity)' }, { value: 'CUSTOM', label: 'Custom price each time' },
];
const PRICING_UNIT: Record<string, string> = { PER_SQFT: 'sq.ft', PER_SQM: 'sq.m', PER_RFT: 'running ft', PER_KG: 'kg', PER_UNIT: 'unit' };
const blankVariant = (sku = ''): Variant => ({ id: 0, productId: 0, variantName: '', sku, isDefault: false, isActive: true, onHand: 0, reserved: 0, damaged: 0, available: 0, openingStock: 0 });
const blank = (): Product => ({
  id: 0, code: '', name: '', categoryId: 0, brandId: null, warrantyMonths: 12, gstRate: 18, priceIncludesGst: true, costPrice: null, sellingPrice: 0,
  discountPercent: 0, minStock: 1, status: 'ACTIVE', isStockItem: true, onHand: 0, reserved: 0, available: 0, variants: [],
});

/** Product form grouped the way staff think about furniture: what it is, what it's made of, what it costs, how much we hold. */
export default function ProductEditor() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const can = useCan();
  const me = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: lookups } = useLookups();
  const [p, setP] = useState<Product>(blank);
  const [openingStock, setOpeningStock] = useState<number | null>(0);
  const [pricingMode, setPricingMode] = useState<PricingMode>('FIXED');
  const [pricingRate, setPricingRate] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const existing = useQuery({ queryKey: ['product', Number(id)], queryFn: () => api.get<Product>(`/api/products/${id}`), enabled: editing });
  useEffect(() => {
    if (!existing.data) return;
    setP(existing.data);
    const v0 = existing.data.variants[0];
    if (v0) { setPricingMode(v0.pricingMode ?? 'FIXED'); setPricingRate(v0.pricingRate ?? null); }
  }, [existing.data]);
  useEffect(() => { if (!editing && lookups) setP(x => ({ ...x, gstRate: lookups.defaults.defaultGstRate, priceIncludesGst: lookups.defaults.defaultPriceIncludesGst })); }, [editing, lookups]);
  const set = <K extends keyof Product>(k: K, v: Product[K]) => setP(x => ({ ...x, [k]: v }));
  const hasVariants = p.variants.length > 1 || (p.variants.length === 1 && p.variants[0].variantName && p.variants[0].variantName !== 'Standard');

  const onCategory = (cid: number) => {
    const c = lookups?.categories.find(x => x.id === cid);
    setP(x => ({ ...x, categoryId: cid, hsnCode: x.hsnCode || c?.defaultHsn || x.hsnCode, gstRate: c?.defaultGstRate ?? x.gstRate }));
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await api.upload<{ id: number }>(`/api/attachments?ownerType=product&ownerId=${p.id || ''}&purpose=image`, form);
      set('imageAttachmentId', r.id);
    } catch (e) { toast.error('Image not uploaded', errorMessage(e)); } finally { setUploading(false); }
  };

  const save = useMutation({
    mutationFn: async () => {
      const e: Record<string, string> = {};
      if (!p.name.trim()) e.name = 'Enter the product name.';
      if (!p.code.trim()) e.code = 'Enter a product code (used as SKU).';
      if (!p.categoryId) e.categoryId = 'Choose a category.';
      if (p.hsnCode && !/^\d{4}(\d{2}){0,2}$/.test(p.hsnCode)) e.hsnCode = 'HSN is 4, 6 or 8 digits.';
      setErrors(e);
      if (Object.keys(e).length) throw new ApiError(400, 'Please correct the highlighted fields.');
      let variants = p.variants;
      if (!editing && variants.length === 0) variants = [{ ...blankVariant(p.code), variantName: 'Standard', isDefault: true, openingStock: openingStock ?? 0 }];
      if (pricingMode !== 'FIXED' && pricingMode !== 'CUSTOM' && !pricingRate) throw new ApiError(400, 'Enter the rate for measured pricing.', undefined, { pricingRate: 'Required' });
      const body = { ...p, variants: variants.map((v, i) => ({ ...v, sku: v.sku || `${p.code}-${i + 1}`, variantName: v.variantName || 'Standard', pricingMode, pricingRate: pricingMode === 'FIXED' ? null : pricingRate })) };
      return editing ? api.put<Product>(`/api/products/${id}`, body) : api.post<Product>('/api/products', body);
    },
    onSuccess: r => { toast.success(editing ? 'Product saved' : 'Product added', r.name); qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['product', r.id] }); qc.invalidateQueries({ queryKey: ['lookups'] }); nav(`/products/${r.id}`); },
    onError: e => { if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors); toast.error('Not saved', errorMessage(e)); },
  });

  if (editing && !existing.data) return <div className="page"><SkeletonRows rows={8} /></div>;
  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <PageHeader crumbs={[{ label: 'Products', to: '/products' }, { label: editing ? p.name : 'New' }]} title={editing ? `Edit ${p.name}` : 'Add product'} />
      {errors.variants && <Notice tone="bad">{errors.variants}</Notice>}
      <div className="card card-pad">
        <section className="form-section">
          <div className="form-section-head"><h3>Product information</h3><p>What the customer sees on the invoice.</p></div>
          <div className="stack gap-4">
            <div className="grid grid-2">
              <TextInput label="Product name" required value={p.name} onChange={e => set('name', e.target.value)} error={errors.name} autoFocus={!editing} placeholder="e.g. Chesterfield 3 Seater Sofa" />
              <TextInput label="Product code / SKU" required value={p.code} onChange={e => set('code', e.target.value.toUpperCase())} error={errors.code} className="mono" placeholder="SOF-012" hint="Unique. Variants get their own SKU." />
            </div>
            <div className="grid grid-3">
              <Select label="Category" required value={p.categoryId || ''} onChange={e => onCategory(Number(e.target.value))} error={errors.categoryId} placeholder="Choose…" options={(lookups?.categories ?? []).map(c => ({ value: c.id, label: c.name }))} />
              <Select label="Brand" optional value={p.brandId ?? ''} onChange={e => set('brandId', e.target.value ? Number(e.target.value) : null)} placeholder="No brand" options={(lookups?.brands ?? []).map(b => ({ value: b.id, label: b.name }))} />
              <Select label="Status" value={p.status} onChange={e => set('status', e.target.value)} options={[{ value: 'ACTIVE', label: 'Active — can be sold' }, { value: 'INACTIVE', label: 'Inactive — hidden' }, { value: 'DISCONTINUED', label: 'Discontinued' }]} />
            </div>
            <div className="row top gap-4 wrap">
              <div className="grow" style={{ minWidth: 260 }}><TextArea label="Description" optional rows={3} value={p.description ?? ''} onChange={e => set('description', e.target.value)} /></div>
              <div className="field" style={{ width: 180 }}>
                <span className="field-label">Photo</span>
                {p.imageAttachmentId ? (
                  <div className="ref-image" style={{ position: 'relative' }}><img src={`/api/attachments/${p.imageAttachmentId}`} alt={p.name} />
                    <button className="btn btn-icon btn-sm" style={{ position: 'absolute', top: 6, right: 6 }} aria-label="Remove photo" onClick={() => set('imageAttachmentId', null)}><X /></button></div>
                ) : (
                  <button type="button" className="dropzone" onClick={() => fileRef.current?.click()} aria-busy={uploading} style={{ aspectRatio: '4/3', display: 'grid', placeItems: 'center' }}>
                    <span className="stack gap-1" style={{ alignItems: 'center' }}><ImagePlus aria-hidden /><span className="text-xs">{uploading ? 'Uploading…' : 'JPG or PNG, max 5 MB'}</span></span>
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
              </div>
            </div>
          </div>
        </section>

        <section className="form-section">
          <div className="form-section-head"><h3>Build & finish</h3><p>Material, finish and size help staff find the right piece.</p></div>
          <div className="stack gap-4">
            <div className="grid grid-3">
              <TextInput label="Material" optional value={p.material ?? ''} onChange={e => set('material', e.target.value)} placeholder="Sheesham wood" list="materials" />
              <TextInput label="Finish" optional value={p.finish ?? ''} onChange={e => set('finish', e.target.value)} placeholder="Honey polish" />
              <TextInput label="Fabric / upholstery" optional value={p.fabric ?? ''} onChange={e => set('fabric', e.target.value)} />
            </div>
            <div className="grid grid-4">
              <TextInput label="Colour" optional value={p.color ?? ''} onChange={e => set('color', e.target.value)} />
              <TextInput label="Size" optional value={p.size ?? ''} onChange={e => set('size', e.target.value)} placeholder="King" />
              <TextInput label="Dimensions" optional value={p.dimensions ?? ''} onChange={e => set('dimensions', e.target.value)} placeholder="84 × 36 × 34 in" />
              <NumberInput label="Warranty (months)" value={p.warrantyMonths} min={0} onChange={v => set('warrantyMonths', v ?? 0)} hint={p.warrantyMonths ? 'Registered automatically on every sale' : undefined} />
            </div>
            {p.warrantyMonths > 0 && <TextInput label="Warranty terms" optional value={p.warrantyTerms ?? ''} onChange={e => set('warrantyTerms', e.target.value)} placeholder="Manufacturing defects in frame and hydraulics; excludes fabric wear and water damage" />}
          </div>
        </section>

        <section className="form-section">
          <div className="form-section-head"><h3>Pricing & GST</h3><p>GST is applied by the billing engine — CGST+SGST or IGST is decided per invoice.</p></div>
          <div className="stack gap-4">
            <div className="grid grid-4">
              <NumberInput label="Selling price" required money value={p.sellingPrice} onChange={v => set('sellingPrice', v ?? 0)} error={errors.sellingPrice} />
              {me.canSeeCost && <NumberInput label="Cost price" optional money value={p.costPrice ?? null} onChange={v => set('costPrice', v)} hint={p.costPrice && p.sellingPrice ? `Margin ${money(p.sellingPrice - p.costPrice, { decimals: false })}` : 'Visible to owners only'} />}
              <NumberInput label="Max discount %" value={p.discountPercent} min={0} max={100} onChange={v => set('discountPercent', v ?? 0)} hint="Staff can give up to this" />
              <Select label="GST rate" value={p.gstRate} onChange={e => set('gstRate', Number(e.target.value))} options={(lookups?.gstRates ?? []).map(r => ({ value: r.rate, label: `${r.rate}%` }))} />
            </div>
            <div className="grid grid-4">
              <Select label="Priced" value={pricingMode} onChange={e => setPricingMode(e.target.value as PricingMode)} options={PRICING_MODES} hint={pricingMode === 'FIXED' ? 'One price per piece' : 'Billed by measurement at the counter'} />
              {pricingMode !== 'FIXED' && pricingMode !== 'CUSTOM' && <NumberInput label={`Rate per ${PRICING_UNIT[pricingMode]}`} required money value={pricingRate} onChange={setPricingRate} hint="Staff may discount up to the max discount" />}
            </div>
            <div className="grid grid-2">
              <Select label="HSN code" value={p.hsnCode ?? ''} onChange={e => set('hsnCode', e.target.value)} error={errors.hsnCode} placeholder="Choose…"
                options={(lookups?.hsnCodes ?? []).map(h => ({ value: h.code, label: `${h.code} — ${h.description}` }))} />
              <div className="field" style={{ justifyContent: 'flex-end' }}>
                <Switch label="Selling price includes GST" checked={p.priceIncludesGst} onChange={v => set('priceIncludesGst', v)} hint={p.priceIncludesGst ? 'MRP-style: the tag price is what the customer pays.' : 'GST is added on top at billing.'} />
              </div>
            </div>
          </div>
        </section>

        <section className="form-section">
          <div className="form-section-head"><h3>Inventory</h3><p>Made-to-order items are never out of stock.</p></div>
          <div className="stack gap-4">
            <Switch label="Track stock for this product" checked={p.isStockItem} onChange={v => set('isStockItem', v)} hint={p.isStockItem ? 'Stock goes down on sale and up on purchase.' : 'Made to order — no stock is kept.'} />
            {p.isStockItem && (
              <div className="grid grid-3">
                <NumberInput label="Minimum stock" value={p.minStock} min={0} onChange={v => set('minStock', v ?? 0)} hint="Low-stock alert at this level" />
                {!editing && !hasVariants && can(P.InventoryAdjust) && <NumberInput label="Opening stock" value={openingStock} min={0} onChange={setOpeningStock} hint="Pieces in the showroom now" />}
                {editing && <div className="field"><span className="field-label">Current stock</span><div className="input" style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-sunken)' }}>{p.available} available · {p.reserved} reserved</div><span className="field-hint">Change stock with Adjust stock or a purchase.</span></div>}
              </div>
            )}
          </div>
        </section>

        <section className="form-section">
          <div className="form-section-head"><h3>Variants</h3><p>Sizes, colours or finishes sold as separate pieces, each with its own SKU, price and stock.</p></div>
          <div className="stack gap-3">
            {p.variants.length === 0 ? <p className="muted text-sm">No variants — the product is sold as a single item.</p> : (
              <div className="table-card"><div className="table-scroll">
                <table className="data line-editor">
                  <thead><tr><th>Variant name</th><th>SKU</th><th>Size / colour / finish</th><th className="num" style={{ width: 130 }}>Price</th>{me.canSeeCost && <th className="num" style={{ width: 120 }}>Cost</th>}<th className="num" style={{ width: 100 }}>{editing ? 'In stock' : 'Opening'}</th><th /></tr></thead>
                  <tbody>{p.variants.map((v, i) => {
                    const upd = (patch: Partial<Variant>) => setP(x => ({ ...x, variants: x.variants.map((y, j) => (j === i ? { ...y, ...patch } : y)) }));
                    return (
                      <tr key={v.id || `n${i}`}>
                        <td><input className="input" value={v.variantName} placeholder="e.g. Queen · Walnut" aria-label="Variant name" onChange={e => upd({ variantName: e.target.value })} /></td>
                        <td><input className="input mono" value={v.sku} aria-label="Variant SKU" onChange={e => upd({ sku: e.target.value.toUpperCase() })} /></td>
                        <td><div className="row gap-1">
                          <input className="input" placeholder="Size" value={v.size ?? ''} aria-label="Size" onChange={e => upd({ size: e.target.value })} />
                          <input className="input" placeholder="Colour" value={v.color ?? ''} aria-label="Colour" onChange={e => upd({ color: e.target.value })} />
                          <input className="input" placeholder="Finish" value={v.finish ?? ''} aria-label="Finish" onChange={e => upd({ finish: e.target.value })} />
                        </div></td>
                        <td><NumberInput money value={v.sellingPrice ?? null} placeholder={String(p.sellingPrice)} aria-label="Variant price" onChange={val => upd({ sellingPrice: val })} /></td>
                        {me.canSeeCost && <td><NumberInput money value={v.costPrice ?? null} aria-label="Variant cost" onChange={val => upd({ costPrice: val })} /></td>}
                        <td className="num">{v.id ? <span className="num">{v.onHand - v.reserved}</span> : <NumberInput value={v.openingStock} min={0} aria-label="Opening stock" onChange={val => upd({ openingStock: val ?? 0 })} />}</td>
                        <td>{!v.id || v.onHand === 0 ? <button className="btn btn-ghost btn-icon btn-sm" aria-label="Remove variant" onClick={() => setP(x => ({ ...x, variants: x.variants.filter((_, j) => j !== i) }))}><Trash2 /></button> : null}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div></div>
            )}
            <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setP(x => ({ ...x, variants: [...(x.variants.length === 0 && editing ? [] : x.variants), blankVariant(x.code ? `${x.code}-${x.variants.length + 1}` : '')] }))}><Plus aria-hidden />Add variant</button>
            <p className="text-xs muted">Leave a variant’s price empty to use the product price.</p>
          </div>
        </section>

        <div className="sticky-actions" style={{ ['--page-pad' as string]: '20px' }}>
          <button className="btn" onClick={() => nav(-1)}>Cancel</button>
          <button className="btn btn-primary btn-lg" onClick={() => save.mutate()} disabled={save.isPending} aria-busy={save.isPending}>{editing ? 'Save product' : 'Add product'}</button>
        </div>
      </div>
      <datalist id="materials">{['Sheesham wood', 'Teak wood', 'Engineered wood', 'Mango wood', 'Metal', 'Rattan', 'Fabric', 'Leatherette'].map(m => <option key={m} value={m} />)}</datalist>
    </div>
  );
}
