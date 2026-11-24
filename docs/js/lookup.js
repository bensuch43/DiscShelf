// External lookups: TMDB (title -> film/TV, franchises, public lists).
// Optional: every failure returns a status the UI explains, and the user can
// always type details by hand. (UPCitemdb barcode lookup was removed in 0.5.0:
// it blocks browser requests.)
import { CONFIG } from './config.js';
import * as db from './db.js';

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

const toResult = (r, fallbackType = 'movie') => {
  const date = r.release_date || r.first_air_date || '';
  return {
    tmdbId: r.id,
    mediaType: r.media_type || fallbackType,
    title: r.title || r.name || '',
    year: date ? Number(date.slice(0, 4)) : null,
    posterPath: r.poster_path || null,
  };
};

/** GET a TMDB v3 path. Returns { status: 'ok'|'nokey'|'offline'|'error', body, message }. */
async function tmdbGet(path, params, fetchImpl) {
  const key = (await getTmdbKey())?.trim();
  if (!key) return { status: 'nokey' };
  if (!navigator.onLine) return { status: 'offline' };
  const { url, headers } = tmdbRequest(path, params, key);
  let res;
  try { res = await fetchImpl(url, { headers }); } catch (err) {
    return { status: 'error', message: `Couldn't reach TMDB (${err.message}).` };
  }
  if (res.status === 401) return { status: 'error', message: 'TMDB rejected the key. Check it in Settings.' };
  if (res.status === 404) return { status: 'error', message: 'TMDB couldn\'t find that. Check the link or ID.' };
  if (!res.ok) return { status: 'error', message: `TMDB returned HTTP ${res.status}.` };
  return { status: 'ok', body: await res.json() };
}

/** Returns { status, results: [{tmdbId, mediaType, title, year, posterPath}], message } */
export async function tmdbSearch(query, { fetchImpl = fetch } = {}) {
  const r = await tmdbGet('/search/multi', {
    query, include_adult: 'false', language: CONFIG.tmdb.language, region: CONFIG.tmdb.region,
  }, fetchImpl);
  if (r.status !== 'ok') return { ...r, results: [] };
  const results = (r.body.results || [])
    .filter((x) => x.media_type === 'movie' || x.media_type === 'tv')
    .slice(0, 8)
    .map((x) => toResult(x));
  return { status: 'ok', results };
}

/** Franchise search (TMDB "collections", e.g. "Toy Story Collection"). */
export async function tmdbSearchFranchise(query, { fetchImpl = fetch } = {}) {
  const r = await tmdbGet('/search/collection', { query, language: CONFIG.tmdb.language }, fetchImpl);
  if (r.status !== 'ok') return { ...r, results: [] };
  return { status: 'ok', results: (r.body.results || []).slice(0, 8).map((x) => ({ id: x.id, name: x.name, posterPath: x.poster_path || null })) };
}

/** Films in a TMDB franchise, oldest first. */
export async function tmdbFranchiseParts(id, { fetchImpl = fetch } = {}) {
  const r = await tmdbGet(`/collection/${encodeURIComponent(id)}`, { language: CONFIG.tmdb.language }, fetchImpl);
  if (r.status !== 'ok') return { ...r, results: [] };
  const results = (r.body.parts || []).map((x) => toResult(x, 'movie'))
    .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
  return { status: 'ok', name: r.body.name || '', results };
}

/** "https://www.themoviedb.org/list/8136-disney-classics" or "8136" -> "8136" */
export function parseTmdbListId(input) {
  const s = String(input || '').trim();
  const m = s.match(/themoviedb\.org\/(?:[a-z-]+\/)?list\/(\d+)/i) || s.match(/^(\d+)$/);
  return m ? m[1] : null;
}

/** Items in a public TMDB list, in list order. Follows pages (capped). */
export async function tmdbListItems(listId, { fetchImpl = fetch, maxPages = 20 } = {}) {
  const results = [];
  let name = '';
  for (let page = 1; page <= maxPages; page += 1) {
    const r = await tmdbGet(`/list/${encodeURIComponent(listId)}`, { language: CONFIG.tmdb.language, page: String(page) }, fetchImpl);
    if (r.status !== 'ok') return { ...r, results: [] };
    name = name || r.body.name || '';
    for (const x of r.body.items || []) if (x.media_type !== 'person') results.push(toResult(x));
    const totalPages = r.body.total_pages || 1;
    if (page >= totalPages) break;
  }
  return { status: 'ok', name, results };
}

/** Settings > Test connections. */
export async function testConnections({ fetchImpl = fetch } = {}) {
  const key = (await getTmdbKey())?.trim();
  if (!key) return [{ name: 'TMDB', ok: false, detail: 'No API key saved.' }];
  try {
    const { url, headers } = tmdbRequest('/configuration', {}, key);
    const r = await fetchImpl(url, { headers });
    return [{ name: 'TMDB', ok: r.ok, detail: r.ok ? 'Key accepted.' : r.status === 401 ? 'Key rejected (401).' : `HTTP ${r.status}` }];
  } catch (err) {
    return [{ name: 'TMDB', ok: false, detail: `Blocked or unreachable (${err.message}).` }];
  }
}
