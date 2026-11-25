// DiscShelf entry point: hash router, startup checks, service worker.
import { CONFIG } from './config.js';
import * as db from './db.js';
import { view, showBanner, el, applyTheme } from './ui.js';
import { renderCollection } from './view-discs.js';
import { renderItemForm } from './view-item.js';
import { renderWants, renderWantForm, renderWantDetail } from './view-wants.js';
import { renderSettings } from './view-settings.js';
import { renderShared } from './view-shared.js';
import { renderCollections, renderCollectionDetail } from './view-collections.js';

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
  if (page === 'collections' && a) return [renderCollectionDetail, { id: a }];
  if (page === 'collections') return [renderCollections, {}];
  if (page === 'settings') return [renderSettings, {}];
  if (page === 'shared') return [renderShared, { payload: a }];
  return [renderCollection, {}];
}

let activeTransitions = 0;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Render the screen for the current hash. A re-render of the same screen
 * keeps the scroll position; a navigation scrolls to the top and eases across
 * with View Transitions where the browser supports them (PokéBinder pattern).
 */
async function route({ keepScroll = false, animate = false } = {}) {
  routeSeq += 1;
  const seq = routeSeq;
  const ctx = { isCurrent: () => seq === routeSeq, rerender: () => route({ keepScroll: true }) };
  const [render, params] = resolve(location.hash);
  try {
    if (animate && document.startViewTransition && !reducedMotion()) {
      // A newer navigation skips an unfinished transition; that's expected, so swallow those rejections.
      // Lock the screen while any transition is swapping it, so typing can't
      // land on the outgoing copy. Counted, so overlapping navigations can't
      // leave it locked.
      activeTransitions += 1;
      view().inert = true;
      try {
        const vt = document.startViewTransition(() => render(params, ctx));
        vt.ready.catch(() => {});
        vt.finished.catch(() => {});
        await vt.updateCallbackDone;
      } finally {
        activeTransitions -= 1;
        if (!activeTransitions) view().inert = false;
      }
    } else {
      await render(params, ctx);
    }
  } catch (err) {
    console.error(err);
    if (!ctx.isCurrent()) return;
    view().replaceChildren(el('p', { className: 'error', textContent: `Something went wrong: ${err.message}` }));
  }
  if (ctx.isCurrent() && !keepScroll) window.scrollTo(0, 0);
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
    // Check for a new version whenever the app comes back to the foreground.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
      });
    });
  }).catch((err) => console.warn('Service worker registration failed', err));
}

addEventListener('hashchange', () => route({ animate: true }));
addEventListener('discshelf:collection-updated', (e) => {
  if (location.hash === `#/collections/${encodeURIComponent(e.detail.id)}`) route({ keepScroll: true });
});
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
watchConnectivity();
registerServiceWorker();
route().then(checkBackupReminder);
