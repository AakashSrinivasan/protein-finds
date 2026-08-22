const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CATALOG_VERSION,
  VERIFICATION_STATES,
  validateCatalog,
  scoreAxes,
  rankCatalog
} = require('./catalog-contract.js');
const catalog = require('./catalog-fixtures.js');

test('fixtures use the versioned contract and cover the five required cases', () => {
  assert.equal(catalog.version, CATALOG_VERSION);
  assert.deepEqual(validateCatalog(catalog), []);
  assert.equal(catalog.products.length, 4, 'the offer is an observation, not a duplicate product');
  assert.ok(catalog.products.some(product => product.kind === 'packaged'));
  assert.ok(catalog.products.some(product => product.kind === 'whole-food'));
  assert.ok(catalog.products.some(product => product.markets.includes('indian-grocery')));
  assert.ok(catalog.observations.some(observation => observation.storeId && observation.field === 'price'));
  assert.ok(catalog.conflicts.length >= 1);
});

test('product identity is separate from store observations', () => {
  const offer = catalog.observations.find(observation => observation.id === 'obs-tofu-price-target');
  const product = catalog.products.find(candidate => candidate.id === offer.productId);
  assert.ok(product);
  assert.equal(Object.hasOwn(product, 'price'), false);
  assert.equal(Object.hasOwn(product, 'availability'), false);
  assert.equal(offer.storeId, 'store-target-sunnyvale');
  assert.equal(offer.field, 'price');
  assert.deepEqual(offer.value, {amount: 2.49, currency: 'USD'});
});

test('nutrition, ingredients, price, and availability have provenance and verification state', () => {
  for (const field of ['nutrition', 'ingredients', 'price', 'availability']) {
    const matching = catalog.observations.filter(observation => observation.field === field);
    assert.ok(matching.length > 0, `${field} fixture exists`);
    for (const observation of matching) {
      assert.ok(observation.sourceId);
      assert.match(observation.observedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.ok(VERIFICATION_STATES.includes(observation.verificationState));
    }
  }
});

test('unknown inputs remain unknown instead of receiving favorable defaults', () => {
  const axes = scoreAxes({proteinG: 20, calories: 200});
  assert.equal(axes.proteinEfficiency.score, 50);
  for (const axis of ['value', 'proteinQuality', 'foodQuality', 'personalFit', 'convenience']) {
    assert.equal(axes[axis].score, null, `${axis} remains unknown`);
    assert.equal(axes[axis].status, 'unknown');
  }
});

test('all six axes are deterministic and independently explainable', () => {
  const input = {
    proteinG: 20,
    calories: 200,
    priceAmount: 2.5,
    currency: 'USD',
    proteinQuality: 'complete',
    processingLevel: 'minimally-processed',
    fiberG: 5,
    sodiumMg: 300,
    dietaryTags: ['vegetarian', 'gluten-free'],
    excludedTags: ['soy'],
    requiredTags: ['vegetarian'],
    prepMinutes: 2,
    availability: 'in-stock'
  };
  const first = scoreAxes(input);
  const second = scoreAxes({...input, dietaryTags: [...input.dietaryTags]});
  assert.deepEqual(second, first);
  assert.deepEqual(Object.keys(first), [
    'proteinEfficiency',
    'value',
    'proteinQuality',
    'foodQuality',
    'personalFit',
    'convenience'
  ]);
  for (const result of Object.values(first)) {
    assert.equal(typeof result.score, 'number');
    assert.ok(result.score >= 0 && result.score <= 100);
    assert.ok(result.formula);
    assert.ok(result.explanation);
    assert.ok(result.inputs && typeof result.inputs === 'object');
  }
});

test('ranking requires explicit weights and reports coverage without imputing missing axes', () => {
  const ranked = rankCatalog([
    {id: 'known', input: {proteinG: 20, calories: 200, priceAmount: 2.5, currency: 'USD'}},
    {id: 'partial', input: {proteinG: 15, calories: 100}}
  ], {proteinEfficiency: 1, value: 1});
  assert.equal(ranked[0].id, 'partial');
  assert.equal(ranked[0].coverage, 0.5);
  assert.equal(ranked[0].weightedScore, 75);
  assert.equal(ranked[1].coverage, 1);
  assert.equal(ranked[1].weightedScore, 65);
});

test('all-unknown rankings remain deterministic and visibly unsupported', () => {
  const ranked = rankCatalog([
    {id: 'z-last', input: {}},
    {id: 'a-first', input: {}}
  ], {value: 1});
  assert.deepEqual(ranked.map(item => item.id), ['a-first', 'z-last']);
  assert.ok(ranked.every(item => item.weightedScore === null && item.coverage === 0));
});

test('validator rejects silent truth defaults and malformed source boundaries', () => {
  const invalid = structuredClone(catalog);
  invalid.products[0].price = 0;
  invalid.observations[0].sourceId = 'missing-source';
  invalid.observations.find(observation => observation.field === 'price').storeId = null;
  const errors = validateCatalog(invalid);
  assert.ok(errors.some(error => error.includes('must not embed price')));
  assert.ok(errors.some(error => error.includes('unknown source')));
  assert.ok(errors.some(error => error.includes('price observations require storeId')));
});

test('validator enforces store, source, conflict, and verified-image boundaries', () => {
  const invalid = structuredClone(catalog);
  invalid.stores[0].location = null;
  invalid.sources[0].locator = '';
  invalid.sources[0].accessedAt = 'not-a-date';
  invalid.products[0].images.front = {status: 'verified', sourceId: 'missing-source', license: 'unknown', exactPackage: false};
  invalid.conflicts[0].observationIds = ['obs-tofu-nutrition-manufacturer', 'obs-lentils-nutrition'];
  const errors = validateCatalog(invalid);
  assert.ok(errors.some(error => error.includes('requires location')));
  assert.ok(errors.some(error => error.includes('requires locator')));
  assert.ok(errors.some(error => error.includes('requires ISO accessedAt')));
  assert.ok(errors.some(error => error.includes('verified image front requires source, license, and exactPackage=true')));
  assert.ok(errors.some(error => error.includes('must reference one product and field')));
});
