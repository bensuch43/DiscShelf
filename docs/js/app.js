// DiscShelf UI: hash router + views. User data is only ever written with
// textContent/value (never innerHTML) so stored titles can't inject markup.
import { CONFIG } from './config.js';
import * as db from './db.js';
import { parsePounds, formatPence, penceToInput } from './money.js';
import { validateBarcode, normaliseBarcode } from './ean.js';
import { itemValue, totals } from './value.js';
import { buildBackup, backupFileName, validateBackup } from './backup.js';

const view = document.getElementById('view');
const banners = document.getElementById('banners');
const conditionLabel = Object.fromEntries(CONFIG.conditions.map((c) => [c.id, c.label]));

// ---------- helpers ----------
const clone = (id) => document.getElementById(id).content.cloneNode(true);
const nowIso = () => new Date().toISOString();
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function fillSelect(select, values, { blank } = {}) {
  if (blank !== undefined) select.append(new Option(blank, ''));
  for (const v of values) {
    const [value, label] = typeof v === 'string' ? [v, v] : [v.id, v.label];
    select.append(new Option(label, value));
  }
}

let toastTimer;
function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

function setActiveTab(name) {
  document.querySelectorAll('.tabbar a').forEach((a) => {
    a.toggleAttribute('aria-current', a.dataset.tab === name);
  });
}

function showBanner(id, text, actionLabel, onAction) {
  if (document.getElementById(id)) return;
  const div = document.createElement('div');
  div.className = 'banner';
  div.id = id;
  const span = document.createElement('span');
  span.textContent = text;
  div.append(span);
  if (actionLabel) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = actionLabel;
    btn.addEventListener('click', onAction);
    div.append(btn);
  }
  banners.append(div);
}
const hideBanner = (id) => document.getElementById(id)?.remove();

// ---------- render guard ----------
// Each navigation gets a sequence number. Renders load their data first and
// only touch the DOM if they're still the latest navigation, so a slow render
// can't overwrite the page the user has already moved to.
let routeSeq = 0;
const isCurrent = (seq) => seq === routeSeq;

// ---------- collection ----------
const listState = { search: '', format: '', sort: 'title' };

function matches(item, q) {
  if (!q) return true;
  const hay = [item.title, item.ean, item.distributor, item.edition, item.year].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every((t) => hay.includes(t));
}

function sortItems(items, sort) {
  const byTitle = (a, b) => a.title.localeCompare(b.title, CONFIG.locale, { sensitivity: 'base' });
  if (sort === 'recent') return items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  if (sort === 'value') return items.sort((a, b) => (itemValue(b) ?? -1) - (itemValue(a) ?? -1) || byTitle(a, b));
  return items.sort(byTitle);
}

async function renderCollection(seq) {
  const all = await db.getAll('items');
  if (!isCurrent(seq)) return;
  setActiveTab('collection');
  view.replaceChildren(clone('tpl-collection'));

  const t = totals(all);
  view.querySelector('[data-total="count"]').textContent = String(t.count);
  view.querySelector('[data-total="paid"]').textContent = formatPence(t.paid);
  view.querySelector('[data-total="value"]').textContent = formatPence(t.value);
  const unpriced = view.querySelector('[data-total="unpriced"]');
  if (t.unpriced) {
    unpriced.hidden = false;
    unpriced.textContent = `${t.unpriced} item${t.unpriced === 1 ? '' : 's'} with no price or estimate (not counted in value).`;
  }

  const search = view.querySelector('#search');
  const format = view.querySelector('#filter-format');
  const sort = view.querySelector('#sort');
  fillSelect(format, CONFIG.formats);
  search.value = listState.search;
  format.value = listState.format;
  sort.value = listState.sort;

  const list = view.querySelector('#item-list');
  const empty = view.querySelector('#empty');

  const draw = () => {
    const shown = sortItems(
      all.filter((i) => matches(i, listState.search) && (!listState.format || i.format === listState.format)),
      listState.sort,
    );
    list.replaceChildren(...shown.map((item) => {
      const row = clone('tpl-item-row');
      const a = row.querySelector('a');
      a.href = `#/item/${encodeURIComponent(item.id)}`;
      row.querySelector('.title').textContent = item.year ? `${item.title} (${item.year})` : item.title;
      row.querySelector('.meta').textContent = [
        item.format,
        item.packaging && item.packaging !== 'Standard' ? item.packaging : '',
        item.region && item.region !== 'Unknown' ? item.region : '',
        item.distributor,
      ].filter(Boolean).join(' · ');
      row.querySelector('.value').textContent = formatPence(itemValue(item));
      return row;
    }));
    empty.hidden = all.length > 0;
    if (all.length && !shown.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No items match your search.';
      list.append(li);
    }
  };

  search.addEventListener('input', () => { listState.search = search.value.trim(); draw(); });
  format.addEventListener('change', () => { listState.format = format.value; draw(); });
  sort.addEventListener('change', () => { listState.sort = sort.value; draw(); });
  draw();
}

// ---------- add / edit ----------
async function renderItemForm(id, seq) {
  const all = await db.getAll('items');
  const existing = id ? await db.get('items', id) : null;
  if (!isCurrent(seq)) return;
  if (id && !existing) { toast('That item no longer exists.'); location.hash = '#/collection'; return; }
  setActiveTab(id ? 'collection' : 'add');
  view.replaceChildren(clone('tpl-item-form'));
  const form = view.querySelector('#item-form');
  const f = form.elements;
  fillSelect(f.format, CONFIG.formats);
  fillSelect(f.packaging, CONFIG.packaging);
  fillSelect(f.region, CONFIG.regions);
  fillSelect(f.condition, CONFIG.conditions, { blank: 'Not recorded' });

  const distributors = [...new Set(all.map((i) => i.distributor).filter(Boolean))].sort();
  view.querySelector('#distributors').replaceChildren(...distributors.map((d) => new Option(d)));

  if (existing) {
    view.querySelector('[data-heading]').textContent = 'Edit disc';
    for (const key of ['title', 'year', 'discCount', 'ean', 'format', 'packaging', 'region', 'condition',
      'distributor', 'edition', 'purchasedFrom', 'purchasedOn', 'notes']) {
      if (existing[key] != null) f[key].value = String(existing[key]);
    }
    f.pricePaid.value = penceToInput(existing.pricePaid);
    f.estimatedValue.value = penceToInput(existing.estimatedValue);
    const del = form.querySelector('[data-action="delete"]');
    del.hidden = false;
    del.addEventListener('click', async () => {
      if (!confirm(`Delete "${existing.title}"? This can't be undone (except from a backup).`)) return;
      await db.remove('items', existing.id);
      toast('Deleted.');
      location.hash = '#/collection';
    });
  } else {
    // New items: region follows format until the user picks one themselves.
    let regionTouched = false;
    const applyDefaultRegion = () => {
      if (!regionTouched) f.region.value = CONFIG.defaultRegionByFormat[f.format.value] || 'Unknown';
    };
    f.region.addEventListener('change', () => { regionTouched = true; });
    f.format.addEventListener('change', applyDefaultRegion);
    applyDefaultRegion();
  }

  const eanNote = form.querySelector('[data-note="ean"]');
  const checkEan = () => {
    const result = validateBarcode(f.ean.value);
    const dupes = result.code ? all.filter((i) => i.ean === result.code && i.id !== existing?.id) : [];
    const notes = [];
    if (!result.ok && result.reason === 'length') notes.push('Barcodes are usually 8, 12 or 13 digits. Check the number.');
    if (!result.ok && result.reason === 'checksum') notes.push('The check digit doesn\'t match. Check for a typo (you can still save).');
    if (dupes.length) notes.push(`You already have ${dupes.length} item${dupes.length === 1 ? '' : 's'} with this barcode.`);
    eanNote.textContent = notes.join(' ');
    eanNote.hidden = notes.length === 0;
  };
  f.ean.addEventListener('input', checkEan);
  if (existing) checkEan();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorEl = form.querySelector('[data-error]');
    const errors = [];
    const title = f.title.value.trim();
    if (!title) errors.push('Enter a title.');
    const year = f.year.value.trim();
    const maxYear = new Date().getFullYear() + 2;
    if (year && (!/^\d{4}$/.test(year) || +year < 1888 || +year > maxYear)) errors.push(`Year must be between 1888 and ${maxYear}.`);
    const discCount = f.discCount.value.trim();
    if (discCount && !/^\d{1,3}$/.test(discCount)) errors.push('Discs must be a whole number.');
    const pricePaid = parsePounds(f.pricePaid.value);
    const estimatedValue = parsePounds(f.estimatedValue.value);
    if (Number.isNaN(pricePaid)) errors.push('Price paid must be an amount like 12.99.');
    if (Number.isNaN(estimatedValue)) errors.push('Estimated value must be an amount like 12.99.');
    if (errors.length) {
      errorEl.textContent = errors.join(' ');
      errorEl.hidden = false;
      if (!title) f.title.focus(); else errorEl.scrollIntoView({ block: 'center' });
      return;
    }
    const text = (name) => f[name].value.trim() || null;
    const now = nowIso();
    const item = {
      ...(existing || {}),
      id: existing?.id || newId(),
      title,
      year: year ? +year : null,
      discCount: discCount ? +discCount : null,
      ean: normaliseBarcode(f.ean.value) || null,
      format: f.format.value,
      packaging: f.packaging.value,
      region: f.region.value,
      condition: f.condition.value || null,
      distributor: text('distributor'),
      edition: text('edition'),
      pricePaid,
      estimatedValue,
      purchasedFrom: text('purchasedFrom'),
      purchasedOn: f.purchasedOn.value || null,
      notes: text('notes'),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    await db.put('items', item);
    toast(existing ? 'Saved.' : `Added "${title}".`);
    location.hash = '#/collection';
  });

  f.title.focus();
}

// ---------- settings: backup / restore / storage ----------
async function renderSettings(seq) {
  const lastBackup = await db.getMeta('lastBackupAt');
  const canReport = !!navigator.storage?.persisted;
  const persisted = canReport ? await navigator.storage.persisted() : false;
  const est = canReport && navigator.storage.estimate ? await navigator.storage.estimate() : null;
  if (!isCurrent(seq)) return;
  setActiveTab('settings');
  view.replaceChildren(clone('tpl-settings'));
  view.querySelector('[data-field="version"]').textContent = `v${CONFIG.version}`;

  view.querySelector('[data-field="lastBackup"]').textContent = lastBackup
    ? new Date(lastBackup).toLocaleString(CONFIG.locale, { dateStyle: 'medium', timeStyle: 'short' })
    : 'never';

  const makeFile = async () => {
    const data = await buildBackup();
    return new File([JSON.stringify(data, null, 2)], backupFileName(), { type: 'application/json' });
  };
  const markBackedUp = async () => {
    await db.setMeta('lastBackupAt', nowIso());
    hideBanner('backup-reminder');
  };

  view.querySelector('[data-action="download-backup"]').addEventListener('click', async () => {
    const file = await makeFile();
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    await markBackedUp();
    toast('Backup downloaded.');
    route();
  });

  const shareBtn = view.querySelector('[data-action="share-backup"]');
  const probe = new File(['{}'], 'probe.json', { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [probe] })) {
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', async () => {
      try {
        await navigator.share({ files: [await makeFile()], title: 'DiscShelf backup' });
        await markBackedUp();
        route();
      } catch (err) {
        if (err.name !== 'AbortError') toast(`Share failed: ${err.message}`);
      }
    });
  }

  view.querySelector('[data-action="restore"]').addEventListener('click', async () => {
    const errorEl = view.querySelectorAll('[data-error]')[0];
    errorEl.hidden = true;
    const file = view.querySelector('[data-field="restoreFile"]').files[0];
    const mode = view.querySelector('input[name="restoreMode"]:checked').value;
    if (!file) { errorEl.textContent = 'Choose a backup file first.'; errorEl.hidden = false; return; }
    let data;
    try { data = JSON.parse(await file.text()); } catch {
      errorEl.textContent = 'That file isn\'t valid JSON.'; errorEl.hidden = false; return;
    }
    const problems = validateBackup(data);
    if (problems.length) { errorEl.textContent = problems.join(' '); errorEl.hidden = false; return; }
    const n = (data.items || []).length;
    if (mode === 'replace') {
      if (!confirm(`Replace everything on this device with ${n} item${n === 1 ? '' : 's'} from the backup?`)) return;
      await db.replaceAll(data);
      toast(`Restored ${n} item${n === 1 ? '' : 's'}.`);
    } else {
      const c = await db.mergeAll(data);
      toast(`Merged: ${c.added} added, ${c.updated} updated, ${c.kept} unchanged.`);
    }
    location.hash = '#/collection';
  });

  const status = view.querySelector('[data-field="storageStatus"]');
  const persistBtn = view.querySelector('[data-action="persist"]');
  if (!canReport) {
    status.textContent = 'This browser doesn\'t report storage status. Keep regular backups.';
  } else {
    const used = est?.usage != null ? ` Using about ${(est.usage / 1024 / 1024).toFixed(1)} MB.` : '';
    status.textContent = (persisted
      ? 'Persistent storage is on: the browser shouldn\'t clear your data automatically.'
      : 'Persistent storage is off: the browser may clear data if space runs low or the app goes unused.') + used;
    persistBtn.hidden = persisted;
    persistBtn.addEventListener('click', async () => {
      const ok = await navigator.storage.persist();
      toast(ok ? 'Persistent storage granted.' : 'The browser declined. Installing to the Home Screen usually helps.');
      route();
    });
  }
}

// ---------- router ----------
async function route() {
  routeSeq += 1;
  const seq = routeSeq;
  const hash = location.hash || '#/collection';
  const [, page, param] = hash.split('/');
  try {
    if (page === 'add') await renderItemForm(null, seq);
    else if (page === 'item' && param) await renderItemForm(decodeURIComponent(param), seq);
    else if (page === 'settings') await renderSettings(seq);
    else await renderCollection(seq);
  } catch (err) {
    console.error(err);
    if (!isCurrent(seq)) return;
    view.replaceChildren(Object.assign(document.createElement('p'), { className: 'error', textContent: `Something went wrong: ${err.message}` }));
  }
  if (isCurrent(seq)) window.scrollTo(0, 0);
}

// ---------- startup ----------
async function checkBackupReminder() {
  const items = await db.getAll('items');
  if (!items.length) return;
  const last = await db.getMeta('lastBackupAt');
  const days = last ? (Date.now() - new Date(last).getTime()) / 86400000 : Infinity;
  if (days > CONFIG.backupReminderDays) {
    showBanner('backup-reminder', last ? `No backup for ${Math.floor(days)} days.` : 'You haven\'t made a backup yet.',
      'Back up', () => { location.hash = '#/settings'; });
  }
}

function watchConnectivity() {
  const badge = document.getElementById('offline-badge');
  const update = () => { badge.hidden = navigator.onLine; };
  addEventListener('online', update);
  addEventListener('offline', update);
  update();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Reload only when the user asked for the update. On first visit the worker
  // claims the page (controllerchange fires) and we must NOT reload then, or
  // half-typed forms would be lost.
  let updateRequested = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateRequested) return;
    updateRequested = false;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offerUpdate = (worker) => showBanner('update-ready', 'A new version is ready.', 'Reload', () => {
      updateRequested = true;
      worker.postMessage('SKIP_WAITING');
    });
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
      });
    });
  }).catch((err) => console.warn('Service worker registration failed', err));
}

addEventListener('hashchange', route);
watchConnectivity();
registerServiceWorker();
route().then(checkBackupReminder);
