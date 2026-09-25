import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { P } from '@/lib/perms';
import type { Brand } from '@/lib/types';
import { useCan, useToast } from '@/app/providers';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge, EmptyState, PageHeader } from '@/components/ui/display';
import { Switch, TextInput } from '@/components/ui/form';
import { Modal, useConfirm } from '@/components/ui/overlay';

export default function Brands() {
  const can = useCan();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['brands'], queryFn: () => api.get<Brand[]>('/api/brands') });
  const [edit, setEdit] = useState<Partial<Brand> | null>(null);
  const refresh = () => ['brands', 'lookups', 'product-facets'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
  const save = useMutation({
    mutationFn: (b: Partial<Brand>) => (b.id ? api.put(`/api/brands/${b.id}`, b) : api.post('/api/brands', b)),
    onSuccess: () => { toast.success('Brand saved'); refresh(); setEdit(null); },
    onError: e => toast.error('Not saved', errorMessage(e)),
  });
  const remove = async (b: Brand) => {
    if ((await confirm({ title: `Delete ${b.name}?`, message: 'Products keep working; they will simply show no brand.', confirmText: 'Delete brand' })) === null) return;
    try { await api.del(`/api/brands/${b.id}`); toast.success('Brand deleted'); refresh(); } catch (e) { toast.error('Not deleted', errorMessage(e)); }
  };
  const cols: Column<Brand>[] = [
    { key: 'name', header: 'Brand', fixed: true, mobile: 'title', render: b => <span className="cell-title">{b.name}</span>, exportValue: b => b.name },
    { key: 'count', header: 'Products', num: true, mobile: 'right', render: b => <Link to={`/products?brandId=${b.id}`} onClick={e => e.stopPropagation()}>{b.productCount ?? 0}</Link>, exportValue: b => b.productCount },
    { key: 'active', header: 'Status', render: b => (b.isActive ? <Badge tone="ok">Active</Badge> : <Badge>Hidden</Badge>), exportValue: b => (b.isActive ? 'Active' : 'Hidden') },
  ];
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <PageHeader title="Brands" desc="Manufacturers and in-house lines. Use brand as a filter in products and reports."
        actions={can(P.ProductManage) && <button className="btn btn-primary" onClick={() => setEdit({ name: '', isActive: true })}><Plus aria-hidden />Add brand</button>} />
      <DataTable id="brands" label="Brands" columns={cols} rows={data} loading={isLoading} error={error} onRetry={() => void refetch()} rowKey={b => b.id}
        onRowClick={can(P.ProductManage) ? b => setEdit(b) : undefined}
        rowActions={b => [
          { label: 'Edit', icon: <Pencil />, onClick: () => setEdit(b), hidden: !can(P.ProductManage) },
          { label: 'Delete', icon: <Trash2 />, danger: true, onClick: () => remove(b), hidden: !can(P.ProductDelete) },
        ]}
        empty={<EmptyState icon={<Tag />} title="No brands yet" desc="Brands are optional — add them if you stock branded furniture." />} />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit brand' : 'Add brand'} width={420}
        footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" disabled={!edit?.name?.trim() || save.isPending} aria-busy={save.isPending} onClick={() => edit && save.mutate(edit)}>Save</button></>}>
        {edit && <div className="stack gap-4">
          <TextInput label="Brand name" required autoFocus value={edit.name ?? ''} onChange={e => setEdit({ ...edit, name: e.target.value })} />
          <Switch label="Active" checked={edit.isActive ?? true} onChange={v => setEdit({ ...edit, isActive: v })} />
        </div>}
      </Modal>
    </div>
  );
}
