import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { api, download, errorMessage } from '@/lib/api';
import { money, num } from '@/lib/format';
import { useToast } from '@/app/providers';
import { Badge, Card, EmptyState, Notice, PageHeader, Segmented, StatStrip } from '@/components/ui/display';

interface ImportRow {
  line: number; action: 'CREATE' | 'UPDATE' | 'ERROR'; errors: string[]; warnings: string[]; code: string; name: string; category: string; brand?: string;
  sellingPrice: number; gstRate: number; costPrice?: number | null; openingStock: number; warrantyMonths: number; hsnCode?: string; [k: string]: unknown;
}
interface Preview { rows: ImportRow[]; creates: number; updates: number; errorCount: number; newCategories: string[]; newBrands: string[] }
interface Result { created: number; updated: number; failed: string[] }

/** Catalogue import from CSV / Excel: upload → check every row → import the good ones. */
export default function ProductImport() {
  const toast = useToast();
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [show, setShow] = useState<'all' | 'ERROR' | 'CREATE' | 'UPDATE'>('all');
  const [over, setOver] = useState(false);
  const check = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append('file', f); setName(f.name); return api.upload<Preview>('/api/products/import/preview', fd); },
    onSuccess: p => { setPreview(p); setResult(null); setShow(p.errorCount ? 'ERROR' : 'all'); },
    onError: e => toast.error('File not accepted', errorMessage(e)),
  });
  const commit = useMutation({
    mutationFn: () => api.post<Result>('/api/products/import/commit', preview!.rows.filter(r => r.action !== 'ERROR')),
    onSuccess: r => { setResult(r); setPreview(null); ['products', 'sellable', 'inventory', 'lookups'].forEach(k => qc.invalidateQueries({ queryKey: [k] })); toast.success('Import finished', `${r.created} added, ${r.updated} updated.`); },
    onError: e => toast.error('Import failed', errorMessage(e)),
  });
  const pick = (f?: File | null) => { if (f) check.mutate(f); };
  const rows = (preview?.rows ?? []).filter(r => show === 'all' || r.action === show);
  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <PageHeader crumbs={[{ label: 'Products', to: '/products' }, { label: 'Import' }]} title="Import products"
        desc="Add or update many products from a spreadsheet. Nothing is saved until you have checked the preview."
        actions={<button className="btn" onClick={() => download('GET', '/api/products/import/template', 'product-import-template.xlsx').catch(e => toast.error('Download failed', errorMessage(e)))}><Download aria-hidden />Template</button>} />
      {result && <Card title="Import complete">
        <div className="stack gap-3">
          <p><CheckCircle2 className="t-ok" aria-hidden style={{ width: 18, verticalAlign: -3 }} /> <b>{result.created}</b> products added, <b>{result.updated}</b> updated.</p>
          {result.failed.length > 0 && <Notice tone="bad"><div className="stack gap-1">{result.failed.map(f => <span key={f}>{f}</span>)}</div></Notice>}
          <div className="row gap-2"><Link className="btn btn-primary" to="/products">View products</Link><button className="btn" onClick={() => setResult(null)}>Import another file</button></div>
        </div>
      </Card>}
      {!preview && !result && (
        <Card>
          <label className={`dropzone import-drop ${over ? 'over' : ''}`} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }} aria-busy={check.isPending}>
            <FileSpreadsheet aria-hidden />
            <span className="medium">{check.isPending ? `Checking ${name}…` : 'Drop a .xlsx or .csv file here, or click to choose'}</span>
            <span className="text-sm muted">Up to 5,000 rows. One product per row, first row is the header.</span>
            <input ref={file} type="file" accept=".csv,.xlsx" hidden onChange={e => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <div className="stack gap-2" style={{ marginTop: 16 }}>
            <p className="text-sm"><b>Required columns:</b> Code, Name, Category, Selling price.</p>
            <p className="text-sm soft">Optional: Brand, Material, Color, Finish, Dimensions, HSN, GST %, Price includes GST (Yes/No), Cost price, Discount %, Min stock, Warranty months, Opening stock, Stock item (Yes/No), Barcode, Description.</p>
            <p className="text-sm soft">A code that already exists updates that product (name, prices, tax, category…). Stock of existing products is never changed by an import — use stock adjustments or purchases.</p>
          </div>
        </Card>
      )}
      {preview && <>
        <StatStrip items={[{ label: 'New products', value: num(preview.creates) }, { label: 'Updates', value: num(preview.updates) }, { label: 'Rows with errors', value: num(preview.errorCount), tone: preview.errorCount ? 'bad' : undefined }]} />
        {(preview.newCategories.length > 0 || preview.newBrands.length > 0) && <Notice tone="info">
          {preview.newCategories.length > 0 && <>New categories will be created: <b>{preview.newCategories.join(', ')}</b>. </>}
          {preview.newBrands.length > 0 && <>New brands: <b>{preview.newBrands.join(', ')}</b>.</>}
        </Notice>}
        <Card bodyClass="" title={name} actions={<div className="row gap-2">
          <button className="btn" onClick={() => setPreview(null)}>Choose another file</button>
          <button className="btn btn-primary" disabled={preview.creates + preview.updates === 0 || commit.isPending} aria-busy={commit.isPending} onClick={() => commit.mutate()}><Upload aria-hidden />Import {preview.creates + preview.updates} row{preview.creates + preview.updates === 1 ? '' : 's'}</button>
        </div>}>
          <div className="table-toolbar"><Segmented value={show} onChange={setShow} label="Show" options={[{ value: 'all', label: `All ${preview.rows.length}` }, { value: 'ERROR', label: `Errors ${preview.errorCount}` }, { value: 'CREATE', label: `New ${preview.creates}` }, { value: 'UPDATE', label: `Updates ${preview.updates}` }]} />
            {preview.errorCount > 0 && <span className="text-sm muted">Rows with errors are skipped. Fix them in the file and upload again, or import the rest now.</span>}</div>
          {rows.length === 0 ? <EmptyState compact title="Nothing to show" /> : (
            <div className="table-scroll" style={{ maxHeight: '60vh' }}><table className="data compact">
              <thead><tr><th className="num">Row</th><th>Result</th><th>Code</th><th>Name</th><th>Category</th><th className="num">Price</th><th className="num">GST</th><th className="num">Opening</th><th>Notes</th></tr></thead>
              <tbody>{rows.map(r => (
                <tr key={r.line} className={r.action === 'ERROR' ? 'row-error' : ''}>
                  <td className="num muted">{r.line}</td>
                  <td><Badge tone={r.action === 'ERROR' ? 'bad' : r.action === 'CREATE' ? 'ok' : 'info'}>{r.action === 'ERROR' ? 'Error' : r.action === 'CREATE' ? 'New' : 'Update'}</Badge></td>
                  <td className="mono">{r.code || '—'}</td><td>{r.name || '—'}</td><td>{r.category || '—'}</td>
                  <td className="num">{money(r.sellingPrice, { decimals: false })}</td><td className="num">{r.gstRate}%</td><td className="num">{r.action === 'CREATE' && r.openingStock ? r.openingStock : '—'}</td>
                  <td className="text-sm">{r.errors.map(e => <div key={e} className="t-bad">{e}</div>)}{r.warnings.map(w => <div key={w} className="t-warn">{w}</div>)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      </>}
    </div>
  );
}
