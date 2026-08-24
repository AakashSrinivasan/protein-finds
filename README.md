# Protein Finds

A mobile-first vegetarian protein grocery discovery and basket-planning prototype.

## Try it

Open **https://aakashsrinivasan.github.io/protein-finds/** on a phone.

- iPhone/iPad: Safari → Share → **Add to Home Screen**
- Android: Chrome menu → **Install app** or **Add to Home screen**

The installed progressive web app opens from the home screen, works with a cached shell, and updates from the same free GitHub Pages URL. No App Store account or subscription is required for this test stage.

## Run locally

```bash
npm ci
npm run serve
```

Open `http://localhost:4173`.

## Verify

```bash
npm test
# with the local server running
npm run verify
npm run test:location
```

## Current boundary

All product, price, ingredient, and availability records are seeded prototype data. They demonstrate discovery, filtering, comparison, saves, basket planning, and source handoffs; they are not current inventory or individualized medical advice.

The versioned catalog/provenance contract and its migration boundary are documented in [`DATA.md`](DATA.md). Deterministic CSV/JSON staging, conflict routing, and accepted-only application live in [`catalog-import.js`](catalog-import.js); the sanitized vendor example is [`fixtures/vendor-catalog-sanitized.csv`](fixtures/vendor-catalog-sanitized.csv).

The opt-in geolocation, ZIP fallback, sourced coordinate fixtures, deterministic distance calculation, map/list synchronization, availability boundary, and zero-quota map path are documented in [`LOCATION.md`](LOCATION.md).
