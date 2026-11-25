// Shared "fill from scan / title search" behaviour for the item and want forms.
// The form must contain: [data-action="scan"], [data-action="search-title"],
// [data-panel="lookup"], and inputs title, year, ean.
// Barcode lookup services were removed in 0.5.0 (none allow browser requests),
// so a scan fills the barcode, shows what this device already knows about it,
// and hands over to TMDB title search.
import { openScanner } from './scanner.js';
import { tmdbSearch, cleanTitle } from './lookup.js';
import { validateBarcode } from './ean.js';
import * as db from './db.js';
import { el, poster, titleYear } from './ui.js';

/** Records on this device with this barcode. */
async function localMatches(ean) {
  const [items, wants] = await Promise.all([db.getAll('items'), db.getAll('wants')]);
  return { items: items.filter((i) => i.ean === ean), wants: wants.filter((w) => w.ean === ean && w.status !== 'bought') };
}

/**
 * extra: object that receives tmdbId / posterPath / mediaType for the record being edited.
 * onPosterChange: called after a TMDB pick so the form can show the poster.
 */
export function wireLookup(form, extra, { onPosterChange } = {}) {
  const f = form.elements;
  const panel = form.querySelector('[data-panel="lookup"]');
  const say = (...nodes) => { panel.hidden = false; panel.replaceChildren(...nodes.filter(Boolean)); };

  async function searchTmdb(query, preface = []) {
    const q = cleanTitle(query) || query.trim();
    if (!q) {
      say(...preface, el('p', { className: 'hint', textContent: 'Type the title above, then tap Search title.' }));
      f.title.focus();
      return;
    }
    say(...preface, el('p', { className: 'hint', textContent: `Searching TMDB for "${q}"…` }));
    const r = await tmdbSearch(q);
    const nodes = [...preface];
    if (r.status === 'nokey') {
      nodes.push(el('p', { className: 'hint' }, 'Add a TMDB API key in ', el('a', { href: '#/settings', textContent: 'Settings' }), ' to search titles and get posters.'));
    } else if (r.status === 'offline') {
      nodes.push(el('p', { className: 'hint', textContent: 'You\'re offline. Fill the details by hand.' }));
    } else if (r.status === 'error') {
      nodes.push(el('p', { className: 'error', textContent: r.message }));
    } else if (!r.results.length) {
      nodes.push(el('p', { className: 'hint', textContent: `No TMDB matches for "${q}". Try fewer words.` }));
    } else {
      nodes.push(el('p', { className: 'hint', textContent: 'Pick the film or series:' }));
      const list = el('ul', { className: 'pick-list' });
      for (const res of r.results) {
        const btn = el('button', { type: 'button', className: 'pick' },
          poster(res.posterPath),
          el('span', { textContent: `${titleYear(res)} · ${res.mediaType === 'tv' ? 'TV' : 'Film'}` }));
        btn.addEventListener('click', () => {
          f.title.value = res.title;
          if (res.year) f.year.value = String(res.year);
          Object.assign(extra, { tmdbId: res.tmdbId, posterPath: res.posterPath, mediaType: res.mediaType });
          onPosterChange?.(res.posterPath);
          f.title.dispatchEvent(new Event('input'));
          say(el('p', { className: 'ok', textContent: `Filled from TMDB: ${titleYear(res)}. Check the edition details below.` }));
        });
        list.append(el('li', {}, btn));
      }
      nodes.push(list);
    }
    say(...nodes);
  }

  async function useBarcode(code) {
    const v = validateBarcode(code);
    if (!v.code) return;
    f.ean.value = v.code;
    f.ean.dispatchEvent(new Event('input'));
    const local = await localMatches(v.code);
    const notes = [el('p', {}, 'Barcode ', el('strong', { textContent: v.code }), ' captured.')];
    for (const i of local.items) {
      notes.push(el('p', { className: 'warn-text' }, 'You already own ', el('a', { href: `#/item/${encodeURIComponent(i.id)}`, textContent: titleYear(i) }), ` (${i.format}).`));
    }
    for (const w of local.wants) {
      notes.push(el('p', { className: 'ok' }, 'On your want list: ', el('a', { href: `#/want/${encodeURIComponent(w.id)}`, textContent: titleYear(w) }), '.'));
    }
    // Reuse details from a record with the same barcode (e.g. scanning a want you've just bought).
    const known = local.items[0] || local.wants[0];
    if (known && !f.title.value.trim()) {
      f.title.value = known.title;
      if (known.year) f.year.value = String(known.year);
      for (const k of ['format', 'packaging', 'edition', 'distributor', 'region']) {
        if (known[k] && f[k] && [...(f[k].options || [{ value: known[k] }])].some((o) => o.value === known[k])) {
          f[k].value = known[k];
          if (k === 'format') f.format.dispatchEvent(new Event('change'));
        }
      }
      Object.assign(extra, { tmdbId: known.tmdbId ?? null, posterPath: known.posterPath ?? null, mediaType: known.mediaType ?? null });
      onPosterChange?.(known.posterPath);
      f.title.dispatchEvent(new Event('input'));
      notes.push(el('p', { className: 'hint', textContent: 'Details copied from the matching record. Check them.' }));
      say(...notes);
      return;
    }
    if (f.title.value.trim()) {
      await searchTmdb(f.title.value, notes);
      return;
    }
    notes.push(el('p', { className: 'hint', textContent: 'Free barcode databases don\'t allow lookups from this app, so type the title and tap Search title.' }));
    say(...notes);
    f.title.focus();
  }

  form.querySelector('[data-action="scan"]').addEventListener('click', async () => {
    const code = await openScanner();
    if (code) await useBarcode(code);
  });
  form.querySelector('[data-action="search-title"]').addEventListener('click', () => searchTmdb(f.title.value));
}
