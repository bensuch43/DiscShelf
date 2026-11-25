// Shared test helpers: API stubs and a fake camera that shows an EAN-13 barcode.
import { expect } from '@playwright/test';

export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64',
);

/**
 * Stub UPCitemdb, TMDB and TMDB images at the browser-context level (also
 * catches requests the service worker makes). Returns call counters.
 */
export async function mockApis(context, { upc = {}, tmdb = [], franchises = [], franchiseParts = {}, lists = {} } = {}) {
  const calls = { upc: [], tmdbSearch: [], tmdbConfig: 0, images: 0, lists: [] };
  await context.route('https://api.upcitemdb.com/**', (route) => {
    const ean = new URL(route.request().url()).searchParams.get('upc');
    calls.upc.push(ean);
    const items = upc[ean] ? [{ ean, title: upc[ean].title, brand: upc[ean].brand || '' }] : [];
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ code: 'OK', total: items.length, items }) });
  });
  await context.route('https://api.themoviedb.org/**', (route) => {
    const url = new URL(route.request().url());
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Accept' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname.endsWith('/configuration')) {
      calls.tmdbConfig += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{"images":{}}' });
    }
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    if (url.pathname.endsWith('/search/collection')) return json({ results: franchises });
    const coll = url.pathname.match(/\/collection\/(\d+)$/);
    if (coll) return franchiseParts[coll[1]] ? json(franchiseParts[coll[1]]) : json({}, 404);
    const list = url.pathname.match(/\/list\/(\d+)$/);
    if (list) {
      const page = Number(url.searchParams.get('page') || 1);
      calls.lists.push(`${list[1]}:${page}`);
      const pages = lists[list[1]];
      return pages ? json({ ...pages[page - 1], total_pages: pages.length }) : json({}, 404);
    }
    calls.tmdbSearch.push(url.searchParams.get('query'));
    return json({ results: tmdb });
  });
  await context.route('https://image.tmdb.org/**', (route) => {
    calls.images += 1;
    route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG });
  });
  return calls;
}

export async function saveTmdbKey(page, key = 'test-v3-key') {
  await page.goto('./#/settings');
  await page.getByLabel('TMDB API key or read access token').fill(key);
  await page.getByRole('button', { name: 'Save key' }).click();
  await expect(page.locator('#toast')).toContainText('TMDB key saved');
}

/**
 * Replace getUserMedia with a canvas stream showing an EAN-13 barcode, so the
 * real scanner code (ZXing in Chromium on Linux) decodes a real image.
 */
export async function fakeCamera(page, ean) {
  await page.addInitScript((code) => {
    const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
    const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
    const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
    const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
    const d = code.split('').map(Number);
    let bits = '101';
    for (let i = 1; i <= 6; i += 1) bits += (PARITY[d[0]][i - 1] === 'L' ? L : G)[d[i]];
    bits += '01010';
    for (let i = 7; i <= 12; i += 1) bits += R[d[i]];
    bits += '101';
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const draw = () => {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 640, 480);
      ctx.fillStyle = '#000';
      const module = 4;
      const x0 = (640 - bits.length * module) / 2;
      for (let i = 0; i < bits.length; i += 1) if (bits[i] === '1') ctx.fillRect(x0 + i * module, 140, module, 200);
    };
    navigator.mediaDevices.getUserMedia = async () => {
      draw();
      const stream = canvas.captureStream(10);
      setInterval(draw, 100); // keep frames flowing
      return stream;
    };
  }, ean);
}
