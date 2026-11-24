// Text lists and read-only share links.
// A share link carries a compressed snapshot in the URL #fragment, which
// browsers never send to the server: GitHub never sees the list.
import { CONFIG } from './config.js';
import { formatPence } from './money.js';
import { conditionLabel, cheapest, logTotal } from './prices.js';

const titleYear = (x) => (x.year ? `${x.title} (${x.year})` : x.title);
const extras = (x) => [x.packaging && x.packaging !== 'Standard' ? x.packaging : '', x.edition].filter(Boolean).join(', ');

export function collectionText(items) {
  const out = [`My disc collection (${items.length})`];
  for (const format of [...CONFIG.formats, '']) {
    const group = items.filter((i) => (format ? i.format === format : !CONFIG.formats.includes(i.format)))
      .sort((a, b) => a.title.localeCompare(b.title, CONFIG.locale));
    if (!group.length) continue;
    out.push('', `${format || 'Other'} (${group.length})`);
    for (const i of group) out.push(`- ${titleYear(i)}${extras(i) ? ` [${extras(i)}]` : ''}`);
  }
  return out.join('\n');
}

export function wantsText(wants, logs) {
  const active = wants.filter((w) => w.status !== 'bought').sort((a, b) => a.title.localeCompare(b.title, CONFIG.locale));
  const out = [`My want list (${active.length})`, ''];
  for (const w of active) {
    const c = cheapest(w, logs);
    const bits = [w.format, extras(w), `${conditionLabel(w.wantedCondition)} or better`];
    if (w.targetPrice != null) bits.push(`target ${formatPence(w.targetPrice)}`);
    if (c) bits.push(`best seen ${formatPence(logTotal(c))} at ${c.retailer}`);
    out.push(`- ${titleYear(w)}: ${bits.filter(Boolean).join(', ')}`);
  }
  return out.join('\n');
}

// ---------- share links ----------
const toB64Url = (bytes) => {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64Url = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function pipeBytes(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

const canCompress = () => typeof CompressionStream !== 'undefined';

export function snapshotFrom(kind, rows) {
  const pick = kind === 'wants'
    ? (w) => [w.title, w.year ?? null, w.format || '', w.packaging || '', w.edition || '', w.wantedCondition || '', w.targetPrice ?? null]
    : (i) => [i.title, i.year ?? null, i.format || '', i.packaging || '', i.edition || ''];
  return { v: 1, kind, at: new Date().toISOString().slice(0, 10), rows: rows.map(pick) };
}

/** 'z' prefix = deflate-raw + base64url; 'j' = plain JSON base64url (no CompressionStream). */
export async function encodeSnapshot(snapshot) {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  if (canCompress()) {
    try { return `z${toB64Url(await pipeBytes(bytes, new CompressionStream('deflate-raw')))}`; } catch { /* fall back */ }
  }
  return `j${toB64Url(bytes)}`;
}

export async function decodeSnapshot(payload) {
  const kind = payload[0];
  let bytes = fromB64Url(payload.slice(1));
  if (kind === 'z') bytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
  else if (kind !== 'j') throw new Error('Unknown link format');
  const snap = JSON.parse(new TextDecoder().decode(bytes));
  if (snap.v !== 1 || !Array.isArray(snap.rows)) throw new Error('Unsupported snapshot');
  return snap;
}

export function shareUrl(payload) {
  return `${location.origin}${location.pathname}#/shared/${payload}`;
}
