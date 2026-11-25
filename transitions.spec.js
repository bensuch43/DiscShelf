import { test, expect } from '@playwright/test';

// The animated path: View Transitions on, as on an iPhone without Reduce Motion.
test.use({ reducedMotion: 'no-preference' });

test('screen transitions never leave the screen locked or show errors', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('./');
  // Rapid overlapping navigations.
  await page.evaluate(() => {
    for (const h of ['#/wants', '#/collections', '#/settings', '#/add', '#/collection', '#/add']) location.hash = h;
  });
  await expect(page.getByLabel('Title')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.getElementById('view').inert)).toBe(false);
  // Normal use through the tab bar, waiting as a person would.
  for (const tab of ['Collections', 'Wants', 'Settings', 'Add']) {
    await page.locator('.tabbar').getByRole('link', { name: tab }).click();
    await expect.poll(() => page.evaluate(() => document.getElementById('view').inert)).toBe(false);
  }
  await page.getByLabel('Title').fill('Typed after a transition');
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.item-row')).toHaveText(/Typed after a transition/);
  expect(errors).toEqual([]);
});
