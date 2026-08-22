# Protein Finds V0 data contract

`catalog-contract.js` is the executable contract. `catalog-fixtures.js` contains five representative, non-live examples. The contract version is `protein-finds.catalog.v0`.

## Truth boundary

Products describe stable identity. They never contain nutrition, ingredients, price, or availability values. Those values are append-oriented observations because they can differ by exact package, source, store, and time.

Every observation includes:

- `productId` and optional `storeId`;
- one field: `nutrition`, `ingredients`, `price`, or `availability`;
- a field-specific `value` union with `knowledge: "known"` or `knowledge: "unknown"`;
- a non-empty `reasonUnknown` as the only payload for an unknown value;
- `sourceId`;
- a strict UTC ISO-8601 `observedAt` timestamp (`YYYY-MM-DDTHH:mm:ss[.sss]Z`);
- `verificationState`: `unverified`, `source-backed`, `conflict`, `stale`, or `rejected`.

Known values are validated by field:

- nutrition requires positive serving size/unit and finite non-negative calories, protein, fiber, and sodium; protein-quality classification is optional but enumerated;
- ingredients requires non-empty source text and normalized ingredients; processing level is optional but enumerated;
- V0 price requires a finite non-negative amount and `USD`; no cross-currency normalization is implied;
- availability is one of `in-stock`, `limited-stock`, or `out-of-stock`.

Price and availability always require a store. Unknown values cannot carry known-value fields. Validators and scorers do not manufacture zero price, in-stock inventory, nutrition, ingredients, or favorable score inputs.

The included records are historical interaction fixtures. They are not evidence of current prices, inventory, nutrition panels, ingredients, or exact packages.

## Entities

### Product

A product owns discovery identity only:

- non-empty `id`, `kind`, `name`, `category`, `markets`, and dietary-tag array;
- explicit `preparationMinutes`, which is nullable until proven;
- packaged identity: non-empty brand, nullable non-empty variant, positive package size with an allowed unit, and nullable 8–14 digit UPC;
- whole-food identity: null brand/package/UPC plus a non-empty generic variant descriptor;
- image slots for `front`, `nutrition`, and `ingredients`.

Packaged and whole-food identities deliberately have different required/null-permitted shapes. Missing identity data is not invented to make records pass.

### Media asset

Images are first-class `mediaAssets`, not descriptive fields embedded in a product. A verified asset requires:

- stable asset ID and product ID;
- role: `front`, `nutrition`, or `ingredients`;
- retrievable `https://` or managed `asset://` locator;
- SHA-256 digest;
- source ID and explicit non-`unknown` license;
- strict UTC capture timestamp;
- `source-backed` verification state;
- an exact copy of the product identity tuple (brand, variant, package size, UPC).

A product image slot is either `{status: "verified", assetId}` pointing to an asset for the same product and role, or `{status: "needed", reasonMissing}`. Generic, merely similar, unlicensed, unbound, or unretrievable package art cannot pass the contract.

### Store and source

A store has a stable ID, display name, kind, location, and optional external ID. Store IDs are referenced by observations; store facts do not belong on products.

A source records its kind, title, publisher, locator, and strict UTC access time. A source is provenance, not automatic verification. Search and family pages can support discovery while their observations remain `unverified`.

### Conflict

A conflict points to two or more unique observations for one product and exact field/path. Each observation reciprocally names the conflict.

- `open`: resolution is null and every linked observation is marked `conflict`;
- `resolved`: resolution records the winning observation, reason, reviewer, and review time; the winner is `source-backed` and alternatives are `rejected`.

Consumers must not select any observation from an open conflict. The reviewed lifecycle retains all original claims instead of overwriting them.

## Deterministic score contract

`scoreAxes(input)` contains the six pure arithmetic/classification functions. Every result contains `score`, `status`, exact `inputs`, `formula`, and a plain-English `explanation`.

| Axis | Deterministic rule | Required inputs |
| --- | --- | --- |
| Protein efficiency | 20 g protein per 100 calories maps to 100, clamped to 0–100 | protein grams, positive calories |
| Value | USD cost per 25 g protein; `100 - cost * 6.4`, clamped | protein grams, USD price |
| Protein quality | complete 100, complementary 75, incomplete 50 | sourced quality classification |
| Food quality | processing base plus fiber bonus minus sodium penalty | processing level, fiber, sodium |
| Personal fit | 100 only when all required tags match and excluded tags do not | product tags and explicit preferences |
| Convenience | preparation-time band adjusted by current availability | preparation minutes, availability |

Missing required inputs produce `{score: null, status: "unknown"}`. They never receive neutral, zero, or favorable defaults.

### Evidence admission

Production consumers call `scoreCatalogProduct(catalog, options)`, not the pure score functions directly. The admission boundary requires:

1. an otherwise valid catalog;
2. explicit observation IDs for each selected evidence type;
3. the expected product and store;
4. `source-backed`, known observations outside open conflicts;
5. an explicit strict-UTC `now` and positive freshness window;
6. an explicit supported expected currency (USD in V0).

Rejected, stale, future-dated, unknown, conflicted, wrong-product, wrong-store, wrong-field, or unsupported-currency evidence cannot populate score inputs. Each axis returns selected evidence IDs, verification states, identity IDs where relevant, and deterministic `ineligibleReasons`. This explains both the arithmetic and why each input was or was not admitted.

`rankCatalog(candidates, weights)` is retained for pure deterministic ranking of already-admitted inputs. It requires explicit non-negative weights, averages only scored axes, and returns coverage. Downstream catalog consumers must perform evidence admission first.

## Representative fixtures

The fixtures cover the issue contract without claiming live truth:

1. packaged grocery: exact-size tofu identity with all image slots explicitly `needed`;
2. produce/whole food: generic raw broccoli;
3. Indian-grocery item: packaged paneer with unknown exact-panel ingredients;
4. store-specific offer: tofu price and unknown availability tied to one store;
5. source conflict: manufacturer and retailer tofu calorie observations retained together in an open, reciprocal conflict.

Cooked lentils provide a second whole-food example used to exercise sourced nutrition structure. `mediaAssets` is intentionally empty because no exact licensed fixture image has been verified; tests prove the valid first-class asset path without publishing a false image claim.

## Import and migration boundary

The current `data.js` array remains the legacy UI fixture until a downstream consumer ticket migrates the screen. It mixes product identity with demo values and must not be imported as verified V0 data.

A future importer must:

1. normalize product identity without inventing UPC, package, variant, or preparation fields;
2. create or match stores and sources independently;
3. append one field-specific known/unknown observation per sourced field and timestamp;
4. validate the complete candidate catalog before persistence;
5. preserve existing observations;
6. create reciprocal conflicts rather than choosing the newest or most convenient value;
7. create media assets only for retrievable, hashed, licensed, source-backed exact-package imagery;
8. project observations into UI view models only through explicit conflict, freshness, store, and currency admission policy.

There is intentionally no Supabase schema, remote persistence, broad API import, UI migration, or model-backed ranking in V0 of this contract.

## Verification

```bash
npm test
```

The contract tests cover representative records, identity/observation separation, strict known/unknown payloads, package identity, exact media binding, conflict resolution, timestamp parsing, provenance-aware score admission, all six explanations, explicit-weight ranking, and adversarial malformed inputs.