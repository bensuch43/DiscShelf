// Shared "fill from scan / barcode / title search" behaviour for the item and want forms.
// The form must contain: [data-action="scan"], [data-action="lookup-ean"],
// [data-action="search-title"], [data-panel="lookup"], and inputs title, year, ean,
// format, packaging (format change triggers the region default in item forms).
import { openScanner } from '../scanner.js';
import { upcLookup, tmdbSearch, cleanTitle, guessEdition, upcUsageToday } from '../lookup.js';
import { validateBarcode } from '../ean.js';
import { CONFIG } from '../config.js';
import { el, poster, titleYear } from '../ui.js';

/**
 * extra: object that receives tmdbId / posterPath / mediaType for the record being edited.
 * onPosterChange: called after a TMDB pick so the form can show the poster.
 */
export function wireLookup(form, extra, { onPosterChange, onBarcode } = {}) {
  const f = form.elements;
  const panel = form.querySelector('[data-panel="lookup"]');

  const say = (...nodes) => { panel.hidden = false; panel.replaceChildren(...nodes); };
  const busy = (text) => say(el('p', { className: 'hint', textContent: text }));

  const setSelect = (select, value) => {
    if (!value || ![...select.options].some((o) => o.value === value)) return false;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    return true;
  };

  async function searchTmdb(query, preface = []) {
    const q = cleanTitle(query) || query;
    if (!q) { say(...preface, el('p', { className: 'error', textContent: 'Type a title first.' })); return; }
    busy(`Searching TMDB for "${q}"…`);
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
          say(el('p', { className: 'ok', textContent: `Filled from TMDB: ${titleYear(res)}. Check the edition details below.` }));
        });
        list.append(el('li', {}, btn));
      }
      nodes.push(list);
    }
    say(...nodes);
  }

  async function lookupBarcode(code) {
    const v = validateBarcode(code);
    if (!v.code) { say(el('p', { className: 'error', textContent: 'Enter or scan a barcode first.' })); return; }
    f.ean.value = v.code;
    f.ean.dispatchEvent(new Event('input'));
    onBarcode?.(v.code);
    busy(`Looking up ${v.code}…`);
    const r = await upcLookup(v.code);
    const used = await upcUsageToday();
    const usage = el('p', { className: 'hint small', textContent: r.cached ? 'From this device\'s lookup cache.' : `UPCitemdb lookups today on this device: ${used} of ${CONFIG.upcitemdb.dailyLimit}.` });
    if (r.status === 'found') {
      const product = r.items[0];
      const guess = guessEdition(product.title);
      const changed = [];
      if (setSelect(f.format, guess.format)) changed.push('format');
      if (setSelect(f.packaging, guess.packaging)) changed.push('packaging');
      const preface = [
        el('p', {}, 'Barcode listing: ', el('strong', { textContent: product.title })),
        changed.length ? el('p', { className: 'hint', textContent: `Guessed ${changed.join(' and ')} from the listing. Check them.` }) : null,
        product.brand ? el('p', { className: 'hint', textContent: `Listed brand: ${product.brand} (often a US distributor, so not filled in).` }) : null,
        usage,
      ].filter(Boolean);
      if (!f.title.value.trim()) f.title.value = cleanTitle(product.title);
      await searchTmdb(product.title, preface);
    } else {
      const msg = {
        notfound: 'UPCitemdb doesn\'t know this barcode (common for UK editions). Search by title instead.',
        limit: r.message || `Daily lookup limit (${CONFIG.upcitemdb.dailyLimit}) reached on this device. Search by title instead.`,
        offline: 'You\'re offline. The barcode is saved; fill the rest by hand or search later.',
        error: r.message || 'Lookup failed.',
      }[r.status];
      const actions = el('div', { className: 'actions' });
      const searchBtn = el('button', { type: 'button', textContent: 'Search TMDB by title' });
      searchBtn.addEventListener('click', () => searchTmdb(f.title.value));
      actions.append(searchBtn);
      say(el('p', { className: r.status === 'error' ? 'error' : 'hint', textContent: msg }), usage, actions);
    }
  }

  form.querySelector('[data-action="scan"]').addEventListener('click', async () => {
    const code = await openScanner();
    if (code) await lookupBarcode(code);
  });
  form.querySelector('[data-action="lookup-ean"]').addEventListener('click', () => lookupBarcode(f.ean.value));
  form.querySelector('[data-action="search-title"]').addEventListener('click', () => searchTmdb(f.title.value));
}
