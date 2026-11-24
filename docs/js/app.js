// DiscShelf entry point: hash router, startup checks, service worker.
import { CONFIG } from './config.js';
import * as db from './db.js';
import { view, showBanner, el } from './ui.js';
import { renderCollection } from './views/collection.js';
import { renderItemForm } from './views/item-form.js';
import { renderWants, renderWantForm, renderWantDetail } from './views/wants.js';
import { renderSettings } from './views/settings.js';
import { renderShared } from './views/shared.js';

// Each navigation gets a sequence number. Views load their data first and only
// touch the DOM if they're still the latest navigation, so a slow render can't
// overwrite the page the user has already moved to.
let routeSeq = 0;

function resolve(hash) {
  const parts = (hash || '#/collection').replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const [page, a, b] = parts;
  if (page === 'add') return [renderItemForm, { id: null }];
  if (page === 'item' && a) return [renderItemForm, { id: a }];
  if (page === 'wants' && a === 'new') return [renderWantForm, { id: null }];
  if (page === 'wants') return [renderWants, {}];
  if (page === 'want' && a && b === 'edit') return [renderWantForm, { id: a }];
  if (page === 'want' && a) return [renderWantDetail, { id: a }];
  if (page === 'settings') return [renderSettings, {}];
  if (page === 'shared') return [renderShared, { payload: a }];
  return [renderCollection, {}];
}

async function route() {
  routeSeq += 1;
  const seq = routeSeq;
  const ctx = { isCurrent: () => seq === routeSeq, rerender: route };
  const [render, params] = resolve(location.hash);
  try {
    await render(params, ctx);
  } catch (err) {
    console.error(err);
    if (!ctx.isCurrent()) return;
    view().replaceChildren(el('p', { className: 'error', textContent: `Something went wrong: ${err.message}` }));
  }
  if (ctx.isCurrent()) window.scrollTo(0, 0);
}

async function checkBackupReminder() {
  if (location.hash.startsWith('#/shared/')) return;
  const items = await db.getAll('items');
  const wants = await db.getAll('wants');
  if (!items.length && !wants.length) return;
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
  // claims the page (controllerchange fires) and we must NOT reload then.
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
