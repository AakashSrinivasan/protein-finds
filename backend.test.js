'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {loadConfig} = require('./backend/config.js');
const {openDatabase, migrate, migrationStatus} = require('./backend/database.js');
const {CatalogRepository} = require('./backend/catalog-repository.js');
const {publicCatalog} = require('./backend/public-catalog.js');
const {createBackendServer} = require('./backend/server.js');
const catalogFixture = require('./catalog-fixtures.js');

const TEST_TOKEN = 'test-admin-token-that-is-at-least-32-characters';

function testConfig(overrides = {}) {
  return loadConfig({
    PF_ENV: 'test',
    PF_DATABASE_PATH: ':memory:',
    PF_ADMIN_TOKEN: TEST_TOKEN,
    PF_ALLOWED_ORIGIN: 'https://app.test.example',
    ...overrides
  });
}

function sourceFixture() {
  return {
    id: 'source-backend-test-import',
    kind: 'vendor-json',
    title: 'Sanitized backend test import',
    publisher: 'Fixture Foods',
    locator: 'https://example.test/catalog.json',
    accessedAt: '2026-08-22T12:00:00Z'
  };
}

function acceptedRow() {
  return {
    source_row_id: 'backend-001', name: 'Chickpea Fusilli', kind: 'packaged', brand: 'Fixture Foods',
    variant: 'Chickpea', package_value: 8, package_unit: 'oz', upc: '123456789013', category: 'pasta',
    markets: ['mainstream-grocery'], dietary_tags: ['vegetarian', 'vegan', 'gluten-free'], allergens: ['none'],
    store_id: 'store-target-sunnyvale', observed_at: '2026-08-22T12:00:00Z', serving_value: 56,
    serving_unit: 'g', calories: 190, protein_g: 14, fiber_g: 8, sodium_mg: 35,
    ingredients: 'Chickpea flour', price_amount: 3.99, currency: 'USD', availability: 'in-stock'
  };
}

test('configuration is environment-separated and production fails closed', () => {
  const local = loadConfig({PF_ENV: 'local'});
  const testEnvironment = testConfig();
  assert.equal(local.environment, 'local');
  assert.match(local.databasePath, /protein-finds-local\.sqlite$/);
  assert.equal(local.adminToken, null, 'local writes are disabled unless a token is explicit');
  assert.equal(testEnvironment.databasePath, ':memory:');
  assert.throws(() => loadConfig({PF_ENV: 'production'}), /PF_DATABASE_PATH/);
  assert.throws(() => loadConfig({
    PF_ENV: 'production', PF_DATABASE_PATH: '/tmp/catalog.sqlite', PF_ADMIN_TOKEN: TEST_TOKEN,
    PF_ALLOWED_ORIGIN: 'http://insecure.example'
  }), /https/);
  const production = loadConfig({
    PF_ENV: 'production', PF_DATABASE_PATH: '/srv/protein-finds/catalog.sqlite', PF_ADMIN_TOKEN: TEST_TOKEN,
    PF_ALLOWED_ORIGIN: 'https://aakashsrinivasan.github.io'
  });
  assert.equal(production.environment, 'production');
  assert.equal(production.seedFixture, false);
});

test('database migration is versioned, idempotent, and reversible', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'protein-finds-db-'));
  const databasePath = path.join(directory, 'catalog.sqlite');
  const database = openDatabase(databasePath);
  try {
    assert.deepEqual(migrationStatus(database), {applied: [], pending: [1]});
    assert.equal(migrate(database, 'up').applied, 1);
    assert.equal(migrate(database, 'up').applied, 0);
    assert.deepEqual(migrationStatus(database), {applied: [1], pending: []});
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
    assert.ok(tables.includes('catalog_snapshots'));
    assert.ok(tables.includes('import_receipts'));
    assert.equal(migrate(database, 'down').reverted, 1);
    assert.deepEqual(migrationStatus(database), {applied: [], pending: [1]});
    const remaining = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
    assert.equal(remaining.includes('catalog_snapshots'), false);
    assert.equal(remaining.includes('import_receipts'), false);
  } finally {
    database.close();
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('public projection is allowlisted and excludes review/admin fields', () => {
  const candidate = structuredClone(catalogFixture);
  candidate.internalAdminNote = 'secret';
  candidate.conflicts[0].reviewNote = 'operator-only';
  candidate.conflicts[0].resolution = {
    winningObservationId: 'obs-tofu-nutrition-manufacturer', reason: 'private rationale',
    reviewedBy: 'private@example.test', reviewedAt: '2026-08-22T12:00:00Z'
  };
  candidate.mediaAssets.push({
    id: 'media-projection-test', productId: candidate.products[0].id, role: 'front',
    locator: 'https://example.test/front.jpg', sha256: 'a'.repeat(64), sourceId: candidate.sources[0].id,
    license: 'test-only', capturedAt: '2026-08-22T12:00:00Z', verificationState: 'source-backed',
    identityBinding: structuredClone(candidate.products[0].identity)
  });
  const exposed = publicCatalog(candidate, {revision: 7, servedAt: '2026-08-22T13:00:00Z'});
  assert.equal(exposed.revision, 7);
  assert.equal(exposed.products.length, candidate.products.length);
  assert.deepEqual(exposed.mediaAssets[0].identityBinding, candidate.mediaAssets[0].identityBinding);
  assert.equal(Object.hasOwn(exposed.mediaAssets[0], 'identity'), false);
  assert.equal(exposed.internalAdminNote, undefined);
  assert.equal(exposed.conflicts[0].reviewNote, undefined);
  assert.deepEqual(exposed.conflicts[0].resolution, {
    winningObservationId: 'obs-tofu-nutrition-manufacturer', reviewedAt: '2026-08-22T12:00:00Z'
  });
  assert.equal(JSON.stringify(exposed).includes('private@example.test'), false);
  assert.equal(JSON.stringify(exposed).includes('private rationale'), false);
});

test('HTTP read is safe; writes require authorization and persist receipt plus catalog atomically', async () => {
  const config = testConfig();
  const database = openDatabase(config.databasePath);
  migrate(database, 'up');
  const repository = new CatalogRepository(database);
  repository.initializeCatalog(catalogFixture, {reason: 'test-seed', createdAt: '2026-08-22T13:00:00Z'});
  const backend = createBackendServer({config, repository, now: () => '2026-08-22T13:00:00Z'});
  await backend.listen();
  const baseUrl = `http://127.0.0.1:${backend.address().port}`;
  try {
    const publicResponse = await fetch(`${baseUrl}/api/v1/catalog`, {headers: {Origin: config.allowedOrigin}});
    assert.equal(publicResponse.status, 200);
    assert.equal(publicResponse.headers.get('access-control-allow-origin'), config.allowedOrigin);
    assert.match(publicResponse.headers.get('cache-control'), /max-age=60/);
    const exposed = await publicResponse.json();
    assert.equal(exposed.products.length, catalogFixture.products.length);
    assert.equal(JSON.stringify(exposed).includes(TEST_TOKEN), false);
    assert.equal(JSON.stringify(exposed).includes('reviewNote'), false);
    const notModified = await fetch(`${baseUrl}/api/v1/catalog`, {headers: {'if-none-match': publicResponse.headers.get('etag')}});
    assert.equal(notModified.status, 304, 'stable revisions support conditional public reads');

    const payload = {format: 'json', input: [acceptedRow()], source: sourceFixture(), importedAt: '2026-08-22T13:00:00Z', maxAgeDays: 30};
    const unauthorized = await fetch(`${baseUrl}/api/v1/admin/import`, {
      method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload)
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(repository.current().revision, 1);
    assert.equal(repository.receiptCount(), 0);

    const authorized = await fetch(`${baseUrl}/api/v1/admin/import`, {
      method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}`}, body: JSON.stringify(payload)
    });
    assert.equal(authorized.status, 201);
    const result = await authorized.json();
    assert.deepEqual(result.summary, {total: 1, accepted: 1, rejected: 0, needsReview: 0});
    assert.equal(result.revision, 2);
    assert.equal(repository.current().catalog.products.length, catalogFixture.products.length + 1);
    assert.equal(repository.receiptCount(), 1);
    const committedCatalog = repository.current().catalog;
    assert.throws(() => repository.commitImport(
      {version: 'collision-proof', importedAt: '2026-08-22T13:00:01Z'}, committedCatalog,
      {createdAt: '2026-08-22T13:00:01Z', receiptId: result.receiptId}
    ), /UNIQUE/, 'receipt collision rolls back the catalog snapshot written earlier in the transaction');
    assert.equal(repository.current().revision, 2);
    assert.equal(repository.receiptCount(), 1);

    const replay = await fetch(`${baseUrl}/api/v1/admin/import`, {
      method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}`}, body: JSON.stringify(payload)
    });
    assert.equal(replay.status, 200, 'an identical import request converges without another write');
    assert.equal((await replay.json()).replayed, true);
    assert.equal(repository.current().revision, 2);
    assert.equal(repository.receiptCount(), 1);
  } finally {
    await backend.close();
    database.close();
  }
});
