# Protein Finds V0 data contract

`catalog-contract.js` is the executable contract. `catalog-fixtures.js` contains five representative, non-live examples. The contract version is `protein-finds.catalog.v0`.

## Truth boundary

Products describe stable identity. They never contain nutrition, ingredients, price, or availability values. Those values are observations because they can differ by package, source, store, and time.

Every observation includes:

- `productId` and optional `storeId`;
- one field: `nutrition`, `ingredients`, `price`, or `availability`;
- the observed `value`, including an explicit reason when the value is unknown;
- `sourceId`;
- ISO 8601 `observedAt`;
- `verificationState`: `unverified`, `source-backed`, `conflict`, `stale`, or `rejected`.

Price and availability always require a store. An unknown value stays unknown; validators and scorers do not manufacture zero price, in-stock inventory, nutrition, ingredients, or favorable score inputs.

The included records are historical interaction fixtures. They are not evidence of current prices, inventory, nutrition panels, ingredients, or exact packages.

## Entities

### Product

A product owns discovery identity only:

- `id`, `kind`, `name`, `category`, and `markets`;
- `identity.brand`, `identity.variant`, `identity.packageSize`, and `identity.upc`;
- dietary tags;
- image contracts for `front`, `nutrition`, and `ingredients`.

A packaged product can retain `null` for an identity field that has not been proven. A verified image must name its source, license, and assert `exactPackage: true`; otherwise its status is `needed`. Generic or merely similar package art is not accepted.

### Store

A store has a stable ID, display name, kind, location, and optional external ID. Store IDs are referenced by observations; store facts do not belong on products.

### Source

A source records its kind, title, publisher, locator, and access time. A source is provenance, not automatic verification. Search and family pages can support discovery while their observations remain `unverified`.

### Observation

Observations are append-oriented claims. New imports add observations rather than overwriting previous values. Conflicting claims remain side by side and enter explicit conflict review.

### Conflict

A conflict points to two or more observation IDs and remains `open` until a human-reviewed resolution is recorded. Consumers must not silently select a winner from an open conflict.

## Deterministic score contract

`scoreAxes(input)` returns six independent results. Every result contains `score`, `status`, exact `inputs`, `formula`, and a plain-English `explanation`.

| Axis | Deterministic rule | Required inputs |
| --- | --- | --- |
| Protein efficiency | 20 g protein per 100 calories maps to 100, clamped to 0–100 | protein grams, positive calories |
| Value | cost per 25 g protein; `100 - cost * 6.4`, clamped | protein grams, price, currency |
| Protein quality | complete 100, complementary 75, incomplete 50 | sourced quality classification |
| Food quality | processing base plus fiber bonus minus sodium penalty | processing level, fiber, sodium |
| Personal fit | 100 only when all required tags match and excluded tags do not | product tags and explicit preferences |
| Convenience | preparation-time band adjusted by current availability | prep minutes, availability |

Missing required inputs produce `{score: null, status: "unknown"}`. They never receive neutral, zero, or favorable defaults.

`rankCatalog(candidates, weights)` requires explicit non-negative weights. It averages only scored axes and returns `coverage`, the fraction of requested weight supported by known inputs. This makes a partial high score visibly partial instead of disguising missing evidence. Callers decide their own minimum coverage threshold; V0 does not impose a hidden composite policy.

## Representative fixtures

The fixtures cover the issue contract without claiming live truth:

1. packaged grocery: exact-size tofu identity with image slots marked `needed`;
2. produce/whole food: generic raw broccoli;
3. Indian-grocery item: packaged paneer with unknown exact-panel ingredients;
4. store-specific offer: tofu price and availability observations tied to one store;
5. source conflict: manufacturer and retailer tofu calorie observations retained together in an open conflict.

Cooked lentils provide a second whole-food example used to exercise sourced nutrition structure.

## Import and migration boundary

The current `data.js` array remains the legacy UI fixture until a downstream consumer ticket migrates the screen. It mixes product identity with demo values and must not be imported as verified V0 data.

A future importer must:

1. normalize product identity without inventing UPC, package, or variant fields;
2. create or match stores and sources independently;
3. append one observation per sourced field and timestamp;
4. validate the complete candidate catalog before persistence;
5. preserve existing observations;
6. route differing claims to `conflicts` rather than choosing the newest or most convenient value;
7. expose only verified exact-package images with recorded licensing provenance;
8. project observations into UI view models only after conflict and freshness policy is explicit.

There is intentionally no Supabase schema, remote persistence, broad API import, UI migration, or model-backed ranking in V0 of this contract.

## Verification

```bash
npm test
```

The contract tests validate the representative records, identity/observation split, provenance requirements, unknown handling, all six score explanations, explicit-weight ranking, and malformed-boundary rejection.
