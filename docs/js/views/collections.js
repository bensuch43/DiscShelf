// Collections tab: list of checklists, and the checklist detail screen.
import { CONFIG } from '../config.js';
import * as db from '../db.js';
import {
  progress, entryStatus, ownedFormats, parseTitleList, addEntries, newCollection, sortEntries, checklistText, enrichEntries,
} from '../collections.js';
import { tmdbSearch, tmdbSearchFranchise, tmdbFranchiseParts, tmdbListItems, parseTmdbListId } from '../lookup.js';
import {
  clone, view, setActiveTab, toast, nowIso, newId, poster, titleYear, plural, el, setPrefill, shareOrCopy,
} from '../ui.js';

const detailState = { filter: 'all', sort: 'list' };

function progressLine(p) {
  const bits = [`${p.owned} of ${p.total} owned`];
  if (p.wanted) bits.push(`${p.wanted} on want list`);
  return bits.join(' · ');
}

// ---------- list ----------
export async function renderCollections(params, ctx) {
  const [collections, items, wants] = await Promise.all([db.getAll('collections'), db.getAll('items'), db.getAll('wants')]);
  if (!ctx.isCurrent()) return;
  setActiveTab('collections');
  const root = view();
  root.replaceChildren(clone('tpl-collections'));

  const form = root.querySelector('#new-collection');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.elements.name.value.trim();
    const err = form.querySelector('[data-error]');
    if (!name) { err.textContent = 'Give the collection a name.'; err.hidden = false; return; }
    if (collections.some((c) => c.name.toLowerCase() === name.toLowerCase())) { err.textContent = 'You already have a collection with that name.'; err.hidden = false; return; }
    const c = newCollection(name, form.elements.description.value);
    await db.put('collections', c);
    toast(`Created "${c.name}". Now add films to it.`);
    location.hash = `#/collections/${encodeURIComponent(c.id)}`;
  });

  const list = root.querySelector('#collection-list');
  const sorted = [...collections].sort((a, b) => a.name.localeCompare(b.name, CONFIG.locale, { sensitivity: 'base' }));
  for (const c of sorted) {
    const p = progress(c, items, wants);
    const thumbs = el('span', { className: 'thumbs', ariaHidden: 'true' }, ...c.entries.filter((e) => e.posterPath).slice(0, 4).map((e) => poster(e.posterPath)));
    list.append(el('li', {}, el('a', { className: 'item-row collection-row', href: `#/collections/${encodeURIComponent(c.id)}` },
      el('span', { className: 'main' },
        el('span', { className: 'title', textContent: c.name }),
        el('span', { className: 'meta', textContent: p.total ? progressLine(p) : 'Empty: tap to add films' }),
        el('progress', { max: Math.max(p.total, 1), value: p.owned, ariaLabel: `${p.owned} of ${p.total} owned` })),
      thumbs)));
  }
  root.querySelector('#collections-empty').hidden = collections.length > 0;
}

// ---------- detail ----------
export async function renderCollectionDetail({ id }, ctx) {
  const [stored, items, wants] = await Promise.all([db.get('collections', id), db.getAll('items'), db.getAll('wants')]);
  if (!ctx.isCurrent()) return;
  if (!stored) { toast('That collection no longer exists.'); location.hash = '#/collections'; return; }
  // Pick up TMDB ids/posters from matching discs and wants (helps pasted titles).
  let collection = enrichEntries(stored, [...items, ...wants]);
  if (collection !== stored) await db.put('collections', collection);
  if (!ctx.isCurrent()) return;
  setActiveTab('collections');
  const root = view();
  root.replaceChildren(clone('tpl-collection-detail'));
  const q = (s) => root.querySelector(s);
  const save = async (c) => { collection = { ...c, updatedAt: nowIso() }; await db.put('collections', collection); };

  // Header
  const p = progress(collection, items, wants);
  q('[data-field="name"]').textContent = collection.name;
  q('[data-field="description"]').textContent = collection.description || '';
  q('[data-field="description"]').hidden = !collection.description;
  q('[data-field="progress"]').textContent = p.total ? `${progressLine(p)} · ${p.missing} missing` : 'No films yet. Add some below.';
  Object.assign(q('[data-field="bar"]'), { max: Math.max(p.total, 1), value: p.owned });

  // Edit / share / delete
  const editForm = q('#edit-collection');
  q('[data-action="edit-collection"]').addEventListener('click', () => {
    editForm.hidden = !editForm.hidden;
    editForm.elements.name.value = collection.name;
    editForm.elements.description.value = collection.description || '';
  });
  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = editForm.elements.name.value.trim();
    if (!name) return;
    await save({ ...collection, name, description: editForm.elements.description.value.trim() || null });
    toast('Saved.');
    ctx.rerender();
  });
  q('[data-action="share-collection"]').addEventListener('click', async () => {
    const r = await shareOrCopy(checklistText(collection, items, wants), collection.name);
    if (r === 'copied') toast('Checklist copied to the clipboard.');
    else if (r === 'failed') toast('Couldn\'t share or copy.');
  });
  q('[data-action="delete-collection"]').addEventListener('click', async () => {
    if (!confirm(`Delete the collection "${collection.name}"? Your discs and wants are not affected.`)) return;
    await db.remove('collections', collection.id);
    toast('Collection deleted.');
    location.hash = '#/collections';
  });

  // Filter + sort
  const filter = q('#entry-filter');
  const sort = q('#entry-sort');
  filter.value = detailState.filter;
  sort.value = detailState.sort;
  const list = q('#entry-list');

  const draw = () => {
    const rows = sortEntries(collection.entries, detailState.sort)
      .map((e) => ({ e, s: entryStatus(e, items, wants) }))
      .filter(({ s }) => detailState.filter === 'all' || s.status === detailState.filter);
    list.replaceChildren(...rows.map(({ e, s }) => entryRow(e, s)));
    if (collection.entries.length && !rows.length) list.append(el('li', { className: 'empty', textContent: 'Nothing matches this filter.' }));
  };

  function entryRow(entry, s) {
    const tag = {
      owned: el('span', { className: 'tag good', textContent: `Owned: ${ownedFormats(s.owned).join(', ')}` }),
      wanted: el('span', { className: 'tag warn', textContent: 'On want list' }),
      missing: el('span', { className: 'tag', textContent: 'Missing' }),
    }[s.status];
    const actions = el('span', { className: 'entry-actions' });
    const btn = (label, onClick, cls = '') => {
      const b = el('button', { type: 'button', className: `small ${cls}`.trim(), textContent: label, ariaLabel: `${label}: ${titleYear(entry)}` });
      b.addEventListener('click', onClick);
      actions.append(b);
    };
    const link = (label, href) => actions.append(el('a', { className: 'button small', href, textContent: label, ariaLabel: `${label}: ${titleYear(entry)}` }));
    if (s.status === 'owned') link('View disc', `#/item/${encodeURIComponent(s.owned[0].id)}`);
    if (s.status === 'wanted') link('View want', `#/want/${encodeURIComponent(s.wanted[0].id)}`);
    if (s.status === 'missing') {
      btn('Want it', async () => {
        const now = nowIso();
        await db.put('wants', {
          id: newId(), title: entry.title, year: entry.year ?? null, ean: null, format: null, packaging: 'Standard', edition: null,
          wantedCondition: CONFIG.defaultWantedCondition, targetPrice: null, notes: null, status: 'wanted',
          tmdbId: entry.tmdbId ?? null, posterPath: entry.posterPath ?? null, mediaType: entry.mediaType ?? null,
          createdAt: now, updatedAt: now,
        });
        toast(`Added "${entry.title}" to your want list.`);
        ctx.rerender();
      });
      btn('I own it', () => {
        setPrefill({ record: entry, returnTo: `#/collections/${encodeURIComponent(collection.id)}` });
        location.hash = '#/add';
      });
    }
    btn('Remove', async () => {
      if (!confirm(`Remove "${entry.title}" from ${collection.name}? Your discs and wants are not affected.`)) return;
      await save({ ...collection, entries: collection.entries.filter((x) => x.id !== entry.id) });
      ctx.rerender();
    }, 'quiet');
    return el('li', { className: `entry-row ${s.status}` },
      poster(entry.posterPath),
      el('span', { className: 'main' },
        el('span', { className: 'title', textContent: titleYear(entry) }),
        tag, actions));
  }

  filter.addEventListener('change', () => { detailState.filter = filter.value; draw(); });
  sort.addEventListener('change', () => { detailState.sort = sort.value; draw(); });
  draw();
  q('#entries-empty').hidden = collection.entries.length > 0;

  // ----- Adding films -----
  const status = q('[data-field="addStatus"]');
  const report = (added, skipped) => {
    toast(`Added ${plural(added, 'film')}${skipped ? `, ${skipped} already in the collection` : ''}.`);
  };
  const addAndRefresh = async (records) => {
    const r = addEntries(collection, records);
    await save(r.collection);
    report(r.added, r.skipped);
    ctx.rerender();
  };
  const showMessage = (r) => {
    status.hidden = false;
    status.className = r.status === 'error' ? 'error' : 'hint';
    status.replaceChildren(r.status === 'nokey'
      ? el('span', {}, 'Add a TMDB API key in ', el('a', { href: '#/settings', textContent: 'Settings' }), ' to search TMDB.')
      : el('span', { textContent: r.status === 'offline' ? 'You\'re offline.' : r.message || 'Something went wrong.' }));
  };

  // 1. Search TMDB for one title
  const searchForm = q('#entry-search');
  const results = q('[data-field="searchResults"]');
  searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = searchForm.elements.query.value.trim();
    if (!query) return;
    status.hidden = true;
    results.replaceChildren(el('li', { className: 'hint', textContent: 'Searching…' }));
    const r = await tmdbSearch(query);
    results.replaceChildren();
    if (r.status !== 'ok') { showMessage(r); return; }
    if (!r.results.length) { results.append(el('li', { className: 'hint', textContent: 'No matches. Try fewer words.' })); return; }
    for (const res of r.results) {
      const b = el('button', { type: 'button', className: 'pick' }, poster(res.posterPath),
        el('span', { textContent: `${titleYear(res)} · ${res.mediaType === 'tv' ? 'TV' : 'Film'}` }));
      b.addEventListener('click', () => addAndRefresh([res]));
      results.append(el('li', {}, b));
    }
  });

  // 2. Paste a list of titles
  const pasteForm = q('#entry-paste');
  pasteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const titles = parseTitleList(pasteForm.elements.titles.value);
    if (!titles.length) { showMessage({ status: 'error', message: 'Paste at least one title, one per line.' }); return; }
    await addAndRefresh(titles);
  });

  // 3. Import a TMDB franchise
  const franchiseForm = q('#entry-franchise');
  const franchiseResults = q('[data-field="franchiseResults"]');
  franchiseForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = franchiseForm.elements.franchise.value.trim();
    if (!query) return;
    status.hidden = true;
    franchiseResults.replaceChildren(el('li', { className: 'hint', textContent: 'Searching…' }));
    const r = await tmdbSearchFranchise(query);
    franchiseResults.replaceChildren();
    if (r.status !== 'ok') { showMessage(r); return; }
    if (!r.results.length) { franchiseResults.append(el('li', { className: 'hint', textContent: 'No franchises found. TMDB franchises are series like "Toy Story Collection".' })); return; }
    for (const fr of r.results) {
      const b = el('button', { type: 'button', className: 'pick' }, poster(fr.posterPath), el('span', { textContent: `Import ${fr.name}` }));
      b.addEventListener('click', async () => {
        const parts = await tmdbFranchiseParts(fr.id);
        if (parts.status !== 'ok') { showMessage(parts); return; }
        await addAndRefresh(parts.results);
      });
      franchiseResults.append(el('li', {}, b));
    }
  });

  // 4. Import a public TMDB list
  const listForm = q('#entry-tmdb-list');
  listForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const listId = parseTmdbListId(listForm.elements.listUrl.value);
    if (!listId) { showMessage({ status: 'error', message: 'Paste a TMDB list link like https://www.themoviedb.org/list/1234 or just its number.' }); return; }
    status.hidden = false;
    status.className = 'hint';
    status.textContent = 'Importing…';
    const r = await tmdbListItems(listId);
    if (r.status !== 'ok') { showMessage(r); return; }
    if (!r.results.length) { showMessage({ status: 'error', message: 'That list is empty or private.' }); return; }
    if (!collection.description && r.name) collection = { ...collection, description: `Imported from TMDB list "${r.name}"` };
    await addAndRefresh(r.results);
  });
}
