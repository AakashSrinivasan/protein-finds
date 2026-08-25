const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const url = process.env.REVIEW_URL || 'http://127.0.0.1:4173/index.html';
const artifactDir = path.join(root, 'review-artifacts');
fs.mkdirSync(artifactDir, { recursive: true });

async function assertShell(browserType, viewport, label, screenshot, basketScreenshot) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', message => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-product-id]');

  assert.equal(await page.locator('[data-screen]:visible').count(), 1, `${label}: one focused screen`);
  assert.equal(await page.locator('[data-bottom-nav]').evaluate(el => getComputedStyle(el).position), 'fixed', `${label}: bottom nav stays fixed`);
  assert.ok(await page.locator('[data-featured-id]').first().boundingBox().then(box => box && box.y < viewport.height), `${label}: featured product is in first viewport`);
  const featuredCopy = await page.locator('[data-featured-id]').first().locator('.featured-copy').boundingBox();
  const featuredAction = await page.locator('[data-featured-id]').first().locator('[data-add]').boundingBox();
  const navigationBox = await page.locator('[data-bottom-nav]').boundingBox();
  assert.ok(await page.locator('[data-tab]').count() <= 5, `${label}: primary navigation has five or fewer persistent destinations`);
  assert.ok(featuredCopy && navigationBox && featuredCopy.y < navigationBox.y, `${label}: product name and decision metrics begin above navigation`);
  assert.ok(featuredAction && navigationBox && featuredAction.y + featuredAction.height <= navigationBox.y, `${label}: first recommendation action is fully visible above navigation`);
  assert.ok(await page.locator('.surface-truth').isVisible(), `${label}: demo/not-live source context remains available through progressive disclosure`);
  const firstImage = page.locator('[data-featured-id]').first().locator('[data-product-image]');
  assert.equal(await firstImage.getAttribute('data-image-license'), 'CC BY-SA 3.0', `${label}: first card uses licensed exact package image`);
  assert.ok(await firstImage.getAttribute('data-upc'), `${label}: visible image is tied to a UPC`);

  const smallTargets = await page.locator('button:visible,a:visible,input:visible,select:visible').evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect();
    return { label: (node.textContent || node.getAttribute('aria-label') || '').trim(), width: rect.width, height: rect.height };
  }).filter(target => target.width < 43.5 || target.height < 43.5));
  assert.deepEqual(smallTargets, [], `${label}: all visible interactive targets are at least 44px`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, `${label}: no horizontal overflow`);

  if (screenshot) await page.screenshot({ path: path.join(artifactDir, screenshot), fullPage: false });

  await page.click('[data-tab="screener"]');
  await page.waitForSelector('[data-screen="screener"]');
  assert.equal(await page.locator('[data-screen-result]').count(), 12, `${label}: screener starts with the full truthful grocery seed`);
  assert.ok(await page.locator('[data-screen-result-count]').isVisible(), `${label}: screener exposes its live result count`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, `${label}: screener has no horizontal overflow`);
  const presetBoxes = await page.locator('[data-screen-template]').evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, text: node.textContent.trim() }; }));
  assert.ok(presetBoxes.every(box => box.left >= 0 && box.right <= viewport.width + 1), `${label}: every quick screen is fully visible without a clipped continuation`);
  assert.equal(await page.locator('#screenSort option:checked').textContent(), 'Most protein', `${label}: active sort label is complete and understandable`);
  if (viewport.height <= 500) {
    const firstResult = await page.locator('[data-screen-result]').first().boundingBox();
    const firstIdentity = await page.locator('[data-screen-result]').first().locator('.screen-product').boundingBox();
    const firstMetrics = await page.locator('[data-screen-result]').first().locator('.screen-result-metrics').boundingBox();
    const firstActions = await page.locator('[data-screen-result]').first().locator('.screen-result-actions').boundingBox();
    const screenerNavigation = await page.locator('[data-bottom-nav]').boundingBox();
    assert.ok(firstResult && screenerNavigation && firstResult.y < screenerNavigation.y, `${label}: first Screener result begins above navigation`);
    assert.ok(firstIdentity && screenerNavigation && firstIdentity.y + firstIdentity.height <= screenerNavigation.y, `${label}: first Screener product identity remains visible above navigation`);
    assert.ok(firstMetrics && screenerNavigation && firstMetrics.y + firstMetrics.height <= screenerNavigation.y, `${label}: first Screener decision metrics remain visible above navigation`);
    assert.ok(firstActions && screenerNavigation && firstActions.y + firstActions.height <= screenerNavigation.y, `${label}: first Screener actions remain usable above navigation`);
  }
  const screenerTargets = await page.locator('[data-screen="screener"] button:visible,[data-screen="screener"] a:visible,[data-screen="screener"] input:visible,[data-screen="screener"] select:visible').evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect();
    return { label: (node.textContent || node.getAttribute('aria-label') || '').trim(), width: rect.width, height: rect.height };
  }).filter(target => target.width < 43.5 || target.height < 43.5));
  assert.deepEqual(screenerTargets, [], `${label}: screener controls meet 44px minimum`);
  if (screenshot) await page.screenshot({ path: path.join(artifactDir, `screener-${screenshot}`), fullPage: false });
  await page.click('[data-tab="discover"]');
  await page.waitForSelector('[data-product-id]');

  await page.click('[data-tab="ask"]');
  await page.click('[data-ask-prompt="soy-free snacks"]');
  await page.waitForSelector('[data-ask-product-id]');
  assert.equal(await page.locator('[data-query-plan]').isVisible(), true, `${label}: Ask exposes its deterministic plan`);
  assert.ok(await page.locator('[data-ask-product-id]').count() > 0, `${label}: Ask returns catalog records`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, `${label}: Ask has no horizontal overflow`);
  if (screenshot) await page.screenshot({ path: path.join(artifactDir, `ask-${screenshot}`), fullPage: false });
  await page.click('[data-tab="discover"]');
  await page.waitForSelector('[data-product-id]');

  await page.locator('[data-product-id]').first().locator('.product-link').click();
  await page.waitForSelector('[data-screen="product"]:visible');
  const productHash = await page.evaluate(() => location.hash);
  assert.match(productHash, /^#product\//, `${label}: exact product route`);
  const title = await page.locator('#screenTitle').textContent();
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('#screenTitle').textContent(), title, `${label}: exact product deep link survives refresh`);
  await page.goBack();
  await page.waitForSelector('[data-screen="discover"]:visible');

  await page.fill('#search', 'BOCA');
  await page.locator('[data-product-id]').last().scrollIntoViewIfNeeded();
  const discoverScroll = await page.evaluate(() => scrollY);
  assert.ok(discoverScroll > 0, `${label}: scroll-restoration fixture is scrollable`);
  await page.click('[data-header-saved]');
  await page.goBack();
  await page.waitForSelector('[data-screen="discover"]:visible');
  assert.equal(await page.inputValue('#search'), 'BOCA', `${label}: Back restores filters`);
  await page.waitForFunction(expected => Math.abs(scrollY - expected) < 8, discoverScroll);
  assert.ok(await page.evaluate(expected => Math.abs(scrollY - expected) < 8, discoverScroll), `${label}: Back restores independent tab scroll`);

  for (const state of ['empty', 'loading', 'error', 'offline', 'stale']) {
    await page.evaluate(value => window.ProteinFinds.setDataState(value), state);
    await page.waitForSelector(`[data-state="${state}"]:visible`);
  }
  await page.evaluate(() => window.ProteinFinds.setDataState('ready'));

  await page.fill('#search', '');
  await page.locator('[data-product-id]').first().locator('[data-save]').click();
  await page.locator('[data-product-id]').first().locator('.product-link').click();
  await page.locator('.detail-card [data-add]').click();
  await page.locator('[data-tab="basket"]').click();
  await page.waitForSelector('[data-screen="basket"] .basket-line');
  assert.ok(await page.locator('[data-missing-categories]').isVisible(), `${label}: grocery trip shows non-medical missing-category prompts`);
  assert.match(await page.locator('.basket-line').first().textContent(), /seeded \/ serving|price unknown/, `${label}: basket price remains source-honest`);
  if (basketScreenshot) await page.screenshot({ path: path.join(artifactDir, basketScreenshot), fullPage: false });

  assert.deepEqual(errors, [], `${label}: no console or page errors`);
  await browser.close();
}

async function assertDesktopComposition() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  const navigationBox = await page.locator('[data-bottom-nav]').boundingBox();
  assert.ok(navigationBox && navigationBox.y < 160 && navigationBox.y + navigationBox.height < 700, 'desktop: navigation becomes a compact side rail instead of a full-width bottom bar');
  assert.equal(await page.locator('[data-featured-id]').count(), 3, 'desktop: three goal-matched decisions compose above the fold');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, 'desktop: no horizontal overflow');
  await browser.close();
}

(async () => {
  await assertShell(webkit, { width: 390, height: 844 }, 'WebKit portrait', 'first-viewport-portrait-390x844.png', 'grocery-loop-basket-390x844.png');
  await assertShell(webkit, { width: 844, height: 390 }, 'WebKit landscape', 'first-viewport-landscape-844x390.png');
  await assertShell(chromium, { width: 390, height: 844 }, 'Chromium standalone contract');
  await assertDesktopComposition();
  console.log('PASS: focused app shell, licensed exact imagery, routes, Back/scroll restoration, states, 44px targets, portrait/landscape WebKit, desktop side rail, overflow, and console checks');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
