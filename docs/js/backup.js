// Full backup / restore as a single JSON file.
import { CONFIG } from './config.js';
import { getAll } from './db.js';

export const BACKUP_FORMAT = 'discshelf-backup';
const EXCLUDED_META = ['lastBackupAt'];

export async function buildBackup() {
  const [items, wants, priceLog, meta] = await Promise.all(
    ['items', 'wants', 'priceLog', 'meta'].map((s) => getAll(s)),
  );
  return {
    format: BACKUP_FORMAT,
    schema: CONFIG.dbVersion,
    appVersion: CONFIG.version,
    exportedAt: new Date().toISOString(),
    items,
    wants,
    priceLog,
    meta: meta.filter((m) => !EXCLUDED_META.includes(m.key) && !m.key.startsWith(CONFIG.secretMetaPrefix)),
  };
}

export function backupFileName(date = new Date()) {
  const stamp = date.toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
  return `discshelf-backup-${stamp}.json`;
}

/** Returns a list of human-readable problems; empty list = valid. */
export function validateBackup(data) {
  const problems = [];
  if (!data || typeof data !== 'object') return ['This file is not a DiscShelf backup.'];
  if (data.format !== BACKUP_FORMAT) problems.push('This file is not a DiscShelf backup.');
  if (typeof data.schema !== 'number') problems.push('The backup has no schema version.');
  else if (data.schema > CONFIG.dbVersion) problems.push(`The backup is from a newer version of the app (schema ${data.schema}). Update the app first.`);
  for (const key of ['items', 'wants', 'priceLog', 'meta']) {
    if (data[key] !== undefined && !Array.isArray(data[key])) problems.push(`"${key}" should be a list.`);
  }
  (Array.isArray(data.items) ? data.items : []).forEach((item, i) => {
    if (!item || typeof item.id !== 'string' || typeof item.title !== 'string' || !item.title.trim()) {
      problems.push(`Item ${i + 1} is missing an id or title.`);
    }
  });
  return problems.slice(0, 10);
}
