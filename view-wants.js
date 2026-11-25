// Want list, want form, and want detail (retailer links + price log).
import { CONFIG } from './config.js';
import * as db from './db.js';
import { parsePounds, formatPence, penceToInput } from './money.js';
import { normaliseBarcode, validateBarcode } from './ean.js';
import { cheapest, eligibleLogs, logTotal, conditionLabel, conditionRank, isStale, ageDays } from './prices.js';
import {
  clone, view, setActiveTab, fillSelect, toast, undoable, nowIso, todayIso, newId, poster, titleYear, plural, el,
  retailerLink, formatDate,
} from './ui.js';
import { wireLookup } from './view-lookup.js';

const state = { showBought: false, search: '' };

function ageText(log) {
  const d = ageDays(log.seenOn);
  if (d == null) return '';
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

function cheapestSummary(want, logs) {
  const c = cheapest(want, logs);
  if (!c) return { text: eligibleLogs(want, logs).length ? '' : 'No prices logged yet', best: null };
  const parts = [`Best ${formatPence(logTotal(c))} at ${c.retailer}`, `${conditionLabel(c.condition)}`, ageText(c)];
  return { text: parts.filter(Boolean).join(' · '), best: c };
}

// ---------- list ----------
export async function renderWants(params, ctx) {
  const [wants, logs] = await Promise.all([db.getAll('wants'), db.getAll('priceLog')]);
  if (!ctx.isCurrent()) return;
  setActiveTab('wants');
  const root = view();
  root.replaceChildren(clone('tpl-wants'));
  const list = root.querySelector('#want-list');
  const search = root.querySelector('#want-search');
  const showBought = root.querySelector('#show-bought');
  search.value = state.search;
  showBought.checked = state.showBought;

  const active = wants.filter((w) => w.status !== 'bought');
  root.querySelector('[data-total="wants"]').textContent = plural(active.length, 'want');
  const underTarget = active.filter((w) => { const c = cheapest(w, logs); return c && w.targetPrice != null && logTotal(c) <= w.targetPrice; });
  root.querySelector('[data-total="under"]').textContent = underTarget.length ? `${underTarget.length} at or under target` : '';

  const draw = () => {
    const q = state.search.toLowerCase();
    const shown = wants
      .filter((w) => (state.showBought || w.status !== 'bought'))
      .filter((w) => !q || [w.title, w.ean, w.edition, w.year].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title, CONFIG.locale, { sensitivity: 'base' }));
    list.replaceChildren(...shown.map((w) => {
      const { text, best } = cheapestSummary(w, logs);
      const target = w.targetPrice != null ? `Target ${formatPence(w.targetPrice)}` : 'No target';
      const flags = [];
      if (w.status === 'bought') flags.push(el('span', { className: 'tag', textContent: 'Bought' }));
      if (best && w.targetPrice != null && logTotal(best) <= w.targetPrice) flags.push(el('span', { className: 'tag good', textContent: 'At or under target' }));
      if (best && isStale(best)) flags.push(el('span', { className: 'tag warn', textContent: 'Price may be out of date' }));
      const a = el('a', { className: 'item-row', href: `#/want/${encodeURIComponent(w.id)}` },
        poster(w.posterPath),
        el('span', { className: 'main' },
          el('span', { className: 'title', textContent: titleYear(w) }),
          el('span', { className: 'meta', textContent: [w.format || 'Any format', w.packaging && w.packaging !== 'Standard' ? w.packaging : '', `${conditionLabel(w.wantedCondition)} or better`, target].filter(Boolean).join(' · ') }),
          el('span', { className: 'meta strong', textContent: text }),
          flags.length ? el('span', { className: 'tags' }, ...flags) : null));
      return el('li', {}, a);
    }));
    root.querySelector('#wants-empty').hidden = wants.length > 0;
    if (wants.length && !shown.length) list.append(el('li', { className: 'empty', textContent: 'Nothing to show.' }));
  };
  search.addEventListener('input', () => { state.search = search.value.trim(); draw(); });
  showBought.addEventListener('change', () => { state.showBought = showBought.checked; draw(); });
  draw();
}

// ---------- form ----------
export async function renderWantForm({ id }, ctx) {
  const existing = id ? await db.get('wants', id) : null;
  if (!ctx.isCurrent()) return;
  if (id && !existing) { toast('That want no longer exists.'); location.hash = '#/wants'; return; }
  setActiveTab('wants');
  const root = view();
  root.replaceChildren(clone('tpl-want-form'));
  const form = root.querySelector('#want-form');
  const f = form.elements;
  fillSelect(f.format, CONFIG.formats, { blank: 'Any format' });
  fillSelect(f.packaging, CONFIG.packaging);
  fillSelect(f.wantedCondition, CONFIG.conditions);
  f.wantedCondition.value = CONFIG.defaultWantedCondition;

  const extra = { tmdbId: existing?.tmdbId ?? null, posterPath: existing?.posterPath ?? null, mediaType: existing?.mediaType ?? null };
  const posterSlot = form.querySelector('[data-slot="poster"]');
  const showPoster = (path) => { posterSlot.replaceChildren(path ? poster(path, CONFIG.tmdb.posterSize) : ''); posterSlot.hidden = !path; };
  showPoster(extra.posterPath);

  if (existing) {
    form.querySelector('[data-heading]').textContent = 'Edit want';
    for (const key of ['title', 'year', 'ean', 'format', 'packaging', 'edition', 'wantedCondition', 'notes']) {
      if (existing[key] != null) f[key].value = String(existing[key]);
    }
    f.targetPrice.value = penceToInput(existing.targetPrice);
    form.querySelector('[data-action="cancel"]').href = `#/want/${encodeURIComponent(existing.id)}`;
  }

  const eanNote = form.querySelector('[data-note="ean"]');
  f.ean.addEventListener('input', () => {
    const r = validateBarcode(f.ean.value);
    eanNote.hidden = r.ok;
    eanNote.textContent = r.ok ? '' : r.reason === 'length' ? 'Barcodes are usually 8, 12 or 13 digits.' : 'The check digit doesn\'t match. Check for a typo.';
  });

  wireLookup(form, extra, { onPosterChange: showPoster });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = form.querySelector('[data-error]');
    const errors = [];
    const title = f.title.value.trim();
    if (!title) errors.push('Enter a title.');
    const year = f.year.value.trim();
    if (year && !/^\d{4}$/.test(year)) errors.push('Year must be four digits.');
    const targetPrice = parsePounds(f.targetPrice.value);
    if (Number.isNaN(targetPrice)) errors.push('Target price must be an amount like 12.99.');
    if (errors.length) {
      errorEl.textContent = errors.join(' ');
      errorEl.hidden = false;
      if (!title) f.title.focus();
      return;
    }
    const now = nowIso();
    const want = {
      ...(existing || {}),
      ...extra,
      id: existing?.id || newId(),
      title,
      year: year ? +year : null,
      ean: normaliseBarcode(f.ean.value) || null,
      format: f.format.value || null,
      packaging: f.packaging.value,
      edition: f.edition.value.trim() || null,
      wantedCondition: f.wantedCondition.value,
      targetPrice,
      notes: f.notes.value.trim() || null,
      status: existing?.status || 'wanted',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    await db.put('wants', want);
    // Keep the barcode on this want's logs in step, so collection valuation can use them.
    if (existing && existing.ean !== want.ean) {
      for (const log of (await db.getAll('priceLog')).filter((l) => l.wantId === want.id)) {
        await db.put('priceLog', { ...log, ean: want.ean, updatedAt: now });
      }
    }
    toast(existing ? 'Saved.' : `Added "${title}" to your want list.`);
    location.hash = `#/want/${encodeURIComponent(want.id)}`;
  });

  if (!existing) f.title.focus();
}

// ---------- detail ----------
export async function renderWantDetail({ id }, ctx) {
  const want = await db.get('wants', id);
  const logs = (await db.getAll('priceLog')).filter((l) => l.wantId === id);
  if (!ctx.isCurrent()) return;
  if (!want) { toast('That want no longer exists.'); location.hash = '#/wants'; return; }
  setActiveTab('wants');
  const root = view();
  root.replaceChildren(clone('tpl-want-detail'));

  root.querySelector('[data-slot="poster"]').replaceChildren(poster(want.posterPath, CONFIG.tmdb.posterSize));
  root.querySelector('[data-field="title"]').textContent = titleYear(want);
  root.querySelector('[data-field="meta"]').textContent = [
    want.format || 'Any format', want.packaging && want.packaging !== 'Standard' ? want.packaging : '', want.edition, want.ean ? `Barcode ${want.ean}` : '',
  ].filter(Boolean).join(' · ');
  root.querySelector('[data-field="wanted"]').textContent = `${conditionLabel(want.wantedCondition)} or better`
    + (want.targetPrice != null ? `, target ${formatPence(want.targetPrice)}` : ', no target price');
  if (want.status === 'bought') root.querySelector('[data-field="status"]').hidden = false;
  root.querySelector('[data-action="edit"]').href = `#/want/${encodeURIComponent(want.id)}/edit`;

  // Cheapest
  const best = cheapest(want, logs);
  const bestEl = root.querySelector('[data-field="cheapest"]');
  if (best) {
    const under = want.targetPrice != null && logTotal(best) <= want.targetPrice;
    bestEl.replaceChildren(...[
      el('strong', { className: 'big', textContent: formatPence(logTotal(best)) }),
      el('span', { textContent: ` at ${best.retailer}, ${conditionLabel(best.condition)}, seen ${ageText(best)}` }),
      best.postage ? el('span', { className: 'hint', textContent: ` (${formatPence(best.price)} + ${formatPence(best.postage)} postage)` }) : null,
      under ? el('p', { className: 'ok', textContent: 'At or under your target price.' }) : null,
      isStale(best) ? el('p', { className: 'warn-text', textContent: `This price is over ${CONFIG.priceStaleDays} days old. Check it's still available.` }) : null,
      best.url ? el('p', {}, el('a', { href: best.url, target: '_blank', rel: 'noopener noreferrer', textContent: 'Open the listing' })) : null,
    ].filter(Boolean));
  } else {
    bestEl.textContent = logs.length
      ? `None of the ${plural(logs.length, 'logged price')} meet ${conditionLabel(want.wantedCondition)} or better.`
      : 'No prices logged yet. Use the links below, then log what you find.';
  }

  // Retailer links
  const linkList = root.querySelector('[data-field="links"]');
  const titleQuery = [want.title, want.format].filter(Boolean).join(' ');
  for (const r of CONFIG.retailers) {
    const row = el('li', { className: 'link-row' }, el('span', { className: 'name', textContent: r.name }));
    if (want.ean && r.barcode) row.append(el('a', { className: 'button small', href: retailerLink(r, want.ean), target: '_blank', rel: 'noopener noreferrer', textContent: 'Barcode' }));
    row.append(el('a', { className: 'button small', href: retailerLink(r, titleQuery), target: '_blank', rel: 'noopener noreferrer', textContent: 'Title' }));
    linkList.append(row);
  }

  // Log a price
  const form = root.querySelector('#log-form');
  const lf = form.elements;
  fillSelect(lf.retailer, [...CONFIG.retailers.map((r) => r.name), 'Other']);
  fillSelect(lf.condition, CONFIG.conditions);
  lf.condition.value = want.wantedCondition;
  lf.seenOn.value = todayIso();
  const otherWrap = form.querySelector('[data-wrap="otherRetailer"]');
  lf.retailer.addEventListener('change', () => { otherWrap.hidden = lf.retailer.value !== 'Other'; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('[data-error]');
    const price = parsePounds(lf.price.value);
    const postage = parsePounds(lf.postage.value);
    const retailer = lf.retailer.value === 'Other' ? lf.otherRetailer.value.trim() : lf.retailer.value;
    const url = lf.url.value.trim();
    const problems = [];
    if (price == null || Number.isNaN(price)) problems.push('Enter the price, like 9.99.');
    if (Number.isNaN(postage)) problems.push('Postage must be an amount like 2.99 (or blank).');
    if (!retailer) problems.push('Name the retailer.');
    if (url && !/^https:\/\//i.test(url)) problems.push('The link must start with https://');
    if (!lf.seenOn.value) problems.push('Enter the date you saw it.');
    if (problems.length) { err.textContent = problems.join(' '); err.hidden = false; return; }
    const now = nowIso();
    await db.put('priceLog', {
      id: newId(),
      wantId: want.id,
      ean: want.ean || null,
      retailer,
      price,
      postage: postage ?? 0,
      condition: lf.condition.value,
      seenOn: lf.seenOn.value,
      url: url || null,
      note: lf.note.value.trim() || null,
      createdAt: now,
      updatedAt: now,
    });
    toast(`Logged ${formatPence(price + (postage ?? 0))} at ${retailer}.`);
    ctx.rerender();
  });

  // History
  const hist = root.querySelector('[data-field="history"]');
  const sorted = [...logs].sort((a, b) => (b.seenOn || '').localeCompare(a.seenOn || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  root.querySelector('[data-field="history-count"]').textContent = logs.length ? `(${logs.length})` : '';
  for (const l of sorted) {
    const eligible = conditionRank(l.condition) >= conditionRank(want.wantedCondition);
    const del = el('button', { type: 'button', className: 'small', textContent: 'Delete', ariaLabel: `Delete price from ${l.retailer} on ${formatDate(l.seenOn)}` });
    del.addEventListener('click', async () => {
      await db.remove('priceLog', l.id);
      undoable(`Deleted the ${formatPence(logTotal(l))} price from ${l.retailer}.`, async () => { await db.put('priceLog', l); ctx.rerender(); });
      ctx.rerender();
    });
    hist.append(el('li', { className: `history-row${eligible ? '' : ' ineligible'}${l.id === best?.id ? ' best' : ''}` },
      el('span', { className: 'main' },
        el('strong', { textContent: `${formatPence(logTotal(l))} · ${l.retailer}` }),
        el('span', { className: 'meta', textContent: [formatDate(l.seenOn), conditionLabel(l.condition), l.postage ? `incl. ${formatPence(l.postage)} postage` : '', eligible ? '' : 'below wanted condition', l.note].filter(Boolean).join(' · ') }),
        l.url ? el('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', textContent: 'Listing', className: 'meta' }) : null),
      del));
  }
  if (!logs.length) hist.append(el('li', { className: 'hint', textContent: 'No prices logged yet.' }));

  // Actions
  const boughtBtn = root.querySelector('[data-action="bought"]');
  boughtBtn.hidden = want.status === 'bought';
  boughtBtn.addEventListener('click', async () => {
    if (!confirm(`Mark "${want.title}" as bought and add it to your collection? You can edit the details next.`)) return;
    const now = nowIso();
    const item = {
      id: newId(),
      title: want.title,
      year: want.year ?? null,
      ean: want.ean ?? null,
      format: want.format || CONFIG.formats[0],
      packaging: want.packaging || 'Standard',
      region: CONFIG.defaultRegionByFormat[want.format || CONFIG.formats[0]] || 'Unknown',
      condition: best?.condition || want.wantedCondition,
      distributor: null,
      edition: want.edition ?? null,
      discCount: null,
      pricePaid: best ? logTotal(best) : null,
      estimatedValue: null,
      purchasedFrom: best?.retailer || null,
      purchasedOn: todayIso(),
      notes: want.notes ?? null,
      tmdbId: want.tmdbId ?? null,
      posterPath: want.posterPath ?? null,
      mediaType: want.mediaType ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await db.put('items', item);
    await db.put('wants', { ...want, status: 'bought', boughtItemId: item.id, boughtAt: now, updatedAt: now });
    toast('Added to your collection. Check the price and details.');
    location.hash = `#/item/${encodeURIComponent(item.id)}`;
  });
  root.querySelector('[data-action="delete-want"]').addEventListener('click', async () => {
    for (const l of logs) await db.remove('priceLog', l.id);
    await db.remove('wants', want.id);
    location.hash = '#/wants';
    undoable(`Deleted "${want.title}"${logs.length ? ` and ${plural(logs.length, 'logged price')}` : ''}.`, async () => {
      await db.put('wants', want);
      for (const l of logs) await db.put('priceLog', l);
      location.hash = `#/want/${encodeURIComponent(want.id)}`;
    });
  });
}
