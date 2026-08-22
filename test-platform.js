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

  assert.equal(await page.locator('[data-product-id]').count(), 12, 'grocery discovery excludes restaurant records');
  assert.equal(await page.locator('[data-screen]:visible').count(), 1, 'only one focused screen renders');
  assert.deepEqual(await page.locator('[data-tab]').evaluateAll(tabs => tabs.map(tab => tab.dataset.tab)), ['discover', 'ask', 'saved', 'basket'], 'primary navigation includes grounded Ask inside the grocery loop');
  assert.equal(await page.locator('[data-category="Restaurant"]').count(), 0, 'restaurants are not a top-level grocery category');
  assert.equal(await page.locator('[data-product-id] .decision-price').count(), 12, 'every grocery card shows price or an honest unknown state');
  assert.equal(await page.locator('[data-product-id] .decision-store').count(), 12, 'every grocery card shows its seeded store');
  assert.equal(await page.locator('[data-product-id] .decision-freshness').count(), 12, 'every grocery card shows availability freshness');
  assert.equal(await page.locator('[data-product-id] .decision-verdict').count(), 12, 'every grocery card shows a plain-English verdict');
  assert.match(await page.locator('[data-product-id="magic-spoon"] .decision-price').textContent(), /Price unknown/i, 'unsupported package price is not presented as current');
  assert.equal(await page.locator('.role-pill').count(), 0, 'internal ranking labels are not exposed to shoppers');
  assert.equal(await page.locator('link[rel="manifest"]').count(), 1, 'install manifest is linked');
  assert.equal(await page.locator('[data-product-image]').count(), 3, 'only three exact licensed images are attached');
  assert.equal(await page.locator('[data-image-needed]').count(), 9, 'uncertain grocery variants use image-needed states');

  const imageRecords = await page.locator('[data-product-image]').evaluateAll(images => images.map(image => ({
    src: image.getAttribute('src'), upc: image.dataset.upc, license: image.dataset.imageLicense
  })));
  for (const image of imageRecords) {
    assert.match(image.upc, /^\d{13}$/, 'exact image has a 13-digit UPC');
    assert.equal(image.license, 'CC BY-SA 3.0', 'exact image carries its license');
    assert.ok(fs.existsSync(path.join(root, image.src)), `local image exists: ${image.src}`);
  }

  await page.locator('[data-tab="ask"]').click();
  await page.fill('#askInput', 'best protein cereal');
  await page.click('#askForm button[type="submit"]');
  assert.equal(await page.locator('[data-query-plan]').isVisible(), true, 'Ask exposes the deterministic query plan');
  assert.equal(await page.locator('[data-ask-product-id="magic-spoon"]').count(), 1, 'cereal intent resolves to a catalog record');
  assert.match(await page.locator('[data-ask-product-id="magic-spoon"]').textContent(), /Price unknown[\s\S]*Availability unknown/, 'Ask exposes unsupported price and availability honestly');
  assert.match(await page.locator('.field-citations').textContent(), /protein[\s\S]*calories[\s\S]*efficiency/, 'Ask cites actual ranking fields');
  const askIds = await page.locator('[data-ask-product-id]').evaluateAll(nodes => nodes.map(node => node.dataset.askProductId));
  const catalogIds = await page.evaluate(() => window.ProteinFinds.products.map(product => product.id));
  assert.ok(askIds.every(id => catalogIds.includes(id)), 'every Ask recommendation resolves to the browser catalog');
  await page.fill('#askInput', '<img src=x onerror=alert(1)>');
  await page.click('#askForm button[type="submit"]');
  assert.equal(await page.locator('[data-ask-product-id]').count(), 0, 'unsupported hostile input fails closed');
  assert.equal(await page.locator('.ask-answer img').count(), 0, 'Ask input is not interpreted as markup');
  await page.locator('[data-tab="discover"]').click();

  await page.locator('[data-category="Main proteins"]').click();
  assert.equal(await page.locator('[data-product-id]').count(), 5, 'trip-led category groups egg and plant-meat mains');
  await page.locator('[data-category="All groceries"]').click();

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
  assert.match(await page.locator('[data-screen="basket"]').textContent(), /Safeway[\s\S]*Plant meat/, 'basket groups items by store and category');
  assert.match(await page.locator('[data-missing-categories]').textContent(), /Trip ideas, not nutrition requirements/i, 'missing-category prompts avoid medical framing');
  assert.match(await page.locator('[data-screen="basket"]').textContent(), /No order or payment is submitted/, 'basket is source-honest');
  await page.locator('[data-tab="ask"]').click();
  await page.locator('[data-ask-prompt="improve my basket"]').click();
  assert.match(await page.locator('.ask-summary').textContent(), /basket is missing/i, 'basket improvement reads the current persisted basket');
  assert.equal(await page.locator('[data-ask-product-id="boca-original"]').count(), 0, 'basket improvement does not recommend an item already in the basket');
  assert.ok(await page.locator('[data-ask-product-id]').count() > 0, 'basket improvement fills missing trip categories from catalog records');
  await page.locator('[data-tab="basket"]').click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-screen="basket"] .basket-line');
  assert.equal(await page.locator('[data-screen="basket"] .basket-line').count(), 1, 'basket persists across refresh');

  assert.deepEqual(errors, [], 'zero browser errors');
  await browser.close();
  console.log('PASS: grocery-only decision cards, focused navigation, search, saves, exact deep links, persistent store/category basket, honest prompts, and standalone manifest');
})().catch(error => {
  console.error(error);
  process.exit(1);
});