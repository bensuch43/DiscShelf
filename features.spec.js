import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { mockApis, saveTmdbKey, fakeCamera } from './e2e-helpers.js';

// Fail any test that logs a console error or CSP violation.
test.beforeEach(async ({ page }, testInfo) => {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(err.message));
  testInfo.errors_ = errors;
});
test.afterEach(async ({}, testInfo) => {
  expect(testInfo.errors_, 'console errors').toEqual([]);
});

const MOS = '5051892145329';
const TMDB_MOS = [
  { id: 49521, media_type: 'movie', title: 'Man of Steel', release_date: '2013-06-12', poster_path: '/mos.jpg' },
  { id: 1, media_type: 'person', name: 'Somebody' },
  { id: 2, media_type: 'tv', name: 'Superman & Lois', first_air_date: '2021-02-23', poster_path: null },
];

test('scan a barcode with the camera, then search the title on TMDB and save', async ({ page, context }) => {
  const calls = await mockApis(context, { tmdb: TMDB_MOS });
  await fakeCamera(page, MOS);
  await saveTmdbKey(page);

  await page.goto('./#/add');
  await page.getByRole('button', { name: 'Scan barcode' }).click();
  await expect(page.getByLabel('Barcode (EAN/UPC)')).toHaveValue(MOS, { timeout: 15000 });
  await expect(page.locator('.scanner')).toHaveCount(0);
  const panel = page.locator('[data-panel="lookup"]');
  await expect(panel).toContainText(`Barcode ${MOS} captured.`);
  await expect(panel).toContainText('type the title and tap Search title');
  await expect(page.getByLabel('Title')).toBeFocused();
  expect(calls.upc).toEqual([]); // no barcode service is called any more

  await page.getByLabel('Title').fill('Man of Steel Blu-ray');
  await page.getByRole('button', { name: 'Search title' }).click();
  await expect(panel.locator('.pick')).toHaveCount(2); // people filtered out
  expect(calls.tmdbSearch).toEqual(['Man of Steel']); // retail noise stripped
  await panel.getByRole('button', { name: /Man of Steel \(2013\) · Film/ }).click();
  await expect(page.getByLabel('Year')).toHaveValue('2013');
  await expect(page.locator('[data-slot="poster"] img')).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w185/mos.jpg');
  await page.getByLabel('Format').selectOption('Blu-ray');
  await page.getByLabel('Packaging').selectOption('Steelbook');
  await page.getByRole('button', { name: 'Save' }).click();
  const row = page.locator('.item-row', { hasText: 'Man of Steel (2013)' });
  await expect(row).toContainText('Blu-ray · Steelbook · Blu-ray B');
  await expect(row.locator('img.poster')).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w92/mos.jpg');
});

test('scanning a barcode you already have says so and copies the details', async ({ page }) => {
  await fakeCamera(page, MOS);
  await page.goto('./#/wants/new');
  await page.getByLabel('Title').fill('Man of Steel');
  await page.getByLabel('Year').fill('2013');
  await page.getByLabel('Barcode (EAN/UPC)').fill(MOS);
  await page.getByLabel('Format').selectOption('Blu-ray');
  await page.getByLabel('Packaging').selectOption('Steelbook');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Man of Steel (2013)' })).toBeVisible();

  await page.goto('./#/add');
  await page.getByRole('button', { name: 'Scan barcode' }).click();
  const panel = page.locator('[data-panel="lookup"]');
  await expect(panel).toContainText('On your want list: Man of Steel (2013)', { timeout: 15000 });
  await expect(panel).toContainText('Details copied from the matching record.');
  await expect(page.getByLabel('Title')).toHaveValue('Man of Steel');
  await expect(page.getByLabel('Packaging')).toHaveValue('Steelbook');
  await expect(page.getByLabel('Region')).toHaveValue('Blu-ray B');
});

test('title search without a TMDB key explains where to add one', async ({ page }) => {
  await page.goto('./#/add');
  await page.getByRole('button', { name: 'Search title' }).click();
  const panel = page.locator('[data-panel="lookup"]');
  await expect(panel).toContainText('Type the title above');
  await page.getByLabel('Title').fill('Edge of Tomorrow');
  await page.getByRole('button', { name: 'Search title' }).click();
  await expect(panel).toContainText('Add a TMDB API key in Settings');
});

test('scanner: manual entry and cancel', async ({ page }) => {
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); }; });
  await page.goto('./#/add');
  await page.getByRole('button', { name: 'Scan barcode' }).click();
  await expect(page.locator('[data-scan-status]')).toContainText('Camera permission was refused');
  await page.getByRole('button', { name: 'Cancel' }).last().click();
  await expect(page.locator('.scanner')).toHaveCount(0);
  await expect(page.getByLabel('Barcode (EAN/UPC)')).toHaveValue('');

  // Manual entry goes through the same path, and works offline.
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Scan barcode' }).click();
  await page.getByLabel('Or type the barcode').fill('5050629604047');
  await page.getByRole('button', { name: 'Use this barcode' }).click();
  await expect(page.getByLabel('Barcode (EAN/UPC)')).toHaveValue('5050629604047');
  await expect(page.locator('[data-panel="lookup"]')).toContainText('Barcode 5050629604047 captured.');
  await page.context().setOffline(false);
});

async function addWant(page, { title, ean, format = 'Blu-ray', condition = 'Very good', target }) {
  await page.goto('./#/wants/new');
  await page.getByLabel('Title').fill(title);
  if (ean) await page.getByLabel('Barcode (EAN/UPC)').fill(ean);
  await page.getByLabel('Format').selectOption(format);
  await page.getByLabel('Wanted condition (or better)').selectOption({ label: condition });
  if (target) await page.getByLabel('Target price (£)').fill(target);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(title) })).toBeVisible();
}

async function logPrice(page, { shop, price, postage, condition, other }) {
  await page.getByLabel('Shop').selectOption(shop);
  if (other) await page.getByLabel('Retailer name').fill(other);
  await page.getByLabel('Condition').selectOption({ label: condition });
  await page.getByLabel('Price (£)').fill(price);
  await page.getByLabel('Postage (£)').fill(postage || '');
  const before = await page.locator('.history-row').count();
  await page.getByRole('button', { name: 'Log price' }).click();
  await expect(page.locator('#toast')).toContainText('Logged');
  // Wait for the detail view to re-render with the new row before the next action.
  await expect(page.locator('.history-row')).toHaveCount(before + 1);
  await expect(page.getByLabel('Price (£)')).toHaveValue('');
}

test('want list: links, price log, cheapest for condition or better, mark as bought', async ({ page }) => {
  await addWant(page, { title: 'Heat', ean: '5039036000000', target: '15' });

  // Retailer links: barcode and title for each configured shop.
  const links = page.locator('[data-field="links"] .link-row');
  await expect(links).toHaveCount(8);
  await expect(links.getByRole('link', { name: 'Barcode' })).toHaveCount(3); // eBay, Amazon, CeX only
  await expect(page.locator('[data-field="links"]')).not.toContainText('Zavvi');
  await expect(links.first().getByRole('link', { name: 'Barcode' })).toHaveAttribute('href', 'https://www.ebay.co.uk/sch/i.html?_nkw=5039036000000');
  await expect(links.first().getByRole('link', { name: 'Title' })).toHaveAttribute('href', 'https://www.ebay.co.uk/sch/i.html?_nkw=Heat%20Blu-ray');
  await expect(links.first().getByRole('link', { name: 'Title' })).toHaveAttribute('target', '_blank');

  await expect(page.locator('[data-field="cheapest"]')).toContainText('No prices logged yet');
  await logPrice(page, { shop: 'CeX', price: '8', condition: 'Good' });
  await expect(page.locator('[data-field="cheapest"]')).toContainText('None of the 1 logged price meet Very good or better');
  await logPrice(page, { shop: 'eBay UK', price: '9', postage: '2.50', condition: 'Like new' });
  await logPrice(page, { shop: 'Other', other: 'Fopp', price: '11.99', condition: 'New (sealed)' });

  const cheapestBox = page.locator('[data-field="cheapest"]');
  await expect(cheapestBox).toContainText('£11.50');
  await expect(cheapestBox).toContainText('at eBay UK, Like new, seen today');
  await expect(cheapestBox).toContainText('(£9.00 + £2.50 postage)');
  await expect(cheapestBox).toContainText('At or under your target price.');
  await expect(cheapestBox).not.toContainText('null');
  await expect(page.locator('#view')).not.toContainText(/\bnull\b|undefined|NaN/);
  await expect(page.locator('.history-row')).toHaveCount(3);
  await expect(page.locator('.history-row.ineligible')).toContainText('CeX');
  await expect(page.locator('.history-row.best')).toContainText('eBay UK');

  // Delete the eBay price: Fopp becomes cheapest.
  await page.getByRole('button', { name: /Delete price from eBay UK/ }).click();
  await expect(page.locator('#toast')).toContainText('Undo');
  await expect(cheapestBox).toContainText('£11.99');
  await expect(cheapestBox).toContainText('Fopp');

  await page.goto('./#/wants');
  const row = page.locator('.item-row', { hasText: 'Heat' });
  await expect(row).toContainText('Very good or better · Target £15.00');
  await expect(row).toContainText('Best £11.99 at Fopp · New (sealed) · today');
  await expect(row).toContainText('At or under target');
  await expect(page.locator('[data-total="under"]')).toHaveText('1 at or under target');

  await row.click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Mark as bought' }).click();
  await expect(page.getByRole('heading', { name: 'Edit disc' })).toBeVisible();
  await expect(page.getByLabel('Title')).toHaveValue('Heat');
  await expect(page.getByLabel('Price paid (£)')).toHaveValue('11.99');
  await expect(page.getByLabel('Bought from')).toHaveValue('Fopp');
  await expect(page.getByLabel('Condition')).toHaveValue('new');
  await expect(page.locator('[data-note="value"]')).toContainText('from a price you logged at Fopp');

  await page.goto('./#/wants');
  await expect(page.locator('.item-row')).toHaveCount(0);
  await page.getByLabel('Show bought').check();
  await expect(page.locator('.item-row', { hasText: 'Heat' })).toContainText('Bought');
});

test('want validation and delete removes its prices', async ({ page }) => {
  await page.goto('./#/wants/new');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('[data-error]')).toContainText('Enter a title.');
  await addWant(page, { title: 'Alien', target: '5' });
  await page.getByLabel('Price (£)').fill('abc');
  await page.getByRole('button', { name: 'Log price' }).click();
  await expect(page.locator('#log-form [data-error]')).toContainText('Enter the price');
  await logPrice(page, { shop: 'CeX', price: '4', condition: 'Very good' });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete' }).last().click();
  await expect(page).toHaveURL(/#\/wants$/);
  await expect(page.getByText('No wants yet.')).toBeVisible();
  const leftover = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('discshelf');
    r.onsuccess = () => { const g = r.result.transaction('priceLog').objectStore('priceLog').count(); g.onsuccess = () => res(g.result); };
  }));
  expect(leftover).toBe(0);
});

test('exports: collection CSV, want list CSV and text list', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => { delete Navigator.prototype.share; });
  await page.goto('./#/add');
  await page.getByLabel('Title').fill('Casablanca');
  await page.getByLabel('Price paid (£)').fill('8');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/collection$/);
  await addWant(page, { title: 'Heat', target: '15' });

  await page.goto('./#/settings');
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Collection CSV' }).click()]);
  expect(csv.suggestedFilename()).toMatch(/^discshelf-collection-\d{8}-\d{4}\.csv$/);
  const csvText = readFileSync(await csv.path(), 'utf8');
  expect(csvText.split('\r\n')[0]).toContain('Title,Year,Barcode,Format');
  expect(csvText).toContain('Casablanca,,,DVD,Standard,DVD 2,,,,,8.00,,8.00');

  const [wcsv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Want list CSV' }).click()]);
  expect(readFileSync(await wcsv.path(), 'utf8')).toContain('Heat,,,Blu-ray,Standard,,Very good,15.00,,,,Wanted');

  await page.getByRole('button', { name: 'Share want list as text' }).click();
  await expect(page.locator('#toast')).toContainText('Copied to the clipboard.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('My want list (1)\n\n- Heat: Blu-ray, Very good or better, target £15.00');
});

test('share link opens a read-only snapshot in another browser', async ({ page, browser, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await addWant(page, { title: 'Heat', target: '15', format: '4K UHD' });
  await addWant(page, { title: 'Alien <b>bold</b>', condition: 'New (sealed)' });
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Create link' }).click();
  await expect(page.getByLabel('Share link')).toHaveValue(/\/#\/shared\/z[A-Za-z0-9_-]+$/);
  const url = await page.getByLabel('Share link').inputValue();
  await expect(page.locator('[data-field="shareNote"]')).toContainText('2 wants');

  const other = await browser.newContext({ ...testInfo.project.use });
  const p2 = await other.newPage();
  await p2.goto(url);
  await expect(p2.getByRole('heading', { name: 'Shared want list' })).toBeVisible();
  await expect(p2.locator('.item-row')).toHaveCount(2);
  await expect(p2.locator('.item-row', { hasText: 'Heat' })).toContainText('4K UHD · Very good or better · target £15.00');
  await expect(p2.locator('.item-row').first()).toContainText('Alien <b>bold</b>');
  // Nothing written to the recipient's device.
  await p2.goto(new URL('./#/wants', url).toString());
  await expect(p2.getByText('No wants yet.')).toBeVisible();
  // Damaged link.
  await p2.goto(url.slice(0, -10) + '!!!!');
  await expect(p2.getByText('This share link is damaged')).toBeVisible();
  await other.close();
});

test('CSV import adds items and skips owned barcodes', async ({ page }, testInfo) => {
  await page.goto('./#/add');
  await page.getByLabel('Title').fill('Already owned');
  await page.getByLabel('Barcode (EAN/UPC)').fill('5050629604047');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/collection$/);

  const file = testInfo.outputPath('import.csv');
  writeFileSync(file, '﻿Title,Year,Barcode,Format,Packaging,Condition,Price paid (GBP),Shelf\r\n'
    + 'Blade Runner 2049,2017,5051892239677,4K UHD,Steelbook,Like new,24.99,A3\r\n'
    + '"Dup, owned",,5050629604047,Blu-ray,,,,\r\n'
    + ',,,,,,,\r\n'
    + 'Paddington,2014,,DVD,,,£3,\r\n');
  await page.goto('./#/settings');
  await page.locator('[data-field="importFile"]').setInputFiles(file);
  let message = '';
  page.once('dialog', (d) => { message = d.message(); d.accept(); });
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page).toHaveURL(/#\/collection$/);
  expect(message).toContain('Add 2 items');
  expect(message).toContain('1 row match barcodes you already own and will be skipped');
  expect(message).toContain('Ignored columns: Shelf');
  await expect(page.locator('.item-row')).toHaveCount(3);
  await expect(page.locator('.item-row', { hasText: 'Blade Runner 2049 (2017)' })).toContainText('4K UHD · Steelbook');
  await expect(page.locator('[data-total="paid"]')).toHaveText('£27.99');
});

test('settings: test connections, key never in backups, replace-restore keeps the key', async ({ page, context }) => {
  const calls = await mockApis(context, {});
  await saveTmdbKey(page, 'eyJhbGciOiJIUzI1NiJ9.test.token');
  let auth = null;
  page.on('request', (r) => { if (r.url().includes('/configuration')) auth = r.headers().authorization; });
  await page.getByRole('button', { name: 'Test connections' }).click();
  await expect(page.locator('[data-field="connectionResults"]')).toContainText('✓ TMDB: Key accepted.');
  expect(auth).toBe('Bearer eyJhbGciOiJIUzI1NiJ9.test.token');
  expect(calls.tmdbConfig).toBe(1);

  await page.goto('./#/add');
  await page.getByLabel('Title').fill('Keep me');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/collection$/);
  await page.goto('./#/settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  const backupPath = await dl.path();
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  expect(JSON.stringify(backup)).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  expect(backup.meta.map((m) => m.key)).toEqual([]);

  await page.locator('[data-field="restoreFile"]').setInputFiles(backupPath);
  await page.getByLabel('Replace everything on this device').check();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('.item-row')).toHaveCount(1);
  await page.goto('./#/settings');
  await expect(page.getByLabel('TMDB API key or read access token')).toHaveValue('eyJhbGciOiJIUzI1NiJ9.test.token');
});

test('posters still show offline after being seen once', async ({ page, context }) => {
  await mockApis(context, { upc: {}, tmdb: TMDB_MOS });
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await saveTmdbKey(page);
  await page.goto('./#/add');
  await page.getByLabel('Title').fill('Man of Steel');
  await page.getByRole('button', { name: 'Search title' }).click();
  await page.locator('[data-panel="lookup"]').getByRole('button', { name: /Man of Steel \(2013\)/ }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  const img = page.locator('.item-row img.poster');
  await expect(img).toHaveJSProperty('complete', true);
  await expect.poll(() => img.evaluate((i) => i.naturalWidth)).toBe(1);

  await context.unroute('https://image.tmdb.org/**');
  await context.setOffline(true);
  await page.reload();
  await expect.poll(() => page.locator('.item-row img.poster').evaluate((i) => i.complete && i.naturalWidth)).toBe(1);
  await context.setOffline(false);
});
