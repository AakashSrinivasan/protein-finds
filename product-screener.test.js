const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'product-screener.js'), 'utf8'), context);
const products = context.window.PROTEIN_PRODUCTS.filter(product => product.category !== 'Restaurant');
const screener = context.window.ProductScreener;

const ids = result => Array.from(result.results, product => product.id);

test('default screen returns the complete 12-product grocery seed', () => {
  const result = screener.run(products, {});
  assert.equal(result.total, 12);
  assert.equal(result.results.length, 12);
  assert.equal(new Set(ids(result)).size, 12);
});

test('thresholds are inclusive and combined with AND semantics', () => {
  const result = screener.run(products, {
    category: 'Plant meat', minProtein: 21, maxCalories: 170,
    exclusions: ['soy'], prep: 'heat', sort: 'protein'
  });
  assert.deepEqual(ids(result), ['beyond-steak']);
});

test('high-protein quick screen returns only truthful qualifying records', () => {
  const screen = screener.applyTemplate('high-protein', [...new Set(products.map(product => product.category))]);
  assert.deepEqual(ids(screener.run(products, screen)), ['beyond-steak', 'oikos-pro']);
});

test('exclusions require an explicit true field and compose safely', () => {
  const soyFree = screener.run(products, { exclusions: ['soy'], sort: 'name' });
  assert.equal(soyFree.results.length, 7);
  assert.ok(soyFree.results.every(product => product.soyFree === true));
  const multi = screener.run(products, { exclusions: ['soy', 'dairy', 'gluten'], sort: 'name' });
  assert.ok(multi.results.every(product => product.soyFree && product.dairyFree && product.glutenFree));
});

test('preparation modes are mutually clear and never infer readiness', () => {
  const ready = screener.run(products, { minProtein: 10, prep: 'ready', sort: 'protein' });
  assert.equal(ready.results.length, 5);
  assert.ok(ready.results.every(product => product.prep === 'Ready now'));
  const heat = screener.run(products, { prep: 'heat', sort: 'name' });
  assert.ok(heat.results.every(product => product.prep !== 'Ready now'));
});

test('unknown preparation fails closed for every preparation filter', () => {
  const unknown = { ...products[0], id: 'unknown-prep', name: 'Unknown prep', prep: undefined };
  assert.equal(screener.run([unknown], { prep: 'ready' }).results.length, 0);
  assert.equal(screener.run([unknown], { prep: 'heat' }).results.length, 0);
});

test('unknown values sort after known values for every supported sort', () => {
  const knownHigh = { ...products[0], id: 'known-high', name: 'Known high', protein: 20, calories: 100, efficiency: 20, pricePer25: 2, availability: 'demo-available' };
  const knownLow = { ...products[0], id: 'known-low', name: 'Known low', protein: 10, calories: 200, efficiency: 5, pricePer25: 3, availability: 'demo-available' };
  const baseUnknown = { ...products[0], id: 'unknown', name: 'Aardvark unknown', protein: undefined, calories: undefined, efficiency: undefined, pricePer25: undefined, availability: 'demo-unavailable' };
  for (const sort of ['protein', 'calories', 'efficiency', 'price']) {
    const result = screener.run([baseUnknown, knownLow, knownHigh], { sort });
    assert.equal(result.results.at(-1).id, 'unknown', `${sort} keeps unknown values last`);
  }
  const unknownName = { ...knownHigh, id: 'unknown-name', name: undefined };
  assert.equal(screener.run([unknownName, knownLow, knownHigh], { sort: 'name' }).results.at(-1).id, 'unknown-name', 'name keeps an unknown label last');
});

test('unknown seeded prices sort last and remain counted', () => {
  const result = screener.run(products, { sort: 'price' });
  assert.equal(result.unknownPriceCount, 1);
  assert.equal(result.results.at(-1).id, 'magic-spoon');
});

test('empty screens fail closed rather than widening criteria', () => {
  const result = screener.run(products, { maxCalories: 20 });
  assert.equal(result.results.length, 0);
});

test('malformed persisted state is normalized to supported controls', () => {
  const screen = screener.normalize({
    category: '<script>', minProtein: -5, maxCalories: 'nope',
    exclusions: ['soy', 'invented', 'soy'], prep: 'teleport', sort: 'secret-score'
  }, ['Dairy', 'Plant meat']);
  assert.deepEqual(JSON.parse(JSON.stringify(screen)), {
    category: 'All groceries', minProtein: null, maxCalories: null,
    exclusions: ['soy'], prep: 'all', sort: 'protein'
  });
});

test('active clauses are plain-language and removable by stable keys', () => {
  const clauses = screener.clauses(screener.normalize({
    category: 'Dairy', minProtein: 20, maxCalories: 200,
    exclusions: ['soy'], prep: 'ready'
  }, ['Dairy']));
  assert.deepEqual(Array.from(clauses, clause => clause.key), ['category', 'minProtein', 'maxCalories', 'exclude:soy', 'prep']);
  assert.match(Array.from(clauses, clause => clause.label).join(' · '), /Type is Dairy.*At least 20g protein.*No more than 200 calories.*Soy-free.*Ready to eat/);
});

test('pagination bounds the rendered slice while preserving stable global counts', () => {
  const generated = Array.from({ length: 10_000 }, (_, index) => ({
    ...products[index % products.length],
    id: `generated-${String(index).padStart(5, '0')}`,
    name: `Generated ${String(index).padStart(5, '0')}`,
    protein: index % 101,
    calories: 50 + (index % 500),
    efficiency: index % 43
  }));
  const run = screener.run(generated, { sort: 'protein' });
  const first = screener.paginate(run.results, 1, 24);
  const last = screener.paginate(run.results, 9999, 24);
  assert.equal(run.results.length, 10_000);
  assert.equal(first.items.length, 24);
  assert.equal(first.totalResults, 10_000);
  assert.equal(first.pageCount, 417);
  assert.equal(first.start, 1);
  assert.equal(first.end, 24);
  assert.equal(last.page, 417);
  assert.equal(last.items.length, 16);
  assert.equal(last.start, 9985);
  assert.equal(last.end, 10_000);
  assert.ok(first.items.every((product, index, items) => index === 0 || items[index - 1].protein >= product.protein));
});
