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
let toastUndo = null;
/** Short message above the tab bar. Pass { action, onAction } for an Undo-style button. */
export function toast(message, { action, onAction, ms = 3500 } = {}) {
  const t = document.getElementById('toast');
  t.replaceChildren(el('span', { textContent: message }));
  toastUndo = onAction || null;
  if (action && onAction) {
    const b = el('button', { type: 'button', textContent: action });
    b.addEventListener('click', async () => {
      const fn = toastUndo;
      toastUndo = null;
      t.hidden = true;
      clearTimeout(toastTimer);
      await fn?.();
    });
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; toastUndo = null; }, ms);
}

/** Do a destructive change now and offer Undo for 7 seconds (PokéBinder pattern). */
export function undoable(message, undo) {
  toast(message, { action: 'Undo', onAction: undo, ms: 7000 });
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

// ---------- icons, rings, tiles ----------
const SVG = 'http://www.w3.org/2000/svg';
export function icon(name, cls = 'i') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

/** Progress ring: owned / total. Sets the CSS custom property via CSSOM (CSP-safe). */
export function setRing(ring, owned, total) {
  const pct = total ? Math.round((owned / total) * 100) : 0;
  ring.style.setProperty('--p', String(pct));
  ring.dataset.label = `${pct}%`;
  ring.setAttribute('aria-label', `${owned} of ${total} owned (${pct}%)`);
  ring.classList.toggle('done', total > 0 && owned === total);
}

/**
 * Poster tile. state: 'owned' | 'wanted' | 'missing' | null (plain).
 * Renders a <a> when href is given, otherwise a <button>.
 */
export function tile({ title, year, posterPath, state = null, flag, href, onClick, sub }) {
  const label = year ? `${title} (${year})` : title;
  const node = href ? el('a', { className: `tile${state ? ` ${state}` : ''}`, href }) : el('button', { type: 'button', className: `tile${state ? ` ${state}` : ''}` });
  if (onClick) node.addEventListener('click', onClick);
  const src = posterUrl(posterPath, CONFIG.tmdb.posterSize);
  if (src) {
    const img = el('img', { src, alt: '', loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer' });
    img.addEventListener('error', () => img.replaceWith(el('span', { className: 'noimg', textContent: label })));
    node.append(img);
  } else node.append(el('span', { className: 'noimg', textContent: label }));
  if (state) node.append(el('span', { className: 'tick' }, icon('check')));
  if (flag) node.append(el('span', { className: `flag${flag.warn ? ' warn' : ''}`, textContent: flag.text }));
  node.append(el('span', { className: 'cap' }, label, sub ? el('small', { textContent: sub }) : null));
  node.setAttribute('aria-label', [label, state === 'owned' ? 'owned' : state === 'wanted' ? 'on want list' : state === 'missing' ? 'missing' : '', sub].filter(Boolean).join(', '));
  return node;
}

/** Segmented List/Grid switch; remembers the choice per screen on this device. */
export function wireViewToggle(root, key, fallback, onChange) {
  let mode = fallback;
  try { mode = localStorage.getItem(`discshelf.view.${key}`) || fallback; } catch { /* storage unavailable */ }
  const buttons = [...root.querySelectorAll('.seg [data-view]')];
  const apply = (m) => {
    mode = m;
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === m)));
    try { localStorage.setItem(`discshelf.view.${key}`, m); } catch { /* ignore */ }
    onChange(m);
  };
  buttons.forEach((b) => b.addEventListener('click', () => apply(b.dataset.view)));
  apply(mode);
  return () => mode;
}

// ---------- theme ----------
export function getTheme() {
  try { return localStorage.getItem('discshelf.theme') || 'auto'; } catch { return 'auto'; }
}
export function applyTheme(theme = getTheme()) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0c0f' : '#f6f6f4');
}
export function setTheme(theme) {
  try { localStorage.setItem('discshelf.theme', theme); } catch { /* ignore */ }
  applyTheme(theme);
}
