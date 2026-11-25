// Collections tab: list of checklists, and the checklist detail screen.
import { CONFIG } from './config.js';
import * as db from './db.js';
import {
  progress, entryStatus, ownedFormats, parseTitleList, addEntries, newCollection, sortEntries, checklistText, enrichEntries,
} from './collections.js';
import { matchEntries, applyMatches, pick, unmatch, matchSummary, needsMatch } from './matching.js';
import { tmdbSearch, tmdbSearchFranchise, tmdbFranchiseParts, tmdbListItems, parseTmdbListId, getTmdbKey } from './lookup.js';
import {
  clone, view, setActiveTab, toast, undoable, nowIso, newId, poster, titleYear, plural, el, setPrefill, shareOrCopy,
  setRing, tile, wireViewToggle,
} from './ui.js';

const detailState = { filter: 'all', sort: 'list' };
const celebrated = new Set(); // once per session per collection
const running = new Set(); // collections currently being matched
const progressText = new Map(); // id -> latest progress message

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

// ---------- matching (runs independently of the screen) ----------
async function runMatching(collectionId, { onProgress } = {}) {
  if (running.has(collectionId)) return { busy: true };
  running.add(collectionId);
  try {
    const start = await db.get('collections', collectionId);
    if (!start) return { gone: true };
    const outcome = await matchEntries(start.entries, tmdbSearch, { onProgress });
    // Re-read before writing so edits made while matching aren't lost.
    const latest = await db.get('collections', collectionId);
    if (latest && outcome.results.size) await db.put('collections', applyMatches(latest, outcome.results));
    return outcome;
  } finally {
    running.delete(collectionId);
    // Whatever screen is showing this collection now (maybe a fresh render) refreshes itself.
    dispatchEvent(new CustomEvent('discshelf:collection-updated', { detail: { id: collectionId } }));
  }
}

// ---------- detail ----------
export async function renderCollectionDetail({ id }, ctx) {
  const [stored, items, wants] = await Promise.all([db.get('collections', id), db.getAll('items'), db.getAll('wants')]);
  if (!ctx.isCurrent()) return;
  if (!stored) { toast('That collection no longer exists.'); location.hash = '#/collections'; return; }
  // Pick up TMDB ids/posters from matching discs and wants.
  let collection = enrichEntries(stored, [...items, ...wants]);
  if (collection !== stored) await db.put('collections', collection);
  if (!ctx.isCurrent()) return;
  setActiveTab('collections');
  const root = view();
  root.replaceChildren(clone('tpl-collection-detail'));
  const q = (s) => root.querySelector(s);
  const save = async (c) => { collection = { ...c, updatedAt: nowIso() }; await db.put('collections', collection); };

  // ----- header -----
  const p = progress(collection, items, wants);
  q('[data-field="name"]').textContent = collection.name;
  q('[data-field="description"]').textContent = collection.description || '';
  q('[data-field="description"]').hidden = !collection.description;
  q('[data-field="progress"]').textContent = p.total ? `${progressLine(p)} · ${p.missing} missing` : 'No films yet. Add some below.';
  const ring = q('[data-field="ring"]');
  setRing(ring, p.owned, p.total);
  if (p.total && p.owned === p.total && !celebrated.has(collection.id)) {
    celebrated.add(collection.id);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) ring.classList.add('celebrate');
    toast(`Complete! You own every film in ${collection.name}.`);
  }

  // ----- TMDB match status -----
  const matchBar = q('[data-field="matchBar"]');
  const matchStatus = q('[data-field="matchStatus"]');
  const matchBtn = q('[data-action="match-tmdb"]');
  const showMatchState = () => {
    const s = matchSummary(collection);
    const bits = [];
    if (s.pending) bits.push(`${s.pending} not matched to TMDB yet`);
    if (s.ambiguous) bits.push(`${s.ambiguous} need you to pick`);
    if (s.notfound) bits.push(`${s.notfound} not found`);
    matchBar.hidden = !bits.length;
    matchStatus.textContent = bits.length ? `${bits.join(' · ')}. Tap a film to sort it out.` : '';
    getTmdbKey().then((k) => { if (!k?.trim() && s.pending) matchStatus.textContent = `${plural(s.pending, 'film')} not matched to TMDB. Add a TMDB key in Settings to match them and get posters.`; });
    matchBtn.hidden = !s.pending;
    matchBtn.textContent = `Match ${plural(s.pending, 'film')} with TMDB`;
  };
  showMatchState();

  const startMatching = async () => {
    if (!collection.entries.some(needsMatch)) return;
    matchBar.hidden = false;
    matchBtn.disabled = true;
    matchStatus.textContent = 'Matching with TMDB…';
    const r = await runMatching(collection.id, {
      onProgress: (done, total) => { progressText.set(collection.id, `Matching with TMDB… ${done} of ${total}`); if (ctx.isCurrent()) matchStatus.textContent = progressText.get(collection.id); },
    });
    if (r.busy) return;
    if (r.stopped) {
      const msg = r.stopped.status === 'nokey' ? 'Add a TMDB key in Settings to match titles and get posters.'
        : r.stopped.status === 'offline' ? 'You\'re offline. Matching will finish when you tap Match again online.'
          : r.stopped.message || 'TMDB matching stopped.';
      toast(msg);
    } else if (r.results?.size) {
      const vals = [...r.results.values()];
      const n = (st) => vals.filter((v) => v.state === st).length;
      toast(`Matched ${n('matched')} of ${vals.length}${n('ambiguous') ? `, ${n('ambiguous')} to pick` : ''}${n('notfound') ? `, ${n('notfound')} not found` : ''}.`);
    }
    progressText.delete(collection.id);
  };
  matchBtn.addEventListener('click', startMatching);
  if (running.has(collection.id)) {
    matchBar.hidden = false;
    matchBtn.disabled = true;
    matchStatus.textContent = progressText.get(collection.id) || 'Matching with TMDB…';
  }

  // ----- edit / share / delete -----
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
    const copy = collection;
    await db.remove('collections', copy.id);
    location.hash = '#/collections';
    undoable(`Deleted "${copy.name}". Your discs and wants are not affected.`, async () => {
      await db.put('collections', copy);
      location.hash = `#/collections/${encodeURIComponent(copy.id)}`;
    });
  });

  // ----- entry actions (shared by list rows and the sheet) -----
  const wantIt = async (entry) => {
    const now = nowIso();
    const want = {
      id: newId(), title: entry.title, year: entry.year ?? null, ean: null, format: null, packaging: 'Standard', edition: null,
      wantedCondition: CONFIG.defaultWantedCondition, targetPrice: null, notes: null, status: 'wanted',
      tmdbId: entry.tmdbId ?? null, posterPath: entry.posterPath ?? null, mediaType: entry.mediaType ?? null,
      createdAt: now, updatedAt: now,
    };
    await db.put('wants', want);
    undoable(`Added "${entry.title}" to your want list.`, async () => { await db.remove('wants', want.id); ctx.rerender(); });
    ctx.rerender();
  };
  const ownIt = (entry) => {
    setPrefill({ record: entry, returnTo: `#/collections/${encodeURIComponent(collection.id)}` });
    location.hash = '#/add';
  };
  const removeEntry = async (entry) => {
    const before = collection;
    await save({ ...collection, entries: collection.entries.filter((x) => x.id !== entry.id) });
    undoable(`Removed "${entry.title}".`, async () => { await db.put('collections', { ...before, updatedAt: nowIso() }); ctx.rerender(); });
    ctx.rerender();
  };
  const replaceEntry = async (entry, next) => {
    await save({ ...collection, entries: collection.entries.map((x) => (x.id === entry.id ? next : x)) });
  };

  // ----- sheet: one film -----
  function openSheet(entry) {
    const s = entryStatus(entry, items, wants);
    const dlg = clone('tpl-entry-sheet').firstElementChild;
    document.body.append(dlg);
    const d = (sel) => dlg.querySelector(sel);
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
    d('[data-slot="poster"]').replaceChildren(poster(entry.posterPath, CONFIG.tmdb.posterSize));
    d('[data-field="title"]').textContent = titleYear(entry);
    d('[data-field="status"]').replaceChildren(statusTag(s));
    const actions = d('[data-field="actions"]');
    const btn = (label, fn, cls = '') => { const b = el('button', { type: 'button', className: cls, textContent: label }); b.addEventListener('click', fn); actions.append(b); };
    const link = (label, href) => { const a = el('a', { className: 'button', href, textContent: label }); a.addEventListener('click', close); actions.append(a); };
    if (s.status === 'owned') s.owned.forEach((i) => link(`View ${i.format || 'disc'}`, `#/item/${encodeURIComponent(i.id)}`));
    if (s.status === 'wanted') link('View want', `#/want/${encodeURIComponent(s.wanted[0].id)}`);
    if (s.status === 'missing') {
      btn('Want it', () => { close(); wantIt(entry); });
      btn('I own it', () => { close(); ownIt(entry); }, 'primary');
    }

    // TMDB match section
    const matchText = d('[data-field="matchText"]');
    const cands = d('[data-field="candidates"]');
    const searchForm = d('[data-field="searchForm"]');
    const matchActions = d('[data-field="matchActions"]');
    const showCandidates = (list, note) => {
      matchText.textContent = note;
      cands.replaceChildren(...list.map((c) => {
        const b = el('button', { type: 'button', className: 'pick' }, poster(c.posterPath), el('span', { textContent: `${titleYear(c)} · ${c.mediaType === 'tv' ? 'TV' : 'Film'}` }));
        b.addEventListener('click', async () => {
          await replaceEntry(entry, pick(entry, c));
          close();
          toast(`Matched to ${titleYear(c)}.`);
          ctx.rerender();
        });
        return el('li', {}, b);
      }));
    };
    searchForm.elements.q.value = entry.title;
    if (entry.tmdbId) {
      matchText.textContent = `Matched to ${entry.tmdbTitle || entry.title} on TMDB. Wrong film? Search below and pick the right one.`;
      const b = el('button', { type: 'button', className: 'small', textContent: 'Clear match' });
      b.addEventListener('click', async () => { await replaceEntry(entry, unmatch(entry, 'skipped')); close(); ctx.rerender(); });
      matchActions.append(b);
    } else if (entry.matchState === 'ambiguous' && entry.candidates?.length) {
      showCandidates(entry.candidates, 'More than one film fits. Pick the right one:');
    } else if (entry.matchState === 'notfound') {
      matchText.textContent = 'TMDB found nothing for this title. Try different words below.';
    } else if (entry.matchState === 'skipped') {
      matchText.textContent = 'Kept without a TMDB match. Search below to add one.';
    } else {
      matchText.textContent = 'Not matched yet. Search below, or use Match with TMDB on the collection.';
    }
    if (!entry.tmdbId && entry.matchState !== 'skipped') {
      const b = el('button', { type: 'button', className: 'small quiet', textContent: 'Not on TMDB: keep as it is' });
      b.addEventListener('click', async () => { await replaceEntry(entry, unmatch(entry, 'skipped')); close(); ctx.rerender(); });
      matchActions.append(b);
    }
    searchForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const query = searchForm.elements.q.value.trim();
      if (!query) return;
      matchText.textContent = 'Searching…';
      const r = await tmdbSearch(query);
      if (r.status === 'nokey') { matchText.textContent = 'Add a TMDB key in Settings first.'; return; }
      if (r.status !== 'ok') { matchText.textContent = r.message || 'Search failed.'; return; }
      showCandidates(r.results, r.results.length ? 'Pick the right film:' : 'No matches. Try fewer words.');
    });
    d('[data-action="remove-entry"]').addEventListener('click', () => { close(); removeEntry(entry); });
    d('[data-action="close-sheet"]').addEventListener('click', close);
    dlg.showModal();
  }

  function statusTag(s) {
    return {
      owned: el('span', { className: 'tag good', textContent: `Owned: ${ownedFormats(s.owned).join(', ')}` }),
      wanted: el('span', { className: 'tag warn', textContent: 'On want list' }),
      missing: el('span', { className: 'tag', textContent: 'Missing' }),
    }[s.status];
  }

  // ----- filter + sort + views -----
  const filter = q('#entry-filter');
  const sort = q('#entry-sort');
  filter.value = detailState.filter;
  sort.value = detailState.sort;
  const list = q('#entry-list');
  const grid = q('#entry-grid');

  const matchFlag = (e) => (e.tmdbId ? null
    : e.matchState === 'ambiguous' ? { text: 'Pick match', warn: true }
      : e.matchState === 'notfound' ? { text: 'Not found' } : null);

  const draw = () => {
    const rows = sortEntries(collection.entries, detailState.sort)
      .map((e) => ({ e, s: entryStatus(e, items, wants) }))
      .filter(({ s }) => detailState.filter === 'all' || s.status === detailState.filter);
    list.replaceChildren(...rows.map(({ e, s }) => entryRow(e, s)));
    grid.replaceChildren(...rows.map(({ e, s }) => el('li', {}, tile({
      title: e.title, year: e.year, posterPath: e.posterPath, state: s.status,
      flag: matchFlag(e), onClick: () => openSheet(e),
      sub: s.status === 'owned' ? ownedFormats(s.owned).join(', ') : s.status === 'wanted' ? 'On want list' : '',
    }))));
    if (collection.entries.length && !rows.length) {
      list.append(el('li', { className: 'empty', textContent: 'Nothing matches this filter.' }));
      grid.append(el('li', { className: 'empty', textContent: 'Nothing matches this filter.' }));
    }
  };

  function entryRow(entry, s) {
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
      btn('Want it', () => wantIt(entry));
      btn('I own it', () => ownIt(entry));
    }
    btn('More', () => openSheet(entry), 'quiet');
    const flag = matchFlag(entry);
    return el('li', { className: `entry-row ${s.status}` },
      poster(entry.posterPath),
      el('span', { className: 'main' },
        el('span', { className: 'title', textContent: titleYear(entry) }),
        el('span', { className: 'tags' }, statusTag(s), flag ? el('span', { className: `tag${flag.warn ? ' warn' : ''}`, textContent: flag.text }) : null),
        actions));
  }

  filter.addEventListener('change', () => { detailState.filter = filter.value; draw(); });
  sort.addEventListener('change', () => { detailState.sort = sort.value; draw(); });
  wireViewToggle(root, 'collection', 'grid', (mode) => { list.hidden = mode !== 'list'; grid.hidden = mode !== 'grid'; });
  draw();
  q('#entries-empty').hidden = collection.entries.length > 0;

  // ----- adding films -----
  const status = q('[data-field="addStatus"]');
  const addAndRefresh = async (records, { match = false } = {}) => {
    const r = addEntries(collection, records);
    await save(r.collection);
    toast(`Added ${plural(r.added, 'film')}${r.skipped ? `, ${r.skipped} already in the collection` : ''}.`);
    // Without a TMDB key, don't try: the match bar explains and offers the button.
    if (match && r.added && (await getTmdbKey())?.trim()) {
      // Show the new films straight away, then match them; the screen refreshes when matching finishes.
      draw();
      q('#entries-empty').hidden = true;
      await startMatching();
    } else ctx.rerender();
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

  // 2. Paste a list of titles (then match them on TMDB automatically)
  const pasteForm = q('#entry-paste');
  pasteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const titles = parseTitleList(pasteForm.elements.titles.value);
    if (!titles.length) { showMessage({ status: 'error', message: 'Paste at least one title, one per line.' }); return; }
    await addAndRefresh(titles, { match: true });
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
