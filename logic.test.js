import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePounds, formatPence, penceToInput } from './money.js';
import { validateBarcode, normaliseBarcode } from './ean.js';
import { itemValue, totals } from './value.js';
import { validateBackup, backupFileName, BACKUP_FORMAT } from './backup.js';
import { CONFIG } from './config.js';

test('parsePounds handles £, commas, decimals and blanks', () => {
  assert.equal(parsePounds('£12.50'), 1250);
  assert.equal(parsePounds('12.5'), 1250);
  assert.equal(parsePounds('1,299'), 129900);
  assert.equal(parsePounds('0.99'), 99);
  assert.equal(parsePounds(''), null);
  assert.equal(parsePounds('  '), null);
  assert.ok(Number.isNaN(parsePounds('12.999')));
  assert.ok(Number.isNaN(parsePounds('abc')));
  assert.ok(Number.isNaN(parsePounds('-5')));
});

test('formatPence uses GBP en-GB', () => {
  assert.equal(formatPence(1250), '£12.50');
  assert.equal(formatPence(129900), '£1,299.00');
  assert.equal(formatPence(null), '—');
  assert.equal(penceToInput(99), '0.99');
  assert.equal(penceToInput(null), '');
});

test('validateBarcode accepts real UK EANs and flags typos', () => {
  // Real UK barcodes found during research (HMV / 45worlds listings).
  for (const ean of ['5051892145329', '5051892239677', '5050629604047', '5037899095003']) {
    assert.equal(validateBarcode(ean).ok, true, ean);
  }
  assert.equal(validateBarcode('5051892145328').reason, 'checksum');
  assert.equal(validateBarcode('5051892145328').expected, 9);
  assert.equal(validateBarcode('12345').reason, 'length');
  assert.equal(validateBarcode('').empty, true);
  assert.equal(normaliseBarcode('5 051892 145329'), '5051892145329');
  assert.equal(validateBarcode('036000291452').ok, true); // UPC-A
});

test('value uses estimate, then price paid', () => {
  assert.equal(itemValue({ pricePaid: 1000, estimatedValue: 1500 }), 1500);
  assert.equal(itemValue({ pricePaid: 1000, estimatedValue: null }), 1000);
  assert.equal(itemValue({ pricePaid: null, estimatedValue: null }), null);
  assert.deepEqual(
    totals([{ pricePaid: 1000, estimatedValue: 1500 }, { pricePaid: 500 }, { pricePaid: null }]),
    { count: 3, paid: 1500, value: 2000, unpriced: 1 },
  );
});

test('validateBackup rejects bad files', () => {
  assert.deepEqual(validateBackup({ format: BACKUP_FORMAT, schema: 1, items: [{ id: 'a', title: 'X' }] }), []);
  assert.ok(validateBackup(null).length);
  assert.ok(validateBackup({ format: 'other', schema: 1 }).length);
  assert.ok(validateBackup({ format: BACKUP_FORMAT, schema: 99 }).length);
  assert.ok(validateBackup({ format: BACKUP_FORMAT, schema: 1, items: [{ id: 'a' }] }).length);
  assert.ok(validateBackup({ format: BACKUP_FORMAT, schema: 1, items: 'nope' }).length);
});

test('backup file name is sortable', () => {
  assert.equal(backupFileName(new Date('2026-11-24T17:05:00Z')), 'discshelf-backup-20261124-1705.json');
});

test('service worker VERSION matches CONFIG.version and precaches every module', () => {
  const sw = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
  assert.equal(sw.match(/const VERSION = '([^']+)'/)[1], CONFIG.version);
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, CONFIG.version);
});
