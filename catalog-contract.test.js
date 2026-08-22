const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CATALOG_VERSION,
  VERIFICATION_STATES,
  validateCatalog,
  scoreAxes,
  scoreCatalogProduct,
  rankCatalog
} = require('./catalog-contract.js');
const catalog = require('./catalog-fixtures.js');

const errorsFor = mutate => {
  const candidate = structuredClone(catalog);
  mutate(candidate);
  return validateCatalog(candidate);
};

test('fixtures use the versioned contract and cover the five required cases', () => {
  assert.equal(catalog.version, CATALOG_VERSION);
  assert.deepEqual(validateCatalog(catalog), []);
  assert.equal(catalog.products.length, 4, 'the offer is an observation, not a duplicate product');
  assert.ok(catalog.products.some(product => product.kind === 'packaged'));
  assert.ok(catalog.products.some(product => product.kind === 'whole-food'));
  assert.ok(catalog.products.some(product => product.markets.includes('indian-grocery')));
  assert.ok(catalog.observations.some(observation => observation.storeId && observation.field === 'price'));
  assert.ok(catalog.conflicts.length >= 1);
  assert.ok(Array.isArray(catalog.mediaAssets));
});

test('product identity is separate from store observations', () => {
  const offer = catalog.observations.find(observation => observation.id === 'obs-tofu-price-target');
  const product = catalog.products.find(candidate => candidate.id === offer.productId);
  assert.ok(product);
  assert.equal(Object.hasOwn(product, 'price'), false);
  assert.equal(Object.hasOwn(product, 'availability'), false);
  assert.equal(offer.storeId, 'store-target-sunnyvale');
  assert.equal(offer.field, 'price');
  assert.deepEqual(offer.value, {knowledge: 'known', amount: 2.49, currency: 'USD'});
});

test('nutrition, ingredients, price, and availability have provenance and verification state', () => {
  for (const field of ['nutrition', 'ingredients', 'price', 'availability']) {
    const matching = catalog.observations.filter(observation => observation.field === field);
    assert.ok(matching.length > 0, `${field} fixture exists`);
    for (const observation of matching) {
      assert.ok(observation.sourceId);
      assert.match(observation.observedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.ok(VERIFICATION_STATES.includes(observation.verificationState));
      assert.ok(['known', 'unknown'].includes(observation.value.knowledge));
    }
  }
});

test('field-specific observation schemas reject malformed known and unknown values', () => {
  const adversarialValues = [
    ['nutrition', null],
    ['nutrition', {}],
    ['nutrition', {knowledge: 'known', servingSize: {value: 85, unit: 'g'}, calories: -1, proteinG: 9, fiberG: 1, sodiumMg: 10}],
    ['ingredients', {knowledge: 'known', text: '', normalized: []}],
    ['price', {knowledge: 'known', amount: -99, currency: ''}],
    ['price', {knowledge: 'known', amount: 2, currency: 'XXX'}],
    ['availability', {knowledge: 'known', status: 'maybe'}],
    ['availability', {knowledge: 'unknown'}]
  ];
  for (const [field, value] of adversarialValues) {
    const errors = errorsFor(candidate => {
      candidate.observations.find(observation => observation.field === field).value = value;
    });
    assert.ok(errors.some(error => error.includes(`invalid ${field} value`)), `${field} ${JSON.stringify(value)} rejected`);
  }
});

test('explicit unknown observation values require a non-empty reason and cannot carry known fields', () => {
  const errors = errorsFor(candidate => {
    const ingredients = candidate.observations.find(observation => observation.field === 'ingredients');
    ingredients.value = {knowledge: 'unknown', reasonUnknown: ' ', text: 'invented'};
  });
  assert.ok(errors.some(error => error.includes('invalid ingredients value')));
});

test('product/package identity shapes are strict for packaged and whole-food records', () => {
  const emptyIdentity = errorsFor(candidate => { candidate.products[0].identity = {}; });
  const blankName = errorsFor(candidate => { candidate.products[0].name = ' '; });
  const badMarkets = errorsFor(candidate => { candidate.products[0].markets = 'mainstream-grocery'; });
  const missingPackage = errorsFor(candidate => { candidate.products[0].identity.packageSize = null; });
  const brandedWholeFood = errorsFor(candidate => { candidate.products.find(product => product.kind === 'whole-food').identity.brand = 'Generic Corp'; });
  assert.ok(emptyIdentity.some(error => error.includes('invalid packaged identity')));
  assert.ok(blankName.some(error => error.includes('requires non-empty name')));
  assert.ok(badMarkets.some(error => error.includes('requires non-empty markets')));
  assert.ok(missingPackage.some(error => error.includes('invalid packaged identity')));
  assert.ok(brandedWholeFood.some(error => error.includes('invalid whole-food identity')));
});

test('media is first-class, retrievable, verified, hashed, and exactly identity-bound', () => {
  const candidate = structuredClone(catalog);
  const product = candidate.products[0];
  candidate.mediaAssets.push({
    id: 'media-tofu-front',
    productId: product.id,
    role: 'front',
    locator: 'https://example.invalid/licensed/tofu-front.jpg',
    sha256: 'a'.repeat(64),
    sourceId: 'source-nasoya-product-page',
    license: 'manufacturer-authorized-test-fixture',
    capturedAt: '2026-08-13T12:00:00Z',
    verificationState: 'source-backed',
    identityBinding: structuredClone(product.identity)
  });
  product.images.front = {status: 'verified', assetId: 'media-tofu-front'};
  assert.deepEqual(validateCatalog(candidate), []);

  const malformed = structuredClone(candidate);
  delete malformed.mediaAssets[0].locator;
  malformed.mediaAssets[0].identityBinding.variant = 'Different Variant';
  const errors = validateCatalog(malformed);
  assert.ok(errors.some(error => error.includes('requires retrievable locator')));
  assert.ok(errors.some(error => error.includes('must exactly bind product identity')));
});

test('every image slot has either one matching verified asset or an explicit missing reason', () => {
  const missingReason = errorsFor(candidate => { candidate.products[0].images.front = {status: 'needed', reasonMissing: ''}; });
  const missingAsset = errorsFor(candidate => { candidate.products[0].images.front = {status: 'verified', assetId: 'not-there'}; });
  assert.ok(missingReason.some(error => error.includes('needed image front requires reasonMissing')));
  assert.ok(missingAsset.some(error => error.includes('verified image front references unknown asset')));
});

test('conflicts enforce exact field paths, reciprocal linkage, and reviewed resolution', () => {
  const mismatch = errorsFor(candidate => { candidate.conflicts[0].field = 'nutritionGarbage'; });
  const unknownPath = errorsFor(candidate => { candidate.conflicts[0].field = 'nutrition.notARealField'; });
  const nonReciprocal = errorsFor(candidate => { delete candidate.observations[0].conflictId; });
  assert.ok(mismatch.some(error => error.includes('must reference one exact product field')));
  assert.ok(unknownPath.some(error => error.includes('must reference one exact product field')));
  assert.ok(nonReciprocal.some(error => error.includes('requires reciprocal conflict linkage')));

  const resolved = structuredClone(catalog);
  const conflict = resolved.conflicts[0];
  conflict.status = 'resolved';
  conflict.resolution = {
    winningObservationId: conflict.observationIds[0],
    reason: 'Exact current package panel matched the manufacturer record.',
    reviewer: 'fixture-reviewer',
    reviewedAt: '2026-08-14T12:00:00Z'
  };
  resolved.observations.find(observation => observation.id === conflict.observationIds[0]).verificationState = 'source-backed';
  resolved.observations.find(observation => observation.id === conflict.observationIds[1]).verificationState = 'rejected';
  assert.deepEqual(validateCatalog(resolved), []);
});

test('strict UTC ISO-8601 timestamps reject human-readable dates and impossible dates', () => {
  const human = errorsFor(candidate => { candidate.sources[0].accessedAt = 'August 13, 2026'; });
  const impossible = errorsFor(candidate => { candidate.observations[0].observedAt = '2026-02-30T12:00:00Z'; });
  assert.ok(human.some(error => error.includes('requires strict UTC ISO accessedAt')));
  assert.ok(impossible.some(error => error.includes('requires strict UTC ISO observedAt')));
});

test('unknown score inputs remain unknown instead of receiving favorable defaults', () => {
  const axes = scoreAxes({proteinG: 20, calories: 200});
  assert.equal(axes.proteinEfficiency.score, 50);
  for (const axis of ['value', 'proteinQuality', 'foodQuality', 'personalFit', 'convenience']) {
    assert.equal(axes[axis].score, null, `${axis} remains unknown`);
    assert.equal(axes[axis].status, 'unknown');
  }
});

test('all six pure axes are deterministic and independently explainable', () => {
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
    'proteinEfficiency', 'value', 'proteinQuality', 'foodQuality', 'personalFit', 'convenience'
  ]);
  for (const result of Object.values(first)) {
    assert.equal(typeof result.score, 'number');
    assert.ok(result.score >= 0 && result.score <= 100);
    assert.ok(result.formula);
    assert.ok(result.explanation);
    assert.ok(result.inputs && typeof result.inputs === 'object');
  }
});

test('provenance-aware scoring admits only explicit, fresh, source-backed evidence', () => {
  const candidate = structuredClone(catalog);
  const nutrition = candidate.observations.find(observation => observation.id === 'obs-lentils-nutrition');
  nutrition.verificationState = 'source-backed';
  nutrition.value.proteinQuality = 'complementary';
  const result = scoreCatalogProduct(candidate, {
    productId: nutrition.productId,
    evidence: {nutritionId: nutrition.id},
    preferences: {requiredTags: ['vegetarian'], excludedTags: []},
    now: '2026-08-14T00:00:00Z',
    maxAgeDays: 30,
    expectedCurrency: 'USD'
  });
  assert.equal(result.axes.proteinEfficiency.score > 0, true);
  assert.equal(result.axes.proteinEfficiency.evidenceIds[0], nutrition.id);
  assert.deepEqual(result.axes.proteinEfficiency.verificationStates, ['source-backed']);
  assert.equal(result.axes.personalFit.score, 100);
  assert.deepEqual(result.axes.personalFit.identityIds, [nutrition.productId]);

  nutrition.verificationState = 'unverified';
  const rejected = scoreCatalogProduct(candidate, {
    productId: nutrition.productId,
    evidence: {nutritionId: nutrition.id},
    preferences: {requiredTags: ['vegetarian'], excludedTags: []},
    now: '2026-08-14T00:00:00Z',
    maxAgeDays: 30,
    expectedCurrency: 'USD'
  });
  assert.equal(rejected.axes.proteinEfficiency.score, null);
  assert.ok(rejected.axes.proteinEfficiency.ineligibleReasons.some(reason => reason.includes('not source-backed')));
});

test('score admission rejects open conflicts, stale evidence, unknown values, and currency mismatch', () => {
  const openConflict = scoreCatalogProduct(catalog, {
    productId: 'product-nasoya-extra-firm-tofu-14oz',
    storeId: 'store-target-sunnyvale',
    evidence: {
      nutritionId: 'obs-tofu-nutrition-manufacturer',
      priceId: 'obs-tofu-price-target',
      availabilityId: 'obs-tofu-availability-target'
    },
    preferences: {requiredTags: ['vegetarian'], excludedTags: []},
    now: '2026-08-14T00:00:00Z',
    maxAgeDays: 30,
    expectedCurrency: 'USD'
  });
  assert.equal(openConflict.axes.proteinEfficiency.score, null);
  assert.ok(openConflict.axes.proteinEfficiency.ineligibleReasons.some(reason => reason.includes('open conflict')));
  assert.ok(openConflict.axes.convenience.ineligibleReasons.some(reason => reason.includes('unknown value')));

  const candidate = structuredClone(catalog);
  const price = candidate.observations.find(observation => observation.id === 'obs-tofu-price-target');
  price.verificationState = 'source-backed';
  const stale = scoreCatalogProduct(candidate, {
    productId: price.productId,
    storeId: price.storeId,
    evidence: {priceId: price.id},
    preferences: {requiredTags: [], excludedTags: []},
    now: '2026-09-30T00:00:00Z',
    maxAgeDays: 30,
    expectedCurrency: 'USD'
  });
  assert.ok(stale.axes.value.ineligibleReasons.some(reason => reason.includes('stale')));
  assert.throws(() => scoreCatalogProduct(candidate, {
    productId: price.productId,
    storeId: price.storeId,
    evidence: {priceId: price.id},
    preferences: {requiredTags: [], excludedTags: []},
    now: '2026-08-14T00:00:00Z',
    maxAgeDays: 30,
    expectedCurrency: 'EUR'
  }), /supported expectedCurrency/);
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
  const errors = errorsFor(candidate => {
    candidate.products[0].price = 0;
    candidate.observations[0].sourceId = 'missing-source';
    candidate.observations.find(observation => observation.field === 'price').storeId = null;
    candidate.stores[0].location = null;
    candidate.sources[0].locator = '';
  });
  assert.ok(errors.some(error => error.includes('must not embed price')));
  assert.ok(errors.some(error => error.includes('unknown source')));
  assert.ok(errors.some(error => error.includes('price observations require storeId')));
  assert.ok(errors.some(error => error.includes('requires location')));
  assert.ok(errors.some(error => error.includes('requires locator')));
});