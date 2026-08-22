# Protein Finds V0 Roadmap

The canonical implementation queue lives in GitHub Issues. This file records dependency order and checkpoint definitions.

## Checkpoint 0 — Installable proof (shipped)

- Responsive grocery discovery prototype
- Search, filtering, product detail, comparison, saves, and basket
- Installable GitHub Pages PWA with cached offline shell
- Automated functional, accessibility, browser, and PWA checks

## Checkpoint 0.5 — Mobile app-shell reset

- Replace the landing-page information architecture while preserving useful data/scoring logic
- Search or products in the first phone viewport; products reachable within two taps
- Persistent bottom tabs with focused screens and independent scroll restoration
- Back navigation, exact product deep links, and explicit empty/loading/error/stale states
- Exact licensed product imagery recognizable on phone cards
- Portrait and landscape WebKit QA, 44px touch targets, no horizontal overflow or console errors

**Expert review:** frozen live mobile build, first-viewport screenshots, and exact acceptance-check evidence.

## Checkpoint 1 — Trusted catalog foundation

- Versioned product/store/source schema
- Deterministic scoring fields and explanation contract
- Import staging, validation, conflict review, and provenance
- Exact front-package, nutrition-label, and ingredient-image contracts with variant/size/UPC identity and licensing provenance
- Seed expansion using source-backed grocery records

**Expert review:** product/data architecture and sample records.

## Checkpoint 2 — Complete grocery-trip loop

- Category-led discovery
- Search → product → save interaction under five seconds
- Store-grouped basket with totals and missing-category prompts
- Clear verification and freshness labels

**Expert review:** frozen live mobile build and core-loop QA.

## Checkpoint 3 — Local discovery moat

- User location and explicit ZIP fallback
- Store directory and map/list interaction
- Vendor spreadsheet intake
- Local Indian-grocery products, prices, and availability with timestamps

**Expert review:** location, maps, and vendor-data QA.

## Checkpoint 4 — Ask Protein Finds

- Natural-language intent translated into deterministic catalog filters
- Grounded comparison and basket recommendations
- No invented products, prices, availability, or health claims

**Expert review:** adversarial grounding and usefulness QA.

## Checkpoint 5 — Closed-beta candidate

- Durable backend and migration path
- Error/empty/loading/offline states
- Privacy and analytics boundary
- Device matrix and release checklist

**Expert review:** consolidated release-candidate pass.

## Operating rules

- PWA is canonical V0; Expo is deferred.
- One meaningful feature per issue.
- GitHub issues are the execution truth; GBrain stores durable decisions.
- Owner interruptions are reserved for real gates.
- Every checkpoint requires a frozen commit, live URL, test evidence, and one consolidated independent QA pass.
