import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, IndianRupee, Pencil, Phone } from 'lucide-react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { P } from '@/lib/perms';
import type { LedgerEntry, Supplier } from '@/lib/types';
import { useCan } from '@/app/providers';
import { EmptyState, PageHeader, StatStrip } from '@/components/ui/display';
import { SupplierPicker } from '@/components/pickers';
import { LedgerTable } from '../customers/CustomerLedger';
import { SupplierPayModal } from './SupplierPayments';
import { SupplierDrawer } from './Suppliers';

/** Supplier statement: purchases (we owe), payments and debit notes (reduce what we owe). */
export default function SupplierLedger() {
  const { id } = useParams();
  const can = useCan();
  const nav = useNavigate();
  const [pay, setPay] = useState(false);
  const [edit, setEdit] = useState<Supplier | undefined>(undefined);
  const supplier = useQuery({ queryKey: ['supplier', Number(id)], queryFn: () => api.get<Supplier>(`/api/suppliers/${id}`), enabled: !!id });
  const ledger = useQuery({ queryKey: ['supplier-ledger', Number(id)], queryFn: () => api.get<LedgerEntry[]>(`/api/suppliers/${id}/ledger`), enabled: !!id });
  const s = supplier.data;
  return (
    <div className="page">
      <PageHeader crumbs={[{ label: 'Suppliers', to: '/purchases/suppliers' }, { label: s?.name ?? 'Ledger' }]} title={s ? s.name : 'Supplier ledger'}
        desc={s ? <span className="row wrap gap-3">{s.gstin && <span>GSTIN <span className="mono">{s.gstin}</span></span>}{s.mobile && <span className="row gap-1"><Phone aria-hidden style={{ width: 13 }} />{s.mobile}</span>}{s.bankAccount && <span>{s.bankName} · {s.bankAccount} · {s.bankIfsc}</span>}</span> : 'Choose a supplier to see purchases, payments and returns with a running balance.'}
        actions={s && <>
          {can(P.SupplierPay) && <button className="btn btn-primary" onClick={() => setPay(true)}><IndianRupee aria-hidden />Pay supplier</button>}
          {can(P.PurchaseManage) && <Link className="btn" to="/purchases/new">New purchase</Link>}
          {can(P.SupplierManage) && <button className="btn" onClick={() => setEdit(s)}><Pencil aria-hidden />Edit</button>}
        </>} />
      {!id && <div className="card card-pad" style={{ maxWidth: 520 }}><SupplierPicker value={null} onChange={x => x && nav(`/purchases/suppliers/${x.id}`)} /></div>}
      {!id ? <EmptyState icon={<BookOpen />} title="Choose a supplier" /> : (
        <>
          <StatStrip loading={!s} items={[
            { label: 'Purchases', value: money(s?.totalPurchases, { decimals: false }) }, { label: 'Paid', value: money(s?.totalPaid, { decimals: false }), tone: 'ok' },
            { label: (s?.outstanding ?? 0) >= 0 ? 'Payable' : 'Advance with supplier', value: money(Math.abs(s?.outstanding ?? 0), { decimals: false }), tone: (s?.outstanding ?? 0) > 0 ? 'warn' : undefined },
          ]} />
          <LedgerTable entries={ledger.data} loading={ledger.isLoading} party="supplier" exportTitle={`Supplier ledger ${s?.name ?? ''}`} />
        </>
      )}
      {pay && s && <SupplierPayModal open onClose={() => setPay(false)} supplierId={s.id} supplierName={s.name} />}
      <SupplierDrawer supplier={edit} onClose={() => setEdit(undefined)} />
    </div>
  );
}
