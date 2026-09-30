// Excel (.xlsx), CSV and print output. The XLSX writer builds a real Office Open XML
// workbook (stored ZIP) in the browser: no external libraries.
import { esc, fdate, today } from './utils.js';
import { S } from './store.js';

// ---------------------------------------------------------------- ZIP (store, no compression)
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zip(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const [name, text] of files) {
    const data = enc.encode(text), nameB = enc.encode(name), crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true); local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nameB.length, true); local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), nameB, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
    cen.setUint16(12, dosTime, true); cen.setUint16(14, dosDate, true); cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
    cen.setUint16(28, nameB.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cenSize = central.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const xml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

/**
 * table = { title, subtitle, columns:[{label, type:'text'|'money'|'qty'|'date'|'pct'}], rows:[[...values]], totals:[...]|null }
 * Values are raw: numbers for numeric types, ISO strings for dates.
 */
export function toXlsx(table) {
  const { columns, rows, totals } = table;
  const styleOf = t => ({ money: 3, qty: 4, pct: 5, date: 6 }[t] || 0);
  const cell = (v, t, r, c, bold) => {
    const ref = colName(c) + r;
    if (v == null || v === '') return `<c r="${ref}"${bold ? ' s="1"' : ''}/>`;
    if (t === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const serial = (Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000;
      return `<c r="${ref}" s="6"><v>${serial}</v></c>`;
    }
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${bold ? styleOf(t) + 4 : styleOf(t)}"><v>${t === 'pct' ? v / 100 : v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  };
  let r = 1;
  const out = [];
  out.push(`<row r="${r}"><c r="A${r}" t="inlineStr" s="2"><is><t>${xml(table.title)}</t></is></c></row>`); r++;
  if (table.subtitle) { out.push(`<row r="${r}"><c r="A${r}" t="inlineStr"><is><t>${xml(table.subtitle)}</t></is></c></row>`); r++; }
  r++;
  const headRow = r;
  out.push(`<row r="${r}">${columns.map((c, i) => `<c r="${colName(i)}${r}" t="inlineStr" s="7"><is><t>${xml(c.label)}</t></is></c>`).join('')}</row>`); r++;
  for (const row of rows) { out.push(`<row r="${r}">${row.map((v, i) => cell(v, columns[i].type, r, i)).join('')}</row>`); r++; }
  if (totals) { out.push(`<row r="${r}">${totals.map((v, i) => cell(v, columns[i].type, r, i, true)).join('')}</row>`); r++; }
  const widths = columns.map((c, i) => Math.min(48, Math.max(c.label.length + 2, ...rows.slice(0, 300).map(row => String(row[i] ?? '').length + 2), c.type === 'money' ? 14 : c.type === 'date' ? 12 : 6)));
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${out.join('')}</sheetData>
<autoFilter ref="A${headRow}:${colName(columns.length - 1)}${headRow + rows.length}"/>
</worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.###"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F1"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF7F9DB9"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="10" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const sheetName = xml(table.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${sheetName}'!$A$${headRow}:$${colName(columns.length - 1)}$${headRow + rows.length}</definedName></definedNames></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', sheet],
    ['xl/styles.xml', styles],
  ]);
}

export function toCsv(table) {
  const q = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [table.columns.map(c => q(c.label)).join(',')];
  for (const row of table.rows) lines.push(row.map((v, i) => q(table.columns[i].type === 'date' ? fdate(v) : v)).join(','));
  if (table.totals) lines.push(table.totals.map(q).join(','));
  return new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const fileName = (title, ext) => `${title.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '')}_${today()}.${ext}`;

// ---------------------------------------------------------------- print
/** HTML for a printable report: business header, title, filters and table. */
export function printHtml(table, fmtCell) {
  const b = S().business;
  const head = table.columns.map(c => `<th class="${c.type && c.type !== 'text' && c.type !== 'date' ? 'num' : ''}">${esc(c.label)}</th>`).join('');
  const body = table.rows.map(r => `<tr>${r.map((v, i) => `<td class="${table.columns[i].type && table.columns[i].type !== 'text' && table.columns[i].type !== 'date' ? 'num' : ''}">${esc(fmtCell(v, table.columns[i].type))}</td>`).join('')}</tr>`).join('');
  const foot = table.totals ? `<tfoot><tr>${table.totals.map((v, i) => `<td class="${typeof v === 'number' ? 'num' : ''}">${esc(fmtCell(v, table.columns[i].type))}</td>`).join('')}</tr></tfoot>` : '';
  return `<div class="print-doc">
    <div class="print-head"><div><div class="print-biz">${esc(b.name)}</div><div>${esc(b.address)}</div><div>GSTIN ${esc(b.gstin)} · ${esc(b.phone)}</div></div>
    <div class="print-title"><div>${esc(table.title)}</div><div class="print-sub">${esc(table.subtitle || '')}</div><div class="print-sub">Printed ${fdate(today())} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div></div></div>
    ${table.summary ? `<div class="print-summary">${table.summary.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>` : ''}
    <table class="print-table"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${table.columns.length}">No records</td></tr>`}</tbody>${foot}</table>
    <div class="print-foot">${table.rows.length} record(s)</div></div>`;
}

/** Print arbitrary HTML using the hidden #print-root region (print CSS hides the app). */
export function printNow(html) {
  const root = document.getElementById('print-root');
  root.innerHTML = html;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 500); }, 30);
}
