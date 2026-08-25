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
