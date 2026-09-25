import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Download, FileSpreadsheet, FileText, Sheet } from 'lucide-react';
import { download, errorMessage } from '@/lib/api';
import { useStored } from '@/lib/hooks';
import { useCan, useToast } from '@/app/providers';
import { P } from '@/lib/perms';
import { num } from '@/lib/format';
import { Checkbox } from './ui/form';
import { Menu, type MenuAction } from './ui/overlay';
import { EmptyState, ErrorPanel, SkeletonRows } from './ui/display';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Server sort key; omit for unsortable columns. */
  sort?: string;
  num?: boolean;
  width?: number | string;
  /** Hidden by default (user can show it from "Columns"). */
  optional?: boolean;
  /** Cannot be hidden. */
  fixed?: boolean;
  /** How the column appears in phone card layout. */
  mobile?: 'title' | 'sub' | 'right' | 'meta' | 'hide';
  /** Plain value for CSV / Excel / PDF export. */
  exportValue?: (row: T) => string | number | null | undefined;
  money?: boolean;
  footer?: ReactNode;
}

export interface DataTableProps<T> {
  id: string;
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string | number;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  total?: number;
  page?: number;
  pageSize?: number;
  onPage?: (p: number) => void;
  onPageSize?: (s: number) => void;
  sortBy?: string;
  sortDescending?: boolean;
  onSort?: (key: string, desc: boolean) => void;
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => MenuAction[];
  rowClass?: (row: T) => string | undefined;
  toolbar?: ReactNode;
  empty?: ReactNode;
  selectable?: boolean;
  bulkActions?: (selected: T[], clear: () => void) => ReactNode;
  exportAs?: { title: string; subtitle?: string; fetchAll: () => Promise<T[]>; totals?: { label: string; value: string }[] };
  compact?: boolean;
  maxHeight?: number | string;
  hideFooterTotals?: boolean;
  label?: string;
}

export function DataTable<T>(p: DataTableProps<T>) {
  const can = useCan();
  const toast = useToast();
  const [hidden, setHidden] = useStored<string[]>(`cols:${p.id}`, p.columns.filter(c => c.optional).map(c => c.key));
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [exporting, setExporting] = useState(false);

  const cols = useMemo(() => p.columns.filter(c => c.fixed || !hidden.includes(c.key)), [p.columns, hidden]);
  const rows = p.rows ?? [];
  const selRows = rows.filter(r => selected.has(p.rowKey(r)));
  const allSel = rows.length > 0 && selRows.length === rows.length;
  const hasFooter = !p.hideFooterTotals && cols.some(c => c.footer !== undefined);
  const clear = () => setSelected(new Set());

  const doExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    if (!p.exportAs) return;
    setExporting(true);
    try {
      const all = await p.exportAs.fetchAll();
      const exportCols = cols.filter(c => c.exportValue);
      const data = all.map(r => Object.fromEntries(exportCols.map(c => [c.key, c.exportValue!(r) ?? null])));
      await download('POST', '/api/export', `${p.exportAs.title}.${format}`, {
        title: p.exportAs.title, subtitle: p.exportAs.subtitle, format,
        columns: exportCols.map(c => ({ key: c.key, label: typeof c.header === 'string' ? c.header : c.key, money: !!c.money })),
        rows: data, totals: p.exportAs.totals,
      });
      toast.success('Export ready', `${num(all.length)} rows saved as ${format.toUpperCase()}.`);
    } catch (e) {
      toast.error('Export failed', errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const sortIcon = (c: Column<T>) => p.sortBy === c.sort ? (p.sortDescending ? <ArrowDown aria-hidden /> : <ArrowUp aria-hidden />) : <ArrowUpDown aria-hidden style={{ opacity: 0.35 }} />;
  const ariaSort = (c: Column<T>) => (p.sortBy === c.sort ? (p.sortDescending ? 'descending' : 'ascending') : undefined);
  const titleCol = p.columns.find(c => c.mobile === 'title') ?? cols[0];
  const subCols = p.columns.filter(c => c.mobile === 'sub');
  const rightCol = p.columns.find(c => c.mobile === 'right');
  const metaCols = p.columns.filter(c => c.mobile === 'meta');

  const toolbarRight = (
    <div className="row gap-2" style={{ marginLeft: 'auto' }}>
      {p.columns.some(c => !c.fixed) && (
        <Menu
          label="Show or hide columns"
          trigger={<><Columns3 aria-hidden /><span className="desktop-only">Columns</span></>}
          items={p.columns.filter(c => !c.fixed).map(c => ({
            label: `${hidden.includes(c.key) ? '   ' : '✓ '}${typeof c.header === 'string' ? c.header : c.key}`,
            onClick: () => setHidden(hidden.includes(c.key) ? hidden.filter(h => h !== c.key) : [...hidden, c.key]),
          }))}
        />
      )}
      {p.exportAs && can(P.ExportData) && (
        <Menu
          label="Export"
          trigger={<><Download aria-hidden /><span className="desktop-only">{exporting ? 'Exporting…' : 'Export'}</span></>}
          items={[
            { label: 'Excel (.xlsx)', icon: <FileSpreadsheet />, onClick: () => doExport('xlsx'), disabled: exporting },
            { label: 'CSV', icon: <Sheet />, onClick: () => doExport('csv'), disabled: exporting },
            { label: 'PDF', icon: <FileText />, onClick: () => doExport('pdf'), disabled: exporting },
          ]}
        />
      )}
    </div>
  );

  const pages = Math.max(1, Math.ceil((p.total ?? rows.length) / (p.pageSize || 25)));
  const from = p.total ? (((p.page ?? 1) - 1) * (p.pageSize ?? 25)) + 1 : 0;
  const to = Math.min((p.page ?? 1) * (p.pageSize ?? 25), p.total ?? rows.length);

  return (
    <div className="table-card responsive" style={p.maxHeight ? ({ ['--table-max' as string]: typeof p.maxHeight === 'number' ? `${p.maxHeight}px` : p.maxHeight }) : undefined}>
      {(p.toolbar || p.exportAs || p.columns.some(c => !c.fixed)) && (
        <div className="table-toolbar">{p.toolbar}{toolbarRight}</div>
      )}
      {p.selectable && selRows.length > 0 && p.bulkActions && (
        <div className="bulk-bar" role="region" aria-label="Bulk actions">
          <span className="medium">{selRows.length} selected</span>
          {p.bulkActions(selRows, clear)}
          <button className="btn btn-sm" onClick={clear} style={{ marginLeft: 'auto' }}>Clear</button>
        </div>
      )}

      {p.error ? <div style={{ padding: 16 }}><ErrorPanel error={p.error} retry={p.onRetry} /></div>
        : p.loading && rows.length === 0 ? <SkeletonRows rows={Math.min(p.pageSize ?? 8, 8)} cols={Math.min(cols.length, 6)} />
        : rows.length === 0 ? (p.empty ?? <EmptyState title="Nothing to show" desc="Try a different search or clear the filters." />)
        : (
          <>
            <div className="table-scroll" aria-busy={p.loading || undefined}>
              <table className={`data${p.compact ? ' compact' : ''}`} aria-label={p.label}>
                <thead>
                  <tr>
                    {p.selectable && (
                      <th className="select"><Checkbox checked={allSel} indeterminate={selRows.length > 0 && !allSel} onChange={v => setSelected(v ? new Set(rows.map(p.rowKey)) : new Set())} label={<span className="sr-only">Select all</span>} /></th>
                    )}
                    {cols.map(c => (
                      <th key={c.key} className={c.num ? 'num' : undefined} style={{ width: c.width }} aria-sort={ariaSort(c)} scope="col">
                        {c.sort && p.onSort ? (
                          <button className="th-sort" onClick={() => p.onSort!(c.sort!, p.sortBy === c.sort ? !p.sortDescending : !!c.num)}>{c.header}{sortIcon(c)}</button>
                        ) : c.header}
                      </th>
                    ))}
                    {p.rowActions && <th className="actions"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody style={{ opacity: p.loading ? 0.55 : 1, transition: 'opacity 120ms' }}>
                  {rows.map(r => {
                    const k = p.rowKey(r);
                    return (
                      <tr
                        key={k}
                        className={[p.onRowClick ? 'clickable' : '', p.rowClass?.(r) ?? ''].join(' ')}
                        aria-selected={selected.has(k) || undefined}
                        onClick={p.onRowClick ? () => p.onRowClick!(r) : undefined}
                        onKeyDown={p.onRowClick ? e => { if (e.key === 'Enter' && e.target === e.currentTarget) p.onRowClick!(r); } : undefined}
                        tabIndex={p.onRowClick ? 0 : undefined}
                      >
                        {p.selectable && (
                          <td className="select" onClick={e => e.stopPropagation()}>
                            <Checkbox checked={selected.has(k)} onChange={v => { const n = new Set(selected); if (v) n.add(k); else n.delete(k); setSelected(n); }} label={<span className="sr-only">Select row</span>} />
                          </td>
                        )}
                        {cols.map(c => <td key={c.key} className={c.num ? 'num' : undefined}>{c.render(r)}</td>)}
                        {p.rowActions && <td className="actions" onClick={e => e.stopPropagation()}><Menu items={p.rowActions(r)} /></td>}
                      </tr>
                    );
                  })}
                </tbody>
                {hasFooter && (
                  <tfoot>
                    <tr>
                      {p.selectable && <td />}
                      {cols.map(c => <td key={c.key} className={c.num ? 'num' : undefined}>{c.footer}</td>)}
                      {p.rowActions && <td />}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <div className="row-cards" aria-label={p.label}>
              {rows.map(r => {
                const content = (
                  <>
                    <div className="row-card-main">
                      <div className="row-card-top">
                        <span className="medium truncate">{titleCol.render(r)}</span>
                        {rightCol && <span className="num medium">{rightCol.render(r)}</span>}
                      </div>
                      {subCols.map(c => <div key={c.key} className="text-sm soft">{c.render(r)}</div>)}
                      {metaCols.length > 0 && <div className="row-card-meta">{metaCols.map(c => <span key={c.key}>{c.render(r)}</span>)}</div>}
                    </div>
                    {p.rowActions && <span onClick={e => e.stopPropagation()}><Menu items={p.rowActions(r)} /></span>}
                  </>
                );
                return p.onRowClick
                  ? <div key={p.rowKey(r)} className="row-card" role="button" tabIndex={0} onClick={() => p.onRowClick!(r)} onKeyDown={e => { if (e.key === 'Enter') p.onRowClick!(r); }}>{content}</div>
                  : <div key={p.rowKey(r)} className="row-card">{content}</div>;
              })}
            </div>
          </>
        )}

      {p.onPage && (p.total ?? 0) > 0 && (
        <nav className="pagination" aria-label="Pagination">
          <span>{num(from)}–{num(to)} of {num(p.total)}</span>
          {p.onPageSize && (
            <label className="row gap-2 desktop-only">
              <span>Rows</span>
              <select className="select" value={p.pageSize} onChange={e => p.onPageSize!(Number(e.target.value))}>
                {[10, 25, 50, 100].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          )}
          <div className="pages">
            <button className="btn btn-sm btn-icon" disabled={(p.page ?? 1) <= 1} onClick={() => p.onPage!((p.page ?? 1) - 1)} aria-label="Previous page"><ChevronLeft /></button>
            <span className="num" style={{ minWidth: 70, textAlign: 'center' }}>Page {p.page ?? 1} / {pages}</span>
            <button className="btn btn-sm btn-icon" disabled={(p.page ?? 1) >= pages} onClick={() => p.onPage!((p.page ?? 1) + 1)} aria-label="Next page"><ChevronRight /></button>
          </div>
        </nav>
      )}
    </div>
  );
}
