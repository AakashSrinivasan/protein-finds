'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const catalogFixture = require('./catalog-fixtures.js');
const {validateCatalog} = require('./catalog-contract.js');
const {
  IMPORT_VERSION,
  parseCsvRecords,
  stageCatalogImport,
  applyAcceptedImport
} = require('./catalog-import.js');

const fixturePath = path.join(__dirname, 'fixtures/vendor-catalog-sanitized.csv');
const csv = fs.readFileSync(fixturePath, 'utf8');
const source = {
  id: 'source-sanitized-vendor-csv',
  kind: 'vendor-csv',
  title: 'Sanitized vendor catalog fixture',
  publisher: 'Fixture Vendor',
  locator: 'fixture://vendor-catalog-sanitized.csv',
  accessedAt: '2026-08-22T12:00:00Z'
};

function verifiedCanonical() {
  const catalog = structuredClone(catalogFixture);
  catalog.conflicts = [];
  for (const observation of catalog.observations) {
    delete observation.conflictId;
  }
  const manufacturer = catalog.observations.find(item => item.id === 'obs-tofu-nutrition-manufacturer');
  manufacturer.verificationState = 'source-backed';
  const retailer = catalog.observations.find(item => item.id === 'obs-tofu-nutrition-retailer');
  retailer.verificationState = 'rejected';
  assert.deepEqual(validateCatalog(catalog), []);
  return catalog;
}

const stageFixture = canonical => stageCatalogImport({
  format: 'csv',
  input: csv,
  source,
  canonical,
  importedAt: '2026-08-22T12:00:00Z',
  maxAgeDays: 180
});

test('CSV parser handles quoted commas and preserves exact raw records', () => {
  const records = parseCsvRecords(csv);
  assert.equal(records.length, 7);
  assert.equal(records[0].value.ingredients, 'Cultured soybeans, water');
  assert.match(records[0].raw, /"Cultured soybeans, water"/);
  assert.equal(records[0].rowNumber, 2);
});

test('stages every source row before canonical mutation with machine-readable outcomes', () => {
  const canonical = verifiedCanonical();
  const before = structuredClone(canonical);
  const result = stageFixture(canonical);

  assert.equal(result.version, IMPORT_VERSION);
  assert.equal(result.stagedRows.length, 7);
  assert.deepEqual(canonical, before, 'staging is physically non-mutating');
  assert.equal(result.summary.total, 7);
  assert.equal(result.summary.accepted, 1);
  assert.equal(result.summary.rejected, 2);
  assert.equal(result.summary.needsReview, 4);
  assert.deepEqual(result.results.accepted, ['vendor-007']);
  assert.deepEqual(result.results.rejected, ['vendor-004', 'vendor-005']);
  assert.deepEqual(result.results.needsReview, ['vendor-001', 'vendor-002', 'vendor-003', 'vendor-006']);
  assert.ok(result.stagedRows.every(row => row.rawSource && row.rawSource.raw && row.rawSource.record));
  assert.ok(result.stagedRows.every(row => ['accepted', 'rejected', 'needs-review'].includes(row.disposition)));
  assert.ok(result.stagedRows.every(row => row.reasons.every(reason => reason.code && reason.field && reason.message)));
});

test('routes duplicate identities, verified conflicts, stale rows, bad units, and partial rows correctly', () => {
  const result = stageFixture(verifiedCanonical());
  const byId = new Map(result.stagedRows.map(row => [row.sourceRowId, row]));

  for (const id of ['vendor-001', 'vendor-002']) {
    assert.equal(byId.get(id).disposition, 'needs-review');
    assert.ok(byId.get(id).reasons.some(reason => reason.code === 'duplicate_identity'));
  }
  assert.equal(byId.get('vendor-003').disposition, 'needs-review');
  assert.ok(byId.get('vendor-003').reasons.some(reason => reason.code === 'verified_value_conflict'));
  assert.equal(byId.get('vendor-004').disposition, 'rejected');
  assert.ok(byId.get('vendor-004').reasons.some(reason => reason.code === 'invalid_package_unit'));
  assert.equal(byId.get('vendor-005').disposition, 'rejected');
  assert.ok(byId.get('vendor-005').reasons.some(reason => reason.code === 'missing_required_field' && reason.field === 'observed_at'));
  assert.equal(byId.get('vendor-006').disposition, 'needs-review');
  assert.ok(byId.get('vendor-006').reasons.some(reason => reason.code === 'stale_observation'));
});

test('routes observations for a product field with an open canonical conflict to review', () => {
  const result = stageFixture(catalogFixture);
  const tofu = result.stagedRows.find(row => row.sourceRowId === 'vendor-003');
  assert.equal(tofu.disposition, 'needs-review');
  assert.ok(tofu.reasons.some(reason => reason.code === 'open_canonical_conflict'));
});

test('accepts valid JSON rows and applies only accepted candidates after staging', () => {
  const canonical = verifiedCanonical();
  const input = [{
    source_row_id: 'json-001', name: 'High Protein Chickpea Pasta', kind: 'packaged', brand: 'Fixture Foods',
    variant: 'Chickpea', package_value: 8, package_unit: 'oz', upc: '123456789012', category: 'pasta',
    markets: ['mainstream-grocery'], dietary_tags: ['vegetarian', 'vegan', 'gluten-free'], allergens: ['none'],
    store_id: 'store-target-sunnyvale', observed_at: '2026-08-21T12:00:00Z', serving_value: 56,
    serving_unit: 'g', calories: 190, protein_g: 14, fiber_g: 8, sodium_mg: 35,
    ingredients: 'Chickpea flour', price_amount: 3.99, currency: 'USD', availability: 'in-stock'
  }];
  const staged = stageCatalogImport({
    format: 'json', input, source, canonical, importedAt: '2026-08-22T12:00:00Z', maxAgeDays: 180
  });
  assert.equal(staged.summary.accepted, 1);
  assert.equal(staged.stagedRows[0].disposition, 'accepted');

  const applied = applyAcceptedImport(canonical, staged);
  assert.equal(applied.products.length, canonical.products.length + 1);
  assert.equal(applied.sources.filter(item => item.id === source.id).length, 1);
  assert.ok(applied.observations.length > canonical.observations.length);
  assert.deepEqual(validateCatalog(applied), []);
  assert.deepEqual(canonical, verifiedCanonical(), 'apply returns a new catalog');
});

test('rejects implausible nutrition and invalid diet/allergen flags without inventing values', () => {
  const input = [{
    source_row_id: 'json-bad', name: 'Impossible Bar', kind: 'packaged', brand: 'Fixture', variant: null,
    package_value: 2, package_unit: 'oz', upc: null, category: 'snacks', markets: ['mainstream-grocery'],
    dietary_tags: ['vegetarian', 'carnivore'], allergens: ['mystery'], store_id: 'store-target-sunnyvale',
    observed_at: '2026-08-21T12:00:00Z', serving_value: 50, serving_unit: 'g', calories: 10,
    protein_g: 100, fiber_g: 0, sodium_mg: 20
  }];
  const result = stageCatalogImport({
    format: 'json', input, source, canonical: verifiedCanonical(), importedAt: '2026-08-22T12:00:00Z', maxAgeDays: 180
  });
  assert.equal(result.stagedRows[0].disposition, 'rejected');
  assert.ok(result.stagedRows[0].reasons.some(reason => reason.code === 'invalid_dietary_flag'));
  assert.ok(result.stagedRows[0].reasons.some(reason => reason.code === 'invalid_allergen_flag'));
  assert.ok(result.stagedRows[0].reasons.some(reason => reason.code === 'implausible_nutrition'));
  assert.equal(result.stagedRows[0].candidate, null);
});

test('routes source-id and matched-product metadata conflicts to review', () => {
  const canonical = verifiedCanonical();
  canonical.sources.push({...source, publisher: 'Different Publisher'});
  const input = [{
    source_row_id: 'json-metadata', name: 'Renamed Organic Extra Firm Tofu', kind: 'packaged', brand: 'Nasoya',
    variant: 'Organic Extra Firm', package_value: 14, package_unit: 'oz', upc: null, category: 'different-category',
    markets: ['mainstream-grocery'], dietary_tags: ['vegetarian', 'vegan', 'soy'], allergens: ['soy'],
    observed_at: '2026-08-21T12:00:00Z', serving_value: 85, serving_unit: 'g', calories: 90,
    protein_g: 9, fiber_g: 1, sodium_mg: 10
  }];
  const result = stageCatalogImport({
    format: 'json', input, source, canonical, importedAt: '2026-08-22T12:00:00Z', maxAgeDays: 180
  });
  assert.equal(result.stagedRows[0].disposition, 'needs-review');
  assert.ok(result.stagedRows[0].reasons.some(reason => reason.code === 'source_definition_conflict'));
  assert.ok(result.stagedRows[0].reasons.some(reason => reason.code === 'product_metadata_conflict'));
});

test('routes a reused UPC with conflicting package identity to review', () => {
  const canonical = verifiedCanonical();
  const tofu = canonical.products.find(product => product.id === 'product-nasoya-extra-firm-tofu-14oz');
  tofu.identity.upc = '123456789012';
  const input = [{
    source_row_id: 'json-upc-conflict', name: tofu.name, kind: 'packaged', brand: 'Different Brand',
    variant: tofu.identity.variant, package_value: 16, package_unit: 'oz', upc: tofu.identity.upc,
    category: tofu.category, markets: tofu.markets, dietary_tags: tofu.dietaryTags, allergens: ['soy'],
    observed_at: '2026-08-21T12:00:00Z', serving_value: 85, serving_unit: 'g', calories: 90,
    protein_g: 9, fiber_g: 1, sodium_mg: 10
  }];
  const result = stageCatalogImport({
    format: 'json', input, source, canonical, importedAt: '2026-08-22T12:00:00Z', maxAgeDays: 180
  });
  assert.equal(result.stagedRows[0].disposition, 'needs-review');
  assert.ok(result.stagedRows[0].reasons.some(reason => reason.code === 'product_identity_conflict'));
});

test('accepted application revalidates against canonical changes made after staging', () => {
  const canonical = verifiedCanonical();
  const input = [{
    source_row_id: 'json-race', name: 'High Protein Chickpea Pasta', kind: 'packaged', brand: 'Fixture Foods',
    variant: 'Chickpea', package_value: 8, package_unit: 'oz', upc: '123456789012', category: 'pasta',
    markets: ['mainstream-grocery'], dietary_tags: ['vegetarian', 'vegan'], allergens: ['none'],
    observed_at: '2026-08-21T12:00:00Z', serving_value: 56, serving_unit: 'g', calories: 190,
    protein_g: 14, fiber_g: 8, sodium_mg: 35
  }];
  const staged = stageCatalogImport({
    format: 'json', input, source, canonical, importedAt: '2026-08-22T12:00:00Z', maxAgeDays: 180
  });
  assert.equal(staged.stagedRows[0].disposition, 'accepted');

  const changedCanonical = structuredClone(canonical);
  changedCanonical.products.push(structuredClone(staged.stagedRows[0].candidate.product));
  changedCanonical.sources.push(structuredClone(source));
  changedCanonical.observations.push({
    ...structuredClone(staged.stagedRows[0].candidate.observations[0]),
    id: 'obs-concurrent-source-backed-nutrition',
    value: {...staged.stagedRows[0].candidate.observations[0].value, proteinG: 12},
    verificationState: 'source-backed'
  });
  assert.deepEqual(validateCatalog(changedCanonical), []);
  assert.throws(() => applyAcceptedImport(changedCanonical, staged), /no longer accepted/);
});

test('rejects rows that contain identity but no observation payload', () => {
  const input = [{
    source_row_id: 'json-empty', name: 'Empty Product', kind: 'packaged', brand: 'Fixture', variant: null,
    package_value: 8, package_unit: 'oz', upc: null, category: 'snacks', markets: ['mainstream-grocery'],
    dietary_tags: ['vegetarian'], allergens: ['none'], observed_at: '2026-08-21T12:00:00Z'
  }];
  const result = stageCatalogImport({
    format: 'json', input, source, canonical: verifiedCanonical(), importedAt: '2026-08-22T12:00:00Z', maxAgeDays: 180
  });
  assert.equal(result.stagedRows[0].disposition, 'rejected');
  assert.ok(result.stagedRows[0].reasons.some(reason => reason.code === 'missing_observation_data'));
});

test('routes colliding source row IDs to review before generated observation IDs collide', () => {
  const base = {
    kind: 'packaged', brand: 'Fixture', variant: null, package_value: 8, package_unit: 'oz',
    category: 'snacks', markets: ['mainstream-grocery'], dietary_tags: ['vegetarian'], allergens: ['none'],
    observed_at: '2026-08-21T12:00:00Z', serving_value: 50, serving_unit: 'g', calories: 200,
    protein_g: 10, fiber_g: 2, sodium_mg: 20
  };
  const input = [
    {...base, source_row_id: 'row one', name: 'First', upc: '123456780001'},
    {...base, source_row_id: 'row-one', name: 'Second', upc: '123456780002'}
  ];
  const result = stageCatalogImport({
    format: 'json', input, source, canonical: verifiedCanonical(), importedAt: '2026-08-22T12:00:00Z', maxAgeDays: 180
  });
  assert.deepEqual(result.stagedRows.map(row => row.disposition), ['needs-review', 'needs-review']);
  assert.ok(result.stagedRows.every(row => row.reasons.some(reason => reason.code === 'duplicate_source_row_id')));
});

test('fails closed on malformed input and invalid import options', () => {
  const canonical = verifiedCanonical();
  assert.throws(() => parseCsvRecords('source_row_id,name\n1'), /column count/);
  assert.throws(() => stageCatalogImport({format: 'yaml', input: '', source, canonical, importedAt: '2026-08-22T12:00:00Z', maxAgeDays: 180}), /format/);
  assert.throws(() => stageCatalogImport({format: 'json', input: {}, source, canonical, importedAt: '2026-08-22T12:00:00Z', maxAgeDays: 180}), /array/);
  assert.throws(() => stageCatalogImport({format: 'json', input: [], source, canonical, importedAt: 'not-a-date', maxAgeDays: 180}), /importedAt/);
});
