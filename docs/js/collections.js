// Collections: named checklists of films/series (e.g. "Disney Classics").
// An entry is a title, not a disc. A disc in your library "counts" for an
// entry when it matches it, so one disc can tick off entries in many
// collections, and an entry can be ticked by several discs (DVD + 4K).
//
// Matching: both have a TMDB id -> ids must be equal. Otherwise normalised
// title must be equal, and years must be equal when both are known.
import { CONFIG } from './config.js';

const id = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export function normTitle(title) {
  return String(title || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/^\s*(the|a|an)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matches(entry, record) {
  if (!entry || !record) return false;
  if (entry.tmdbId && record.tmdbId) return entry.tmdbId === record.tmdbId && (entry.mediaType || 'movie') === (record.mediaType || 'movie');
  if (normTitle(entry.title) !== normTitle(record.title)) return false;
  return !entry.year || !record.year || entry.year === record.year;
}

export function entryFrom(record) {
  return {
    id: id(),
    title: record.title,
    year: record.year ?? null,
    tmdbId: record.tmdbId ?? null,
    mediaType: record.tmdbId ? (record.mediaType || 'movie') : null,
    posterPath: record.posterPath ?? null,
  };
}

/** Distinct formats owned, in config order (DVD, Blu-ray, 4K UHD…). */
export function ownedFormats(owned) {
  const order = (f) => { const i = CONFIG.formats.indexOf(f); return i < 0 ? 99 : i; };
  return [...new Set(owned.map((i) => i.format).filter(Boolean))].sort((a, b) => order(a) - order(b));
}

export function entryStatus(entry, items, wants) {
  const owned = items.filter((i) => matches(entry, i));
  const wanted = wants.filter((w) => w.status !== 'bought' && matches(entry, w));
  return { status: owned.length ? 'owned' : wanted.length ? 'wanted' : 'missing', owned, wanted };
}

export function progress(collection, items, wants) {
  const counts = { total: collection.entries.length, owned: 0, wanted: 0, missing: 0 };
  for (const e of collection.entries) counts[entryStatus(e, items, wants).status] += 1;
  return counts;
}

/**
 * Parse pasted lines like "1. Snow White and the Seven Dwarfs (1937)",
 * "- Pinocchio, 1940", "Fantasia 2000". Returns [{ title, year }], de-duplicated.
 */
export function parseTitleList(text) {
  const out = [];
  for (let line of String(text || '').split(/\r?\n/)) {
    line = line.replace(/^\s*(?:[-*•]|\d+[.)]|#\d+)\s*/, '').trim();
    if (!line) continue;
    let year = null;
    // A year counts only in brackets, or after a dash/comma: "Fantasia 2000" is a title.
    const m = line.match(/^(.*?)\s*(?:[([]\s*((?:18|19|20)\d{2})\s*[)\]]|[,–-]\s*((?:18|19|20)\d{2}))$/);
    if (m && m[1].trim()) { line = m[1].trim(); year = Number(m[2] || m[3]); }
    const rec = { title: line.replace(/[\s,–-]+$/, ''), year };
    if (!out.some((o) => matches(o, rec) && o.year === rec.year)) out.push(rec);
  }
  return out;
}

/** Add records as entries, skipping ones already in the collection. Returns a new collection + counts. */
export function addEntries(collection, records, now = new Date().toISOString()) {
  const entries = [...collection.entries];
  let added = 0;
  let skipped = 0;
  for (const r of records) {
    if (entries.some((e) => matches(e, r))) { skipped += 1; continue; }
    entries.push(entryFrom(r));
    added += 1;
  }
  return { collection: { ...collection, entries, updatedAt: now }, added, skipped };
}

export const collectionsContaining = (record, collections) => collections.filter((c) => c.entries.some((e) => matches(e, record)));

/** Tick/untick a disc's title in a collection. Returns a new collection. */
export function setMembership(collection, record, member, now = new Date().toISOString()) {
  const has = collection.entries.some((e) => matches(e, record));
  if (member && !has) return addEntries(collection, [record], now).collection;
  if (!member && has) return { ...collection, entries: collection.entries.filter((e) => !matches(e, record)), updatedAt: now };
  return collection;
}

/** If an entry has no TMDB data and a matching record does, copy it across (better posters/matching). */
export function enrichEntries(collection, records, now = new Date().toISOString()) {
  let changed = false;
  const entries = collection.entries.map((e) => {
    if (e.tmdbId) return e;
    const r = records.find((x) => x.tmdbId && matches(e, x));
    if (!r) return e;
    changed = true;
    return { ...e, tmdbId: r.tmdbId, mediaType: r.mediaType || 'movie', posterPath: e.posterPath || r.posterPath || null, year: e.year ?? r.year ?? null };
  });
  return changed ? { ...collection, entries, updatedAt: now } : collection;
}

export function newCollection(name, description = '', now = new Date().toISOString()) {
  return { id: id(), name: name.trim(), description: description.trim() || null, entries: [], createdAt: now, updatedAt: now };
}

export function sortEntries(entries, sort) {
  const list = [...entries];
  if (sort === 'title') return list.sort((a, b) => normTitle(a.title).localeCompare(normTitle(b.title), CONFIG.locale));
  if (sort === 'year') return list.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || normTitle(a.title).localeCompare(normTitle(b.title)));
  return list; // list order (as added)
}

export function checklistText(collection, items, wants) {
  const p = progress(collection, items, wants);
  const lines = [`${collection.name}: ${p.owned} of ${p.total} owned`, ''];
  for (const e of collection.entries) {
    const s = entryStatus(e, items, wants);
    const mark = s.status === 'owned' ? '✓' : s.status === 'wanted' ? '☆' : '✗';
    const formats = s.owned.length ? ` [${ownedFormats(s.owned).join(', ')}]` : '';
    lines.push(`${mark} ${e.year ? `${e.title} (${e.year})` : e.title}${formats}`);
  }
  lines.push('', '✓ owned  ☆ on want list  ✗ missing');
  return lines.join('\n');
}
