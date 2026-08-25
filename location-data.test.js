const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ZIP_CENTERS,
  STORES,
  distanceMiles,
  findZipCenter,
  storesNear
} = require('./location-data.js');

test('ZIP fallback accepts a five-digit ZIP or ZIP+4 and rejects unsupported locations', () => {
  assert.equal(findZipCenter('94404').label, '94404 · Foster City');
  assert.equal(findZipCenter('95113').zip, '95113');
  assert.equal(findZipCenter('95113-1234').zip, '95113');
  assert.equal(findZipCenter(' 95129 ').zip, '95129');
  assert.equal(findZipCenter('10001'), null);
  assert.equal(findZipCenter('9511'), null);
});

test('ZIP and store coordinates carry inspectable source records', () => {
  for (const record of [...Object.values(ZIP_CENTERS), ...STORES]) {
    assert.ok(Number.isFinite(record.lat));
    assert.ok(Number.isFinite(record.lon));
    assert.match(record.coordinateSourceUrl, /^https:\/\//);
    assert.match(record.coordinateObservedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(record.coordinateStatus, /seeded|verified/i);
  }
});

test('Foster City market indexes the four requested retailer handoffs', () => {
  assert.deepEqual(STORES.map(store => store.name).sort(), ['CVS', 'Costco', 'Safeway', 'Target']);
  for (const store of STORES) {
    assert.match(store.address, /94404/);
    assert.match(store.retailerUrl, /^https:\/\//);
    assert.match(store.retailerActionLabel, /shop|check/i);
  }
});

test('distance is deterministic, symmetric, and sorted for nearby stores', () => {
  const origin = ZIP_CENTERS['94404'];
  assert.equal(distanceMiles(origin, origin), 0);
  assert.equal(distanceMiles(origin, STORES[0]), distanceMiles(STORES[0], origin));

  const results = storesNear(origin);
  assert.equal(results.length, STORES.length);
  assert.ok(results.every((store, index) => index === 0 || store.distanceMiles >= results[index - 1].distanceMiles));
  assert.ok(results.every(store => Number.isFinite(store.distanceMiles) && store.distanceMiles >= 0));
});

test('nearby results never infer inventory from proximity', () => {
  for (const store of storesNear(ZIP_CENTERS['94404'])) {
    assert.notEqual(store.availabilityStatus, 'in-stock');
    assert.match(store.availabilityLabel, /not checked|unknown|stale/i);
    assert.match(store.availabilityObservedAt, /^\d{4}-\d{2}-\d{2}$|^never$/);
  }
});
