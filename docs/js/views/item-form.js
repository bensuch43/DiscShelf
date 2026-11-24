import { CONFIG } from '../config.js';
import * as db from '../db.js';
import { parsePounds, formatPence, penceToInput } from '../money.js';
import { validateBarcode, normaliseBarcode } from '../ean.js';
import { valueDetail } from '../value.js';
import { formatDate } from '../ui.js';
import { clone, view, setActiveTab, fillSelect, toast, nowIso, newId, poster, plural } from '../ui.js';
import { wireLookup } from './lookup-panel.js';

const TEXT_FIELDS = ['title', 'year', 'discCount', 'ean', 'format', 'packaging', 'region', 'condition',
  'distributor', 'edition', 'purchasedFrom', 'purchasedOn', 'notes'];

export async function renderItemForm({ id }, ctx) {
  const [all, logs] = await Promise.all([db.getAll('items'), db.getAll('priceLog')]);
  const existing = id ? await db.get('items', id) : null;
  if (!ctx.isCurrent()) return;
  if (id && !existing) { toast('That item no longer exists.'); location.hash = '#/collection'; return; }
  setActiveTab(id ? 'collection' : 'add');
  const root = view();
  root.replaceChildren(clone('tpl-item-form'));
  const form = root.querySelector('#item-form');
  const f = form.elements;
  fillSelect(f.format, CONFIG.formats);
  fillSelect(f.packaging, CONFIG.packaging);
  fillSelect(f.region, CONFIG.regions);
  fillSelect(f.condition, CONFIG.conditions, { blank: 'Not recorded' });

  const distributors = [...new Set(all.map((i) => i.distributor).filter(Boolean))].sort();
  root.querySelector('#distributors').replaceChildren(...distributors.map((d) => new Option(d)));

  // Fields not shown as inputs (filled by TMDB lookups).
  const extra = { tmdbId: existing?.tmdbId ?? null, posterPath: existing?.posterPath ?? null, mediaType: existing?.mediaType ?? null };
  const posterSlot = form.querySelector('[data-slot="poster"]');
  const showPoster = (path) => { posterSlot.replaceChildren(path ? poster(path, CONFIG.tmdb.posterSize) : ''); posterSlot.hidden = !path; };
  showPoster(extra.posterPath);

  if (existing) {
    form.querySelector('[data-heading]').textContent = 'Edit disc';
    for (const key of TEXT_FIELDS) if (existing[key] != null) f[key].value = String(existing[key]);
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
    const detail = valueDetail(existing, logs);
    const note = form.querySelector('[data-note="value"]');
    note.hidden = false;
    note.textContent = {
      estimate: `Valued at ${formatPence(detail.value)} from your estimate.`,
      logged: detail.log ? `Valued at ${formatPence(detail.value)} from a price you logged at ${detail.log.retailer} on ${formatDate(detail.log.seenOn)}. Enter an estimate to override.` : '',
      paid: `Valued at ${formatPence(detail.value)}, what you paid. Log prices on a want with this barcode, or enter an estimate, to change it.`,
    }[detail.source] || 'No value yet: add a price paid or an estimate.';
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
    if (dupes.length) notes.push(`You already have ${plural(dupes.length, 'item')} with this barcode.`);
    eanNote.textContent = notes.join(' ');
    eanNote.hidden = notes.length === 0;
  };
  f.ean.addEventListener('input', checkEan);
  if (existing) checkEan();

  wireLookup(form, extra, { onPosterChange: showPoster });

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
      ...extra,
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

  if (!existing) f.title.focus();
}
