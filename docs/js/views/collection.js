import { CONFIG } from '../config.js';
import * as db from '../db.js';
import { formatPence } from '../money.js';
import { itemValue, totals } from '../value.js';
import { clone, view, setActiveTab, fillSelect, poster, titleYear, plural, el } from '../ui.js';
import { matches } from '../collections.js';

const listState = { search: '', format: '', sort: 'title', collection: '' };

function matchesSearch(item, q) {
  if (!q) return true;
  const hay = [item.title, item.ean, item.distributor, item.edition, item.year, item.packaging].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every((t) => hay.includes(t));
}

function sortItems(items, sort, logs) {
  const byTitle = (a, b) => a.title.localeCompare(b.title, CONFIG.locale, { sensitivity: 'base' });
  if (sort === 'recent') return items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  if (sort === 'value') return items.sort((a, b) => (itemValue(b, logs) ?? -1) - (itemValue(a, logs) ?? -1) || byTitle(a, b));
  return items.sort(byTitle);
}

export async function renderCollection(params, ctx) {
  const [all, logs, collections] = await Promise.all([db.getAll('items'), db.getAll('priceLog'), db.getAll('collections')]);
  if (!ctx.isCurrent()) return;
  setActiveTab('collection');
  const root = view();
  root.replaceChildren(clone('tpl-collection'));

  const t = totals(all, logs);
  root.querySelector('[data-total="count"]').textContent = String(t.count);
  root.querySelector('[data-total="paid"]').textContent = formatPence(t.paid);
  root.querySelector('[data-total="value"]').textContent = formatPence(t.value);
  const unpriced = root.querySelector('[data-total="unpriced"]');
  if (t.unpriced) {
    unpriced.hidden = false;
    unpriced.textContent = `${plural(t.unpriced, 'item')} with no price or estimate (not counted in value).`;
  }

  const search = root.querySelector('#search');
  const format = root.querySelector('#filter-format');
  const sort = root.querySelector('#sort');
  fillSelect(format, CONFIG.formats);
  search.value = listState.search;
  format.value = listState.format;
  sort.value = listState.sort;
  const collFilter = root.querySelector('#filter-collection');
  collFilter.hidden = collections.length === 0;
  for (const c of [...collections].sort((a, b) => a.name.localeCompare(b.name, CONFIG.locale))) collFilter.append(new Option(c.name, c.id));
  if (!collections.some((c) => c.id === listState.collection) && listState.collection !== '__none') listState.collection = '';
  collFilter.value = listState.collection;
  const inCollection = (item) => {
    if (!listState.collection) return true;
    if (listState.collection === '__none') return !collections.some((c) => c.entries.some((e) => matches(e, item)));
    const c = collections.find((x) => x.id === listState.collection);
    return c.entries.some((e) => matches(e, item));
  };

  const list = root.querySelector('#item-list');
  const empty = root.querySelector('#empty');

  const draw = () => {
    const shown = sortItems(
      all.filter((i) => matchesSearch(i, listState.search) && (!listState.format || i.format === listState.format) && inCollection(i)),
      listState.sort, logs,
    );
    list.replaceChildren(...shown.map((item) => {
      const row = clone('tpl-item-row');
      const a = row.querySelector('a');
      a.href = `#/item/${encodeURIComponent(item.id)}`;
      a.prepend(poster(item.posterPath));
      row.querySelector('.title').textContent = titleYear(item);
      row.querySelector('.meta').textContent = [
        item.format,
        item.packaging && item.packaging !== 'Standard' ? item.packaging : '',
        item.region && item.region !== 'Unknown' ? item.region : '',
        item.distributor,
      ].filter(Boolean).join(' · ');
      row.querySelector('.value').textContent = formatPence(itemValue(item, logs));
      return row;
    }));
    empty.hidden = all.length > 0;
    if (all.length && !shown.length) list.append(el('li', { className: 'empty', textContent: 'No items match your search.' }));
  };

  search.addEventListener('input', () => { listState.search = search.value.trim(); draw(); });
  format.addEventListener('change', () => { listState.format = format.value; draw(); });
  sort.addEventListener('change', () => { listState.sort = sort.value; draw(); });
  collFilter.addEventListener('change', () => { listState.collection = collFilter.value; draw(); });
  draw();
}
