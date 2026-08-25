const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadProducts() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('./data.js'), 'utf8'), context, { filename: 'data.js' });
  return context.window.PROTEIN_PRODUCTS;
}

test('Beyond Steak UPC resolves to one exact SKU with typed exact-product and Target-search handoffs', () => {
  const products = loadProducts();
  const matches = products.filter(product => product.exactSku?.upc === '0810057290831');
  assert.equal(matches.length, 1, 'UPC 0810057290831 must identify exactly one catalog record');
  const [product] = matches;
  assert.equal(product.id, 'beyond-steak');
  assert.equal(product.image.upc, product.exactSku.upc);
  assert.deepEqual(Array.from(product.exactSku.retailerHandoffs, handoff => handoff.type), ['exact-product', 'retailer-search']);
  const exact = product.exactSku.retailerHandoffs[0];
  assert.equal(exact.label, 'Check Safeway on Instacart');
  assert.match(exact.url, /^https:\/\/www\.instacart\.com\/products\/27918479-/);
  assert.equal(exact.availabilityStatus, 'unknown');
  assert.equal(exact.priceStatus, 'unknown');
  const target = product.exactSku.retailerHandoffs[1];
  assert.equal(target.storeId, 'target-bridgepointe-san-mateo');
  assert.equal(target.label, 'Search Target');
  assert.equal(target.url, 'https://www.target.com/s?searchTerm=0810057290831');
});

test('all photographed exact SKUs have identity/nutrition evidence; only verified pages use an exact retailer CTA', () => {
  const photographed = loadProducts().filter(product => product.image);
  assert.equal(photographed.length, 3);
  for (const product of photographed) {
    assert.equal(product.exactSku.upc, product.image.upc);
    assert.match(product.exactSku.nutritionSourceUrl, /^https:\/\//);
    assert.match(product.exactSku.nutritionCheckedAt, /^\d{4}-\d{2}-\d{2}$/);
  }
  const beyond = photographed.find(product => product.id === 'beyond-steak');
  assert.equal(beyond.exactSku.retailerHandoffs.filter(handoff => handoff.type === 'exact-product').length, 1);
  for (const product of photographed) {
    const targetSearch = product.exactSku.retailerHandoffs.find(handoff => handoff.type === 'retailer-search');
    assert.equal(targetSearch.label, 'Search Target');
    assert.match(targetSearch.url, /^https:\/\/www\.target\.com\/s\?searchTerm=/);
    assert.match(decodeURIComponent(targetSearch.url), new RegExp(product.exactSku.upc));
  }
});
