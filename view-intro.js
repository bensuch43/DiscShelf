// Cards shown at the top of the Discs screen: "What's new" after an update
// (PokéBinder pattern) and "Getting started" on an empty library.
import { CONFIG } from './config.js';
import * as db from './db.js';
import { clone, el } from './ui.js';

// Newest first. Shown once after updating, for releases newer than the last one you opened.
export const WHATS_NEW = [
  { version: '0.6.1', items: [
    'Shop links tidied: barcode search only where it works (eBay, Amazon, CeX); title search everywhere else. Zavvi removed.',
  ] },
  { version: '0.6.0', items: [
    'Pasted collection titles are matched to TMDB automatically, with posters. Anything ambiguous asks you to pick.',
    'A new look: dark and light themes, poster views, progress rings.',
    'Undo instead of "Are you sure?" when you delete.',
    'Settings: theme, Check for updates and Reload app from the internet.',
  ] },
  { version: '0.5.0', items: ['Collections: checklists like Disney Classics, with a film in as many as you like.'] },
];

const newer = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

export async function renderIntro(slot, { isEmpty }) {
  // Upgraders from 0.5.0 or earlier have data but no marker yet: treat them as on 0.5.0.
  const seen = (await db.getMeta('lastSeenVersion')) ?? (isEmpty ? null : '0.5.0');
  if (isEmpty && !seen) {
    slot.replaceChildren(clone('tpl-getting-started'));
    await db.setMeta('lastSeenVersion', CONFIG.version); // first use: skip "what's new"
    return;
  }
  if (isEmpty) slot.replaceChildren(clone('tpl-getting-started'));
  if (seen && seen !== CONFIG.version) {
    const releases = WHATS_NEW.filter((r) => newer(r.version, seen) && !newer(r.version, CONFIG.version)).slice(0, 3);
    if (releases.length) {
      const card = clone('tpl-whats-new');
      card.querySelector('[data-field="version"]').textContent = `v${CONFIG.version}`;
      card.querySelector('[data-field="items"]').replaceChildren(...releases.flatMap((r) => r.items).map((t) => el('li', { textContent: t })));
      const section = card.firstElementChild;
      card.querySelector('[data-action="dismiss"]').addEventListener('click', () => section.remove());
      slot.prepend(card);
    }
  }
  if (!seen || seen !== CONFIG.version) await db.setMeta('lastSeenVersion', CONFIG.version);
}
