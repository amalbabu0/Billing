import { money, qty } from '@/lib/format';
import type { DocLine } from '@/lib/types';
import { Money } from './ui/display';

/** Read-only line items for invoices, quotations and orders. */
export function DocLinesTable({ lines, interState, showReturned, showCost, showReserved }: { lines: DocLine[]; interState: boolean; showReturned?: boolean; showCost?: boolean; showReserved?: boolean }) {
  return (
    <div className="table-scroll">
      <table className="data">
        <thead>
          <tr>
            <th>Item</th><th>HSN</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Disc.</th><th className="num">Taxable</th>
            <th className="num">GST</th><th className="num">{interState ? 'IGST' : 'CGST + SGST'}</th><th className="num">Amount</th>
            {showReserved && <th className="num">Reserved</th>}
            {showReturned && <th className="num">Returned</th>}
            {showCost && <th className="num">Cost</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map(l => (
            <tr key={l.id}>
              <td><div className="cell-stack"><span className="cell-title">{l.description}</span>{l.sku && <span className="cell-sub mono">{l.sku}</span>}</div></td>
              <td className="mono text-sm">{l.hsnCode ?? '—'}</td>
              <td className="num">{qty(l.quantity)}</td>
              <td className="num"><span className="money">{money(l.unitPrice)}</span><div className="text-xs muted">{l.priceIncludesGst ? 'incl.' : 'excl.'} GST</div></td>
              <td className="num">{l.discountPercent > 0 ? `${l.discountPercent}%` : l.discountAmount > 0 ? money(l.discountAmount) : '—'}</td>
              <td className="num"><Money value={l.taxableAmount} /></td>
              <td className="num">{l.gstRate}%</td>
              <td className="num"><Money value={l.cgst + l.sgst + l.igst} /></td>
              <td className="num"><Money value={l.lineTotal} strong /></td>
              {showReserved && <td className="num">{qty(l.reservedQty)}</td>}
              {showReturned && <td className="num">{l.returnedQty > 0 ? <span className="t-warn">{qty(l.returnedQty)}</span> : '—'}</td>}
              {showCost && <td className="num"><Money value={(l.unitCost ?? 0) * l.quantity} className="soft" /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** GST breakup by rate, as printed on a tax invoice. Charges are taxed at the configured charges rate. */
export function TaxSummary({ lines, interState, chargesTax, charges }: { lines: DocLine[]; interState: boolean; chargesTax: number; charges: number }) {
  const byRate = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
  for (const l of lines) {
    const r = byRate.get(l.gstRate) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    r.taxable += l.taxableAmount; r.cgst += l.cgst; r.sgst += l.sgst; r.igst += l.igst;
    byRate.set(l.gstRate, r);
  }
  const rows = [...byRate.entries()].sort((a, b) => a[0] - b[0]);
  return (
    <div className="table-card">
      <table className="data compact">
        <thead><tr><th>GST rate</th><th className="num">Taxable</th>{interState ? <th className="num">IGST</th> : <><th className="num">CGST</th><th className="num">SGST</th></>}</tr></thead>
        <tbody>
          {rows.map(([rate, r]) => (
            <tr key={rate}><td>{rate}%</td><td className="num"><Money value={r.taxable} /></td>
              {interState ? <td className="num"><Money value={r.igst} /></td> : <><td className="num"><Money value={r.cgst} /></td><td className="num"><Money value={r.sgst} /></td></>}</tr>
          ))}
          {charges > 0 && (
            <tr><td>Delivery / installation</td><td className="num"><Money value={charges} /></td>
              {interState ? <td className="num"><Money value={chargesTax} /></td> : <><td className="num"><Money value={Math.round((chargesTax / 2) * 100) / 100} /></td><td className="num"><Money value={chargesTax - Math.round((chargesTax / 2) * 100) / 100} /></td></>}</tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
