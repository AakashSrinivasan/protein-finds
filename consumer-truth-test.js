const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const base = process.env.REVIEW_URL || 'http://127.0.0.1:4321/index.html';
(async () => {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(base);
      const products = await page.evaluate(() => window.ProteinFinds.products);
      assert.equal(products.length, 3);
      assert.equal(products.find(p => p.id === 'quest-cookie').soyFree, false, 'declared Soy cannot pass a soy-free screen');
      for (const p of products) {
        assert.equal(p.price, null); assert.equal(p.pricePer25, null);
        assert.equal(p.availability, 'unknown');
        assert.equal(p.fieldEvidence.package.status, 'documented');
        assert.equal(p.fieldEvidence.price.status, 'unknown');
        assert.equal(p.fieldEvidence.availability.status, 'unknown');
        assert.equal(p.ingredients, null, 'seed ingredients must not pass consumer ingredient filters');
      }
      await page.goto(base + '#product/quest-cookie');
      assert.doesNotMatch(await page.locator('main').innerText(), /Verified package\.|Ingredients: Protein blend/);
      await page.locator('[data-product-evidence] summary').click();
      assert.match(await page.locator('[data-product-evidence]').innerText(), /historical|recorded/i);
      assert.match(await page.locator('[data-product-evidence]').innerText(), /ingredients.*not verified/i);
      await page.locator('[data-add="quest-cookie"]').click();
      await page.locator('[data-tab="basket"]').click();
      assert.match(await page.locator('.basket-line').innerText(), /stock unknown/i);
      assert.match(await page.locator('.basket-total').innerText(), /0 of 1 products priced/i);
      assert.doesNotMatch(await page.locator('.basket-total').innerText(), /one-serving total|\$0\.00/);
      await page.reload();
      assert.equal(await page.locator('.basket-line').count(), 1);
      await page.evaluate(() => localStorage.setItem('protein-finds-shell-state-v1', JSON.stringify({ basket: ['quest-cookie', 'magic-spoon', 'removed-product'] })));
      await page.reload();
      assert.equal(await page.locator('.basket-line').count(), 3);
      assert.equal(await page.locator('[data-retained-basket]').count(), 2);
      await page.locator('[data-remove="removed-product"]').click();
      await page.reload();
      assert.equal(await page.locator('.basket-line').count(), 2);
      await page.evaluate(() => {
        const products = window.ProteinFinds.products;
        const screen = ProductScreener.normalize({ allergens: ['soy'] });
        const matches = ProductScreener.run(products, screen).results;
        if (matches.some(p => p.id === 'quest-cookie')) throw new Error('Quest passed soy exclusion');
        const ingredient = ProductScreener.run(products, { ingredientExclude: 'stevia' });
        if (ingredient.results.length) throw new Error('unknown ingredients passed negative ingredient filter');
      });
      assert.deepEqual(errors, []);
      console.log(`PASS consumer truth ${engine.name()}: per-field evidence, fail-closed filters, unknown totals and retained basket entries`);
    } finally { await browser.close(); }
  }
})().catch(e => { console.error(e); process.exit(1); });
