# Changelog

## 0.6.1 — 2026-11-25

### Changed

- **Shop links now follow your iPhone test results.**
  - eBay UK, Amazon UK and CeX keep both Barcode and Title buttons.
  - musicMagpie, HMV, Rarewaves, Discogs and Google Shopping show Title only, because their search doesn't find discs by barcode.
  - Each shop in `config.js` now has a `barcode` flag, and all are marked tested.
- **Zavvi removed** because it's no longer trading. Prices you logged at Zavvi are kept, and still count as the cheapest where they are.
- The Edition field's example text no longer mentions Zavvi.

## 0.6.0 — 2026-11-24

### Added

- **Automatic TMDB matching** for pasted collection titles, run straight after you paste.
  - Matching uses the year (±1) to tell remakes apart, prefers a film over a TV series of the same name, and keeps your own wording of the title.
  - Ambiguous titles (e.g. The Lion King with no year) show **Pick match**; tap the film to choose. Titles TMDB doesn't know show **Not found**; search again or keep them as they are.
  - A **Match with TMDB** button handles titles added without a key, or offline.
  - A disc now also counts towards a film if it matches TMDB's full title, so a "Snow White" entry is ticked by a disc saved as "Snow White and the Seven Dwarfs".
- **Film sheet:** tap any film in a collection to open it. You can view the disc or want, Want it, I own it, fix the TMDB match, or remove it.
- **Polish, borrowing PokéBinder Studio's patterns:**
  - The same design tokens, with a dark default theme and a light theme. It follows your device, or set it in Settings → Appearance.
  - A sticky blurred top bar with the logo, and tab icons.
  - Stat cards on the Discs screen, and a progress ring on each collection with a one-time celebration when it's complete.
  - Poster grids: missing films are greyed out, wanted ones half-greyed, and owned ones in full colour with a tick. Collections default to the poster grid; Discs has a list/poster switch.
  - Undo (7 seconds) instead of "Are you sure?" when deleting discs, wants, prices, collections and collection films. Replace-restore and CSV import still ask first, because Undo can't reverse those.
  - Screen transitions where the browser supports them, skipped when Reduce Motion is on.
  - A "What's new" card after updates, and a "Getting started" card on an empty library.
  - Settings → **About this version**: the address the app is running from, **Check for updates**, and **Reload app from the internet**. The app also checks for updates whenever you switch back to it.

### Changed

- **All files in one folder.** There are no `docs/`, `js/`, `css/`, `icons/`, `vendor/` or `tests/` folders any more. Screen files are named `view-*.js`. **Set GitHub Pages to deploy from `/ (root)`** and delete the old folders.
- The GitHub Actions test workflow has been dropped, because it needs a `.github` folder. Run `npm test` locally if you want the tests.
- Wants and collection additions show an Undo toast.

### Fixed during build

- **Skipped screen transitions logged console errors.** Navigating quickly made the browser log "Transition was skipped"; these are now handled.
- **Text typed during a screen transition could land in the outgoing copy of the form.** The screen is now locked until the new one is in place.
- **Matching progress could stall.** After pasting, the counter wrote to a screen that had already been replaced, and the final refresh was skipped. Matching now announces when it finishes, and whichever screen shows that collection refreshes itself.
- **Pasting without a TMDB key showed an error toast.** It now shows a clear note in the collection instead.

## 0.5.0 — 2026-11-24

### Added

- **Collections:** named checklists of films, with a new Collections tab.
  - Add films by pasting titles (one per line; years in brackets), by TMDB search, by importing a TMDB franchise, or by importing a public TMDB list (all pages are fetched).
  - Each film shows Owned (with the formats you own), On want list, or Missing, and each collection shows how many you own.
  - "Want it" adds a want with no format set; "I own it" opens Add disc already filled in and brings you back to the collection afterwards.
  - Filter (all / owned / missing / wanted), sort (list order, title, year), share the checklist as text, rename, and delete. Deleting a collection never touches your discs or wants.
  - A film can be in any number of collections.
  - The disc screen has a tick box for each collection, the Discs tab can be filtered by collection, and pasted titles pick up TMDB posters from matching discs.
- **Scanning now checks your own data:** if you already own the barcode or have it on your want list, the app says so and copies the details across.
- Wants can be "Any format".
- 7 more unit tests and 6 more end-to-end tests, including the database upgrade from 0.4.

### Changed

- **UPCitemdb removed.** It blocks requests from web pages (shown by "Failed to fetch" on your iPhone), so it can never work from GitHub Pages without a proxy server. It's gone from the code, the security policy and Settings. Scanning now fills in the barcode and hands over to title search.
- **Tabs:** "Collection" is now **Discs**, and there's a new **Collections** tab (5 tabs, smaller labels).
- The database moves to version 2 with a new `collections` store, and existing data upgrades automatically. If another tab or window has DiscShelf open during the upgrade, the app asks you to close it.

### Fixed during build

- **Adding a disc could silently remove its film from a collection.** If a matching film was in a collection and you left that collection's box unticked, saving removed the film from the checklist. Now the tick boxes follow the title as you type, and only boxes you actually change are applied. A regression test covers it.
- Owned formats are always listed in the same order (DVD, Blu-ray, 4K UHD).

## 0.4.0 — 2026-11-24 (covers the planned v0.2, v0.3 and v0.4)

### Added

- **Scan and lookup (v0.2 scope)**
  - Camera barcode scanning. The app uses the browser's built-in barcode reader where there is one, and otherwise the bundled ZXing library (Apache-2.0), loaded only when you scan.
  - Only barcodes with a valid check digit are accepted, and you can type a barcode instead.
  - UPCitemdb lookup, with each barcode remembered on the device and a daily usage counter.
  - Format and packaging guessed from the shop's listing.
  - TMDB title search using your own key; choosing a result adds a poster, and posters are kept for offline use.
  - **Settings → Test connections.**
- **Want list (v0.3 scope)**
  - Each want has a wanted condition (or better) and a target price, and wants at or under target are tagged.
  - Search links for 9 shops, by barcode and by title, plus a **Settings → Retailer links** checker.
  - A price log with price, postage, condition, date, link and note.
  - The cheapest total in your condition or better, a warning on prices over 30 days old, and a price history with delete.
  - **Mark as bought** creates the collection item with the price already filled in.
- **Exports (v0.4 scope)**
  - Collection and want list as CSV files (Excel-safe, with formula protection), and as text lists through the share sheet or clipboard.
  - Read-only **share links**: the list is compressed into the link after the `#`, so it never reaches GitHub.
  - CSV import of the collection format, with duplicate skipping.
- **Collection value** now uses logged prices: your own estimate first, then the latest logged price for the same barcode (and condition), then the price paid.
- The edit screen says where each disc's value comes from.
- A Wants tab, now four tabs in total.
- 15 more unit tests and 10 more end-to-end tests, including a real barcode decode from a fake camera.

### Changed

- **The order of value sources is not what I said earlier.** I had said logged prices would come first. Your own estimate now wins instead, because it's a deliberate choice; clear the estimate to use logged prices.
- `app.js` is split into `ui.js` plus one file per screen (`js/views/`). The logic is carried over, not rewritten. `docs/` now holds 29 files (including the 360 KB scanner library and its licence), up from 15.
- Backups now also leave out the lookup cache and the usage counter.

### Fixed

- **Replace-restore deleted your TMDB key.** Keys are never in backups, so replacing everything wiped the key. It's now kept.
- **A backup followed straight away by a restore could lose the chosen file.** Making a backup used to redraw the whole Settings page, so a restore file picked straight afterwards could be dropped. Now only the "Last backup" line updates.
- **Empty optional lines on a want showed the word "null".** Found during visual QA.
- **The "Show bought" checkbox was huge, and a small-button style was applied to small text, which indented it oddly.** Both found during visual QA.

### Open items

- Check retailer URLs and API access on your phone (see README "Verified vs not").
- Add the TMDB logo to About if you want full attribution compliance.

## 0.1.0 — 2026-11-24

### Added

- A static PWA in `docs/` for GitHub Pages: manifest, icons, a cache-first service worker, and a reload-to-update banner.
- IndexedDB storage with `items`, `wants`, `priceLog` and `meta` stores.
- Collection screen with totals (items, amount paid, value), search, format filter and sort.
- Add and edit form with check-digit and duplicate warnings on the barcode, region defaults per format, and amounts in pounds stored as pence.
- Settings screen with JSON backup (download or share), restore (merge or replace) with validation, persistent storage request, and a backup reminder.
- Strict Content Security Policy as a meta tag.
- 7 unit tests and 14 Playwright tests in Chromium at iPhone size, plus a GitHub Actions workflow.

### Decisions to review

- **Format and packaging are separate fields.** The brief listed steelbook and boxset alongside DVD/Blu-ray/4K. I treated those as packaging, so a disc can be both "4K UHD" and "Steelbook".
- **Value = your estimate, otherwise what you paid.** From v0.3, the latest price you logged for the same barcode and condition will come first.
- **No eBay live prices.** The app stays static on GitHub Pages, and eBay's API needs a server to hold the secret key.
- **"DiscShelf" is a placeholder name.** It's set in `config.js`, `index.html` and `manifest.webmanifest`.
- **Icons are a plain generated disc**, not a designed brand.

### Fixed during build

- The first visit reloaded the page when the service worker took control, which could lose a half-filled form. The app now reloads only after you tap "Reload".
- Quickly switching tabs could let a slower page overwrite the current one and show an error. Each page now loads its data first and only draws if it is still the current page.
- New DVDs were given the region "Blu-ray B". The region now follows the chosen format until you pick one yourself.
