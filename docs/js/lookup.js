// External lookups: UPCitemdb (barcode -> product name) and TMDB (title -> film/TV).
// Both are optional: every failure returns a status the UI explains, and the
// user can always type details by hand.
import { CONFIG } from './config.js';
import * as db from './db.js';

const todayKey = () => new Date().toISOString().slice(0, 10);

// ---------- title helpers ----------
const NOISE = [
  /\[[^\]]*\]/g, // [Blu-ray] [2013] [Region Free]
  /\((?:[^)]*\b(?:blu-?ray|dvd|uhd|4k|disc|region|steel ?book|edition|digital|import|uk)\b[^)]*)\)/gi,
  /\b4k\s*ultra\s*hd\b/gi, /\bultra\s*hd\b/gi, /\buhd\b/gi, /\b4k\b/gi,
  /\bblu-?ray(\s*3d)?(\s*disc)?\b/gi, /\bdvd\b/gi, /\bsteel ?book\b/gi,
  /\b(limited|collector'?s|special|exclusive)\s+edition\b/gi, /\bregion\s*(free|[abc12])\b/gi,
  /\+\s*digital(\s*(copy|download|code))?/gi,
];

/** "Man Of Steel (blu-ray Disc)" -> "Man Of Steel" */
export function cleanTitle(raw) {
  let s = String(raw || '');
  for (const re of NOISE) s = s.replace(re, ' ');
  return s.replace(/\s*[-–:|+/]\s*$/g, '').replace(/^\s*[-–:|+/]\s*/g, '').replace(/\s{2,}/g, ' ').trim();
}

/** Guess format/packaging from a retail product title. Returns only what it can tell. */
export function guessEdition(raw) {
  const t = String(raw || '').toLowerCase();
  const guess = {};
  if (/\b4k\b|\buhd\b|ultra\s*hd/.test(t)) guess.format = '4K UHD';
  else if (/blu-?ray/.test(t) && /\b3d\b/.test(t)) guess.format = 'Blu-ray 3D';
  else if (/blu-?ray/.test(t)) guess.format = 'Blu-ray';
  else if (/\bdvd\b/.test(t)) guess.format = 'DVD';
  if (/steel ?book/.test(t)) guess.packaging = 'Steelbook';
  else if (/digibook/.test(t)) guess.packaging = 'Digibook';
  else if (/mediabook/.test(t)) guess.packaging = 'Mediabook';
  else if (/box ?set|complete (series|collection|seasons?)|trilogy|\d+[- ]film collection/.test(t)) guess.packaging = 'Boxset';
  const year = t.match(/\b(19[0-9]{2}|20[0-9]{2})\b/);
  if (year) guess.year = Number(year[1]);
  return guess;
}

// ---------- UPCitemdb ----------
export async function upcUsageToday() {
  const u = await db.getMeta('upc.usage');
  return u && u.date === todayKey() ? u.count : 0;
}

async function bumpUsage() {
  const count = (await upcUsageToday()) + 1;
  await db.setMeta('upc.usage', { date: todayKey(), count });
  return count;
}

/**
 * Returns { status, items, cached } where status is
 * 'found' | 'notfound' | 'limit' | 'offline' | 'error'.
 * Found and not-found answers are cached by barcode so each is asked once.
 */
export async function upcLookup(ean, { fetchImpl = fetch } = {}) {
  const key = `${CONFIG.cacheMetaPrefix}upc.${ean}`;
  const cached = await db.getMeta(key);
  if (cached) return { ...cached, cached: true };
  if (!navigator.onLine) return { status: 'offline', items: [] };
  if ((await upcUsageToday()) >= CONFIG.upcitemdb.dailyLimit) return { status: 'limit', items: [] };

  let res;
  try {
    await bumpUsage();
    res = await fetchImpl(CONFIG.upcitemdb.lookupUrl + encodeURIComponent(ean), { headers: { Accept: 'application/json' } });
  } catch (err) {
    return { status: 'error', items: [], message: `Couldn't reach UPCitemdb (${err.message}). It may block browser requests; see Settings > Test connections.` };
  }
  if (res.status === 429) return { status: 'limit', items: [], message: 'UPCitemdb rate limit reached (6 a minute, 100 a day on the free plan).' };
  if (res.status === 400 || res.status === 404) {
    const result = { status: 'notfound', items: [] };
    await db.setMeta(key, result);
    return result;
  }
  if (!res.ok) return { status: 'error', items: [], message: `UPCitemdb returned HTTP ${res.status}.` };
  const body = await res.json().catch(() => ({}));
  const items = (body.items || []).map((i) => ({ title: i.title || '', brand: i.brand || '', ean: i.ean || ean }));
  const result = { status: items.length ? 'found' : 'notfound', items };
  await db.setMeta(key, result);
  return result;
}

// ---------- TMDB ----------
export const getTmdbKey = () => db.getMeta(`${CONFIG.secretMetaPrefix}tmdbKey`);
export const setTmdbKey = (v) => db.setMeta(`${CONFIG.secretMetaPrefix}tmdbKey`, v || '');

function tmdbRequest(path, params, key) {
  const url = new URL(CONFIG.tmdb.apiBase + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { Accept: 'application/json' };
  // v4 "API Read Access Token" (a JWT, starts eyJ) goes in a Bearer header; v3 key goes in the query.
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set('api_key', key);
  return { url: url.toString(), headers };
}

export const posterUrl = (path, size = CONFIG.tmdb.thumbSize) => (path ? `${CONFIG.tmdb.imageBase}${size}${path}` : null);

/** Returns { status: 'ok'|'nokey'|'offline'|'error', results: [{tmdbId, mediaType, title, year, posterPath}] } */
export async function tmdbSearch(query, { fetchImpl = fetch } = {}) {
  const key = (await getTmdbKey())?.trim();
  if (!key) return { status: 'nokey', results: [] };
  if (!navigator.onLine) return { status: 'offline', results: [] };
  const { url, headers } = tmdbRequest('/search/multi', {
    query, include_adult: 'false', language: CONFIG.tmdb.language, region: CONFIG.tmdb.region,
  }, key);
  let res;
  try { res = await fetchImpl(url, { headers }); } catch (err) {
    return { status: 'error', results: [], message: `Couldn't reach TMDB (${err.message}).` };
  }
  if (res.status === 401) return { status: 'error', results: [], message: 'TMDB rejected the key. Check it in Settings.' };
  if (!res.ok) return { status: 'error', results: [], message: `TMDB returned HTTP ${res.status}.` };
  const body = await res.json();
  const results = (body.results || [])
    .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
    .slice(0, 8)
    .map((r) => {
      const date = r.release_date || r.first_air_date || '';
      return {
        tmdbId: r.id,
        mediaType: r.media_type,
        title: r.title || r.name || '',
        year: date ? Number(date.slice(0, 4)) : null,
        posterPath: r.poster_path || null,
      };
    });
  return { status: 'ok', results };
}

/** Settings > Test connections. Uses a real call to each service; costs one UPCitemdb lookup. */
export async function testConnections({ fetchImpl = fetch } = {}) {
  const out = [];
  try {
    const r = await fetchImpl(`${CONFIG.upcitemdb.lookupUrl}${CONFIG.retailerTestSample.ean}`);
    await bumpUsage();
    out.push({ name: 'UPCitemdb', ok: r.ok, detail: r.ok ? 'Reachable from this browser.' : `HTTP ${r.status}` });
  } catch (err) {
    out.push({ name: 'UPCitemdb', ok: false, detail: `Blocked or unreachable (${err.message}). Barcode lookups won't work; scanning still fills the barcode.` });
  }
  const key = (await getTmdbKey())?.trim();
  if (!key) out.push({ name: 'TMDB', ok: false, detail: 'No API key saved.' });
  else {
    try {
      const { url, headers } = tmdbRequest('/configuration', {}, key);
      const r = await fetchImpl(url, { headers });
      out.push({ name: 'TMDB', ok: r.ok, detail: r.ok ? 'Key accepted.' : r.status === 401 ? 'Key rejected (401).' : `HTTP ${r.status}` });
    } catch (err) {
      out.push({ name: 'TMDB', ok: false, detail: `Blocked or unreachable (${err.message}).` });
    }
  }
  return out;
}
