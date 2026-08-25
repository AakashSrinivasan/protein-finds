# Iteration 4 — Universal Product Screener QA handoff

## Review contract

This is a frozen, branch-only checkpoint for independent review. **Do not merge or deploy from this handoff.** Production remains on the Iteration 3 checkpoint.

- Branch: `feature/universal-product-screener`
- Base: `b2ebbf8e63fc9fb213889f7e829a545198b3cd88`
- Issue: [#23 — Iteration 4: approachable universal product screener](https://github.com/AakashSrinivasan/protein-finds/issues/23)
- Review route: `#screener`
- Truth boundary: results cover the current 12-product grocery seed only; the interface does not claim comprehensive market coverage.

## Visible behavior

- Three common quick screens.
- Plain-language product type, minimum-protein, maximum-calorie, exclusion, and preparation controls.
- Inclusive numeric thresholds and deterministic AND semantics.
- Live survivor count and removable active-criteria clauses.
- Transparent sorting by protein, calories, protein efficiency, seeded cost per 25g, or name.
- Details, Compare, and Add actions on every result.
- Explicit empty state and reset.
- Explicit unknown seeded-price disclosure; unknown prices remain counted and sort last for price ranking.
- Progressive filter disclosure on phone; side-by-side builder/results workspace on larger viewports.

## Data/schema boundary

No canonical catalog records, product facts, schema files, UPCs, imagery, prices, or availability observations were added or changed.

`product-screener.js` is a standalone deterministic projection over an injected product array. It derives categories and totals from the supplied records; it does not enumerate the 12 product IDs. Criteria and sort definitions are centralized in immutable maps. Filtering is O(products × active exclusions), with one stable result sort, so the engine can operate on a larger in-memory catalog without duplicated DOM logic. A future server-backed catalog can preserve the same normalized screen contract while moving execution behind an API.

Missing-data rules:

- Numeric thresholds require a finite product value; unknown values fail the active threshold rather than receiving a favorable default.
- Exclusions require the corresponding field to be explicitly `true`; unknown values do not pass.
- Unknown seeded prices remain visible, are disclosed in the result surface, and sort after known prices.
- Empty combinations return zero results; criteria are never silently widened.

## State persistence

The normalized screen object is persisted inside the existing `protein-finds-state` local-storage record under `screener`:

- `category`
- `minProtein`
- `maxCalories`
- `exclusions[]`
- `prep`
- `sort`

Persisted input is normalized against supported categories, exclusions, preparation modes, sorts, and nonnegative finite thresholds before execution. Malformed values fall back to safe supported defaults. The phone builder's open/closed presentation is ephemeral UI state and is intentionally not persisted. The route remains refresh-safe through `#screener`.

## Changed source/test files

- `app-shell.css`
- `app.js`
- `index.html`
- `manifest.webmanifest`
- `mobile-shell-test.js`
- `package.json`
- `product-screener.js` (new)
- `product-screener.test.js` (new)
- `review-test.js`
- `service-worker.js`
- `test-platform.js`

The service-worker shell cache moves from `protein-finds-shell-v10` to `protein-finds-shell-v11` and includes `product-screener.js`.

## Evidence matrix

- `portrait-default-390x844.png` — phone first viewport, collapsed custom builder, live count, first result.
- `short-landscape-844x390.png` — short-landscape first viewport.
- `desktop-1440x900.png` — desktop side navigation and two-column workspace.
- `quick-screen-20g-under-200-390x844.png` — quick screen, two active clauses, two truthful survivors.
- `custom-criteria-portrait-full.png` — product type + nutrition + exclusion + preparation criteria with one survivor.
- `results-default-portrait-full.png` — complete 12-result seed rendering.
- `empty-state-portrait-full.png` — incompatible maximum-calorie criterion and zero-result recovery.
- `comparison-3-products-portrait-full.png` — three-product comparison reached from Screener result actions.
- `full-test-receipt.txt` — unabridged clean-install, syntax, deterministic, browser, Axe, responsive, location, PWA/offline, and diff-integrity output.

## Exact verification result

The final pre-freeze run used an explicit local target whose served `index.html` SHA-256 matched the working tree:

- `npm ci`: passed, 0 vulnerabilities.
- JavaScript syntax checks: passed.
- Core deterministic/browser contract suite: 47/47 passed plus platform flow pass.
- Release checks: 21 passed; 0 Axe violations; 0 browser errors.
- Chromium and iPhone WebKit portrait/landscape shell checks: passed.
- Location/map regression and Axe checks: passed.
- PWA/install/offline/service-worker checks: passed.
- `git diff --check`: passed.

See `full-test-receipt.txt` for every unabridged test name and command output.
