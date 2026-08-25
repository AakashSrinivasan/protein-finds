# Protein Finds — Iteration 3 live checkpoint

## Scope

Iteration 3 remediates the five findings from Expert's Iteration 2 QA:

1. Comparison recommendations now use either the active shopper goal or visible metric-win count; no hidden composite decides the winner.
2. Recommendation copy states the exact criterion and visible evidence.
3. Comparison headers, metric labels, values, and winner markers use readable mobile typography.
4. Every promoted recommendation exposes Details, Compare, and Add directly.
5. Short landscape fits one complete recommendation and action above fixed navigation.
6. Desktop uses a compact single-line decision header, contained media, and a dense three-card action workspace.
7. Catalog provenance is progressively disclosed rather than repeated across the shopping surface.

## Truth boundary

Catalog, price, and availability records remain demo fixtures dated 2026-08-13. Price and inventory are not live. Only exact licensed variant images are displayed; missing images use compact identity tiles.

## Evidence

- `iteration-3-iphone-portrait-discover.png`
- `iteration-3-iphone-landscape-discover.png`
- `iteration-3-laptop-discover.png`
- `iteration-3-iphone-portrait-compare-balanced.png`
- `iteration-3-iphone-portrait-compare-protein.png`
- `test-receipt.txt`

## Final local gate

The receipt records a clean install and all required suites:

- 38 core/contract tests
- location data plus Chromium/WebKit map checks
- 19 release checks
- 0 Axe violations
- 0 browser errors
- PWA/offline/cache checks
- portrait, short-landscape, desktop, touch-target, overflow, Back/scroll, and console checks
- `git diff --check`

This checkpoint is intentionally published before Iterations 4–8. Publication does not constitute final product acceptance or completion of the eight-iteration loop.
