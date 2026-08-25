# Protein Finds — course-informed mobile UX ledger

## Evidence boundary

The Expert message preserved in this project thread supplied one concrete long-form source:

- [FULL UI Design Mobile Apps Course — Malewicz](https://www.youtube.com/watch?v=ThmHV38Ecqk), 4:14:40

The complete 3,047-segment transcript is preserved in `malewicz-mobile-ui-course-transcript.txt` and `.json`. This ledger applies only lessons relevant to Protein Finds' grocery-product discovery loop; generic login, profile, and checkout examples were intentionally excluded.

## Implemented lessons

| Course evidence | Product problem | Implemented refinement | Verification |
|---|---|---|---|
| 06:28–07:27 — finger-sized controls and a 44px minimum | Important card and navigation actions were not consistently explicit | Added card-level Details and Add to basket controls; preserved ≥44×44 visible targets | `mobile-shell-test.js`; `review-test.js` |
| 13:04–14:06 — use consistent spacing and proximity to communicate groups | Discovery cards repeated verdict explanations and split decision data across weakly related rows | Consolidated protein, calories, and seeded value into one three-part decision strip; grouped store and freshness context beneath it | Chromium screenshot and decision-card assertions |
| 36:41 onward — cards should make scanning and next action obvious | Product cards were informative but lacked a primary shopping action | Added one prominent Add to basket action and one secondary Details action to every card | `test-platform.js`; `review-test.js` |
| 2:15:24–2:16:14 — keep primary navigation visible and focused, generally no more than five tabs | The shopping loop needed predictable destinations | Preserved the existing five-tab Discover/Nearby/Ask/Saved/Basket shell; no additional navigation was added | navigation and shell tests |
| 2:44:04–3:17:42 — detail screens should establish hierarchy and prioritize the main task | Package imagery dominated the mobile viewport; source verification competed with the shopping action | Reduced and bounded detail imagery; made Add to basket dominant; retained Save and View basket as secondary; moved source verification to a tertiary text action | detail hierarchy assertions; screenshot inspection |
| 3:24:30–3:36:08 — a selected map place should lead into a useful place-detail continuation | Marker selection lacked a strong selected-place label | Added a labeled selected grocery-store sheet with distance/catalog context and matching product-detail links | `location-browser-test.js` in Chromium and WebKit |
| 3:43:34–3:51:02 — confirmations and toasts should clearly acknowledge actions and offer a useful next step | Basket mutations were mostly silent | Added accessible save/add/remove confirmations and a View basket shortcut | toast and basket-continuation assertions; Axe |
| Final review/accessibility sections — remove accidental inconsistency, clipping, and weak contrast | Product-detail intrinsic image sizing could overflow after the image-height reduction | Added strict image bounds and overflow clipping; retained readable contrast, focus states, and source-honesty labels | 17 release checks; 0 Axe violations; portrait/landscape overflow and console checks |

## Shopping-flow outcome

1. Discover and compare exact catalog records.
2. Open Details or add directly from a card.
3. Receive visible action feedback with a direct basket continuation.
4. Inspect the basket by store and product; continue shopping or ask the grounded catalog agent to improve the trip.
5. Use Nearby's map/list views and selected-store sheets to continue into matching product details.

No live ordering, inventory inference, payment, login, profile, or unrelated checkout flow was added.

## Release evidence

- Before screenshots: `review-artifacts/before-*-390x844.png`
- After screenshots: `review-artifacts/after-*-390x844.png`
- Comparison sheets: `review-artifacts/before-contact-sheet.jpg`, `review-artifacts/after-contact-sheet.jpg`
- Automated checks: 38 unit/contract tests, location browser suite, 17 release checks, PWA suite, mobile shell suite
- Browsers/viewports: Chromium 390×844; WebKit 390×844 and 844×390
- Accessibility: 0 Axe WCAG A/AA violations
- Runtime: no reported browser console/page errors or horizontal overflow
