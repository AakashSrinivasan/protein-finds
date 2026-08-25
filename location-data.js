(function exposeLocationData(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PROTEIN_LOCATION = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const ZIP_SOURCE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.2020.html';
  const ZIP_CENTERS = Object.freeze({
    '94404': Object.freeze({
      zip: '94404', label: '94404 · Foster City', lat: 37.5609851, lon: -122.2651076,
      coordinateSourceUrl: 'https://www.openstreetmap.org/search?query=94404%20Foster%20City%20CA', coordinateObservedAt: '2026-08-25',
      coordinateStatus: 'Verified OpenStreetMap postcode center; re-check before travel.'
    }),
    '95113': Object.freeze({
      zip: '95113', label: '95113 · Downtown San Jose', lat: 37.3337, lon: -121.8907,
      coordinateSourceUrl: ZIP_SOURCE, coordinateObservedAt: '2026-08-22',
      coordinateStatus: 'Seeded Census-gazetteer prototype centroid; re-check before travel.'
    }),
    '95129': Object.freeze({
      zip: '95129', label: '95129 · West San Jose', lat: 37.3057, lon: -122.0001,
      coordinateSourceUrl: ZIP_SOURCE, coordinateObservedAt: '2026-08-22',
      coordinateStatus: 'Seeded Census-gazetteer prototype centroid; re-check before travel.'
    }),
    '95014': Object.freeze({
      zip: '95014', label: '95014 · Cupertino', lat: 37.3065, lon: -122.0806,
      coordinateSourceUrl: ZIP_SOURCE, coordinateObservedAt: '2026-08-22',
      coordinateStatus: 'Seeded Census-gazetteer prototype centroid; re-check before travel.'
    })
  });

  const sourceSearch = query => `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`;
  const sharedAvailability = Object.freeze({
    availabilityStatus: 'unknown',
    availabilityLabel: 'Unknown inventory · proximity is not availability',
    availabilityObservedAt: 'never'
  });
  const STORES = Object.freeze([
    Object.freeze({
      id: 'costco-foster-city', name: 'Costco', address: '1001 Metro Center Blvd, Foster City, CA 94404',
      lat: 37.5617417, lon: -122.2743342, brands: ['Costco'],
      coordinateSourceUrl: sourceSearch('Costco 1001 Metro Center Blvd Foster City CA 94404'),
      coordinateObservedAt: '2026-08-25', coordinateStatus: 'Verified OpenStreetMap store footprint; re-check before travel.',
      retailerUrl: 'https://www.costco.com/warehouse-locations/foster-city-ca-147.html', retailerActionLabel: 'Check Costco',
      ...sharedAvailability
    }),
    Object.freeze({
      id: 'safeway-foster-city', name: 'Safeway', address: '921 E Hillsdale Blvd, Foster City, CA 94404',
      lat: 37.5569254, lon: -122.2760333, brands: ['Safeway'],
      coordinateSourceUrl: sourceSearch('Safeway 921 E Hillsdale Blvd Foster City CA 94404'),
      coordinateObservedAt: '2026-08-25', coordinateStatus: 'Verified OpenStreetMap store footprint; re-check before travel.',
      retailerUrl: 'https://local.safeway.com/safeway/ca/foster-city/921-e-hillsdale-blvd.html', retailerActionLabel: 'Shop Safeway',
      ...sharedAvailability
    }),
    Object.freeze({
      id: 'cvs-foster-city', name: 'CVS', address: '987 E Hillsdale Blvd, Foster City, CA 94404',
      lat: 37.55765, lon: -122.27458, brands: ['CVS'],
      coordinateSourceUrl: 'https://www.cvs.com/store-locator/cvs-pharmacy-locations/California/Foster-City',
      coordinateObservedAt: '2026-08-25', coordinateStatus: 'Verified against the official CVS store locator; re-check before travel.',
      retailerUrl: 'https://www.cvs.com/store-locator/foster-city-ca-pharmacies/987-e-hillsdale-blvd-foster-city-ca-94404/storeid=9879', retailerActionLabel: 'Shop CVS',
      ...sharedAvailability
    }),
    Object.freeze({
      id: 'target-bridgepointe-san-mateo', name: 'Target', address: '2220 Bridgepointe Pkwy, San Mateo, CA 94404',
      lat: 37.5586167, lon: -122.2832601, brands: ['Target'],
      coordinateSourceUrl: sourceSearch('Target 2220 Bridgepointe Pkwy San Mateo CA 94404'),
      coordinateObservedAt: '2026-08-25', coordinateStatus: 'Verified OpenStreetMap store footprint; re-check before travel.',
      retailerUrl: 'https://www.target.com/sl/san-mateo/1404', retailerActionLabel: 'Shop Target',
      directionsUrl: 'https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=37.5609851%2C-122.2651076%3B37.5586167%2C-122.2832601',
      ...sharedAvailability
    })
  ]);

  function findZipCenter(value) {
    const match = String(value || '').trim().match(/^(\d{5})(?:-\d{4})?$/);
    return match ? ZIP_CENTERS[match[1]] || null : null;
  }

  function distanceMiles(a, b) {
    const radians = degrees => degrees * Math.PI / 180;
    const latDelta = radians(b.lat - a.lat);
    const lonDelta = radians(b.lon - a.lon);
    const startLat = radians(a.lat);
    const endLat = radians(b.lat);
    const haversine = Math.sin(latDelta / 2) ** 2
      + Math.cos(startLat) * Math.cos(endLat) * Math.sin(lonDelta / 2) ** 2;
    return Number((3958.8 * 2 * Math.asin(Math.sqrt(haversine))).toFixed(2));
  }

  function storesNear(origin, stores = STORES) {
    return stores.map(store => ({ ...store, distanceMiles: distanceMiles(origin, store) }))
      .sort((a, b) => a.distanceMiles - b.distanceMiles || a.name.localeCompare(b.name));
  }

  function projectStore(store, center, span = 0.12) {
    const x = 50 + ((store.lon - center.lon) / span) * 100;
    const y = 50 - ((store.lat - center.lat) / span) * 100;
    return { x: Math.max(5, Math.min(95, x)), y: Math.max(7, Math.min(93, y)) };
  }

  return Object.freeze({ ZIP_CENTERS, STORES, findZipCenter, distanceMiles, storesNear, projectStore });
});
