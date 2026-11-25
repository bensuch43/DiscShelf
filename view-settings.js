import { CONFIG } from './config.js';
import * as db from './db.js';
import { buildBackup, backupFileName, validateBackup } from './backup.js';
import { getTmdbKey, setTmdbKey, testConnections } from './lookup.js';
import { collectionCsv, wantsCsv, itemsFromCsv } from './csv.js';
import { collectionText, wantsText, snapshotFrom, encodeSnapshot, shareUrl } from './share.js';
import {
  clone, view, setActiveTab, toast, nowIso, newId, hideBanner, el, downloadFile, shareOrCopy, fileStamp,
  retailerLink, plural, getTheme, setTheme,
} from './ui.js';

const keepDeviceMeta = (key) => key.startsWith(CONFIG.secretMetaPrefix) || key.startsWith(CONFIG.cacheMetaPrefix) || key === 'upc.usage';

export async function renderSettings(params, ctx) {
  const lastBackup = await db.getMeta('lastBackupAt');
  const tmdbKey = (await getTmdbKey()) || '';
  const canReport = !!navigator.storage?.persisted;
  const persisted = canReport ? await navigator.storage.persisted() : false;
  const est = canReport && navigator.storage.estimate ? await navigator.storage.estimate() : null;
  if (!ctx.isCurrent()) return;
  setActiveTab('settings');
  const root = view();
  root.replaceChildren(clone('tpl-settings'));
  root.querySelector('[data-field="version"]').textContent = `v${CONFIG.version}`;
  const q = (sel) => root.querySelector(sel);

  // ---------- lookups ----------
  const keyInput = q('[data-field="tmdbKey"]');
  keyInput.value = tmdbKey;
  q('[data-action="save-key"]').addEventListener('click', async () => {
    await setTmdbKey(keyInput.value.trim());
    toast(keyInput.value.trim() ? 'TMDB key saved on this device.' : 'TMDB key removed.');
  });
  q('[data-action="test-connections"]').addEventListener('click', async (e) => {
    const out = q('[data-field="connectionResults"]');
    e.target.disabled = true;
    out.replaceChildren(el('li', { className: 'hint', textContent: 'Testing…' }));
    if (keyInput.value.trim() !== tmdbKey) await setTmdbKey(keyInput.value.trim());
    const results = await testConnections();
    out.replaceChildren(...results.map((r) => el('li', { className: r.ok ? 'ok' : 'error', textContent: `${r.ok ? '✓' : '✗'} ${r.name}: ${r.detail}` })));
    e.target.disabled = false;
  });

  // ---------- retailer link check ----------
  const sample = CONFIG.retailerTestSample;
  q('[data-field="retailerSample"]').textContent = `${sample.title} (${sample.ean})`;
  const rl = q('[data-field="retailerLinks"]');
  for (const r of CONFIG.retailers) {
    rl.append(el('li', { className: 'link-row' },
      el('span', { className: 'name', textContent: `${r.name}${r.verified ? '' : ' (unverified)'}` }),
      el('a', { className: 'button small', href: retailerLink(r, sample.ean), target: '_blank', rel: 'noopener noreferrer', textContent: 'Barcode' }),
      el('a', { className: 'button small', href: retailerLink(r, sample.title), target: '_blank', rel: 'noopener noreferrer', textContent: 'Title' })));
  }

  // ---------- export ----------
  const loadAll = async () => {
    const [items, wants, logs] = await Promise.all([db.getAll('items'), db.getAll('wants'), db.getAll('priceLog')]);
    return { items, wants, logs };
  };
  q('[data-action="csv-collection"]').addEventListener('click', async () => {
    const { items, logs } = await loadAll();
    downloadFile(fileStamp('discshelf-collection', 'csv'), collectionCsv(items, logs), 'text/csv;charset=utf-8');
    toast(`Exported ${plural(items.length, 'item')}.`);
  });
  q('[data-action="csv-wants"]').addEventListener('click', async () => {
    const { wants, logs } = await loadAll();
    downloadFile(fileStamp('discshelf-wants', 'csv'), wantsCsv(wants, logs), 'text/csv;charset=utf-8');
    toast(`Exported ${plural(wants.length, 'want')}.`);
  });
  const textOut = async (text, title) => {
    const r = await shareOrCopy(text, title);
    if (r === 'copied') toast('Copied to the clipboard.');
    else if (r === 'failed') {
      q('[data-field="textPreview"]').hidden = false;
      q('[data-field="textPreview"]').value = text;
      toast('Couldn\'t share or copy; the text is shown below.');
    }
  };
  q('[data-action="text-collection"]').addEventListener('click', async () => {
    const { items } = await loadAll();
    await textOut(collectionText(items), 'My disc collection');
  });
  q('[data-action="text-wants"]').addEventListener('click', async () => {
    const { wants, logs } = await loadAll();
    await textOut(wantsText(wants, logs), 'My want list');
  });

  // ---------- share link ----------
  const linkOut = q('[data-field="shareLink"]');
  const linkNote = q('[data-field="shareNote"]');
  const linkActions = q('[data-field="shareActions"]');
  q('[data-action="make-link"]').addEventListener('click', async () => {
    const kind = q('input[name="shareKind"]:checked').value;
    const { items, wants } = await loadAll();
    const rows = kind === 'wants' ? wants.filter((w) => w.status !== 'bought') : items;
    if (!rows.length) { toast(kind === 'wants' ? 'Your want list is empty.' : 'Your collection is empty.'); return; }
    const url = shareUrl(await encodeSnapshot(snapshotFrom(kind, rows)));
    linkOut.value = url;
    linkOut.hidden = false;
    linkActions.hidden = false;
    linkNote.hidden = false;
    linkNote.textContent = `${plural(rows.length, kind === 'wants' ? 'want' : 'item')}, ${url.length.toLocaleString(CONFIG.locale)} characters. `
      + 'A read-only snapshot: it won\'t update when your list changes. Prices you logged are not included.'
      + (url.length > CONFIG.shareLinkWarnLength ? ' This link is long; some messaging apps may cut it off. Sharing the want list or a text list is safer.' : '');
  });
  q('[data-action="share-link"]').addEventListener('click', async () => {
    if (navigator.share) {
      try { await navigator.share({ url: linkOut.value, title: 'DiscShelf list' }); return; } catch (err) { if (err.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(linkOut.value); toast('Link copied.'); } catch { linkOut.select(); toast('Select and copy the link.'); }
  });
  q('[data-action="copy-link"]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(linkOut.value); toast('Link copied.'); } catch { linkOut.select(); toast('Select and copy the link.'); }
  });

  // ---------- import CSV ----------
  q('[data-action="import-csv"]').addEventListener('click', async () => {
    const err = q('[data-error="import"]');
    err.hidden = true;
    const file = q('[data-field="importFile"]').files[0];
    if (!file) { err.textContent = 'Choose a CSV file first.'; err.hidden = false; return; }
    const { items: incoming, skipped, unknownHeaders } = itemsFromCsv(await file.text(), { newId });
    if (!incoming.length) {
      err.textContent = 'No rows with a Title were found. The first row must be headers, including "Title". Export a collection CSV to see the expected columns.';
      err.hidden = false;
      return;
    }
    const existing = await db.getAll('items');
    const owned = new Set(existing.map((i) => i.ean).filter(Boolean));
    const skipDupes = q('[data-field="skipDupes"]').checked;
    const dupes = incoming.filter((i) => i.ean && owned.has(i.ean));
    const toAdd = skipDupes ? incoming.filter((i) => !(i.ean && owned.has(i.ean))) : incoming;
    const lines = [`Add ${plural(toAdd.length, 'item')} to your collection?`];
    if (skipped) lines.push(`${plural(skipped, 'row')} without a title will be skipped.`);
    if (dupes.length) lines.push(`${plural(dupes.length, 'row')} match barcodes you already own${skipDupes ? ' and will be skipped' : ' and will be added again'}.`);
    if (unknownHeaders.length) lines.push(`Ignored columns: ${unknownHeaders.join(', ')}.`);
    if (!toAdd.length) { err.textContent = lines.slice(1).join(' ') || 'Nothing to import.'; err.hidden = false; return; }
    if (!confirm(lines.join('\n'))) return;
    for (const item of toAdd) await db.put('items', item);
    toast(`Imported ${plural(toAdd.length, 'item')}.`);
    location.hash = '#/collection';
  });

  // ---------- backup ----------
  q('[data-field="lastBackup"]').textContent = lastBackup
    ? new Date(lastBackup).toLocaleString(CONFIG.locale, { dateStyle: 'medium', timeStyle: 'short' })
    : 'never';
  const makeFile = async () => new File([JSON.stringify(await buildBackup(), null, 2)], backupFileName(), { type: 'application/json' });
  // Update the label in place: a full re-render here could swallow a restore file picked straight after.
  const markBackedUp = async () => {
    const at = nowIso();
    await db.setMeta('lastBackupAt', at);
    hideBanner('backup-reminder');
    q('[data-field="lastBackup"]').textContent = new Date(at).toLocaleString(CONFIG.locale, { dateStyle: 'medium', timeStyle: 'short' });
  };
  q('[data-action="download-backup"]').addEventListener('click', async () => {
    const file = await makeFile();
    downloadFile(file.name, file);
    await markBackedUp();
    toast('Backup downloaded.');
  });
  const shareBtn = q('[data-action="share-backup"]');
  const probe = new File(['{}'], 'probe.json', { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [probe] })) {
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', async () => {
      try {
        await navigator.share({ files: [await makeFile()], title: 'DiscShelf backup' });
        await markBackedUp();
      } catch (err) {
        if (err.name !== 'AbortError') toast(`Share failed: ${err.message}`);
      }
    });
  }

  // ---------- restore ----------
  q('[data-action="restore"]').addEventListener('click', async () => {
    const errorEl = q('[data-error="restore"]');
    errorEl.hidden = true;
    const file = q('[data-field="restoreFile"]').files[0];
    const mode = q('input[name="restoreMode"]:checked').value;
    if (!file) { errorEl.textContent = 'Choose a backup file first.'; errorEl.hidden = false; return; }
    let data;
    try { data = JSON.parse(await file.text()); } catch {
      errorEl.textContent = 'That file isn\'t valid JSON.'; errorEl.hidden = false; return;
    }
    const problems = validateBackup(data);
    if (problems.length) { errorEl.textContent = problems.join(' '); errorEl.hidden = false; return; }
    const n = (data.items || []).length;
    const w = (data.wants || []).length;
    if (mode === 'replace') {
      if (!confirm(`Replace everything on this device with ${plural(n, 'item')} and ${plural(w, 'want')} from the backup? Your TMDB key on this device is kept.`)) return;
      await db.replaceAll(data, keepDeviceMeta);
      toast(`Restored ${plural(n, 'item')} and ${plural(w, 'want')}.`);
    } else {
      const c = await db.mergeAll(data);
      toast(`Merged: ${c.added} added, ${c.updated} updated, ${c.kept} unchanged.`);
    }
    location.hash = '#/collection';
  });

  // ---------- appearance ----------
  const themeSel = q('[data-field="theme"]');
  themeSel.value = getTheme();
  themeSel.addEventListener('change', () => setTheme(themeSel.value));

  // ---------- about this version / updates ----------
  q('[data-field="runningFrom"]').textContent = `${location.origin}${location.pathname}`;
  const updateStatus = q('[data-field="updateStatus"]');
  const say = (t) => { updateStatus.hidden = false; updateStatus.textContent = t; };
  q('[data-action="check-updates"]').addEventListener('click', async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) { say('Offline mode isn\'t active here, so there\'s nothing to update. Reload the page to get the latest version.'); return; }
    say('Checking…');
    try {
      await reg.update();
      say(reg.waiting || reg.installing ? 'A new version is downloading. Tap Reload on the banner when it appears.' : `You're on the latest version (v${CONFIG.version}).`);
    } catch {
      say('Couldn\'t check. Are you offline?');
    }
  });
  q('[data-action="reload-app"]').addEventListener('click', async () => {
    if (!navigator.onLine) { say('You\'re offline. Connect first, or you\'ll lose the offline copy until you\'re back online.'); return; }
    // Clears the app's offline copy (not your data, not cached posters), then reloads from the internet.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('discshelf-') && !k.startsWith('discshelf-posters')).map((k) => caches.delete(k)));
    const regs = await navigator.serviceWorker?.getRegistrations() || [];
    await Promise.all(regs.map((r) => r.unregister()));
    location.reload();
  });

  // ---------- storage ----------
  const status = q('[data-field="storageStatus"]');
  const persistBtn = q('[data-action="persist"]');
  if (!canReport) {
    status.textContent = 'This browser doesn\'t report storage status. Keep regular backups.';
  } else {
    const used = est?.usage != null ? ` Using about ${(est.usage / 1024 / 1024).toFixed(1)} MB.` : '';
    status.textContent = (persisted
      ? 'Persistent storage is on: the browser shouldn\'t clear your data automatically.'
      : 'Persistent storage is off: the browser may clear data if space runs low or the app goes unused.') + used;
    persistBtn.hidden = persisted;
    persistBtn.addEventListener('click', async () => {
      const ok = await navigator.storage.persist();
      toast(ok ? 'Persistent storage granted.' : 'The browser declined. Installing to the Home Screen usually helps.');
      ctx.rerender();
    });
  }
}
