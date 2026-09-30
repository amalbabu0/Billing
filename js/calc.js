// ERP calculator: + − × ÷, percentage, decimals, memory of the last result, keyboard input.
import { h, fill } from './utils.js';
import { modal } from './ui.js';

/** Evaluate a simple infix expression with correct precedence; no eval(). */
export function evaluate(expr) {
  const tokens = expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').match(/\d*\.?\d+|[+\-*/%()]/g) || [];
  let i = 0;
  const peek = () => tokens[i];
  const primary = () => {
    let t = tokens[i++];
    if (t === '-') return -primary();
    if (t === '+') return primary();
    if (t === '(') { const v = sumExpr(); if (tokens[i] === ')') i++; return v; }
    const v = parseFloat(t);
    if (Number.isNaN(v)) throw new Error('Invalid expression');
    return v;
  };
  const term = () => {
    let v = primary();
    while (peek() === '*' || peek() === '/') {
      const op = tokens[i++]; const r = primary();
      if (op === '/' && r === 0) throw new Error('Cannot divide by zero');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const sumExpr = () => {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = tokens[i++];
      let r = term();
      // "a + b%" means a plus b percent of a.
      if (tokens[i] === '%') { i++; r = v * r / 100; }
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  // Standalone "b%" or "a × b%" -> b/100
  const norm = [];
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k] === '%') {
      const prevOp = norm[norm.length - 2];
      if (prevOp === '+' || prevOp === '-') { norm.push('%'); continue; }
      norm[norm.length - 1] = String(parseFloat(norm[norm.length - 1]) / 100);
      continue;
    }
    norm.push(tokens[k]);
  }
  tokens.splice(0, tokens.length, ...norm);
  if (!tokens.length) return 0;
  const v = sumExpr();
  if (i < tokens.length) throw new Error('Invalid expression');
  return Math.round(v * 1e10) / 1e10;
}

let open = null;
export function openCalculator() {
  if (open) { open.el.querySelector('.calc-display').focus(); return; }
  let expr = '', last = null, error = '';
  const display = h('div', { class: 'calc-display', tabindex: '0', 'aria-live': 'polite', autofocus: true });
  const render = () => {
    fill(display, h('div', { class: 'calc-expr' }, expr || (last != null ? 'Ans' : '')), h('div', { class: 'calc-result' + (error ? ' err' : '') }, error || (expr ? preview() : last != null ? fmtN(last) : '0')));
  };
  const fmtN = n => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 8 }).format(n);
  const preview = () => { try { return fmtN(evaluate(expr)); } catch { return '…'; } };
  const press = k => {
    error = '';
    if (k === 'C') { expr = ''; last = null; }
    else if (k === '⌫') expr = expr.slice(0, -1);
    else if (k === '=') { try { last = evaluate(expr || '0'); expr = ''; } catch (e) { error = e.message; } }
    else if (k === '±') expr = /\(-\d*\.?\d+$/.test(expr) ? expr.replace(/\(-(\d*\.?\d+)$/, '$1') : expr.replace(/(\d*\.?\d+)$/, '(-$1');
    else if ('+−×÷'.includes(k)) { if (!expr && last != null) expr = String(last); expr = expr.replace(/[+−×÷]$/, '') + k; }
    else if (k === '.') { const cur = expr.split(/[+−×÷(]/).pop(); if (!cur.includes('.')) expr += cur ? '.' : '0.'; }
    else if (k === '%') { if (/\d$/.test(expr)) expr += '%'; }
    else expr += k;
    render();
  };
  const keys = ['C', '⌫', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '±', '0', '.', '='];
  const pad = h('div', { class: 'calc-pad' }, keys.map(k => h('button', { class: 'calc-key' + ('+−×÷='.includes(k) ? ' op' : '') + (k === '=' ? ' eq' : '') + (k === 'C' ? ' clr' : ''), onclick: () => { press(k); display.focus(); } }, k)));
  const copy = h('button', { class: 'btn btn-sm', onclick: () => { const v = expr ? preview() : last; navigator.clipboard?.writeText(String(v).replace(/,/g, '')); } }, 'Copy result');
  const onKey = e => {
    const map = { '*': '×', '/': '÷', '-': '−', '+': '+', Enter: '=', '=': '=', Backspace: '⌫', Delete: 'C', '%': '%', '.': '.', ',': '.' };
    if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (map[e.key]) { e.preventDefault(); e.stopPropagation(); press(map[e.key]); }
  };
  const body = h('div', { class: 'calc' }, display, pad, h('div', { class: 'calc-foot muted small' }, 'Keyboard: digits, + − * /, %, Enter, Backspace, Delete', copy));
  open = modal({ title: 'Calculator', width: 320, body, onClose: () => { open = null; } });
  open.el.addEventListener('keydown', e => { if (e.target.closest('.modal-head') && e.key === 'Enter') return; onKey(e); });
  display.focus();
  render();
  setTimeout(() => display.focus(), 30);
}
