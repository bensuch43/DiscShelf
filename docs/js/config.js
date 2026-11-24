// =====================================================================
// CONFIG BLOCK: every tunable value lives here. No other file holds
// environment values. sw.js carries its own VERSION constant (service
// workers can't import ES modules everywhere); a test checks they match.
// External hosts must ALSO be added to the CSP meta tag in index.html.
// =====================================================================
export const CONFIG = Object.freeze({
  appName: 'DiscShelf',
  version: '0.4.0',

  // IndexedDB. Bump dbVersion only with a migration in db.js.
  dbName: 'discshelf',
  dbVersion: 1,

  locale: 'en-GB',
  currency: 'GBP',

  backupReminderDays: 30,

  // Meta key prefixes never written to backups.
  secretMetaPrefix: 'secret.', // API keys
  cacheMetaPrefix: 'cache.', // lookup cache (re-creatable)

  // A logged price older than this is shown as stale.
  priceStaleDays: 30,

  // Share links longer than this get a warning (some apps truncate long URLs).
  shareLinkWarnLength: 8000,

  formats: ['DVD', 'Blu-ray', '4K UHD', 'Blu-ray 3D'],
  packaging: ['Standard', 'Steelbook', 'Boxset', 'Digibook', 'Mediabook', 'Slipcover'],
  regions: [
    'Blu-ray B', 'Blu-ray A', 'Blu-ray C', 'Blu-ray region free',
    'DVD 2', 'DVD 1', 'DVD 4', 'DVD 0 (all regions)',
    '4K (unregioned)', 'Unknown',
  ],
  defaultRegionByFormat: {
    'DVD': 'DVD 2',
    'Blu-ray': 'Blu-ray B',
    'Blu-ray 3D': 'Blu-ray B',
    '4K UHD': '4K (unregioned)',
  },

  // Shared condition scale. Higher rank = better.
  // "Wanted condition or better" means rank >= wanted rank.
  conditions: [
    { id: 'new', label: 'New (sealed)', rank: 5 },
    { id: 'like-new', label: 'Like new', rank: 4 },
    { id: 'very-good', label: 'Very good', rank: 3 },
    { id: 'good', label: 'Good', rank: 2 },
    { id: 'acceptable', label: 'Acceptable', rank: 1 },
  ],
  defaultWantedCondition: 'very-good',

  // ---- Barcode lookup: UPCitemdb free tier (no key) ----
  upcitemdb: {
    lookupUrl: 'https://api.upcitemdb.com/prod/trial/lookup?upc=',
    dailyLimit: 100, // per IP per UPCitemdb's docs; counted here per device only
  },

  // ---- TMDB: film/TV metadata and posters. User supplies their own key in Settings ----
  tmdb: {
    apiBase: 'https://api.themoviedb.org/3',
    imageBase: 'https://image.tmdb.org/t/p/',
    thumbSize: 'w92',
    posterSize: 'w185',
    language: 'en-GB',
    region: 'GB',
  },

  // ---- Retailer search links ----
  // {q} = URL-encoded query (barcode or "title format"). Links open in Safari.
  // verified: true only where the URL format was confirmed during the build.
  // Test the rest from Settings > Retailer links on your phone, and edit here.
  retailers: [
    { id: 'ebay', name: 'eBay UK', url: 'https://www.ebay.co.uk/sch/i.html?_nkw={q}', verified: false },
    { id: 'amazon', name: 'Amazon UK', url: 'https://www.amazon.co.uk/s?k={q}', verified: false },
    { id: 'cex', name: 'CeX', url: 'https://uk.webuy.com/search?stext={q}', verified: false },
    { id: 'musicmagpie', name: 'musicMagpie (eBay shop)', url: 'https://www.ebay.co.uk/sch/i.html?_nkw={q}&_ssn=musicmagpie', verified: false },
    { id: 'zavvi', name: 'Zavvi', url: 'https://www.zavvi.com/search?q={q}', verified: false },
    { id: 'hmv', name: 'HMV', url: 'https://hmv.com/search?searchtext={q}', verified: false },
    { id: 'rarewaves', name: 'Rarewaves', url: 'https://www.rarewaves.com/search?q={q}', verified: true },
    { id: 'discogs', name: 'Discogs', url: 'https://www.discogs.com/search/?q={q}&type=all', verified: false },
    { id: 'google', name: 'Google Shopping', url: 'https://www.google.co.uk/search?tbm=shop&q={q}', verified: false },
  ],
  // Sample used by Settings > Retailer links (real UK steelbook barcode).
  retailerTestSample: { ean: '5051892145329', title: 'Man of Steel Blu-ray' },
});
