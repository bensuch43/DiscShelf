# DiscShelf

A personal app for tracking a DVD, Blu-ray and 4K UHD collection, plus a want list with price tracking. It is a static PWA on GitHub Pages, designed for iPhone, and works offline. Your data is stored on the device in IndexedDB. There is no backend, no account, no Azure and no paid service.

**Current release: v0.6.0** (see [CHANGELOG.md](CHANGELOG.md)).

## Features

| Area | What it does |
|---|---|
| **Add a disc** | Scan the barcode with the camera, search by title, or type everything in. Each disc records its exact edition: format, packaging (steelbook, boxset…), region, distributor, edition, condition, discs, price paid, where and when bought, and notes. |
| **Barcode scanning** | Scanning fills in the barcode and tells you if you already own it or have it on your want list (copying the details across if so). Then you search the title. The barcode isn't looked up online: no free barcode database allows requests from a web app (see below). The barcode is still used for exact shop searches, duplicate warnings and valuation. |
| **Look** | Dark "gallery" theme by default, with a light theme; it follows your device, or set it in Settings → Appearance. Poster views with progress rings, and screen transitions that respect Reduce Motion. Undo instead of "Are you sure?", and a "What's new" card after updates. The design language matches PokéBinder Studio. |
| **Collections** | Named checklists of films, such as Disney Classics. You can add films by pasting a list of titles (**matched to TMDB automatically**, with posters; anything ambiguous, such as a remake, asks you to pick), by TMDB search, by importing a whole TMDB franchise (e.g. the Toy Story films), or by importing a public TMDB list. Each film shows as **Owned** (with the formats you own), **On want list** or **Missing**, and each collection shows how many you own. "Want it" and "I own it" buttons sit on every missing film. A film can be in any number of collections. Discs tick films off automatically by title, or by TMDB id where both have one. You can tick collections on the disc screen, filter the Discs tab by collection, and share a checklist as text. |
| **Title search** | TMDB search for films and TV series, using your own free API key. Choosing a result fills in the title and year and adds a poster. Posters are kept for offline use. |
| **Collection** | Totals for number of items, amount paid and value, plus search, a format filter and sorting. Each disc's value is your own estimate, otherwise the latest price you logged for the same barcode (and condition, if recorded), otherwise what you paid. |
| **Want list** | Each want has a wanted condition (that condition or better counts) and a target price. Wants at or under target are tagged. |
| **Cheapest place to buy** | Each want has links that open each shop's own search, by barcode or by title. You log the prices you find (price, postage, condition, date and an optional link), and the app shows the cheapest total in your condition or better, with a warning on prices over 30 days old and a full price history. **Mark as bought** moves the want into your collection with the price already filled in. |
| **Export and share** | Collection and want list as CSV files, or as text lists through the share sheet or clipboard. A **share link** sends a read-only snapshot of your list packed into the link itself. |
| **Import** | Imports a collection CSV in the same layout as the export (only Title is required), and can skip barcodes you already own. |
| **Backup** | Full JSON backup (download, or share on iOS), restore by merging or replacing, a reminder after 30 days, and a request for persistent storage. |

## Setup on your iPhone

1. Deploy (see below), open the site in Safari, then tap **Share → Add to Home Screen**.
2. **Get a TMDB key** (free, for non-commercial use): create an account at themoviedb.org, go to Settings → API and request a Developer key. Paste either the "API Key" or the "API Read Access Token" into **DiscShelf → Settings → Lookups**, then tap **Save key**.
3. Tap **Test connections** to confirm TMDB works from your phone.
4. Under **Settings → Retailer links**, tap through each shop's Barcode and Title links once. Any shop whose search page doesn't load properly needs its URL changing in `config.js`.
5. Tap **Keep my data**, then make a first backup to iCloud Drive.

## Deploying to GitHub Pages

**Every file sits in one folder; there are no subfolders.** To deploy or update:

1. Unzip the release and drag **all** the files into the repo's main folder on GitHub (Add file → Upload files), replacing what's there. Commit.
2. Only the first time, or if you previously used `/docs`: go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, then set the branch to `main` and the folder to **`/ (root)`**.
3. Delete anything left from older layouts: the `docs`, `tests` and `.github` folders.

Installed copies show a "Reload" banner when the new version arrives. **Settings → About this version** shows the address the app is running from, and has **Check for updates** and **Reload app from the internet** if it seems stuck.

To release a new version, change the version number in `config.js`, `sw.js` and `package.json` (a test fails if they differ), and add a line to `WHATS_NEW` in `view-intro.js`.

**Which files are the app?** Everything except the development files: `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `playwright.config.js`, `e2e-helpers.js`, `*.spec.js` and `*.test.js`. Those don't run in the app and contain nothing private, so uploading them alongside is fine; GitHub Pages serves them, but nothing links to them. `.nojekyll` is optional: macOS and Windows hide files starting with a dot, so you may not see it to upload, and the site works without it.

## Tests

```bash
npm install
npx playwright install chromium   # first time only
npm test                          # 35 unit tests (node --test) + 34 Playwright tests
```

- **Unit tests:** TMDB auto-matching (remakes, years ±1, films beating TV series, concurrency, stopping without a key), collection matching and title-list parsing (including "Fantasia 2000" not being read as a year), progress counts, ticking and unticking, money handling, barcode check digits (using real UK barcodes), finding the cheapest price for a condition, how value is chosen, title clean-up and format guessing, CSV quoting and formula protection, CSV export and re-import, share-link encoding, text lists, that every file is cached for offline use, that the CSP and config list the same outside services, and that every retailer link is valid.
- **End-to-end tests** (Chromium at iPhone 13 size):
  - Scanning: a fake camera shows a real EAN-13 barcode, and the real scanner code decodes it before the lookup and save run.
  - Lookups: UPCitemdb and TMDB are stubbed, so the tests never call the real services.
  - Want lists: price logging, cheapest price and marking as bought.
  - Collections: pasting titles, "I own it" and "Want it", one disc counting in several collections, filtering, TMDB franchise and paged list imports, and a regression test that an untouched tick box never removes a film.
  - Upgrading from a 0.4 database.
  - TMDB auto-matching after pasting, picking between remakes in the sheet, and "Not on TMDB".
  - Undo for deleted discs and collections.
- **Motion:** the tests run with Reduce Motion on, because screen transitions swallow taps for about 0.2 s, which only machine-speed clicking notices. `transitions.spec.js` runs with motion on, to check transitions never leave the screen locked or log errors.
  - Exports, share links (including in a second browser), CSV import and backup/restore.
  - The TMDB key never appears in backups.
  - Posters and the app work offline.
  - Rapid tab switching.
  - Any console error or CSP violation fails a test.
- **Not tested on WebKit**, which is the engine iPhone Safari uses. To add it, run `npx playwright install webkit` and add a project to `playwright.config.js`.

## Configuration

Everything you might want to change is in the config block at `config.js`: formats, packaging, regions and default region per format, conditions, the default wanted condition, retailer search URLs, when a price counts as stale, the backup reminder, and the share-link length warning. Outside services must be listed in **both** `config.js` and the CSP `<meta>` tag in `index.html`; a test checks the two match.

## Security and privacy

- **CSP:** `default-src 'none'`. Scripts and styles come only from this site, with no `unsafe-*`. The only outside connection allowed is `api.themoviedb.org`, plus images from `image.tmdb.org`. The camera is allowed through `mediastream:`. GitHub Pages can't set headers, so the CSP is a `<meta>` tag, and browsers ignore `frame-ancestors` there.
- **What leaves the device:** only TMDB searches and imports (the search text or list id, plus your key), poster downloads, and any retailer link you tap. Barcodes never leave the device. Your collection, want list and prices stay on the device unless you export or share them.
- **TMDB key:** stored only on the device. It is left out of backups, and a replace-restore keeps it. It appears in TMDB request URLs (v3 keys) or headers (v4 tokens) as TMDB requires.
- **Share links** put the snapshot after the `#` in the link, which browsers never send to the server, so GitHub never sees the list. The snapshot leaves out prices, barcodes and notes. Anyone you send the link to can read the list.
- **CSV exports** add a `'` before any cell starting with `= + - @`, so spreadsheet apps can't run them as formulas.
- User text is only ever inserted as plain text, never as HTML, and the tests check this.

## Data model (IndexedDB `discshelf`, schema 2)

Schema 2 (v0.5.0) added the `collections` store. Older data upgrades automatically when the new version first opens, and v0.1–v0.4 backups still restore.

| Store | Contents |
|---|---|
| `items` | Collection discs. Money is stored as whole pence. Includes `tmdbId`, `posterPath` and `mediaType` when matched on TMDB. |
| `wants` | `wantedCondition`, `targetPrice`, `status` (`wanted` or `bought`), and `boughtItemId` once bought. |
| `priceLog` | `wantId`, `ean`, `retailer`, `price`, `postage`, `condition`, `seenOn`, `url` and `note`. |
| `collections` | `name`, `description`, and `entries[]`, where each entry has `title`, `year`, `tmdbId`, `mediaType` and `posterPath`. Owned and wanted status isn't stored: it's worked out by matching your discs and wants. |
| `meta` | `lastBackupAt` and `secret.tmdbKey` (left out of backups). Old `cache.upc.*` and `upc.usage` keys from v0.4 are ignored and left out of backups. |

## Verified vs not

| Item | Status |
|---|---|
| UPCitemdb barcode lookup | **Removed in v0.5.0.** Settings → Test connections on your iPhone gave "Failed to fetch" while TMDB worked, which almost certainly means UPCitemdb blocks requests from web pages (CORS). It could only work through a proxy server, which is out of scope. I'm not aware of a free alternative that covers UK films and allows browser requests. |
| TMDB accepts requests from a browser | **Verified on your iPhone** (Test connections worked). |
| TMDB franchise and list endpoints (`/search/collection`, `/collection/{id}`, `/list/{id}` with pages) | Built against TMDB's documented v3 endpoints and tested with stubbed replies. **Not yet tried against real TMDB data.** If list import fails, check that the list is public. |
| TMDB is free for non-commercial use with attribution | Verified from TMDB's FAQ. The About section includes the required notice. **TMDB also asks for its logo** in the credits; I haven't included it because it must be one of TMDB's approved images, which you'd need to download yourself. |
| Retailer search URL formats | **Only Rarewaves confirmed** (its `/search?q=` format works, though it returned no results for a barcode). eBay, Amazon, CeX, Zavvi, HMV, Discogs and Google Shopping either blocked automated checks or returned a generic page. Test them from Settings → Retailer links. The musicMagpie entry searches their eBay shop (`_ssn=musicmagpie`), because I couldn't confirm their own site's search URL. |
| Camera scanning on iPhone | Tested in Chromium with a fake camera. **Not tested on a real iPhone.** Uses ZXing, because iPhone Safari is not known to have a built-in barcode reader. |
| CompressionStream for share links | In Safari 16.4 and later. Older browsers fall back to longer, uncompressed links. |

## Version history

| Version | Date | Summary |
|---|---|---|
| 0.6.0 | 2026-11-24 | Automatic TMDB matching for pasted titles, PokéBinder-style polish, all files in one folder |
| 0.5.0 | 2026-11-24 | Collections (checklists, many-to-many), TMDB franchise and list import, UPCitemdb removed, scanning checks your own data instead |
| 0.4.0 | 2026-11-24 | Scan and lookup, want list with price log and cheapest price, CSV/text export, share links, CSV import (v0.2–v0.4 released together) |
| 0.1.0 | 2026-11-24 | App shell, manual collection management, totals, backup and restore, offline use |
