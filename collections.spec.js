import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mockApis, saveTmdbKey } from './e2e-helpers.js';

test.beforeEach(async ({ page }, testInfo) => {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(err.message));
  testInfo.errors_ = errors;
});
test.afterEach(async ({}, testInfo) => {
  expect(testInfo.errors_, 'console errors').toEqual([]);
});

const DISNEY = 'Snow White and the Seven Dwarfs (1937)\nPinocchio (1940)\nFantasia (1940)\nDumbo (1941)\nFantasia 2000';

async function createCollection(page, name, description = '') {
  await page.goto('./#/collections');
  await page.getByLabel('New collection name').fill(name);
  if (description) await page.getByLabel('Description (optional)').fill(description);
  await page.getByRole('button', { name: 'Create collection' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function pasteTitles(page, text) {
  await page.getByText('Paste a list of titles').click();
  await page.getByLabel(/One film per line/).fill(text);
  await page.getByRole('button', { name: 'Add titles' }).click();
}

const entry = (page, title) => page.locator('.entry-row', { hasText: title });
/** Use the list view on collection screens (the default is the poster grid). */
async function listView(page) {
  await page.getByRole('button', { name: 'List view' }).click();
}

test('create a checklist, paste titles, tick off owned films, want missing ones', async ({ page }) => {
  await createCollection(page, 'Disney Classics', 'Walt Disney Animation Studios');
  await expect(page.getByText('No films yet. Add some below.').first()).toBeVisible();
  await pasteTitles(page, DISNEY);
  await expect(page.locator('#toast')).toContainText('Added 5 films');
  await expect(page.locator('.entry-row')).toHaveCount(5);
  await expect(page.locator('[data-field="progress"]')).toHaveText('0 of 5 owned · 5 missing');

  // Paste again: duplicates skipped.
  await pasteTitles(page, 'Pinocchio (1940)\nBambi (1942)');
  await expect(page.locator('#toast')).toContainText('Added 1 film, 1 already in the collection');

  // I own it -> pre-filled Add disc -> back to the collection.
  // Poster grid is the default: tap the film, then use the sheet.
  await expect(page.locator('.tile.missing')).toHaveCount(6);
  await page.locator('.tile', { hasText: 'Pinocchio (1940)' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'I own it' }).click();
  await expect(page.getByRole('heading', { name: 'Add a disc' })).toBeVisible();
  await expect(page.getByLabel('Title')).toHaveValue('Pinocchio');
  await expect(page.getByLabel('Year')).toHaveValue('1940');
  await expect(page.getByRole('checkbox', { name: 'Disney Classics' })).toBeChecked();
  await page.getByLabel('Format').selectOption('Blu-ray');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/collections\/.+/);
  await expect(page.locator('[data-field="progress"]')).toHaveText('1 of 6 owned · 5 missing');
  await expect(page.locator('.tile.owned')).toHaveText(/Pinocchio \(1940\)Blu-ray/);
  await expect(page.locator('[data-field="ring"]')).toHaveAttribute('data-label', '17%');
  await listView(page);
  await expect(entry(page, 'Pinocchio')).toContainText('Owned: Blu-ray');

  // A second disc of the same film (4K) counts for the same entry.
  await page.goto('./#/add');
  await page.getByLabel('Title').fill('pinocchio');
  await page.getByLabel('Year').fill('1940');
  await page.getByLabel('Format').selectOption('4K UHD');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.goBack();
  await page.goto('./#/collections');
  await page.locator('.collection-row', { hasText: 'Disney Classics' }).click();
  await expect(entry(page, 'Pinocchio')).toContainText('Owned: Blu-ray, 4K UHD');

  // Want it -> want list entry with "Any format".
  await entry(page, 'Dumbo').getByRole('button', { name: 'Want it' }).click();
  await expect(entry(page, 'Dumbo')).toContainText('On want list');
  await expect(page.locator('[data-field="progress"]')).toHaveText('1 of 6 owned · 1 on want list · 4 missing');

  // Filters and ordering.
  await page.getByLabel('Show').selectOption('missing');
  await expect(page.locator('.entry-row')).toHaveCount(4);
  await page.getByLabel('Show').selectOption('all');
  await page.getByLabel('Order').selectOption('title');
  await expect(page.locator('.entry-row .title').first()).toHaveText('Bambi (1942)');
  await page.getByLabel('Order').selectOption('list');
  await expect(page.locator('.entry-row .title').first()).toHaveText('Snow White and the Seven Dwarfs (1937)');

  await page.goto('./#/wants');
  await expect(page.locator('.item-row', { hasText: 'Dumbo (1941)' })).toContainText('Any format · Very good or better');

  // Collections list shows progress.
  await page.goto('./#/collections');
  await expect(page.locator('.collection-row', { hasText: 'Disney Classics' })).toContainText('1 of 6 owned · 1 on want list');
});

test('a disc can be in several collections; Discs tab filters by collection; unticking removes it', async ({ page }) => {
  await createCollection(page, 'Disney Classics');
  await pasteTitles(page, DISNEY);
  await createCollection(page, '1940s');

  await page.goto('./#/add');
  await page.getByLabel('Title').fill('Fantasia');
  await page.getByLabel('Year').fill('1940');
  await expect(page.getByRole('checkbox', { name: 'Disney Classics' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '1940s' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: '1940s' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/collection$/);

  await page.goto('./#/add');
  await page.getByLabel('Title').fill('Heat');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/collection$/);

  const filter = page.getByLabel('Filter by collection');
  await filter.selectOption({ label: '1940s' });
  await expect(page.locator('.item-row .title')).toHaveText(['Fantasia (1940)']);
  await filter.selectOption({ label: 'Disney Classics' });
  await expect(page.locator('.item-row .title')).toHaveText(['Fantasia (1940)']);
  await filter.selectOption({ label: 'Not in any collection' });
  await expect(page.locator('.item-row .title')).toHaveText(['Heat']);
  await filter.selectOption({ label: 'All discs' });

  await page.goto('./#/collections');
  await expect(page.locator('.collection-row', { hasText: '1940s' })).toContainText('1 of 1 owned');

  // Regression: a disc saved with a box untouched never removes the film from that checklist.
  await page.goto('./#/add');
  await page.getByLabel('Title').fill('Dumbo');
  await page.getByLabel('Year').fill('1941');
  await expect(page.getByRole('checkbox', { name: 'Disney Classics' })).toBeChecked();
  await page.getByLabel('Year').fill('');
  await page.getByLabel('Title').fill('Dumbo (live action)');
  await expect(page.getByRole('checkbox', { name: 'Disney Classics' })).not.toBeChecked();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/collection$/);
  await page.goto('./#/collections');
  await expect(page.locator('.collection-row', { hasText: 'Disney Classics' })).toContainText('of 5 owned');

  // Untick 1940s on the disc: the film leaves that checklist only.
  await page.goto('./#/collection');
  await page.locator('.item-row', { hasText: 'Fantasia (1940)' }).click();
  await page.getByRole('checkbox', { name: '1940s' }).uncheck();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/collection$/);
  await page.goto('./#/collections');
  await expect(page.locator('.collection-row', { hasText: '1940s' })).toContainText('Empty');
  await expect(page.locator('.collection-row', { hasText: 'Disney Classics' })).toContainText('1 of 5 owned');
});

test('TMDB: search-add, franchise import and public list import (paged)', async ({ page, context }) => {
  const calls = await mockApis(context, {
    tmdb: [{ id: 10895, media_type: 'movie', title: 'Pinocchio', release_date: '1940-02-23', poster_path: '/p.jpg' }],
    franchises: [{ id: 10194, name: 'Toy Story Collection', poster_path: '/ts.jpg' }],
    franchiseParts: { 10194: { name: 'Toy Story Collection', parts: [
      { id: 863, title: 'Toy Story 2', release_date: '1999-10-30', poster_path: '/ts2.jpg' },
      { id: 862, title: 'Toy Story', release_date: '1995-11-22', poster_path: '/ts1.jpg' },
    ] } },
    lists: { 8136: [
      { name: 'Disney Animated Canon', items: [
        { id: 408, media_type: 'movie', title: 'Snow White and the Seven Dwarfs', release_date: '1937-12-20', poster_path: '/sw.jpg' },
        { id: 10895, media_type: 'movie', title: 'Pinocchio', release_date: '1940-02-23', poster_path: '/p.jpg' },
      ] },
      { items: [{ id: 756, media_type: 'movie', title: 'Fantasia', release_date: '1940-11-13', poster_path: '/f.jpg' }] },
    ] },
  });
  await saveTmdbKey(page);
  await createCollection(page, 'Animation');

  await page.getByLabel('Search TMDB for a film or series').fill('Pinocchio');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.locator('[data-field="searchResults"]').getByRole('button', { name: /Pinocchio \(1940\)/ }).click();
  await expect(page.locator('.entry-row')).toHaveCount(1);
  await listView(page);
  await expect(entry(page, 'Pinocchio').locator('img.poster')).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w92/p.jpg');

  await page.getByText('Import a TMDB franchise').click();
  await page.getByLabel('Franchise name').fill('Toy Story');
  await page.getByRole('button', { name: 'Find' }).click();
  await page.getByRole('button', { name: 'Import Toy Story Collection' }).click();
  await expect(page.locator('#toast')).toContainText('Added 2 films');
  // Franchises come in release order.
  await expect(page.locator('.entry-row .title')).toHaveText(['Pinocchio (1940)', 'Toy Story (1995)', 'Toy Story 2 (1999)']);

  await page.getByText('Import a public TMDB list').click();
  await page.getByLabel('TMDB list link').fill('https://www.themoviedb.org/list/8136-disney-animated-canon');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Added 2 films, 1 already in the collection');
  expect(calls.lists).toEqual(['8136:1', '8136:2']);
  await expect(page.locator('.entry-row')).toHaveCount(5);

  await page.getByText('Import a public TMDB list').click();
  await page.getByLabel('TMDB list link').fill('not a list');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('[data-field="addStatus"]')).toContainText('Paste a TMDB list link');
});

test('share checklist, rename, delete collection keeps discs; backup includes collections', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => { delete Navigator.prototype.share; });
  await createCollection(page, 'Disney Classics');
  await pasteTitles(page, 'Pinocchio (1940)\nDumbo (1941)');
  await listView(page);
  await page.locator('.entry-row', { hasText: 'Pinocchio' }).getByRole('button', { name: 'I own it' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/collections\/.+/);

  await page.getByRole('button', { name: 'Share checklist' }).click();
  await expect(page.locator('#toast')).toContainText('Checklist copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Disney Classics: 1 of 2 owned\n\n✓ Pinocchio (1940) [DVD]\n✗ Dumbo (1941)\n\n✓ owned  ☆ on want list  ✗ missing',
  );

  await page.getByRole('button', { name: 'Rename' }).click();
  await page.locator('#edit-collection').getByLabel('Name').fill('Disney Animated Classics');
  await page.locator('#edit-collection').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Disney Animated Classics' })).toBeVisible();

  await page.goto('./#/settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  const backup = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  expect(backup.schema).toBe(2);
  expect(backup.collections.map((c) => [c.name, c.entries.length])).toEqual([['Disney Animated Classics', 2]]);

  await page.goto('./#/collections');
  await page.locator('.collection-row').click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete collection' }).click();
  await expect(page.getByText('No collections yet.')).toBeVisible();
  await page.goto('./#/collection');
  await expect(page.locator('.item-row')).toHaveText(/Pinocchio/);
});

test('upgrading from a 0.4 database keeps existing data and adds collections', async ({ page }) => {
  // Build a version-1 database exactly as 0.1–0.4 created it, before the app loads.
  await page.goto('./manifest.webmanifest');
  await page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('discshelf', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('items', { keyPath: 'id' }).createIndex('ean', 'ean');
      db.createObjectStore('wants', { keyPath: 'id' }).createIndex('ean', 'ean');
      db.createObjectStore('priceLog', { keyPath: 'id' }).createIndex('wantId', 'wantId');
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    r.onsuccess = () => {
      const tx = r.result.transaction(['items', 'meta'], 'readwrite');
      tx.objectStore('items').put({ id: 'old-1', title: 'Old Disc', format: 'DVD', packaging: 'Standard', region: 'DVD 2', pricePaid: 500, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' });
      tx.objectStore('meta').put({ key: 'secret.tmdbKey', value: 'kept-key' });
      tx.oncomplete = () => { r.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    r.onerror = () => reject(r.error);
  }));
  await page.goto('./');
  await expect(page.locator('.item-row')).toHaveText(/Old Disc/);
  await expect(page.locator('[data-total="paid"]')).toHaveText('£5.00');
  await createCollection(page, 'Migrated');
  await page.goto('./#/settings');
  await expect(page.getByLabel('TMDB API key or read access token')).toHaveValue('kept-key');
  expect(await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('discshelf'); r.onsuccess = () => res(r.result.version); }))).toBe(2);
});

test('pasted titles are matched to TMDB automatically; ambiguous ones are picked in the sheet', async ({ page, context }) => {
  const film = (id, title, date, poster) => ({ id, media_type: 'movie', title, release_date: date, poster_path: poster });
  await mockApis(context, {});
  // Answer per query, like TMDB's /search/multi.
  await context.route('https://api.themoviedb.org/3/search/multi**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('query');
    const results = {
      'Pinocchio': [film(532321, 'Pinocchio', '2022-09-07', '/p22.jpg'), film(10895, 'Pinocchio', '1940-02-23', '/p40.jpg')],
      'The Lion King': [film(8587, 'The Lion King', '1994-06-24', '/lk94.jpg'), film(420818, 'The Lion King', '2019-07-12', '/lk19.jpg')],
      'Fantasia 2000': [film(49948, 'Fantasia 2000', '1999-12-17', '/f2k.jpg')],
    }[q] || [];
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ results }) });
  });
  await saveTmdbKey(page);
  await createCollection(page, 'Disney');
  await pasteTitles(page, 'Pinocchio (1940)\nThe Lion King\nFantasia 2000\nNot A Real Film');
  await expect(page.locator('#toast')).toContainText('Matched 2 of 4, 1 to pick, 1 not found', { timeout: 10000 });
  await expect(page.locator('.tile', { hasText: 'Pinocchio (1940)' }).locator('img')).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w185/p40.jpg');
  await expect(page.locator('.tile', { hasText: 'Fantasia 2000' })).toContainText('Fantasia 2000 (1999)');
  await expect(page.locator('.tile', { hasText: 'The Lion King' }).locator('.flag')).toHaveText('Pick match');
  await expect(page.locator('.tile', { hasText: 'Not A Real Film' }).locator('.flag')).toHaveText('Not found');
  await expect(page.locator('[data-field="matchStatus"]')).toContainText('1 need you to pick · 1 not found');

  await page.locator('.tile', { hasText: 'The Lion King' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('More than one film fits');
  await sheet.getByRole('button', { name: /The Lion King \(2019\)/ }).click();
  await expect(page.locator('#toast')).toContainText('Matched to The Lion King (2019)');
  await expect(page.locator('.tile', { hasText: 'The Lion King (2019)' }).locator('.flag')).toHaveCount(0);

  await page.locator('.tile', { hasText: 'Not A Real Film' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Not on TMDB: keep as it is' }).click();
  await expect(page.locator('[data-field="matchBar"]')).toBeHidden();

  // An owned disc ticks the matched film even though its title differs.
  await page.goto('./#/add');
  await page.getByLabel('Title').fill('Pinocchio');
  await page.getByLabel('Year').fill('1940');
  await expect(page.getByRole('checkbox', { name: 'Disney' })).toBeChecked();
});

test('without a TMDB key, pasted titles wait with a clear message', async ({ page }) => {
  await createCollection(page, 'Later');
  await pasteTitles(page, 'Dumbo (1941)');
  await expect(page.locator('#toast')).toContainText('Added 1 film');
  await expect(page.locator('[data-field="matchStatus"]')).toContainText('Add a TMDB key in Settings');
  await page.getByRole('button', { name: 'Match 1 film with TMDB' }).click();
  await expect(page.locator('#toast')).toContainText('Add a TMDB key in Settings');
});

test('delete with undo: discs, collections', async ({ page }) => {
  await page.goto('./#/add');
  await page.getByLabel('Title').fill('Heat');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.locator('.item-row', { hasText: 'Heat' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('#toast')).toContainText('Deleted "Heat".');
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Heat');

  await createCollection(page, 'Temp');
  await page.getByRole('button', { name: 'Delete collection' }).click();
  await expect(page).toHaveURL(/#\/collections$/);
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('heading', { name: 'Temp', exact: true })).toBeVisible();
});
