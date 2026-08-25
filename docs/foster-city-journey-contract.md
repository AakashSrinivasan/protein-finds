# Foster City exact-SKU journey contract

## Milestone scope

This milestone proves one honest end-to-end path before catalog breadth expands:

`exact SKU → evaluate → nearby store → retailer handoff → community confirmation`

The first golden-path record is **Beyond Steak Plant-Based Seared Tips, 10 oz, UPC 0810057290831** with an exact Safeway-on-Instacart order handoff and an official Target search fallback. This does **not** assert inventory or a current store price. Foster City is a verification seed, not a local-only product boundary; the same market, store, SKU, evidence and typed-handoff primitives must support the next city without redesign.

## Implementation sequence

1. **Exact identity** — attach variant, package size, UPC, package-front image provenance, nutrition source, ingredients, and allergens to one canonical product.
2. **Evaluate** — show protein, calories, protein efficiency, dietary fit, allergens, ingredients, source freshness, and explicit unknowns on the exact-product route.
3. **Nearby store** — resolve the exact identity to the indexed Foster City-area Target search path; show distance from ZIP 94404, address, checked time, and unknown inventory separately from catalog eligibility.
4. **Retailer/order handoff** — render typed `exact-product`, `retailer-search`, and `directions` handoffs. The exact order page may be location-personalized; never convert that into a local stock or price claim.
5. **Community confirmation** — let a user record “I found this here” locally as a pending moderation report. A local report never upgrades inventory status, freshness, or trust until a durable moderated backend exists.
6. **Verification/freeze** — browser-test the whole path in Chromium and iPhone WebKit, audit Axe/console/overflow, then freeze exact bytes and hashes.

## Acceptance contract

### 1. Exact SKU

A qualifying product page must show:

- brand + product + variant;
- package size and UPC;
- exact package image or an explicit `image needed` state;
- image source, license/permission class, and attribution;
- serving size and servings per package;
- calories, protein, complete available macros, ingredients, and allergens;
- field/source timestamp and source URL;
- no family-page or search-page evidence presented as exact-SKU proof.

**Fail closed:** an absent field renders `Unknown`; it is never inferred from another flavor, size, family, or retailer.

### 2. Evaluate

The page must provide a plain-language verdict and expose the arithmetic behind:

- protein grams per serving;
- calories per serving;
- protein grams per 100 calories;
- protein cost only when an observed price and package basis are known;
- vegetarian/vegan, soy, dairy, gluten, and allergen status.

**Fail closed:** unknown price cannot enter price-per-dollar ranking; unknown dietary/allergen state cannot satisfy an exclusion filter.

### 3. Nearby store

For each product/store association, show:

- exact store identity and address;
- deterministic distance from the selected location;
- availability state from: `in-stock`, `likely`, `stale`, `unavailable`, `unknown`;
- confidence and checked timestamp when an observation exists, otherwise explicit `unknown`;
- the typed source/handoff URL.

**Fail closed:** store proximity, brand assortment, a retailer product page, or a user report alone never becomes an in-stock claim.

### 4. Retailer/order handoff

The product page must provide:

- Directions to the exact store;
- a typed exact-product handoff when verified and a clearly labeled retailer search/store fallback;
- external-link labeling;
- no claim that Protein Finds submitted an order, reserved stock, or confirmed price.

### 5. Community confirmation

The product/store panel must provide `I found this here` and record:

- product ID;
- store ID;
- client report timestamp;
- moderation state `pending-local`.

The UI must immediately disclose that the report is stored only on this device, is unverified, and does not change inventory status. Duplicate reports for the same product/store replace the local timestamp rather than inflate counts.

### Golden-path browser assertion

At `#product/beyond-steak`, a user can:

1. recognize the exact 10 oz package and UPC;
2. evaluate vegan + soy-free fit, 21 g protein, 170 calories, allergens, ingredients, and evidence;
3. see Target Bridgepointe, distance from 94404, `unknown` inventory, `Price unknown`, and checked time;
4. open Directions, **Check Safeway on Instacart** for the exact 10 oz item, or **Search Target** by UPC;
5. click `I found this here` and see a persisted pending-local confirmation without any stock claim.

## Breadth gate

This milestone proves the contract, not Foster City comprehensiveness. Catalog and store coverage counts, exact-image gaps, missing evidence, and unresolved retailer links must remain visible in the freeze receipt. The next expansion unit is an exact SKU that satisfies this same contract—not another decorative page or unsupported feature.
