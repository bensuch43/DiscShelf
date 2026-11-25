import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

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

async function addItem(page, data) {
  await page.goto('./#/add');
  await page.getByLabel('Title').fill(data.title);
  if (data.year) await page.getByLabel('Year').fill(data.year);
  if (data.ean) await page.getByLabel('Barcode (EAN/UPC)').fill(data.ean);
  if (data.format) await page.getByLabel('Format').selectOption(data.format);
  if (data.packaging) await page.getByLabel('Packaging').selectOption(data.packaging);
  if (data.distributor) await page.getByLabel('Distributor').fill(data.distributor);
  if (data.paid) await page.getByLabel('Price paid (£)').fill(data.paid);
  if (data.estimate) await page.getByLabel('Estimated value (£)').fill(data.estimate);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/collection$/);
}

const totalsText = (page, key) => page.locator(`[data-total="${key}"]`);

test('loads with strict CSP, manifest and empty state', async ({ page }) => {
  await page.goto('./');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain('unsafe-inline');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', 'manifest.webmanifest');
  await expect(page.getByText('Nothing here yet.')).toBeVisible();
  await expect(totalsText(page, 'count')).toHaveText('0');
});

test('add items manually and see totals in GBP', async ({ page }) => {
  await addItem(page, { title: 'Man of Steel', year: '2013', ean: '5051892145329', format: 'Blu-ray', packaging: 'Steelbook', distributor: 'Warner', paid: '12.50' });
  await addItem(page, { title: 'Edge of Tomorrow', format: '4K UHD', paid: '20', estimate: '35' });
  await addItem(page, { title: 'Unpriced Thing' });

  await expect(page.locator('.item-row')).toHaveCount(3);
  await expect(totalsText(page, 'count')).toHaveText('3');
  await expect(totalsText(page, 'paid')).toHaveText('£32.50');
  await expect(totalsText(page, 'value')).toHaveText('£47.50');
  await expect(totalsText(page, 'unpriced')).toHaveText(/1 item with no price/);
  const row = page.locator('.item-row', { hasText: 'Man of Steel (2013)' });
  await expect(row).toContainText('Blu-ray · Steelbook · Blu-ray B · Warner');
  await expect(row).toContainText('£12.50');
});

test('search, format filter and sort', async ({ page }) => {
  await addItem(page, { title: 'Alien', format: 'DVD', paid: '3' });
  await addItem(page, { title: 'Blade Runner', format: '4K UHD', paid: '25', ean: '5051892239677' });
  await addItem(page, { title: 'Casablanca', format: 'Blu-ray', paid: '8' });

  await page.getByLabel('Search collection').fill('blade');
  await expect(page.locator('.item-row')).toHaveCount(1);
  await page.getByLabel('Search collection').fill('5051892239677');
  await expect(page.locator('.item-row')).toHaveText(/Blade Runner/);
  await page.getByLabel('Search collection').fill('zzz');
  await expect(page.locator('#item-list').getByText('No items match your search.')).toBeVisible();

  await page.getByLabel('Search collection').fill('');
  await page.getByLabel('Filter by format').selectOption('DVD');
  await expect(page.locator('.item-row')).toHaveText([/Alien/]);

  await page.getByLabel('Filter by format').selectOption('');
  await page.getByLabel('Sort by').selectOption('value');
  await expect(page.locator('.item-row .title')).toHaveText(['Blade Runner', 'Casablanca', 'Alien']);
});

test('edit and delete an item', async ({ page }) => {
  await addItem(page, { title: 'Heat', paid: '5' });
  await page.locator('.item-row', { hasText: 'Heat' }).click();
  await expect(page.getByRole('heading', { name: 'Edit disc' })).toBeVisible();
  await expect(page.getByLabel('Price paid (£)')).toHaveValue('5.00');
  await page.getByLabel('Title').fill('Heat (Director\'s Definitive Edition)');
  await page.getByLabel('Estimated value (£)').fill('£18.99');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.item-row')).toContainText('£18.99');

  await page.locator('.item-row').click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Nothing here yet.')).toBeVisible();
});

test('validation: title required, bad price and barcode warnings', async ({ page }) => {
  await page.goto('./#/add');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('[data-error]')).toContainText('Enter a title.');

  await page.getByLabel('Title').fill('Test');
  await page.getByLabel('Price paid (£)').fill('12.999');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('[data-error]')).toContainText('Price paid must be an amount');

  await page.getByLabel('Barcode (EAN/UPC)').fill('5051892145328');
  await expect(page.locator('[data-note="ean"]')).toContainText('check digit');
  await page.getByLabel('Barcode (EAN/UPC)').fill('5051892145329');
  await expect(page.locator('[data-note="ean"]')).toBeHidden();
});

test('region defaults follow format until chosen manually', async ({ page }) => {
  await page.goto('./#/add');
  await expect(page.getByLabel('Region')).toHaveValue('DVD 2');
  await page.getByLabel('Format').selectOption('4K UHD');
  await expect(page.getByLabel('Region')).toHaveValue('4K (unregioned)');
  await page.getByLabel('Format').selectOption('Blu-ray');
  await expect(page.getByLabel('Region')).toHaveValue('Blu-ray B');
  await page.getByLabel('Region').selectOption('Blu-ray A');
  await page.getByLabel('Format').selectOption('DVD');
  await expect(page.getByLabel('Region')).toHaveValue('Blu-ray A');
});

test('duplicate barcode warning', async ({ page }) => {
  await addItem(page, { title: 'Copy one', ean: '5050629604047' });
  await page.goto('./#/add');
  await page.getByLabel('Barcode (EAN/UPC)').fill('5050629604047');
  await expect(page.locator('[data-note="ean"]')).toContainText('You already have 1 item with this barcode');
});

test('stored titles are rendered as text, not HTML', async ({ page }) => {
  await addItem(page, { title: '<img src=x onerror=alert(1)>Evil' });
  await expect(page.locator('.item-row .title')).toHaveText('<img src=x onerror=alert(1)>Evil');
  await expect(page.locator('.item-row img')).toHaveCount(0);
});

test('rapid tab switching never leaves a stale or broken page', async ({ page }) => {
  await addItem(page, { title: 'Race check' });
  for (let i = 0; i < 10; i += 1) {
    await page.evaluate(() => {
      location.hash = '#/collection';
      location.hash = '#/settings';
      location.hash = '#/add';
    });
    await expect(page.getByLabel('Title')).toBeVisible();
    await expect(page.locator('#view > .error')).toHaveCount(0);
  }
});

test('data survives a reload (IndexedDB)', async ({ page }) => {
  await addItem(page, { title: 'Persistent', paid: '1' });
  await page.reload();
  await expect(page.locator('.item-row')).toHaveText(/Persistent/);
});

test('backup reminder appears and clears after backup', async ({ page }) => {
  await addItem(page, { title: 'Needs backup' });
  await page.reload();
  await expect(page.locator('#backup-reminder')).toContainText('You haven\'t made a backup yet.');
  await page.getByRole('button', { name: 'Back up' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  await download;
  await expect(page.locator('#backup-reminder')).toHaveCount(0);
});

test('backup download then restore (replace and merge) in a fresh browser', async ({ page, browser }, testInfo) => {
  await addItem(page, { title: 'Back me up', ean: '5037899095003', paid: '29.99' });
  await addItem(page, { title: 'Second', paid: '2' });
  await page.goto('./#/settings');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download backup' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^discshelf-backup-\d{8}-\d{4}\.json$/);
  const file = testInfo.outputPath('backup.json');
  await download.saveAs(file);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  expect(json.format).toBe('discshelf-backup');
  expect(json.items).toHaveLength(2);
  expect(json.meta.find((m) => m.key === 'lastBackupAt')).toBeUndefined();

  const fresh = await browser.newContext({ ...testInfo.project.use, baseURL: testInfo.project.use.baseURL });
  const p2 = await fresh.newPage();
  // Pre-existing item on the new device, to prove replace wipes and merge keeps.
  await addItem(p2, { title: 'Only on device two' });

  await p2.goto('./#/settings');
  await p2.locator('[data-field="restoreFile"]').setInputFiles(file);
  await p2.getByRole('button', { name: 'Restore' }).click();
  await expect(p2.locator('.item-row')).toHaveCount(3);
  await expect(p2.locator('#toast')).toContainText('2 added');

  await p2.goto('./#/settings');
  await p2.locator('[data-field="restoreFile"]').setInputFiles(file);
  await p2.getByLabel('Replace everything on this device').check();
  p2.once('dialog', (d) => d.accept());
  await p2.getByRole('button', { name: 'Restore' }).click();
  await expect(p2.locator('.item-row')).toHaveCount(2);
  await expect(p2.locator('[data-total="paid"]')).toHaveText('£31.99');
  await fresh.close();
});

test('restore rejects a non-backup file', async ({ page }, testInfo) => {
  const bad = testInfo.outputPath('bad.json');
  (await import('node:fs')).writeFileSync(bad, JSON.stringify({ hello: 'world' }));
  await page.goto('./#/settings');
  await page.locator('[data-field="restoreFile"]').setInputFiles(bad);
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('[data-error="restore"]')).toContainText('not a DiscShelf backup');
});

test('works offline once installed (service worker)', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  // clients.claim() should take control without a reload.
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await addItem(page, { title: 'Offline proof' });

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.item-row')).toHaveText(/Offline proof/);
  await expect(page.locator('#offline-badge')).toBeVisible();
  await page.goto('./#/add');
  await expect(page.getByLabel('Title')).toBeVisible();
  await context.setOffline(false);
});
