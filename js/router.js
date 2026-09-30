// Navigation helpers shared by the shell and pages (kept separate to avoid import cycles).
let hooks = {};
/** Register page-level shortcuts: { save, print } used by Ctrl+S / Ctrl+P. */
export function setHooks(h) { hooks = h || {}; }
export const getHooks = () => hooks;
export const navigate = path => { location.hash = '#' + path; };
export const currentPath = () => (location.hash.slice(1) || '/').split('?')[0];
export const query = () => new URLSearchParams(location.hash.split('?')[1] || '');
let mounted = [];
/** Run once the current page is in the DOM (e.g. open a dialog requested by the URL). */
export const onMounted = fn => { mounted.push(fn); };
export const flushMounted = () => { const q = mounted; mounted = []; q.forEach(fn => fn()); };
export const clearMounted = () => { mounted = []; };
