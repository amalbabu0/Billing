import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import { date, iso, isoInput, money } from '@/lib/format';
import { rangeFor } from '@/lib/hooks';
import { usePagedList } from '@/lib/useList';
import { P } from '@/lib/perms';
import type { Expense } from '@/lib/types';
import { useCan, useLookups, useToast } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { HBarChart } from '@/components/Charts';
import { Card, DocNo, EmptyState, Money, PageHeader, StatStrip } from '@/components/ui/display';
import { NumberInput, SearchInput, Select, TextInput } from '@/components/ui/form';
import { Drawer, useConfirm } from '@/components/ui/overlay';
import { DateRange } from '@/components/pickers';

export default function Expenses() {
  const can = useCan();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { data: lookups } = useLookups();
  const month = rangeFor('month');
  const list = usePagedList<Expense>('expenses', '/api/expenses', { filterKeys: ['categoryId', 'from', 'to', 'preset'], defaults: { filters: { from: month.from, to: month.to, preset: 'month' } } });
  const { state, update } = list;
  const from = state.filters.from ?? month.from, to = state.filters.to ?? month.to;
  const summary = useQuery({ queryKey: ['expenses', 'summary', from, to], queryFn: () => api.get<{ category: string; amount: number; count: number }[]>('/api/expenses/summary', { from, to }) });
  const [edit, setEdit] = useState<Partial<Expense> | null>(null);
  const total = (summary.data ?? []).reduce((s, x) => s + x.amount, 0);
  const del = async (e: Expense) => {
    if ((await confirm({ title: `Delete ${e.number}?`, message: `${money(e.amount)} · ${e.categoryName}. The deletion is recorded in the activity log.`, confirmText: 'Delete' })) === null) return;
    try { await api.del(`/api/expenses/${e.id}`); toast.success('Expense deleted'); qc.invalidateQueries({ queryKey: ['expenses'] }); } catch (x) { toast.error('Not deleted', errorMessage(x)); }
  };
  const cols: Column<Expense>[] = [
    { key: 'n', header: 'Voucher', fixed: true, mobile: 'title', render: r => <DocNo>{r.number}</DocNo>, exportValue: r => r.number },
    { key: 'd', header: 'Date', mobile: 'meta', render: r => date(r.expenseDate), exportValue: r => date(r.expenseDate) },
    { key: 'c', header: 'Category', mobile: 'sub', render: r => <span className="cell-title">{r.categoryName}</span>, exportValue: r => r.categoryName },
    { key: 'desc', header: 'Description', render: r => <span className="soft">{r.description ?? '—'}</span>, exportValue: r => r.description },
    { key: 'm', header: 'Paid by', mobile: 'meta', render: r => lookups?.paymentMethods.find(m => m.code === r.methodCode)?.name ?? r.methodCode, exportValue: r => r.methodCode },
    { key: 'ref', header: 'Reference', optional: true, render: r => r.reference ?? '—', exportValue: r => r.reference },
    { key: 'by', header: 'Entered by', optional: true, render: r => r.createdByName, exportValue: r => r.createdByName },
    { key: 'a', header: 'Amount', num: true, money: true, mobile: 'right', render: r => <Money value={r.amount} strong />, exportValue: r => r.amount },
  ];
  return (
    <div className="page">
      <PageHeader title="Expenses" desc="Shop running costs — rent, salaries, transport, electricity. They reduce profit in reports and cash in the daily closing."
        actions={can(P.ExpenseManage) && <button className="btn btn-primary" onClick={() => setEdit({ expenseDate: iso(), methodCode: 'CASH' })}><Plus aria-hidden />Add expense</button>} />
      <DateRange value={{ preset: state.filters.preset ?? 'custom', from, to }} presets={['today', '7d', 'month', 'lastMonth', 'fy', 'custom']} onChange={v => update({ filters: { from: v.from, to: v.to, preset: v.preset } })} />
      <div className="split">
        <StatStrip loading={summary.isLoading} items={[
          { label: 'Total spent', value: money(total, { decimals: false }) },
          { label: 'Entries', value: (summary.data ?? []).reduce((s, x) => s + x.count, 0) },
          { label: 'Largest head', value: summary.data?.[0]?.category ?? '—' },
        ]} />
        <Card title="By category">
          {(summary.data ?? []).length ? <HBarChart label="Expenses by category" items={(summary.data ?? []).slice(0, 6).map(x => ({ label: x.category, value: x.amount, sub: `${x.count} entries` }))} /> : <p className="text-sm muted">No expenses in this period.</p>}
        </Card>
      </div>
      <DataTable id="expenses" label="Expenses" columns={cols} rowKey={r => r.id} {...list.tableProps}
        onRowClick={can(P.ExpenseManage) ? r => setEdit({ ...r, expenseDate: isoInput(r.expenseDate) }) : undefined}
        rowActions={can(P.ExpenseManage) ? r => [
          { label: 'Edit', icon: <Pencil />, onClick: () => setEdit({ ...r, expenseDate: isoInput(r.expenseDate) }) },
          { label: 'Delete', icon: <Trash2 />, danger: true, onClick: () => del(r) },
        ] : undefined}
        toolbar={<>
          <SearchInput value={state.search} onChange={x => update({ search: x })} placeholder="Voucher, description or category" />
          <select className="select input-sm" style={{ width: 180 }} aria-label="Category" value={state.filters.categoryId ?? ''} onChange={e => update({ filters: { categoryId: e.target.value || undefined } })}>
            <option value="">All categories</option>{(lookups?.expenseCategories ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </>}
        empty={<EmptyState icon={<Wallet />} title="No expenses in this period" action={can(P.ExpenseManage) && <button className="btn btn-primary" onClick={() => setEdit({ expenseDate: iso(), methodCode: 'CASH' })}>Add expense</button>} />}
        exportAs={{ title: 'Expenses', subtitle: `${date(from)} – ${date(to)}`, fetchAll: list.fetchAll, totals: [{ label: 'Total', value: money(total) }] }} />
      <ExpenseDrawer value={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

function ExpenseDrawer({ value, onClose }: { value: Partial<Expense> | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: lookups } = useLookups();
  const [e, setE] = useState<Partial<Expense>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key, setKey] = useState<unknown>(null);
  if (value !== key) { setKey(value); setE(value ?? {}); setErrors({}); }
  const save = useMutation({
    mutationFn: () => {
      const err: Record<string, string> = {};
      if (!e.categoryId) err.categoryId = 'Choose a category.';
      if (!e.amount || e.amount <= 0) err.amount = 'Enter the amount.';
      setErrors(err);
      if (Object.keys(err).length) throw new ApiError(400, 'Please correct the highlighted fields.');
      return e.id ? api.put(`/api/expenses/${e.id}`, e) : api.post('/api/expenses', e);
    },
    onSuccess: () => { toast.success(e.id ? 'Expense updated' : 'Expense added'); qc.invalidateQueries({ queryKey: ['expenses'] }); onClose(); },
    onError: x => { if (x instanceof ApiError) setErrors(s => ({ ...s, ...x.fieldErrors })); toast.error('Not saved', errorMessage(x)); },
  });
  return (
    <Drawer open={!!value} onClose={onClose} title={e.id ? `Edit ${e.number}` : 'Add expense'}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><span className="grow" /><button className="btn btn-primary" onClick={() => save.mutate()} aria-busy={save.isPending}>Save</button></>}>
      <form className="stack gap-4" onSubmit={x => { x.preventDefault(); save.mutate(); }}>
        <Select label="Category" required value={e.categoryId ?? ''} error={errors.categoryId} onChange={x => setE({ ...e, categoryId: Number(x.target.value) || undefined })}
          options={[{ value: '', label: 'Choose…' }, ...(lookups?.expenseCategories ?? []).filter(c => c.isActive || c.id === e.categoryId).map(c => ({ value: c.id, label: c.name }))]} />
        <div className="grid grid-2">
          <NumberInput label="Amount" required money value={e.amount ?? null} error={errors.amount} onChange={v => setE({ ...e, amount: v ?? 0 })} autoFocus />
          <TextInput label="Date" type="date" required max={iso()} value={e.expenseDate ?? ''} onChange={x => setE({ ...e, expenseDate: x.target.value })} error={errors.expenseDate} />
        </div>
        <Select label="Paid by" value={e.methodCode ?? 'CASH'} onChange={x => setE({ ...e, methodCode: x.target.value })} options={(lookups?.paymentMethods ?? []).filter(m => m.isMoney && m.isActive).map(m => ({ value: m.code, label: m.name }))} />
        <TextInput label="Description" optional value={e.description ?? ''} onChange={x => setE({ ...e, description: x.target.value })} placeholder="October shop rent" />
        <TextInput label="Reference" optional value={e.reference ?? ''} onChange={x => setE({ ...e, reference: x.target.value })} placeholder="Bill no. / UPI ref" />
      </form>
    </Drawer>
  );
}
