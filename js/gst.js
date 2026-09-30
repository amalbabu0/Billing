// GST helpers: state codes, units (UQC) and a GSTR-1 JSON file in the GST offline-tool structure.
// The file is produced for review / upload by the user; the prototype does not talk to the GST portal.
import * as st from './store.js';
import { round2, inRange, fdate } from './utils.js';

export const STATE_CODES = {
  'Jammu and Kashmir': '01', 'Himachal Pradesh': '02', Punjab: '03', Chandigarh: '04', Uttarakhand: '05', Haryana: '06', Delhi: '07', Rajasthan: '08', 'Uttar Pradesh': '09', Bihar: '10',
  Sikkim: '11', 'Arunachal Pradesh': '12', Nagaland: '13', Manipur: '14', Mizoram: '15', Tripura: '16', Meghalaya: '17', Assam: '18', 'West Bengal': '19', Jharkhand: '20',
  Odisha: '21', Chhattisgarh: '22', 'Madhya Pradesh': '23', Gujarat: '24', Maharashtra: '27', Karnataka: '29', Goa: '30', Lakshadweep: '31', Kerala: '32', 'Tamil Nadu': '33',
  Puducherry: '34', 'Andaman and Nicobar Islands': '35', Telangana: '36', 'Andhra Pradesh': '37', Ladakh: '38',
};
export const stateFromCode = code => Object.keys(STATE_CODES).find(k => STATE_CODES[k] === code);
const UQC = { Nos: 'NOS', Sheet: 'NOS', 'Sq.ft': 'SQF', Pair: 'PRS', Box: 'BOX', Kg: 'KGS', Ltr: 'LTR', Set: 'SET', Cft: 'OTH', Rft: 'OTH' };
const d = iso => { const [y, m, dd] = iso.split('-'); return `${dd}-${m}-${y}`; };
const r2 = round2;

function byRate(t) {
  const m = {};
  for (const l of t.lines) { const x = (m[l.gst] ||= { rt: l.gst, txval: 0, iamt: 0, camt: 0, samt: 0 }); x.txval += l.taxable; x.iamt += l.igst; x.camt += l.cgst; x.samt += l.sgst; }
  return Object.values(m).map((x, i) => ({ num: i + 1, itm_det: { txval: r2(x.txval), rt: x.rt, iamt: r2(x.iamt), camt: r2(x.camt), samt: r2(x.samt), csamt: 0 } }));
}

/** Returns { json, warnings } for one calendar month; throws a ValidationError otherwise. */
export function gstr1Json(from, to) {
  if (!from || !to || from.slice(0, 7) !== to.slice(0, 7)) throw new st.ValidationError('GSTR-1 is filed per month: set Date From and To inside one calendar month.');
  const biz = st.S().business;
  const b2b = {}, b2cl = {}, b2cs = {}, cdnr = {}, hsn = {};
  const warnings = [];
  const addHsn = (t, sign) => t.lines.forEach(l => {
    const it = st.item(l.itemId);
    const k = it.hsn + '|' + l.gst;
    const x = (hsn[k] ||= { hsn_sc: it.hsn, desc: it.category, uqc: UQC[it.unit] || 'OTH', rt: l.gst, qty: 0, val: 0, txval: 0, iamt: 0, camt: 0, samt: 0 });
    x.qty += sign * l.qty; x.val += sign * l.total; x.txval += sign * l.taxable; x.iamt += sign * l.igst; x.camt += sign * l.cgst; x.samt += sign * l.sgst;
  });
  const addB2cs = (p, t, sign) => t.lines.forEach(l => {
    const pos = STATE_CODES[p.state] || STATE_CODES[biz.state];
    const k = pos + '|' + l.gst;
    const x = (b2cs[k] ||= { sply_ty: t.interstate ? 'INTER' : 'INTRA', pos, typ: 'OE', rt: l.gst, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
    x.txval += sign * l.taxable; x.iamt += sign * l.igst; x.camt += sign * l.cgst; x.samt += sign * l.sgst;
  });
  for (const s of st.salesInRange(from, to)) {
    const p = st.party(s.partyId), t = st.totals(s);
    const pos = STATE_CODES[p.state];
    if (!pos) warnings.push(`${s.no}: unknown state "${p.state}"`);
    addHsn(t, 1);
    if (p.gstin) (b2b[p.gstin] ||= []).push({ inum: s.no, idt: d(s.date), val: t.grand, pos, rchrg: 'N', inv_typ: 'R', itms: byRate(t) });
    else if (t.interstate && t.grand > 250000) (b2cl[pos] ||= []).push({ inum: s.no, idt: d(s.date), val: t.grand, itms: byRate(t).map(x => ({ ...x, itm_det: { txval: x.itm_det.txval, rt: x.itm_det.rt, iamt: x.itm_det.iamt, csamt: 0 } })) });
    else addB2cs(p, t, 1);
  }
  for (const r of st.getState().salesReturns.filter(x => inRange(x.date, from, to))) {
    const p = st.party(r.partyId), t = st.totals(r);
    addHsn(t, -1);
    if (p.gstin) (cdnr[p.gstin] ||= []).push({ ntty: 'C', nt_num: r.no, nt_dt: d(r.date), pos: STATE_CODES[p.state], rchrg: 'N', inv_typ: 'R', val: t.total, itms: byRate(t) });
    else addB2cs(p, t, -1);
  }
  const json = {
    gstin: biz.gstin, fp: from.slice(5, 7) + from.slice(0, 4),
    b2b: Object.entries(b2b).map(([ctin, inv]) => ({ ctin, inv })),
    b2cl: Object.entries(b2cl).map(([pos, inv]) => ({ pos, inv })),
    b2cs: Object.values(b2cs).map(x => ({ ...x, txval: r2(x.txval), iamt: r2(x.iamt), camt: r2(x.camt), samt: r2(x.samt) })).filter(x => x.txval !== 0),
    cdnr: Object.entries(cdnr).map(([ctin, nt]) => ({ ctin, nt })),
    hsn: { data: Object.values(hsn).map((x, i) => ({ num: i + 1, hsn_sc: x.hsn_sc, desc: x.desc, uqc: x.uqc, qty: r2(x.qty), rt: x.rt, val: r2(x.val), txval: r2(x.txval), iamt: r2(x.iamt), camt: r2(x.camt), samt: r2(x.samt), csamt: 0 })) },
  };
  for (const k of ['b2b', 'b2cl', 'b2cs', 'cdnr']) if (!json[k].length) delete json[k];
  return { json, warnings, label: `${fdate(from)}–${fdate(to)}` };
}
