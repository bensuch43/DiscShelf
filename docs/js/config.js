// =====================================================================
// CONFIG BLOCK: every tunable value lives here. No other file holds
// environment values. sw.js carries its own VERSION constant (service
// workers can't import ES modules everywhere); a test checks they match.
// =====================================================================
export const CONFIG = Object.freeze({
  appName: 'DiscShelf',
  version: '0.1.0',

  // IndexedDB. Bump dbVersion only with a migration in db.js.
  dbName: 'discshelf',
  dbVersion: 1,

  locale: 'en-GB',
  currency: 'GBP',

  // Nag to back up when the last backup is older than this.
  backupReminderDays: 30,

  // Meta keys starting with this prefix are never written to backups
  // (reserved for API keys added in later releases).
  secretMetaPrefix: 'secret.',

  formats: ['DVD', 'Blu-ray', '4K UHD', 'Blu-ray 3D'],
  packaging: ['Standard', 'Steelbook', 'Boxset', 'Digibook', 'Mediabook', 'Slipcover'],
  regions: [
    'Blu-ray B', 'Blu-ray A', 'Blu-ray C', 'Blu-ray region free',
    'DVD 2', 'DVD 1', 'DVD 4', 'DVD 0 (all regions)',
    '4K (unregioned)', 'Unknown',
  ],
  // Region pre-selected for a new item when its format is chosen (UK defaults).
  defaultRegionByFormat: {
    'DVD': 'DVD 2',
    'Blu-ray': 'Blu-ray B',
    'Blu-ray 3D': 'Blu-ray B',
    '4K UHD': '4K (unregioned)',
  },

  // Shared condition scale (collection items and, from v0.3, wants).
  // Higher rank = better. "Wanted condition or better" uses rank >=.
  conditions: [
    { id: 'new', label: 'New (sealed)', rank: 5 },
    { id: 'like-new', label: 'Like new', rank: 4 },
    { id: 'very-good', label: 'Very good', rank: 3 },
    { id: 'good', label: 'Good', rank: 2 },
    { id: 'acceptable', label: 'Acceptable', rank: 1 },
  ],
});
