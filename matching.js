// TMDB auto-matching for collection entries (pasted titles).
// Rules, in order:
//   - with a year: candidates within ±1 year; one exact title -> match;
//     else exactly one candidate in that window -> match; several -> ask.
//   - no year: one exact title -> match (a film beats a TV series of the same
//     name); several exact titles (remakes) -> ask; none -> ask with top results.
//   - nothing returned -> not found.
// "Ask" keeps up to 5 candidates on the entry so you can pick without searching again.
import { normTitle } from './collections.js';

const MAX_CANDIDATES = 5;
const slim = (c) => ({ tmdbId: c.tmdbId, mediaType: c.mediaType, title: c.title, year: c.year ?? null, posterPath: c.posterPath ?? null });

export function chooseMatch(entry, candidates) {
  const cands = (candidates || []).filter((c) => c.mediaType === 'movie' || c.mediaType === 'tv');
  if (!cands.length) return { state: 'notfound' };
  const want = normTitle(entry.title);
  const exact = (list) => list.filter((c) => normTitle(c.title) === want);
  const preferFilm = (list) => {
    const films = list.filter((c) => c.mediaType === 'movie');
    return films.length === 1 ? films : list;
  };
  const ask = (list) => ({ state: 'ambiguous', candidates: list.slice(0, MAX_CANDIDATES).map(slim) });

  if (entry.year) {
    const near = cands.filter((c) => c.year && Math.abs(c.year - entry.year) <= 1);
    const ex = preferFilm(exact(near));
    if (ex.length === 1) return { state: 'matched', match: slim(ex[0]) };
    if (ex.length > 1) {
      const sameYear = ex.filter((c) => c.year === entry.year);
      return sameYear.length === 1 ? { state: 'matched', match: slim(sameYear[0]) } : ask(ex);
    }
    if (near.length === 1) return { state: 'matched', match: slim(near[0]) };
    return ask(near.length ? near : cands);
  }
  const ex = preferFilm(exact(cands));
  if (ex.length === 1) return { state: 'matched', match: slim(ex[0]) };
  return ask(ex.length ? ex : cands);
}

/** Entries that still need matching (no TMDB id, not already resolved or skipped). */
export const needsMatch = (e) => !e.tmdbId && !e.matchState;

/**
 * Search TMDB for each entry, a few at a time.
 * search(title) -> { status, results }. Stops at the first non-'ok' status
 * (no key, offline, error) and reports it. Returns { results: Map(id -> outcome), stopped }.
 */
export async function matchEntries(entries, search, { concurrency = 4, onProgress } = {}) {
  const todo = entries.filter(needsMatch);
  const results = new Map();
  let done = 0;
  let stopped = null;
  let next = 0;
  async function worker() {
    while (!stopped && next < todo.length) {
      const entry = todo[next];
      next += 1;
      const r = await search(entry.title);
      if (r.status !== 'ok') { stopped = stopped || r; return; }
      results.set(entry.id, chooseMatch(entry, r.results));
      done += 1;
      onProgress?.(done, todo.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  return { results, stopped, total: todo.length };
}

/** Apply outcomes to a collection (by entry id). Pure: returns a new collection. */
export function applyMatches(collection, results, now = new Date().toISOString()) {
  if (!results.size) return collection;
  const entries = collection.entries.map((e) => {
    const r = results.get(e.id);
    if (!r) return e;
    if (r.state === 'matched') return pick(e, r.match);
    const { candidates, ...rest } = e;
    return r.state === 'ambiguous' ? { ...rest, matchState: 'ambiguous', candidates: r.candidates } : { ...rest, matchState: 'notfound' };
  });
  return { ...collection, entries, updatedAt: now };
}

/** Set an entry's TMDB match (from auto-match or the user's choice). Keeps the user's own title. */
export function pick(entry, match) {
  const { candidates, ...rest } = entry;
  return {
    ...rest,
    tmdbId: match.tmdbId,
    mediaType: match.mediaType || 'movie',
    posterPath: match.posterPath ?? rest.posterPath ?? null,
    year: rest.year ?? match.year ?? null,
    tmdbTitle: match.title,
    matchState: 'matched',
  };
}

/** Clear a match so the entry is title-only again ("Not on TMDB" or to re-match). */
export function unmatch(entry, state = null) {
  const { candidates, tmdbId, mediaType, tmdbTitle, ...rest } = entry;
  return { ...rest, tmdbId: null, mediaType: null, posterPath: null, matchState: state };
}

export function matchSummary(collection) {
  const s = { matched: 0, ambiguous: 0, notfound: 0, skipped: 0, pending: 0 };
  for (const e of collection.entries) {
    if (e.tmdbId) s.matched += 1;
    else if (e.matchState === 'ambiguous') s.ambiguous += 1;
    else if (e.matchState === 'notfound') s.notfound += 1;
    else if (e.matchState === 'skipped') s.skipped += 1;
    else s.pending += 1;
  }
  return s;
}
