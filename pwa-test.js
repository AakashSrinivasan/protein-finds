const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const url = process.env.REVIEW_URL || 'http://127.0.0.1:4173/index.html';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', message => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', error => errors.push(error.message));

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-screen="discover"] [data-featured-id]');
  await page.evaluate(async () => { if ('serviceWorker' in navigator) await navigator.serviceWorker.ready; });
  assert.ok(context.serviceWorkers().some(worker => new URL(worker.url()).pathname.endsWith('/service-worker.js')), 'service worker controls the app');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-product-image]')].some(image => image.complete && image.naturalWidth > 0));

  await page.locator('.header-menu summary').click();
  await page.locator('#installButton').click();
  assert.match(await page.locator('#liveRegion').textContent(), /iPhone Safari.*Share.*Add to Home Screen.*Android Chrome.*Install app/, 'install guidance covers iPhone and Android');

  await context.setOffline(true);
  await page.waitForSelector('[data-state="offline"]');
  assert.equal(await page.locator('[data-featured-id]').count(), 5, 'cached Home recommendations remain available behind explicit offline status');
  const image = page.locator('[data-product-image]').first();
  assert.ok(await image.evaluate(element => element.complete && element.naturalWidth > 0), 'an exact package image is cached offline');
  assert.equal(await page.locator('[data-bottom-nav]').evaluate(element => getComputedStyle(element).position), 'fixed', 'standalone navigation remains app-like offline');

  await page.locator('[data-tab="screener"]').click();
  await page.waitForSelector('[data-screen="screener"]');
  assert.equal(await page.locator('[data-screen-result]').count(), 12, 'offline Search exposes the complete cached grocery catalog');
  await page.fill('#searchAskInput', 'best protein cereal');
  await page.locator('#searchAskForm button[type="submit"]').click();
  await page.waitForSelector('[data-screen-result="magic-spoon"]');
  assert.equal(await page.locator('[data-screen-result="magic-spoon"] [data-add="magic-spoon"]').count(), 1, 'integrated Search compiles to an exact cached catalog result with a usable action');
  assert.match(await page.locator('.personal-chips').textContent(), /Search: cereal/, 'compiled text criterion is visible offline');
  await page.locator('[data-screen-result="magic-spoon"] [data-add="magic-spoon"]').click();
  assert.equal(await page.locator('#basketCount').textContent(), '1', 'offline Search action updates the local basket');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-screen-result="magic-spoon"]');
  assert.match(await page.locator('.personal-chips').textContent(), /Search: cereal/, 'offline reload restores the exact deep-linked criterion state');
  assert.equal(await page.locator('#basketCount').textContent(), '1', 'offline reload preserves local shopping state');
  assert.deepEqual(errors, [], 'zero PWA console/page errors');

  await browser.close();
  console.log('PASS: install guidance, active service worker, cached Home imagery/catalog, explicit offline state, integrated offline Search/action, fixed navigation, and reload persistence');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
