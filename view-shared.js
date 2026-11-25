// Read-only view of a shared snapshot. Never reads or writes IndexedDB.
import { CONFIG } from './config.js';
import { decodeSnapshot } from './share.js';
import { formatPence } from './money.js';
import { conditionLabel } from './prices.js';
import { view, setActiveTab, el, formatDate, plural } from './ui.js';

export async function renderShared({ payload }, ctx) {
  let snap;
  let error = null;
  try { snap = await decodeSnapshot(payload || ''); } catch (err) { error = err; }
  if (!ctx.isCurrent()) return;
  setActiveTab('');
  const root = view();
  if (error) {
    root.replaceChildren(el('section', { className: 'card' },
      el('h2', { textContent: 'Shared list' }),
      el('p', { className: 'error', textContent: 'This share link is damaged or incomplete. Ask for it to be sent again.' })));
    return;
  }
  const isWants = snap.kind === 'wants';
  const rows = snap.rows.map((r) => ({
    title: r[0], year: r[1], format: r[2], packaging: r[3], edition: r[4], wantedCondition: r[5], targetPrice: r[6],
  })).sort((a, b) => String(a.title).localeCompare(String(b.title), CONFIG.locale));
  const list = el('ul', { className: 'list' });
  for (const r of rows) {
    const meta = [r.format, r.packaging && r.packaging !== 'Standard' ? r.packaging : '', r.edition];
    if (isWants) {
      meta.push(`${conditionLabel(r.wantedCondition)} or better`);
      if (r.targetPrice != null) meta.push(`target ${formatPence(r.targetPrice)}`);
    }
    list.append(el('li', {}, el('div', { className: 'item-row static' },
      el('span', { className: 'main' },
        el('span', { className: 'title', textContent: r.year ? `${r.title} (${r.year})` : String(r.title) }),
        el('span', { className: 'meta', textContent: meta.filter(Boolean).join(' · ') })))));
  }
  root.replaceChildren(
    el('section', { className: 'card' },
      el('h2', { textContent: isWants ? 'Shared want list' : 'Shared collection' }),
      el('p', { className: 'hint', textContent: `${plural(rows.length, isWants ? 'want' : 'disc')}. A read-only snapshot from ${formatDate(snap.at)}. Nothing here is saved to your device.` })),
    list,
  );
}
