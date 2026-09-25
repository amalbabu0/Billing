import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderTree, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import { P } from '@/lib/perms';
import type { Category } from '@/lib/types';
import { useCan, useLookups, useToast } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge, EmptyState, PageHeader } from '@/components/ui/display';
import { NumberInput, Select, Switch, TextArea, TextInput } from '@/components/ui/form';
import { Modal, useConfirm } from '@/components/ui/overlay';

export default function Categories() {
  const can = useCan();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/api/categories') });
  const [edit, setEdit] = useState<Category | null | undefined>(undefined);
  const remove = async (c: Category) => {
    if ((await confirm({ title: `Delete ${c.name}?`, message: 'Only empty categories can be deleted. Move products to another category first.', confirmText: 'Delete category' })) === null) return;
    try { await api.del(`/api/categories/${c.id}`); toast.success('Category deleted'); qc.invalidateQueries({ queryKey: ['categories'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); }
    catch (e) { toast.error('Not deleted', errorMessage(e)); }
  };
  const cols: Column<Category>[] = [
    { key: 'name', header: 'Category', fixed: true, mobile: 'title', render: c => <div className="cell-stack"><span className="cell-title">{c.name}</span>{c.description && <span className="cell-sub">{c.description}</span>}</div>, exportValue: c => c.name },
    { key: 'count', header: 'Products', num: true, mobile: 'right', render: c => <Link to={`/products?categoryId=${c.id}`} onClick={e => e.stopPropagation()}>{c.productCount}</Link>, exportValue: c => c.productCount },
    { key: 'hsn', header: 'Default HSN', mobile: 'meta', render: c => <span className="mono">{c.defaultHsn ?? '—'}</span>, exportValue: c => c.defaultHsn },
    { key: 'gst', header: 'Default GST', mobile: 'meta', render: c => (c.defaultGstRate !== null && c.defaultGstRate !== undefined ? `${c.defaultGstRate}%` : '—'), exportValue: c => c.defaultGstRate },
    { key: 'active', header: 'Status', render: c => (c.isActive ? <Badge tone="ok">Active</Badge> : <Badge>Hidden</Badge>), exportValue: c => (c.isActive ? 'Active' : 'Hidden') },
  ];
  return (
    <div className="page">
      <PageHeader title="Categories" desc="Group furniture the way customers shop. A category’s HSN and GST rate are filled in automatically for new products."
        actions={can(P.ProductManage) && <button className="btn btn-primary" onClick={() => setEdit(null)}><Plus aria-hidden />Add category</button>} />
      <DataTable id="categories" label="Categories" columns={cols} rows={data} loading={isLoading} error={error} onRetry={() => void refetch()} rowKey={c => c.id}
        onRowClick={can(P.ProductManage) ? c => setEdit(c) : undefined}
        rowActions={c => [
          { label: 'Edit', icon: <Pencil />, onClick: () => setEdit(c), hidden: !can(P.ProductManage) },
          { label: 'Delete', icon: <Trash2 />, danger: true, onClick: () => remove(c), hidden: !can(P.ProductDelete) || c.productCount > 0 },
        ]}
        empty={<EmptyState icon={<FolderTree />} title="No categories yet" desc="Start with Sofas, Beds, Dining, Wardrobes…" action={can(P.ProductManage) && <button className="btn btn-primary" onClick={() => setEdit(null)}>Add a category</button>} />}
        exportAs={{ title: 'Categories', fetchAll: async () => data ?? [] }} />
      <CategoryModal category={edit} onClose={() => setEdit(undefined)} />
    </div>
  );
}

function CategoryModal({ category, onClose }: { category: Category | null | undefined; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: lookups } = useLookups();
  const [c, setC] = useState<Partial<Category>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (category !== undefined) { setC(category ?? { name: '', isActive: true, defaultGstRate: lookups?.defaults.defaultGstRate }); setErrors({}); } }, [category, lookups]);
  const save = useMutation({
    mutationFn: () => (c.id ? api.put(`/api/categories/${c.id}`, c) : api.post('/api/categories', c)),
    onSuccess: () => { toast.success(c.id ? 'Category saved' : 'Category added', c.name); qc.invalidateQueries({ queryKey: ['categories'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); qc.invalidateQueries({ queryKey: ['product-facets'] }); onClose(); },
    onError: e => { if (e instanceof ApiError) setErrors({ ...e.fieldErrors, form: e.message }); },
  });
  return (
    <Modal open={category !== undefined} onClose={onClose} title={c.id ? 'Edit category' : 'Add category'} width={520}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => save.mutate()} disabled={!c.name?.trim() || save.isPending} aria-busy={save.isPending}>Save</button></>}>
      <div className="stack gap-4">
        {errors.form && !errors.name && <p className="t-bad text-sm">{errors.form}</p>}
        <TextInput label="Name" required value={c.name ?? ''} onChange={e => setC({ ...c, name: e.target.value })} error={errors.name} autoFocus />
        <TextArea label="Description" optional rows={2} value={c.description ?? ''} onChange={e => setC({ ...c, description: e.target.value })} />
        <div className="grid grid-2">
          <Select label="Default HSN" value={c.defaultHsn ?? ''} onChange={e => setC({ ...c, defaultHsn: e.target.value || undefined })} placeholder="None" options={(lookups?.hsnCodes ?? []).map(h => ({ value: h.code, label: `${h.code} — ${h.description}` }))} />
          <NumberInput label="Default GST %" value={c.defaultGstRate ?? null} min={0} max={100} onChange={v => setC({ ...c, defaultGstRate: v ?? undefined })} />
        </div>
        <Switch label="Show in billing and lists" checked={c.isActive ?? true} onChange={v => setC({ ...c, isActive: v })} />
      </div>
    </Modal>
  );
}
