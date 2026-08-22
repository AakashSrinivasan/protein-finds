const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const url = process.env.REVIEW_URL || 'http://127.0.0.1:4173/index.html';

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone', 'manifest launches without browser chrome');
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose.includes('maskable')), 'manifest has a maskable launch icon');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('console', message => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-product-id]');

  assert.equal(await page.locator('[data-product-id]').count(), 16, 'complete seeded catalog is available');
  assert.equal(await page.locator('[data-screen]:visible').count(), 1, 'only one focused screen renders');
  assert.equal(await page.locator('link[rel="manifest"]').count(), 1, 'install manifest is linked');
  assert.equal(await page.locator('[data-product-image]').count(), 3, 'only three exact licensed images are attached');
  assert.equal(await page.locator('[data-image-needed]').count(), 13, 'uncertain variants use image-needed states');

  const imageRecords = await page.locator('[data-product-image]').evaluateAll(images => images.map(image => ({
    src: image.getAttribute('src'), upc: image.dataset.upc, license: image.dataset.imageLicense
  })));
  for (const image of imageRecords) {
    assert.match(image.upc, /^\d{13}$/, 'exact image has a 13-digit UPC');
    assert.equal(image.license, 'CC BY-SA 3.0', 'exact image carries its license');
    assert.ok(fs.existsSync(path.join(root, image.src)), `local image exists: ${image.src}`);
  }

  await page.fill('#search', 'BOCA');
  assert.equal(await page.locator('[data-product-id]').count(), 3, 'search includes both BOCA products and one seeded comparison reference');
  await page.locator('[data-save="boca-original"]').click();
  assert.equal(await page.locator('#savedCount').textContent(), '1', 'save count updates');
  await page.locator('[data-tab="saved"]').click();
  await page.waitForSelector('[data-screen="saved"] [data-product-id]');
  assert.equal(await page.locator('[data-screen="saved"] [data-product-id]').count(), 1, 'saved screen contains the exact saved product');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-screen="saved"] [data-product-id]');
  assert.equal(await page.locator('[data-screen="saved"] [data-product-id]').count(), 1, 'saved product persists across refresh');

  await page.locator('[data-product-id]').click();
  assert.match(page.url(), /#product\/boca-original$/, 'product has an exact deep link');
  await page.locator('[data-add="boca-original"]').click();
  assert.equal(await page.locator('#basketCount').textContent(), '1', 'basket count updates');
  await page.locator('[data-tab="basket"]').click();
  await page.waitForSelector('[data-screen="basket"] .basket-line');
  assert.match(await page.locator('[data-screen="basket"]').textContent(), /Original Vegan Veggie Burger/, 'basket preserves exact product identity');
  assert.match(await page.locator('[data-screen="basket"]').textContent(), /No order or payment is submitted/, 'basket is source-honest');

  await page.locator('[data-tab="planner"]').click();
  await page.waitForSelector('[data-screen="planner"]');
  await page.locator('#plannerForm button[type="submit"]').click();
  assert.ok(await page.locator('.plan-result').isVisible(), 'deterministic planner renders a result');
  const plannedIds = await page.evaluate(() => window.ProteinFinds.state.plannerResult.map(product => product.id));
  assert.equal(new Set(plannedIds).size, plannedIds.length, 'planner does not duplicate products');
  assert.ok(await page.evaluate(() => window.ProteinFinds.state.plannerResult.reduce((sum, product) => sum + product.protein, 0) >= 50), 'default planner reaches 50g');

  assert.deepEqual(errors, [], 'zero browser errors');
  await browser.close();
  console.log('PASS: catalog/image contracts, focused navigation, search, saves, exact deep links, basket persistence, deterministic planning, and standalone manifest');
})().catch(error => {
  console.error(error);
  process.exit(1);
});