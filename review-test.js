const { chromium } = require('playwright');
const axeSource = require('axe-core').source;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const url = process.env.REVIEW_URL || 'http://127.0.0.1:4173/index.html';
const out = path.join(__dirname, 'review', 'hard-reset');
fs.mkdirSync(out, { recursive: true });

const viewports = [
  { name: 'iphone-portrait', width: 390, height: 844 },
  { name: 'iphone-landscape', width: 844, height: 390 },
  { name: 'pixel-portrait', width: 412, height: 915 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'laptop', width: 1440, height: 960 }
];

async function audit(page, label) {
  await page.waitForTimeout(400);
  const errors = await page.evaluate(() => ({
    h1: document.querySelectorAll('main h1').length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    activeScreens: [...document.querySelectorAll('[data-screen]')].filter(node => getComputedStyle(node).display !== 'none').length,
    hiddenMain: getComputedStyle(document.querySelector('main')).opacity
  }));
  assert.equal(errors.h1, 1, `${label}: one page heading`);
  assert.ok(errors.overflow <= 1, `${label}: no horizontal page overflow (${errors.overflow}px)`);
  assert.equal(errors.activeScreens, 1, `${label}: one active screen`);
  assert.equal(errors.hiddenMain, '1', `${label}: main content stays visible`);

  await page.addScriptTag({ content: axeSource });
  const axe = await page.evaluate(() => window.axe.run(document));
  const severe = axe.violations.filter(item => ['critical', 'serious'].includes(item.impact));
  const severeDetails = severe.map(item => ({ id: item.id, nodes: item.nodes.map(node => ({ target: node.target, html: node.html, failure: node.failureSummary })) }));
  assert.deepEqual(severeDetails, [], `${label}: no serious/critical axe violations`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const receipts = [];
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block', reducedMotion: 'no-preference' });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', message => message.type() === 'error' && consoleErrors.push(message.text()));
    page.on('pageerror', error => consoleErrors.push(error.message));

    await page.goto(`${url.split('#')[0]}#discover`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-screen="discover"] [data-featured-id]');
    await audit(page, `${viewport.name}/home`);
    assert.equal(await page.locator('[data-featured-id]').count(), 5, `${viewport.name}: recommendation rail exists`);
    assert.equal(await page.locator('.home-search').isVisible(), true, `${viewport.name}: search is visible`);
    assert.equal(await page.locator('[data-tab][aria-current="page"]').getAttribute('data-tab'), 'discover', `${viewport.name}: active tab matches Home`);
    const homeShot = path.join(out, `${viewport.name}-home.png`);
    await page.screenshot({ path: homeShot, fullPage: true });

    await page.locator('[data-tab="screener"]').click();
    await page.waitForSelector('[data-screen="screener"]');
    await page.fill('#searchAskInput', 'best protein cereal');
    await page.locator('#searchAskForm button[type="submit"]').click();
    await page.waitForSelector('[data-screen-result="magic-spoon"]');
    await audit(page, `${viewport.name}/search`);
    assert.equal(await page.locator('[data-tab][aria-current="page"]').getAttribute('data-tab'), 'screener');
    const searchShot = path.join(out, `${viewport.name}-search.png`);
    await page.screenshot({ path: searchShot, fullPage: true });

    await page.locator('[data-tab="nearby"]').click();
    await page.waitForSelector('[data-screen="nearby"]');
    await page.fill('#zipInput', '94404');
    await page.locator('#locationForm button[type="submit"]').click();
    await page.waitForSelector('[data-store-map]');
    await audit(page, `${viewport.name}/nearby`);
    const sheetStyle = await page.locator('.map-store-sheet').evaluate(element => ({ position: getComputedStyle(element).position, width: element.getBoundingClientRect().width }));
    assert.equal(sheetStyle.position, 'absolute', `${viewport.name}: map results use an anchored sheet`);
    if (viewport.width >= 1020) assert.ok(sheetStyle.width > 300, `${viewport.name}: desktop map has a substantial side panel`);
    const nearbyShot = path.join(out, `${viewport.name}-nearby.png`);
    await page.screenshot({ path: nearbyShot, fullPage: true });

    await page.goto(`${url.split('#')[0]}#product/beyond-steak`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-screen="product"] .detail-actions');
    await audit(page, `${viewport.name}/product`);
    assert.equal(await page.locator('.detail-actions').evaluate(element => getComputedStyle(element).position), 'sticky', `${viewport.name}: product action dock is sticky`);
    const productShot = path.join(out, `${viewport.name}-product.png`);
    await page.screenshot({ path: productShot, fullPage: true });

    await page.keyboard.press('Home');
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => ({ tag: document.activeElement.tagName, outline: getComputedStyle(document.activeElement).outlineStyle }));
    assert.ok(['A', 'BUTTON', 'INPUT'].includes(focus.tag), `${viewport.name}: keyboard reaches an interactive control`);
    assert.notEqual(focus.outline, 'none', `${viewport.name}: focused control has a visible outline`);

    assert.deepEqual(consoleErrors, [], `${viewport.name}: zero browser errors`);
    receipts.push({ viewport: viewport.name, homeShot, searchShot, nearbyShot, productShot });
    await context.close();
  }

  const reduced = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const reducedPage = await reduced.newPage();
  await reducedPage.goto(`${url.split('#')[0]}#discover`, { waitUntil: 'domcontentloaded' });
  const durations = await reducedPage.locator('[data-screen]').evaluate(element => ({ animation: getComputedStyle(element).animationDuration, transition: getComputedStyle(element).transitionDuration }));
  assert.ok(parseFloat(durations.animation) <= 0.01 && parseFloat(durations.transition) <= 0.01, 'reduced motion collapses transitions');
  await reduced.close();
  await browser.close();

  fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify({ generatedAt: new Date().toISOString(), url, receipts }, null, 2));
  console.log(`PASS: responsive, accessibility, console, motion, product, search and Nearby review (${receipts.length} viewports)`);
  console.log(out);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
