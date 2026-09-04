const { chromium, webkit } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');

const base = process.env.REVIEW_URL || 'http://127.0.0.1:4174/index.html';
const out = path.join(__dirname, 'review-artifacts', 'app-bible-freeze-v1');
const pause = page => page.waitForTimeout(360);

async function freshPage(browser, viewport, suffix = '') {
  const context = await browser.newContext({ viewport, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  await page.goto(`${base}?freeze=${Date.now()}${suffix}#discover`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-screen="discover"]');
  return { context, page };
}

async function snap(page, name) {
  await pause(page);
  await page.screenshot({ path: path.join(out, `${name}.png`), animations: 'disabled' });
}

async function phoneSet(browser, prefix) {
  const { context, page } = await freshPage(browser, { width: 390, height: 844 }, `-${prefix}`);
  await snap(page, `${prefix}-390x844-home`);
  await page.click('[data-tab="screener"]');
  await snap(page, `${prefix}-390x844-search-default`);
  await page.click('[data-screen-template="high-protein"]');
  await snap(page, `${prefix}-390x844-search-filtered`);
  await page.click('[data-open-filter]');
  await snap(page, `${prefix}-390x844-filter-sheet`);
  await page.keyboard.press('Escape');
  const first = page.locator('[data-screen-result]').first();
  const firstId = await first.getAttribute('data-screen-result');
  await first.locator('.screen-product a').click();
  await snap(page, `${prefix}-390x844-product`);
  await page.click(`[data-save="${firstId}"]`);
  if (await page.locator(`[data-add="${firstId}"]:not([disabled])`).count()) await page.click(`[data-add="${firstId}"]`);
  await page.click('[data-tab="screener"]');
  await page.click('[data-open-filter]');
  await page.click('[data-screen-reset]');
  await page.click('.filter-sheet header [data-close-filter]');
  await page.click('[data-compare-mode]');
  const compareButtons = page.locator('[data-screen-result] [data-compare]');
  await compareButtons.nth(0).click();
  await compareButtons.nth(1).click();
  await page.click('[data-compare-tray] a[href="#compare"]');
  await snap(page, `${prefix}-390x844-compare`);
  await page.click('[data-tab="nearby"]');
  await snap(page, `${prefix}-390x844-nearby`);
  await page.click('[data-tab="saved"]');
  await snap(page, `${prefix}-390x844-saved`);
  await page.click('[data-tab="basket"]');
  await snap(page, `${prefix}-390x844-basket`);
  await context.close();
}

async function routeShot(browser, viewport, route, name, action) {
  const { context, page } = await freshPage(browser, viewport, `-${name}`);
  if (route !== 'discover') await page.click(`[data-tab="${route}"]`);
  if (action) await action(page);
  await snap(page, name);
  await context.close();
}

(async () => {
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  const c = await chromium.launch({ headless: true });
  const w = await webkit.launch({ headless: true });
  await phoneSet(c, 'chromium');
  await phoneSet(w, 'webkit');
  await routeShot(c, { width: 844, height: 390 }, 'discover', 'chromium-844x390-home');
  await routeShot(c, { width: 844, height: 390 }, 'screener', 'chromium-844x390-search-filter', p => p.click('[data-open-filter]'));
  await routeShot(c, { width: 844, height: 390 }, 'nearby', 'chromium-844x390-nearby');
  await routeShot(c, { width: 1440, height: 900 }, 'discover', 'chromium-1440x900-home');
  await routeShot(c, { width: 1440, height: 900 }, 'screener', 'chromium-1440x900-search');
  await routeShot(c, { width: 1440, height: 900 }, 'screener', 'chromium-1440x900-product', p => p.locator('[data-screen-result] .screen-product a').first().click());
  await routeShot(c, { width: 1440, height: 900 }, 'nearby', 'chromium-1440x900-map-results');

  const videoContext = await c.newContext({ viewport: { width: 390, height: 844 }, recordVideo: { dir: out, size: { width: 390, height: 844 } } });
  const page = await videoContext.newPage();
  const video = page.video();
  await page.goto(`${base}?motion=${Date.now()}#discover`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await pause(page);
  await page.click('.home-search'); await pause(page);
  await page.click('[data-open-filter]'); await pause(page);
  await page.keyboard.press('Escape'); await pause(page);
  const id = await page.locator('[data-screen-result]').first().getAttribute('data-screen-result');
  await page.locator('[data-screen-result] .screen-product a').first().click(); await pause(page);
  await page.waitForSelector('[data-screen="product"]');
  await page.click(`[data-save="${id}"]`); await pause(page);
  if (await page.locator(`[data-add="${id}"]:not([disabled])`).count()) await page.click(`[data-add="${id}"]`);
  await pause(page);
  await page.click('[data-tab="nearby"]'); await pause(page);
  await page.goBack(); await pause(page);
  await videoContext.close();
  const videoPath = await video.path();
  await fs.rename(videoPath, path.join(out, 'chromium-390x844-product-loop.webm'));
  await c.close(); await w.close();
  console.log(out);
})().catch(error => { console.error(error); process.exit(1); });
