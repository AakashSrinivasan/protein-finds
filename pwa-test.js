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
  await page.waitForSelector('[data-product-id]');
  await page.evaluate(async () => { if ('serviceWorker' in navigator) await navigator.serviceWorker.ready; });
  assert.ok(context.serviceWorkers().some(worker => worker.url().endsWith('/service-worker.js')), 'service worker controls the app');

  await page.locator('#installButton').click();
  assert.match(await page.locator('#liveRegion').textContent(), /iPhone Safari.*Share.*Add to Home Screen.*Android Chrome.*Install app/, 'install guidance covers iPhone and Android');

  await context.setOffline(true);
  await page.waitForSelector('[data-state="offline"]');
  assert.equal(await page.locator('[data-product-id]').count(), 12, 'cached grocery catalog remains available behind the explicit offline state');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-product-id]');
  assert.equal(await page.locator('[data-product-id]').count(), 12, 'offline reload restores the cached grocery catalog');
  const image = page.locator('[data-product-image]').first();
  assert.ok(await image.evaluate(element => element.complete && element.naturalWidth > 0), 'an exact package image is cached offline');
  assert.equal(await page.locator('[data-bottom-nav]').evaluate(element => getComputedStyle(element).position), 'fixed', 'standalone navigation remains app-like offline');
  assert.deepEqual(errors, [], 'zero PWA console/page errors');

  await browser.close();
  console.log('PASS: install guidance, active service worker, cached exact imagery/catalog, explicit offline state, and app-like navigation');
})().catch(error => {
  console.error(error);
  process.exit(1);
});