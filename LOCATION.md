# Local discovery contract

Protein Finds V0 provides an intentionally bounded San Jose/Cupertino location demo. It is not a live store-locator or inventory feed.

## Interaction boundary

- The browser never requests geolocation on load. `navigator.geolocation` is called only after **Use current location** is selected.
- If permission is denied, unavailable, or times out, product discovery remains usable and the ZIP field receives focus.
- Supported ZIP fixtures are `95113`, `95129`, and `95014`. Unsupported ZIPs fail visibly; no location is guessed.
- Exact device coordinates remain in memory for the current page session and are not written to local or session storage.
- Panning or zooming the interactive map does not silently change results. **Search this area** explicitly commits the pending center, then both list and map are recomputed from that same center.

## Coordinates and distance

`location-data.js` is the executable source of truth for the fixtures. Every ZIP centroid and store has:

- latitude and longitude;
- a human-inspectable `coordinateSourceUrl`;
- `coordinateObservedAt` and a source-status disclosure;
- a deterministic Haversine distance in statute miles, rounded to two decimals.

ZIP centers point to the US Census Gazetteer source page. Store records point to explicit OpenStreetMap searches for their address. These are seeded interaction fixtures and must be rechecked before travel; they are not asserted as current live-store records.

## Availability honesty

Distance is only proximity. Every store fixture uses `availabilityStatus: not-checked`, `availabilityObservedAt: never`, and a visible “Inventory not checked” label. No product or store is marked in stock from its distance, product-store association, or map presence.

## Real-map path and tile failure

The Nearby surface uses a vendored Leaflet 1.9.4 client with OpenStreetMap Standard raster tiles. It needs no API key, but it does make public tile requests and displays the required OpenStreetMap attribution. This low-traffic prototype must move to a policy-compliant hosted tile provider before material production traffic.

Nearby opens map-first at the bounded San Jose demo center. Leaflet provides touch/mouse pan, pinch/wheel zoom, keyboard-capable controls, accurate fixture-coordinate markers, a location puck, recentering, and explicit **Search this area** behavior. If tiles are unavailable, the list view, recorded source status, distances, ZIP fallback, and store/product links remain usable; tile failure never implies missing stores or inventory.

## Verification

- `node --test location-data.test.js` checks ZIP parsing, source records, distance determinism/sorting, and the no-inventory-inference contract.
- With the local server running, `npm run test:location` proves map-first rendering, OpenStreetMap tile elements, all fixture-coordinate markers, native zoom, location puck, recenter control, marker-to-product sheets, working filters, synchronized list/map state, explicit **Search this area**, opt-in permission timing, denial-to-ZIP fallback, Chromium/WebKit mobile overflow, browser errors, and Axe WCAG A/AA results.
