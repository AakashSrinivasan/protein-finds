const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const url = process.env.REVIEW_URL || 'http://127.0.0.1:4173/index.html';
const artifactDir = path.join(root, 'review-artifacts');
fs.mkdirSync(artifactDir, { recursive: true });

async function assertNoSmallTargets(page, scope, label) {
  const small = await page.locator(`${scope} button:visible,${scope} a:visible,${scope} input:visible,${scope} select:visible`).evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect();
    return { label: (node.textContent || node.getAttribute('aria-label') || node.id || '').trim(), width: rect.width, height: rect.height };
  }).filter(target => target.width < 43.5 || target.height < 43.5));
  assert.deepEqual(small, [], `${label}: every visible interactive target is at least 44px`);
}

async function assertNoOverflow(page, label) {
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, `${label}: no horizontal overflow`);
}

async function assertShell(browserType, viewport, label, screenshot, basketScreenshot) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', message => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-screen="discover"] [data-featured-id]');
  await page.waitForTimeout(500);

  assert.equal(await page.locator('[data-screen]:visible').count(), 1, `${label}: one focused Home screen`);
  const navigationBox = await page.locator('[data-bottom-nav]').boundingBox();
  const recommendation = page.locator('[data-featured-id]').first();
  const recommendationBox = await recommendation.boundingBox();
  const recommendationIdentity = await recommendation.locator('.featured-info').boundingBox();
  const recommendationAction = await recommendation.locator('.featured-actions .primary').boundingBox();
  assert.equal(await page.locator('[data-bottom-nav]').evaluate(element => getComputedStyle(element).position), 'fixed', `${label}: persistent navigation is fixed`);
  assert.equal(await page.locator('[data-tab]').count(), 5, `${label}: five primary destinations only`);
  assert.ok(navigationBox && navigationBox.y + navigationBox.height <= viewport.height + 1, `${label}: navigation respects the viewport/safe-area boundary`);
  assert.ok(recommendationBox && recommendationBox.y < navigationBox.y, `${label}: a recommendation begins in the first viewport`);
  assert.ok(recommendationIdentity && recommendationIdentity.y < navigationBox.y, `${label}: recommendation identity begins above navigation`);
  assert.ok(recommendationAction && recommendationAction.y + recommendationAction.height <= navigationBox.y, `${label}: complete primary recommendation action is above navigation`);
  assert.ok(await page.locator('.surface-truth').isVisible(), `${label}: bounded/not-live data context remains available`);
  const exactImage = page.locator('[data-featured-id] [data-product-image][data-upc]').first();
  assert.equal(await exactImage.getAttribute('data-image-license'), 'CC BY-SA 3.0', `${label}: exact package imagery retains licensing evidence`);
  await assertNoSmallTargets(page, '[data-screen="discover"]', `${label} Home`);
  await assertNoOverflow(page, `${label} Home`);
  if (screenshot) await page.screenshot({ path: path.join(artifactDir, screenshot), fullPage: false });

  await page.locator('[data-tab="screener"]').click();
  await page.waitForSelector('[data-screen="screener"]');
  assert.equal(await page.locator('[data-screen-result]').count(), 12, `${label}: Search begins with the complete grocery seed`);
  assert.equal(await page.locator('[data-screen-result-count]').textContent(), '12', `${label}: Search exposes its live result count`);
  assert.equal(await page.locator('.personal-chips button').count(), 3, `${label}: Search exposes quick filter chips`);
  await page.locator('[data-open-filter]').click();
  await page.selectOption('#criterionPicker', 'numeric:protein');
  await page.click('[data-add-criterion]');
  const proteinMinimum = page.locator('[data-criterion-number="min"][data-key="protein"]');
  assert.ok(await proteinMinimum.isVisible(), `${label}: precise criterion editor opens`);
  await proteinMinimum.fill('20');
  await proteinMinimum.press('Tab');
  const filteredCount = Number(await page.locator('[data-screen-result-count]').textContent());
  assert.ok(filteredCount > 0 && filteredCount < 12, `${label}: filter sheet changes the result count`);
  await page.locator('[data-screen-reset]').first().click();
  await page.locator('.filter-sheet header [data-close-filter]').click();
  await page.fill('#searchAskInput', 'best protein cereal');
  await page.locator('#searchAskForm button[type="submit"]').click();
  await page.waitForSelector('[data-screen-result="magic-spoon"]');
  assert.equal(await page.locator('[data-screen-result="magic-spoon"] [data-add="magic-spoon"]').count(), 1, `${label}: exact query returns a catalog-grounded product action`);
  await assertNoSmallTargets(page, '[data-screen="screener"]', `${label} Search`);
  await assertNoOverflow(page, `${label} Search`);
  if (screenshot) await page.screenshot({ path: path.join(artifactDir, `search-${screenshot}`), fullPage: false });

  await page.locator('[data-screen-result]').last().scrollIntoViewIfNeeded();
  const searchScroll = await page.evaluate(() => scrollY);
  assert.ok(searchScroll >= 0, `${label}: Search exposes a stable scroll position`);
  const productLink = page.locator('[data-screen-result]').last().locator('.screen-product a');
  const productName = await productLink.textContent();
  await productLink.click();
  await page.waitForSelector('[data-screen="product"]');
  assert.match(await page.locator('#screenTitle').textContent(), new RegExp(productName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `${label}: Search opens the exact product deep link`);
  const productHash = await page.evaluate(() => location.hash);
  await page.goBack();
  await page.waitForSelector('[data-screen="screener"]');
  assert.equal(await page.inputValue('#searchAskInput'), 'best protein cereal', `${label}: Back preserves integrated Search state`);
  await page.waitForFunction(expected => Math.abs(scrollY - expected) < 8, searchScroll);
  assert.ok(await page.evaluate(expected => Math.abs(scrollY - expected) < 8, searchScroll), `${label}: Back restores Search scroll`);

  await productLink.click();
  await page.waitForSelector('[data-screen="product"]');
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.evaluate(() => location.hash), productHash, `${label}: product deep link survives refresh`);
  await page.locator('[data-tab="screener"]').click();
  await page.waitForSelector('[data-screen="screener"]');
  await page.fill('#searchAskInput', 'best protein cereal');
  await page.locator('#searchAskForm button[type="submit"]').click();
  await page.waitForSelector('[data-screen-result="magic-spoon"]');

  await page.locator('[data-screen-result="magic-spoon"] [data-add="magic-spoon"]').click();
  await page.locator('[data-screen-result="magic-spoon"] .screen-product a').click();
  await page.waitForSelector('[data-screen="product"]');
  await page.locator('.detail-card [data-save]').click();
  assert.equal(await page.locator('.detail-card [data-save]').getAttribute('aria-pressed'), 'true', `${label}: detail Save works`);
  assert.ok(await page.locator('.detail-card [data-add]').isDisabled(), `${label}: prior Search Add state reaches product detail`);

  await page.locator('[data-tab="nearby"]').click();
  await page.waitForSelector('[data-screen="nearby"] [data-store-map]');
  await page.waitForSelector('[data-store-marker]');
  assert.equal(await page.locator('[data-store-marker]').count(), 4, `${label}: Nearby remains reachable with all bounded store records`);
  await assertNoOverflow(page, `${label} Nearby`);

  await page.locator('[data-tab="basket"]').click();
  await page.waitForSelector('[data-screen="basket"] .basket-line');
  assert.ok(await page.locator('[data-missing-categories]').isVisible(), `${label}: Basket retains trip-completion prompts`);
  assert.match(await page.locator('.basket-line').first().textContent(), /serving|price unknown/i, `${label}: Basket keeps source-honest pricing`);
  if (basketScreenshot) await page.screenshot({ path: path.join(artifactDir, basketScreenshot), fullPage: false });

  for (const state of ['empty', 'loading', 'error', 'offline', 'stale']) {
    await page.evaluate(value => window.ProteinFinds.setDataState(value), state);
    await page.waitForSelector(`[data-screen="discover"] [data-state="${state}"]:visible`);
  }
  await page.evaluate(() => window.ProteinFinds.setDataState('ready'));
  await page.waitForSelector('[data-screen="discover"] [data-featured-id]');
  await assertNoOverflow(page, `${label} dynamic states`);
  assert.deepEqual(errors, [], `${label}: no console or page errors`);
  await browser.close();
}

async function assertDesktopComposition() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', message => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-screen="discover"] [data-featured-id]');
  const navigationBox = await page.locator('[data-bottom-nav]').boundingBox();
  assert.ok(navigationBox && navigationBox.y < 160 && navigationBox.y + navigationBox.height < 700, 'desktop: navigation composes as a compact side rail');
  assert.ok(await page.locator('[data-featured-id]').count() >= 3, 'desktop: at least three goal-matched decisions compose in the workspace');
  await page.locator('[data-tab="screener"]').click();
  await page.waitForSelector('[data-screen="screener"] [data-screen-result]');
  assert.ok((await page.locator('.consumer-search').boundingBox()).width > 900, 'desktop: Search uses the wide product workspace');
  await assertNoOverflow(page, 'desktop Search');
  assert.deepEqual(errors, [], 'desktop: no console/page errors');
  await browser.close();
}

(async () => {
  await assertShell(webkit, { width: 390, height: 844 }, 'WebKit portrait', 'first-viewport-portrait-390x844.png', 'grocery-loop-basket-390x844.png');
  await assertShell(webkit, { width: 844, height: 390 }, 'WebKit landscape', 'first-viewport-landscape-844x390.png');
  await assertShell(chromium, { width: 390, height: 844 }, 'Chromium portrait contract');
  await assertDesktopComposition();
  console.log('PASS: Home/Search IA, goals and filter sheet, result count, exact query/deep link, Back state/scroll, save/add, Nearby, Basket, 44px targets, first-viewport/safe-area geometry, dynamic states, WebKit portrait/landscape, desktop composition, overflow, and console checks');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
