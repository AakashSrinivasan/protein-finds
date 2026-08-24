(function exposeLocationData(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PROTEIN_LOCATION = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const ZIP_SOURCE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.2020.html';
  const ZIP_CENTERS = Object.freeze({
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
    availabilityStatus: 'not-checked',
    availabilityLabel: 'Inventory not checked · proximity is not availability',
    availabilityObservedAt: 'never'
  });
  const STORES = Object.freeze([
    Object.freeze({
      id: 'safeway-2nd-san-jose', name: 'Safeway', address: '100 S 2nd St, San Jose, CA 95113',
      lat: 37.3334, lon: -121.8888, brands: ['Safeway'],
      coordinateSourceUrl: sourceSearch('Safeway 100 S 2nd St San Jose CA 95113'),
      coordinateObservedAt: '2026-08-22', coordinateStatus: 'Seeded OpenStreetMap search fixture; re-check before travel.',
      ...sharedAvailability
    }),
    Object.freeze({
      id: 'whole-foods-alameda-san-jose', name: 'Whole Foods Market', address: '777 The Alameda, San Jose, CA 95126',
      lat: 37.3326, lon: -121.9123, brands: ['Whole Foods'],
      coordinateSourceUrl: sourceSearch('Whole Foods Market 777 The Alameda San Jose CA 95126'),
      coordinateObservedAt: '2026-08-22', coordinateStatus: 'Seeded OpenStreetMap search fixture; re-check before travel.',
      ...sharedAvailability
    }),
    Object.freeze({
      id: 'target-coleman-san-jose', name: 'Target', address: '533 Coleman Ave, San Jose, CA 95110',
      lat: 37.3419, lon: -121.9095, brands: ['Target'],
      coordinateSourceUrl: sourceSearch('Target 533 Coleman Ave San Jose CA 95110'),
      coordinateObservedAt: '2026-08-22', coordinateStatus: 'Seeded OpenStreetMap search fixture; re-check before travel.',
      ...sharedAvailability
    }),
    Object.freeze({
      id: 'costco-almaden-san-jose', name: 'Costco', address: '5301 Almaden Expy, San Jose, CA 95118',
      lat: 37.2535, lon: -121.8742, brands: ['Costco'],
      coordinateSourceUrl: sourceSearch('Costco 5301 Almaden Expressway San Jose CA 95118'),
      coordinateObservedAt: '2026-08-22', coordinateStatus: 'Seeded OpenStreetMap search fixture; re-check before travel.',
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
