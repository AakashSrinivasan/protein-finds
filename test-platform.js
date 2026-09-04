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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', message => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-screen="discover"] [data-featured-id]');

  assert.equal(await page.locator('.discover-hero').count(), 0, 'legacy marketing hero is removed');
  assert.equal(await page.locator('.catalog-title').count(), 0, 'Home no longer duplicates a full catalog shelf');
  assert.equal(await page.locator('.home-search').isVisible(), true, 'dominant search is in the first screen');
  assert.equal(await page.locator('.home-intro a[href="#nearby"]').isVisible(), true, 'location context is immediately actionable');
  assert.equal(await page.locator('[data-featured-id]').count(), 5, 'Home exposes an image-led recommendation rail');
  assert.equal(await page.locator('[data-featured-id] .featured-actions > *').count(), 5, 'each recommendation has one primary action');
  assert.equal(await page.locator('[data-featured-id] [data-add],[data-featured-id] [data-compare]').count(), 0, 'secondary actions moved out of Home cards');
  assert.deepEqual(
    await page.locator('[data-tab]').evaluateAll(tabs => tabs.map(tab => ({ route: tab.dataset.tab, label: tab.querySelector('b').textContent }))),
    [
      { route: 'discover', label: 'Home' },
      { route: 'screener', label: 'Search' },
      { route: 'nearby', label: 'Nearby' },
      { route: 'saved', label: 'Saved' },
      { route: 'basket', label: 'Basket' }
    ],
    'bottom navigation follows the shopping loop'
  );
  assert.equal(await page.locator('[data-header-saved]').count(), 0, 'Saved is no longer duplicated in the header');
  assert.equal(await page.locator('[data-screen]:visible').count(), 1, 'one focused screen renders');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, 'Home does not overflow the phone');

  const motion = await page.locator('[data-screen="discover"]').evaluate(element => ({
    animationName: getComputedStyle(element).animationName,
    opacity: getComputedStyle(element).opacity
  }));
  assert.match(motion.animationName, /screen-rise|screen-push/, 'route content receives a functional transition');
  assert.equal(motion.opacity, '1', 'route motion never hides content from accessibility checks');

  const initialFeatured = await page.locator('[data-featured-id]').evaluateAll(cards => cards.map(card => card.dataset.featuredId));
  await page.locator('[data-quick-sort="efficiency"]').click();
  assert.equal(await page.locator('[data-quick-sort="efficiency"]').getAttribute('aria-pressed'), 'true');
  assert.notDeepEqual(await page.locator('[data-featured-id]').evaluateAll(cards => cards.map(card => card.dataset.featuredId)), initialFeatured, 'goal chips reflow recommendations');

  await page.locator('[data-tab="screener"]').click();
  await page.waitForSelector('[data-screen="screener"]');
  assert.equal(await page.locator('#searchAskForm').isVisible(), true, 'natural-language search is integrated into Search');
  await page.fill('#searchAskInput', 'best protein cereal');
  await page.locator('#searchAskForm button[type="submit"]').click();
  assert.equal(await page.locator('[data-screen-result="magic-spoon"]').count(), 1, 'natural-language search compiles to the exact catalog result');
  assert.match(await page.locator('.personal-chips').textContent(), /Cereal/i, 'parsed natural-language criteria remain visible and editable');
  await page.locator('[data-open-filter]').click();
  await page.locator('[data-screen-reset]').click();
  await page.locator('[data-close-filter]').last().click();
  assert.equal(await page.locator('[data-screen-result]').count(), 12, 'reset restores the complete grocery seed');
  await page.locator('[data-screen-template="high-protein"]').click();
  assert.deepEqual(await page.locator('[data-screen-result]').evaluateAll(nodes => nodes.map(node => node.dataset.screenResult)), ['beyond-steak', 'oikos-pro']);

  await page.locator('[data-compare-mode]').click();
  for (const id of ['beyond-steak', 'oikos-pro']) await page.locator(`[data-screen-result="${id}"] [data-compare]`).click();
  assert.match(await page.locator('[data-compare-tray]').textContent(), /2\/3 selected/);
  await page.locator('[data-compare-tray] a[href="#compare"]').click();
  await page.waitForSelector('[data-screen="compare"]');
  assert.equal(await page.locator('[data-compare-product]').count(), 2, 'comparison loop remains intact');
  assert.equal(await page.locator('.compare-recommendation').count(), 1, 'comparison remains decision-led');
  await page.locator('.detail-back').click();
  await page.waitForSelector('[data-screen="screener"]');
  await page.locator('[data-clear-compare]').click();
  await page.locator('[data-open-filter]').click();
  await page.locator('[data-screen-reset]').click();
  await page.locator('[data-close-filter]').last().click();

  await page.locator('[data-screen-result="boca-original"] .screen-product a').click();
  await page.waitForSelector('[data-screen="product"]');
  assert.equal(await page.locator('.detail-actions').evaluate(element => getComputedStyle(element).position), 'sticky', 'product actions remain reachable in a sticky action dock');
  await page.locator('[data-save="boca-original"]').click();
  assert.equal(await page.locator('#savedCount').textContent(), '1', 'save count bumps in navigation');
  await page.locator('[data-tab="saved"]').click();
  await page.waitForSelector('[data-screen="saved"]');
  assert.equal(await page.locator('[data-screen="saved"] [data-product-id="boca-original"]').count(), 1, 'Saved contains the exact product');
  await page.locator('[data-screen="saved"] [data-product-id="boca-original"] .product-link').click();
  await page.locator('[data-add="boca-original"]').click();
  assert.equal(await page.locator('#basketCount').textContent(), '1', 'basket count bumps in navigation');
  await page.locator('[data-tab="basket"]').click();
  assert.match(await page.locator('[data-screen="basket"]').textContent(), /Original Vegan Veggie Burger/);
  assert.match(await page.locator('[data-screen="basket"]').textContent(), /No order or payment is submitted/);

  await page.locator('[data-tab="nearby"]').click();
  await page.waitForSelector('[data-screen="nearby"]');
  await page.fill('#zipInput', '94404');
  await page.locator('#locationForm button[type="submit"]').click();
  await page.waitForSelector('[data-store-map]');
  assert.equal(await page.locator('.map-store-sheet').evaluate(element => getComputedStyle(element).position), 'absolute', 'mobile Nearby uses a map bottom sheet');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, 'all primary screens fit the phone');

  const reduced = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const reducedPage = await reduced.newPage();
  await reducedPage.goto(url, { waitUntil: 'domcontentloaded' });
  const reducedDuration = await reducedPage.locator('[data-screen]').evaluate(element => getComputedStyle(element).animationDuration);
  assert.ok(parseFloat(reducedDuration) <= 0.01, 'reduced-motion preference collapses animation duration');
  await reduced.close();

  assert.deepEqual(errors, [], 'zero browser errors');
  await browser.close();
  console.log('PASS: field-guide Home, integrated Search, tactile navigation, detail action dock, mobile map sheet, core shopping loops, honest data, and reduced motion');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
