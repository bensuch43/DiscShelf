# Changelog

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
