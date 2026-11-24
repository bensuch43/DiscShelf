# DiscShelf

A personal app for tracking a DVD, Blu-ray and 4K UHD collection, plus a want list. It is a static PWA hosted on GitHub Pages, designed for iPhone, and works offline. All data is kept on the device in IndexedDB. There is no backend, no account, no Azure, and no paid service.

**Current release: v0.1.0** (see [CHANGELOG.md](CHANGELOG.md))

## What v0.1 does

- Add, edit and delete discs manually: title, year, barcode, format, packaging, region, condition, distributor, edition, number of discs, price paid, estimated value, where and when bought, and notes.
- Collection totals in GBP: number of items, amount paid, and value (your estimate if set, otherwise what you paid).
- Search across title, barcode, distributor and edition; filter by format; sort by title, recently added or value.
- Barcode check-digit warning and a duplicate-barcode warning. Neither blocks saving.
- Full backup to a JSON file (download, or share on iOS) and restore, either by **merging** (the newer copy of each record wins) or by **replacing** everything.
- A backup reminder banner after 30 days, and a button to request persistent storage.
- Works offline after the first visit, using a service worker. When a new version is available, the app shows a "Reload" banner; it never reloads by itself.

## Deploying to GitHub Pages

1. Create a GitHub repo, unzip this release into it, then commit and push to `main`.
2. In the repo, go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, then set the branch to `main` and the folder to **`/docs`**.
3. Open `https://<your-user>.github.io/<repo>/` in Safari on your iPhone, tap **Share**, then **Add to Home Screen**.
4. In the app, open **Settings → Keep my data** and make a first backup to iCloud Drive.

All paths are relative, so the app works under a `/<repo>/` subpath without changes.

### Releasing a new version

Change the version in **three** places: `docs/js/config.js` (`version`), `docs/sw.js` (`VERSION`) and `package.json`. A unit test fails if they differ. Changing `sw.js` is what makes installed copies offer the update.

## Running the tests

Requires Node 18+ and Python 3. Python is only used as the local web server.

```bash
npm install
npx playwright install chromium   # first time only
npm test                          # unit tests (node --test) + Playwright end-to-end tests
```

- **Unit tests** (`tests/unit`): money parsing and formatting, barcode check digits (including real UK EANs), value rules, backup validation, and whether the version numbers match.
- **End-to-end tests** (`tests/e2e`): run in Chromium at iPhone 13 size with touch enabled. They cover add, edit and delete, totals, search, filter and sort, validation, region defaults, the duplicate-barcode warning, HTML-injection safety, data surviving a reload, the backup reminder, backup and restore (merge and replace) on a fresh device, rejecting a bad restore file, rapid tab switching, and offline use through the service worker. Any console error or CSP violation fails the test.
- **Not tested on WebKit.** iPhone Safari runs on WebKit, but my build environment only had Chromium available. To add it, run `npx playwright install webkit` and add a project with `browserName: 'webkit'` to `playwright.config.js`.
- `.github/workflows/test.yml` runs the tests on every push, using free GitHub Actions minutes for personal repos.

## Configuration

Everything you might want to change is in the config block at `docs/js/config.js`: formats, packaging types, regions, the default region for each format, condition labels, the backup reminder interval and locale. The Content Security Policy is in the `<meta>` tag in `docs/index.html`, and that is the only place to add the domains of external services later.

## Security and privacy

- **Strict CSP:** `default-src 'none'`, scripts and styles only from the app's own origin, no `unsafe-inline`, and `connect-src 'self'`. In v0.1 the app makes no calls to outside services.
- GitHub Pages can't set HTTP headers, so the CSP is a `<meta>` tag. Browsers ignore `frame-ancestors` in a meta tag, so the app cannot stop other sites framing it. That is low risk for a personal app with no sign-in.
- User text is only ever inserted as plain text, never as HTML, and a test checks this.
- Backups leave out any setting whose key starts with `secret.`. That prefix is reserved for API keys in later releases, so a backup file never contains your keys.

## Data model (IndexedDB `discshelf`, schema 1)

| Store | Key | Used from | Notes |
|---|---|---|---|
| `items` | `id` (UUID) | v0.1 | Index on `ean`. Money is stored as whole pence (integers). |
| `wants` | `id` | v0.3 | Created now so v0.3 doesn't need a data migration. |
| `priceLog` | `id` | v0.3 | Index on `wantId`. |
| `meta` | `key` | v0.1 | Stores `lastBackupAt`; later releases add settings and `secret.*` keys. |

## Research status (verified vs not)

| Claim | Status |
|---|---|
| UPCitemdb free tier: 100 requests a day (search capped separately), 6 a minute, limited per IP, no key | Verified from UPCitemdb's own docs |
| UPCitemdb covers UK EANs | **Partly.** Of 2 UK steelbook EANs tested, 1 was found (with US merchants) and 1 was not. The sample is too small to measure coverage. |
| UPCitemdb accepts calls from a browser (CORS) | **Not verified.** To test in v0.2. |
| Zebra UPC lookup | Deprecated 4 Dec 2023, so dropped |
| Barcode Lookup free tier | **Not verified.** Only a "free test API account" was found. |
| TMDB is free for non-commercial use, with attribution | Verified from the TMDB FAQ |
| TMDB accepts calls from a browser (CORS) | **Not verified.** To test in v0.2. |
| eBay Browse API needs a client secret and a proxy server | Verified. Out of scope because the app is GitHub Pages only. |
| Amazon PA-API retired May 2026, replaced by the Creators API (needs an Associates account) | Verified from Amazon's own notices. Not free for a personal app. |
| PriceCharting API requires a paid subscription | Verified from PriceCharting's own docs |
| iPhone Safari has no built-in barcode reader, so v0.2 will bundle a scanner library | From memory. To confirm on a real device in v0.2. |
| Safari keeps home-screen apps' data longer than ordinary websites' | From memory. Mitigated by backups and the persistent storage request. |

## Roadmap

- **v0.2:** barcode scanning with the camera, using a scanner library bundled in the app. The barcode is looked up on UPCitemdb, then the film is matched on TMDB (using your own TMDB key, stored on the device), and you confirm the edition details. Lookups are saved by barcode, and the app shows TMDB attribution.
- **v0.3:** want list with wanted condition and target price. Links open each retailer's search by barcode or title (eBay UK, Amazon UK, Zavvi, CeX, MusicMagpie, HMV, Discogs). Every link format will be tested before it ships. A "Log price" button records price, postage, condition and date. Each want shows the cheapest total price in the wanted condition or better, with how old each price is, plus a price history. The latest logged price for a barcode and condition will then feed into collection value.
- **v0.4:** exports as CSV and as a text list, plus a read-only share link. The share link packs a snapshot into the URL, so it has a size limit and suits the want list or a filtered list rather than the whole collection.

## Version history

| Version | Date | Summary |
|---|---|---|
| 0.1.0 | 2026-11-24 | App shell, manual collection management, totals, backup and restore, offline use |
