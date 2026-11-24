// CSV export/import (RFC 4180). Exports carry a UTF-8 BOM and CRLF so Excel
// opens them cleanly; text cells starting with = + - @ are prefixed with '
// to stop spreadsheet formula injection.
import { CONFIG } from './config.js';
import { penceToInput, parsePounds } from './money.js';
import { normaliseBarcode } from './ean.js';
import { conditionLabel, cheapest, logTotal } from './prices.js';
import { itemValue } from './value.js';

function cell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns, rows) {
  const lines = [columns.map((c) => cell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(c.get(row))).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') inQuotes = false; else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  return rows;
}

const pounds = (p) => penceToInput(p);

export const COLLECTION_COLUMNS = [
  { header: 'Title', field: 'title', get: (i) => i.title },
  { header: 'Year', field: 'year', get: (i) => i.year },
  { header: 'Barcode', field: 'ean', get: (i) => i.ean },
  { header: 'Format', field: 'format', get: (i) => i.format },
  { header: 'Packaging', field: 'packaging', get: (i) => i.packaging },
  { header: 'Region', field: 'region', get: (i) => i.region },
  { header: 'Condition', field: 'condition', get: (i) => (i.condition ? conditionLabel(i.condition) : '') },
  { header: 'Distributor', field: 'distributor', get: (i) => i.distributor },
  { header: 'Edition', field: 'edition', get: (i) => i.edition },
  { header: 'Discs', field: 'discCount', get: (i) => i.discCount },
  { header: 'Price paid (GBP)', field: 'pricePaid', get: (i) => pounds(i.pricePaid) },
  { header: 'Estimated value (GBP)', field: 'estimatedValue', get: (i) => pounds(i.estimatedValue) },
  { header: 'Value (GBP)', get: (i, logs) => pounds(itemValue(i, logs)) },
  { header: 'Bought from', field: 'purchasedFrom', get: (i) => i.purchasedFrom },
  { header: 'Date bought', field: 'purchasedOn', get: (i) => i.purchasedOn },
  { header: 'Notes', field: 'notes', get: (i) => i.notes },
  { header: 'TMDB ID', field: 'tmdbId', get: (i) => i.tmdbId },
];

export function collectionCsv(items, logs) {
  const cols = COLLECTION_COLUMNS.map((c) => ({ header: c.header, get: (i) => c.get(i, logs) }));
  return toCsv(cols, items);
}

export function wantsCsv(wants, logs) {
  const cols = [
    { header: 'Title', get: (w) => w.title },
    { header: 'Year', get: (w) => w.year },
    { header: 'Barcode', get: (w) => w.ean },
    { header: 'Format', get: (w) => w.format },
    { header: 'Packaging', get: (w) => w.packaging },
    { header: 'Edition', get: (w) => w.edition },
    { header: 'Wanted condition (or better)', get: (w) => conditionLabel(w.wantedCondition) },
    { header: 'Target price (GBP)', get: (w) => pounds(w.targetPrice) },
    { header: 'Cheapest found (GBP, incl. postage)', get: (w) => { const c = cheapest(w, logs); return c ? pounds(logTotal(c)) : ''; } },
    { header: 'Cheapest at', get: (w) => cheapest(w, logs)?.retailer || '' },
    { header: 'Cheapest seen on', get: (w) => cheapest(w, logs)?.seenOn || '' },
    { header: 'Status', get: (w) => (w.status === 'bought' ? 'Bought' : 'Wanted') },
    { header: 'Notes', get: (w) => w.notes },
  ];
  return toCsv(cols, wants);
}

/**
 * Turn CSV text (in DiscShelf's own export format; extra columns ignored)
 * into item records. Returns { items, skipped, unknownHeaders }.
 */
export function itemsFromCsv(text, { newId, now = new Date().toISOString() }) {
  const rows = parseCsv(text);
  if (!rows.length) return { items: [], skipped: 0, unknownHeaders: [] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const byHeader = new Map(COLLECTION_COLUMNS.filter((c) => c.field).map((c) => [c.header.toLowerCase(), c.field]));
  byHeader.set('ean', 'ean'); byHeader.set('upc', 'ean'); byHeader.set('price paid', 'pricePaid');
  const fields = header.map((h) => byHeader.get(h) || null);
  const unknownHeaders = rows[0].filter((h, i) => !fields[i] && h.trim() && h.trim().toLowerCase() !== 'value (gbp)');
  const condByText = new Map(CONFIG.conditions.flatMap((c) => [[c.id, c.id], [c.label.toLowerCase(), c.id]]));
  const items = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const raw = {};
    fields.forEach((f, i) => { if (f) raw[f] = (r[i] ?? '').trim().replace(/^'(?=[=+\-@])/, ''); });
    if (!raw.title) { skipped += 1; continue; }
    const money = (v) => { const p = parsePounds(v); return Number.isNaN(p) ? null : p; };
    const int = (v) => (/^\d+$/.test(v || '') ? Number(v) : null);
    items.push({
      id: newId(),
      title: raw.title,
      year: int(raw.year),
      ean: normaliseBarcode(raw.ean) || null,
      format: CONFIG.formats.includes(raw.format) ? raw.format : (raw.format || CONFIG.formats[0]),
      packaging: raw.packaging || 'Standard',
      region: raw.region || 'Unknown',
      condition: condByText.get((raw.condition || '').toLowerCase()) || null,
      distributor: raw.distributor || null,
      edition: raw.edition || null,
      discCount: int(raw.discCount),
      pricePaid: money(raw.pricePaid),
      estimatedValue: money(raw.estimatedValue),
      purchasedFrom: raw.purchasedFrom || null,
      purchasedOn: /^\d{4}-\d{2}-\d{2}$/.test(raw.purchasedOn || '') ? raw.purchasedOn : null,
      notes: raw.notes || null,
      tmdbId: int(raw.tmdbId),
      createdAt: now,
      updatedAt: now,
    });
  }
  return { items, skipped, unknownHeaders };
}
