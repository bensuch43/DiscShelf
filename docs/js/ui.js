// Shared UI helpers. User data is only ever written with textContent/value
// (never innerHTML) so stored titles can't inject markup.
import { CONFIG } from './config.js';
import { posterUrl } from './lookup.js';

export const view = () => document.getElementById('view');
export const clone = (id) => document.getElementById(id).content.cloneNode(true);
export const nowIso = () => new Date().toISOString();
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
export const titleYear = (x) => (x.year ? `${x.title} (${x.year})` : x.title);
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function fillSelect(select, values, { blank } = {}) {
  if (blank !== undefined) select.append(new Option(blank, ''));
  for (const v of values) {
    const [value, label] = typeof v === 'string' ? [v, v] : [v.id, v.label ?? v.name];
    select.append(new Option(label, value));
  }
}

export function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) if (c != null) node.append(c);
  return node;
}

let toastTimer;
export function toast(message) {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

export function setActiveTab(name) {
  document.querySelectorAll('.tabbar a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.tab === name));
}

export function showBanner(id, text, actionLabel, onAction) {
  if (document.getElementById(id)) return;
  const div = el('div', { className: 'banner', id }, el('span', { textContent: text }));
  if (actionLabel) {
    const btn = el('button', { type: 'button', textContent: actionLabel });
    btn.addEventListener('click', onAction);
    div.append(btn);
  }
  document.getElementById('banners').append(div);
}
export const hideBanner = (id) => document.getElementById(id)?.remove();

/** Small poster thumbnail, or an empty placeholder box. Never blocks layout. */
export function poster(path, size) {
  const src = posterUrl(path, size);
  if (!src) return el('span', { className: 'poster placeholder', ariaHidden: 'true' });
  const img = el('img', { className: 'poster', src, alt: '', loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(el('span', { className: 'poster placeholder', ariaHidden: 'true' })));
  return img;
}

export function downloadFile(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Share text via the share sheet; fall back to the clipboard. Returns 'shared'|'copied'|'cancelled'|'failed'. */
export async function shareOrCopy(text, title) {
  if (navigator.share) {
    try { await navigator.share({ text, title }); return 'shared'; } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
    }
  }
  try { await navigator.clipboard.writeText(text); return 'copied'; } catch { return 'failed'; }
}

export function retailerLink(retailer, query) {
  return retailer.url.replace('{q}', encodeURIComponent(query));
}

export const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
export const fileStamp = (base, ext) => `${base}-${stamp()}.${ext}`;

export const formatDate = (iso) => (iso
  ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString(CONFIG.locale, { day: 'numeric', month: 'short', year: 'numeric' })
  : '');

// One-shot hand-over of starting values to the next form (e.g. "I own it" on a
// collection entry opens Add disc pre-filled, then returns to the collection).
let prefill = null;
export const setPrefill = (p) => { prefill = p; };
export const takePrefill = () => { const p = prefill; prefill = null; return p; };
