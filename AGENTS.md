# Protein Finds Agent Instructions

## Product

Protein Finds is a mobile-first vegetarian grocery discovery and basket-planning PWA. The V0 wedge is a complete high-protein grocery trip across categories and stores—not a generic nutrition tracker or restaurant social feed.

Canonical test build: https://aakashsrinivasan.github.io/protein-finds/

## Source of truth

- GitHub issues define bounded implementation work, dependencies, acceptance criteria, and status.
- `main` must remain deployable.
- GBrain holds durable product decisions and validated research; do not use it as a duplicate ticket board.
- Current product, price, ingredient, and availability values are demo fixtures unless a source record explicitly proves otherwise.

## Execution contract

1. Read the selected issue and this file before editing.
2. Work on only one issue-sized deliverable at a time.
3. Use a branch or isolated worktree. Never overwrite unrelated work.
4. Prefer deterministic filters, scoring, imports, and tests over model calls.
5. Never silently overwrite a verified catalog value. Imports must preserve provenance and route conflicts to review.
6. Do not claim live price, inventory, distance, or nutrition without a timestamped source.
7. Choose a reversible sensible default for non-blocking ambiguity and record it in the issue.
8. Block only for a true owner gate: spending, credentials/MFA, public submission beyond this repository, vendor access, legal/privacy choices, or a product decision that materially changes scope.
9. Before completion, run all relevant tests, exercise the phone-visible path, inspect the diff, and report exact evidence.
10. Commit and push only verified changes. Link the commit or pull request to the issue.

## Required checks

```bash
npm test
npm run serve
npm run verify
npm run test:pwa
git diff --check
```

Run browser checks against both the local server and the deployed GitHub Pages URL when changing user-visible behavior, the manifest, service worker, or deployment paths.

## V0 boundaries

Prioritize:

- grocery products before restaurants;
- search → understand ranking → save → store-grouped basket;
- protein, calories, price, dietary fit, source, and verification state;
- one metro/ZIP and curated high-interest products;
- vendor CSV/Google Sheets intake with human review;
- exact package imagery tied to variant, size, and UPC, with explicit `image needed` states instead of generic or unlicensed substitutes;
- Ask Protein as a catalog-grounded query and basket-improvement layer.

Defer until the core loop proves useful:

- social feeds, followers, streaks, and restaurant-ranking mechanics;
- nationwide real-time inventory promises;
- native Expo/App Store work;
- checkout, payments, and broad retailer integrations;
- model-dependent ranking.

## Security and privacy

Never commit credentials, private chat IDs, vendor-confidential files, personal health context, private GBrain material, or employer/client information. Use sanitized fixtures in the public repository.
