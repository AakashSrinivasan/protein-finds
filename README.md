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
```

## Current boundary

All product, price, ingredient, and availability records are seeded prototype data. They demonstrate discovery, filtering, comparison, saves, basket planning, and source handoffs; they are not current inventory or individualized medical advice.
