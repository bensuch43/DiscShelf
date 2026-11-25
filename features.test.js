import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { cheapest, eligibleLogs, latestLoggedFor, isStale, logTotal } from './prices.js';
import { valueDetail, totals } from './value.js';
import { cleanTitle, parseTmdbListId } from './lookup.js';
import { toCsv, parseCsv, collectionCsv, itemsFromCsv, wantsCsv } from './csv.js';
import { snapshotFrom, encodeSnapshot, decodeSnapshot, collectionText, wantsText } from './share.js';
import { CONFIG } from './config.js';

const want = { id: 'w1', title: 'Heat', wantedCondition: 'very-good', targetPrice: 1500 };
const logs = [
  { id: 'a', wantId: 'w1', ean: '5039036', retailer: 'CeX', price: 800, postage: 0, condition: 'good', seenOn: '2026-11-20' },
  { id: 'b', wantId: 'w1', ean: '5039036', retailer: 'eBay UK', price: 900, postage: 250, condition: 'like-new', seenOn: '2026-11-18' },
  { id: 'c', wantId: 'w1', ean: '5039036', retailer: 'Zavvi', price: 1199, postage: 0, condition: 'new', seenOn: '2026-11-22' },
  { id: 'd', wantId: 'other', retailer: 'Amazon UK', price: 100, postage: 0, condition: 'new', seenOn: '2026-11-22' },
];

test('cheapest respects wanted condition or better, includes postage, ignores other wants', () => {
  assert.deepEqual(eligibleLogs(want, logs).map((l) => l.id), ['b', 'c']);
  assert.equal(cheapest(want, logs).id, 'b'); // 900+250 = 1150 < 1199
  assert.equal(logTotal(logs[1]), 1150);
  assert.equal(cheapest({ ...want, wantedCondition: 'good' }, logs).id, 'a');
  assert.equal(cheapest({ ...want, wantedCondition: 'new' }, logs).id, 'c');
  assert.equal(cheapest({ id: 'none', wantedCondition: 'good' }, logs), null);
});

test('cheapest tie goes to the most recent sighting', () => {
  const tie = [
    { id: 'old', wantId: 'w', price: 500, postage: 0, condition: 'new', seenOn: '2026-01-01' },
    { id: 'new', wantId: 'w', price: 500, postage: 0, condition: 'new', seenOn: '2026-02-01' },
  ];
  assert.equal(cheapest({ id: 'w', wantedCondition: 'good' }, tie).id, 'new');
});

test('stale prices are flagged after the configured days', () => {
  const now = new Date('2026-11-24T12:00:00');
  assert.equal(isStale({ seenOn: '2026-11-20' }, now), false);
  assert.equal(isStale({ seenOn: '2026-09-01' }, now), true);
});

test('value precedence: estimate, then latest logged (same barcode/condition), then paid', () => {
  const item = { ean: '5039036', condition: 'new', pricePaid: 500, estimatedValue: null };
  assert.deepEqual(valueDetail(item, logs).source, 'logged');
  assert.equal(valueDetail(item, logs).value, 1199);
  assert.equal(valueDetail({ ...item, estimatedValue: 2000 }, logs).source, 'estimate');
  assert.equal(valueDetail({ ...item, ean: null }, logs).source, 'paid');
  // No condition recorded: latest log of any condition for that barcode.
  assert.equal(latestLoggedFor({ ean: '5039036' }, logs).id, 'c');
  // Condition recorded but no matching log: falls back to paid.
  assert.equal(valueDetail({ ...item, condition: 'acceptable' }, logs).source, 'paid');
  assert.deepEqual(totals([item, { pricePaid: 100 }], logs), { count: 2, paid: 600, value: 1299, unpriced: 0 });
});

test('cleanTitle strips retail noise', () => {
  assert.equal(cleanTitle('Man Of Steel (blu-ray Disc)'), 'Man Of Steel');
  assert.equal(cleanTitle('Edge of Tomorrow [4K Ultra HD] [2014] [Region Free]'), 'Edge of Tomorrow');
  assert.equal(cleanTitle('The Crow - Limited Edition 4K Steelbook'), 'The Crow');
  assert.equal(cleanTitle('Heat (Director\'s Definitive Edition) Blu-ray + Digital'), 'Heat');
  assert.equal(cleanTitle('Casablanca'), 'Casablanca');
});

test('CSV quotes, guards formulas, and parses back', () => {
  const csv = toCsv([{ header: 'A', get: (r) => r.a }, { header: 'B', get: (r) => r.b }], [
    { a: 'Hello, "world"', b: '=HYPERLINK("x")' },
    { a: 'Line\nbreak', b: null },
  ]);
  assert.ok(csv.startsWith('﻿A,B\r\n'));
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  assert.deepEqual(parseCsv(csv), [['A', 'B'], ['Hello, "world"', '\'=HYPERLINK("x")'], ['Line\nbreak', '']]);
});

test('collection CSV round-trips through import', () => {
  const items = [{
    id: '1', title: 'Man of Steel', year: 2013, ean: '5051892145329', format: 'Blu-ray', packaging: 'Steelbook',
    region: 'Blu-ray B', condition: 'very-good', distributor: 'Warner', edition: 'Zavvi exclusive', discCount: 2,
    pricePaid: 1250, estimatedValue: 2400, purchasedFrom: 'CeX', purchasedOn: '2026-11-01', notes: 'Shelf A, =not a formula', tmdbId: 49521,
  }];
  const csv = collectionCsv(items, []);
  let n = 0;
  const { items: back, skipped } = itemsFromCsv(csv, { newId: () => `n${++n}`, now: 'X' });
  assert.equal(skipped, 0);
  const { id, createdAt, updatedAt, ...rest } = back[0];
  const { id: _i, ...orig } = items[0];
  assert.deepEqual(rest, orig);
});

test('import accepts minimal CSVs and skips untitled rows', () => {
  const { items, skipped, unknownHeaders } = itemsFromCsv('title,EAN,Price paid,Shelf\nAlien,5039036000000,£3.50,B\n,123,1,\n', { newId: () => 'x' });
  assert.equal(items.length, 1);
  assert.equal(skipped, 1);
  assert.equal(items[0].pricePaid, 350);
  assert.equal(items[0].ean, '5039036000000');
  assert.deepEqual(unknownHeaders, ['Shelf']);
});

test('wants CSV includes cheapest eligible price', () => {
  const csv = wantsCsv([want], logs);
  assert.ok(csv.includes('11.50,eBay UK,2026-11-18'), csv);
});

test('share snapshot round-trips (compressed)', async () => {
  const snap = snapshotFrom('wants', [want]);
  const payload = await encodeSnapshot(snap);
  assert.equal(payload[0], 'z');
  assert.match(payload, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(await decodeSnapshot(payload), snap);
  await assert.rejects(decodeSnapshot('zgarbage!!'));
});

test('text lists group and summarise', () => {
  const text = collectionText([{ title: 'B', format: 'DVD' }, { title: 'A', format: 'DVD', year: 1999, packaging: 'Steelbook' }]);
  assert.equal(text, 'My disc collection (2)\n\nDVD (2)\n- A (1999) [Steelbook]\n- B');
  assert.match(wantsText([want], logs), /Heat: Very good or better, target £15\.00, best seen £11\.50 at eBay UK/);
});

test('service worker precaches every app file in the folder', () => {
  const sw = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
  const dev = /\.(test|spec)\.js$|^(e2e-helpers|playwright\.config|sw)\.js$/;
  const appFiles = readdirSync(new URL('./', import.meta.url))
    .filter((f) => /\.(js|css|png|webmanifest)$/.test(f) && !dev.test(f));
  assert.ok(appFiles.length > 25);
  for (const f of appFiles) assert.ok(sw.includes(`'./${f}'`), `sw.js precache missing ${f}`);
  // Every precached file exists (a missing one would break offline install).
  for (const [, f] of sw.matchAll(/'\.\/([^']+)'/g)) if (f) assert.ok(appFiles.includes(f) || ['index.html', 'ZXING-LICENSE.txt'].includes(f), `sw.js lists missing file ${f}`);
});

test('every retailer URL has a {q} placeholder and is https; barcode flags as tested', () => {
  assert.deepEqual(CONFIG.retailers.filter((r) => r.barcode).map((r) => r.id), ['ebay', 'amazon', 'cex']);
  assert.ok(!CONFIG.retailers.some((r) => r.id === 'zavvi'));
  for (const r of CONFIG.retailers) {
    assert.equal(typeof r.barcode, 'boolean', r.id);
    assert.ok(r.url.startsWith('https://'), r.id);
    assert.equal(r.url.split('{q}').length, 2, r.id);
  }
});

test('CSP allows exactly the configured external hosts', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /connect-src 'self' https:\/\/api\.themoviedb\.org;/);
  assert.match(csp, /img-src 'self' data: blob: https:\/\/image\.tmdb\.org;/);
  assert.ok(CONFIG.tmdb.apiBase.startsWith('https://api.themoviedb.org/'));
  assert.ok(!csp.includes('upcitemdb'), 'UPCitemdb was removed in 0.5.0');
  assert.ok(!csp.includes('unsafe'));
});

test('parseTmdbListId accepts links and bare ids', () => {
  assert.equal(parseTmdbListId('https://www.themoviedb.org/list/8136-disney-classics'), '8136');
  assert.equal(parseTmdbListId('https://www.themoviedb.org/u/someone/list/42?language=en-GB'), null);
  assert.equal(parseTmdbListId('themoviedb.org/list/42'), '42');
  assert.equal(parseTmdbListId(' 77 '), '77');
  assert.equal(parseTmdbListId('disney'), null);
});
