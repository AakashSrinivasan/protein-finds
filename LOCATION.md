# Local discovery contract

Protein Finds V0 provides an intentionally bounded San Jose/Cupertino location demo. It is not a live store-locator or inventory feed.

## Interaction boundary

- The browser never requests geolocation on load. `navigator.geolocation` is called only after **Use current location** is selected.
- If permission is denied, unavailable, or times out, product discovery remains usable and the ZIP field receives focus.
- Supported ZIP fixtures are `95113`, `95129`, and `95014`. Unsupported ZIPs fail visibly; no location is guessed.
- Exact device coordinates remain in memory for the current page session and are not written to local or session storage.
- Moving the schematic map does not silently change results. **Search here** explicitly commits the pending center, then both list and map are recomputed from that same center.

## Coordinates and distance

`location-data.js` is the executable source of truth for the fixtures. Every ZIP centroid and store has:

- latitude and longitude;
- a human-inspectable `coordinateSourceUrl`;
- `coordinateObservedAt` and a source-status disclosure;
- a deterministic Haversine distance in statute miles, rounded to two decimals.

ZIP centers point to the US Census Gazetteer source page. Store records point to explicit OpenStreetMap searches for their address. These are seeded interaction fixtures and must be rechecked before travel; they are not asserted as current live-store records.

## Availability honesty

Distance is only proximity. Every store fixture uses `availabilityStatus: not-checked`, `availabilityObservedAt: never`, and a visible “Inventory not checked” label. No product or store is marked in stock from its distance, product-store association, or map presence.

## Free/low-cost map path and quota failure

The V0 map is a local CSS schematic projected from the fixture coordinates. It makes zero tile, geocoding, routing, or map-provider API requests, needs no key, and therefore has no usage quota or billing path. Coordinate-source links are optional external handoffs.

If an external coordinate source is unavailable or later map tiles fail, the deterministic list, recorded source status, distances, ZIP fallback, and schematic markers remain usable. A future tiled map may use OpenStreetMap-compatible tiles only after provider terms and rate limits are selected; tile failure must preserve this no-tile fallback rather than hide store results.

## Verification

- `node --test location-data.test.js` checks ZIP parsing, source records, distance determinism/sorting, and the no-inventory-inference contract.
- With the local server running, `npm run test:location` checks opt-in permission timing, denial-to-ZIP fallback, synchronized list/map state, explicit **Search here**, Chromium/WebKit mobile overflow, browser errors, and Axe WCAG A/AA results.
