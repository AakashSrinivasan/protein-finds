const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const vm = require('node:vm');
const evidence = require('./product-evidence'); const s = {};
const ctx = { window: {}, btoa: v => Buffer.from(v, 'binary').toString('base64'), atob: v => Buffer.from(v, 'base64').toString('binary'), escape, unescape }; vm.createContext(ctx);
for (const f of ['data.js', 'product-evidence.js', 'product-screener.js', 'ask-protein.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
const products = ctx.window.PROTEIN_PRODUCTS;
const fixtures = () => ({ id: 'fixture', exactSku: { upc: '1234567890123', allergens: [] }, exclusionEvidence: { soy: { state: 'free', verificationState: 'source-backed', productId: 'fixture', upc: '1234567890123', sourceUrl: 'https://example.org/explicit-test-fixture', observedAt: '2026-10-01T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z' } } });
test('every declared or precautionary allergen fails exclusion despite legacy booleans', () => {
  const quest = products.find(p => p.id === 'quest-cookie');
  assert.equal(evidence.exclusionState(quest, 'soy'), 'contains');
  assert.equal(ctx.window.ProductScreener.run([quest], { allergens: ['soy'] }).results.length, 0);
  for (const p of products) for (const allergen of ['soy','dairy','gluten','stevia','egg','peanut','sesame','wheat','milk']) {
    if (['contains','may_contain'].includes(evidence.exclusionState(p, allergen))) assert.equal(ctx.window.ProductScreener.run([p], { allergens: [allergen] }).results.length, 0, `${p.id} ${allergen}`);
  }
});
test('legacy free booleans and absence of declared allergens cannot establish freedom', () => {
  assert.equal(evidence.exclusionPass({ id:'unverified', soyFree:true, exactSku:{ allergens:[] } }, 'soy'), false);
  for (const p of products) assert.equal(evidence.exclusionPass(p, 'soy'), false);
});
test('free requires current reviewed evidence bound to exact product and UPC; contradiction wins', () => {
  const now = Date.parse('2026-10-12T00:00:00Z');
  assert.equal(evidence.exclusionPass(fixtures(), 'soy', now), true);
  for (const patch of [{ verificationState:'unverified' },{ productId:'other' },{ upc:'other' },{ expiresAt:'2026-10-02T00:00:00Z' },{ observedAt:'2026-10-20T00:00:00Z' }]) {
    const p=fixtures();Object.assign(p.exclusionEvidence.soy,patch);assert.equal(evidence.exclusionPass(p,'soy',now),false);
  }
  const p=fixtures();p.exactSku.allergens=['May contain soy'];assert.equal(evidence.exclusionState(p,'soy',now),'may_contain');assert.equal(evidence.exclusionPass(p,'soy',now),false);
});
test('all natural-language exclusion variants share the same fail-closed path', () => {
  for (const phrase of ['no soy','soy free','soy-free','without soy','avoid soy']) {
    const screen=ctx.window.ProductScreener.compile(phrase,{},products);
    assert.ok(screen.allergens.includes('soy'),phrase);
    assert.equal(ctx.window.ProductScreener.run(products,screen).results.length,0,phrase);
    assert.equal(ctx.window.AskProtein.answerAsk({query:`${phrase} snacks`,products,basketIds:[]}).recommendations.length,0,phrase);
  }
});
