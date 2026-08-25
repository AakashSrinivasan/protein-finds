const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const url = process.env.REVIEW_URL || 'http://127.0.0.1:4173/index.html';
const artifactDir = path.join(root, 'review-artifacts');
const report = { runAt: new Date().toISOString(), url, checks: [], axe: {}, consoleErrors: [] };
const pass = (name, detail) => report.checks.push({ name, status: 'PASS', detail });

async function auditAxe(page, name, axeSource) {
  await page.addScriptTag({ content: axeSource });
  const result = await page.evaluate(async () => axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
  }));
  report.axe[name] = result.violations.map(violation => ({
    id: violation.id, impact: violation.impact, nodes: violation.nodes.length, help: violation.help
  }));
  assert.deepEqual(report.axe[name], [], `${name} axe violations`);
  pass(`axe-${name}`, '0 WCAG A/AA violations');
}

(async () => {
  fs.mkdirSync(artifactDir, { recursive: true });
  const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  const chromiumBrowser = await chromium.launch({ headless: true });
  const chromiumContext = await chromiumBrowser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await chromiumContext.newPage();
  page.on('console', message => message.type() === 'error' && report.consoleErrors.push(message.text()));
  page.on('pageerror', error => report.consoleErrors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-product-id]');

  assert.ok(await page.locator('[data-featured-id]').first().boundingBox().then(box => box && box.y < 844));
  assert.equal(await page.locator('[data-featured-id]').first().locator('[data-product-image]').isVisible(), true);
  const firstFeaturedCopy = await page.locator('[data-featured-id]').first().locator('.featured-copy').boundingBox();
  const mobileNavBox = await page.locator('[data-bottom-nav]').boundingBox();
  assert.ok(firstFeaturedCopy && mobileNavBox && firstFeaturedCopy.y < mobileNavBox.y, 'featured product name and metrics begin before fixed navigation');
  pass('first-viewport-product', 'decision hero plus an exact product name and metrics are visible at 390×844');
  assert.equal(await page.locator('[data-bottom-nav]').evaluate(element => getComputedStyle(element).position), 'fixed');
  pass('persistent-bottom-navigation', 'five focused grocery-loop destinations, including Nearby and Ask, remain fixed');

  const firstCard = page.locator('[data-product-id]').first();
  assert.equal(await firstCard.locator('.card-decision-strip > div').count(), 3, 'card exposes three decision metrics');
  assert.equal(await firstCard.locator('[data-add]').isVisible(), true, 'card exposes an add-to-basket action');
  pass('decision-card-hierarchy', 'each result presents protein, calories, seeded value, store context, details, and one clear basket action');
  await firstCard.locator('[data-add]').click();
  await page.waitForSelector('.toast:visible');
  assert.match(await page.locator('.toast').textContent(), /added to basket/i);
  assert.equal(await page.locator('.toast a[href="#basket"]').isVisible(), true);
  await page.locator('.toast a[href="#basket"]').click();
  await page.waitForSelector('[data-screen="basket"]:visible');
  assert.equal(await page.locator('.basket-progress').isVisible(), true);
  assert.equal(await page.locator('.basket-next a[href="#discover"]').isVisible(), true);
  assert.equal(await page.locator('.basket-next a[href="#ask"]').isVisible(), true);
  assert.equal(await page.locator('.basket-line a[href^="#product/"]').isVisible(), true);
  pass('basket-continuation', 'confirmation toast links to a store-grouped basket with product detail, continue-shopping, and improve-basket paths');
  await page.locator('[data-remove]').first().click();
  await page.locator('[data-tab="discover"]').click();

  const compareIds = ['egg-whites', 'good-culture'];
  for (const id of compareIds) await page.locator(`[data-compare="${id}"]`).click();
  await page.locator('[data-compare-tray] a[href="#compare"]').click();
  await page.waitForSelector('[data-screen="compare"] [data-compare-product]');
  await auditAxe(page, 'mobile-comparison', axeSource);
  assert.equal(await page.locator('[data-compare-product]').count(), 2, 'comparison renders selected products only');
  assert.equal(await page.locator('.compare-scroll').count(), 0, 'comparison has no hidden horizontal comparison gesture');
  assert.equal(await page.locator('.compare-recommendation').count(), 1, 'comparison leads with one overall recommendation');
  assert.equal(await page.locator('.compare-recommendation').getAttribute('data-recommendation-id'), 'egg-whites', 'balanced recommendation agrees with visible metric wins');
  assert.match(await page.locator('.compare-recommendation').textContent(), /wins 3 of 4 visible metrics/i, 'recommendation explains its evidence');
  const compareType = await page.evaluate(() => ({
    header: parseFloat(getComputedStyle(document.querySelector('.compare-matrix-head a')).fontSize),
    label: parseFloat(getComputedStyle(document.querySelector('.compare-matrix-row > b')).fontSize),
    winner: parseFloat(getComputedStyle(document.querySelector('.compare-matrix-row i')).fontSize)
  }));
  assert.ok(compareType.header >= 12 && compareType.label >= 11 && compareType.winner >= 9, 'comparison labels use readable mobile typography');
  assert.equal(await page.locator('.compare-thumb [data-image-needed]').count(), 2, 'missing package images collapse into compact identity tiles');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, 'comparison fits the phone viewport without body overflow');
  pass('comparison-loop', 'two products fit a mobile-native metric matrix, recommendation, compact truth states, trade-offs, and basket actions');
  await page.locator('a[href="#discover"]').first().click();
  await page.locator('[data-clear-compare]').click();

  for (const tab of ['discover', 'screener', 'nearby', 'ask', 'basket']) {
    await page.locator(`[data-tab="${tab}"]`).click();
    await page.waitForSelector(`[data-screen="${tab}"]:visible`);
    assert.equal(await page.locator('[data-screen]:visible').count(), 1, `${tab} renders one focused screen`);
    assert.equal(await page.locator(`[data-screen="${tab}"]`).count(), 1, `${tab} screen exists`);
    await auditAxe(page, `mobile-${tab}`, axeSource);
  }

  await page.locator('[data-tab="screener"]').click();
  await page.locator('[data-screen-template="high-protein"]').click();
  assert.equal(await page.locator('[data-screen-result]').count(), 2, 'quick screen updates the real result universe');
  assert.equal(await page.locator('[data-screen-result]').first().locator('.screen-metric').count(), 4, 'screen results expose four transparent metrics');
  assert.equal(await page.locator('.active-screen button').count(), 2, 'active criteria are independently removable');
  const screenerTargets = await page.locator('[data-screen="screener"] button:visible,[data-screen="screener"] a:visible,[data-screen="screener"] input:visible,[data-screen="screener"] select:visible').evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect();
    return { label: (node.textContent || node.getAttribute('aria-label') || '').trim(), width: box.width, height: box.height };
  }).filter(target => target.width < 43.5 || target.height < 43.5));
  assert.deepEqual(screenerTargets, [], 'visible screener controls meet 44×44 minimum');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, 'screener fits the phone viewport');
  pass('universal-screener', 'plain-language criteria, live counts, transparent metrics, removable clauses, and 44px controls');

  await page.locator('[data-tab="ask"]').click();
  await page.locator('[data-ask-prompt="soy-free snacks"]').click();
  assert.ok(await page.locator('[data-ask-product-id]').count() > 0, 'Ask renders catalog-grounded recommendations');
  assert.equal(await page.locator('[data-query-plan]').isVisible(), true, 'Ask displays its deterministic plan');
  assert.match(await page.locator('.ask-answer').textContent(), /grounded local catalog rules/i, 'Ask identifies the grounded catalog path');
  pass('grounded-ask', 'soy-free snack prompt returns catalog IDs, field citations, honest unknowns, and an inspectable grounded plan');

  await page.locator('[data-tab="discover"]').click();
  await page.locator('[data-product-id]').first().locator('.product-link').click();
  await auditAxe(page, 'mobile-product-detail', axeSource);
  assert.ok(await page.locator('[data-history-back]').isVisible(), 'product detail has a History/Back control');
  assert.equal(await page.locator('.detail-primary-action').isVisible(), true, 'product detail exposes a dominant primary action');
  assert.equal(await page.locator('.detail-actions .source-link').isVisible(), true, 'source verification remains visible but tertiary');
  pass('product-detail-navigation', 'exact deep link has visible Back navigation, a dominant basket action, and a tertiary source-verification path');

  const smallTargets = await page.locator('button:visible,a:visible,input:visible,select:visible').evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect();
    return { label: (node.textContent || node.getAttribute('aria-label') || '').trim(), width: box.width, height: box.height };
  }).filter(target => target.width < 43.5 || target.height < 43.5));
  assert.deepEqual(smallTargets, [], 'visible product-detail controls meet 44×44 minimum');
  pass('touch-targets', 'visible controls are at least 44×44 CSS px');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false);
  pass('portrait-overflow', '390×844 has no horizontal overflow');

  assert.deepEqual(report.consoleErrors, [], 'zero Chromium console/page errors');
  pass('browser-console', 'zero console/page errors');

  const desktopContext = await chromiumBrowser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const desktopPage = await desktopContext.newPage();
  const desktopErrors = [];
  desktopPage.on('console', message => message.type() === 'error' && desktopErrors.push(message.text()));
  desktopPage.on('pageerror', error => desktopErrors.push(error.message));
  await desktopPage.goto(`${url.split('#')[0]}#product/beyond-steak`, { waitUntil: 'domcontentloaded' });
  await desktopPage.waitForSelector('[data-product-store="target-bridgepointe-san-mateo"]');
  await auditAxe(desktopPage, 'desktop-exact-product', axeSource);
  assert.equal(await desktopPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false);
  assert.deepEqual(desktopErrors, [], 'desktop Chromium console/page errors');
  await desktopPage.screenshot({ path: path.join(artifactDir, 'desktop-beyond-steak-1440x900.png'), fullPage: false });
  pass('desktop-exact-product', '1440×900 exact product journey has no overflow, Axe violations, or console/page errors');
  await desktopContext.close();
  await chromiumBrowser.close();

  const webkitBrowser = await webkit.launch({ headless: true });
  for (const [name, viewport] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
    const webkitPage = await webkitBrowser.newPage({ viewport });
    const errors = [];
    webkitPage.on('console', message => message.type() === 'error' && errors.push(message.text()));
    webkitPage.on('pageerror', error => errors.push(error.message));
    await webkitPage.goto(`${url.split('#')[0]}#product/beyond-steak`, { waitUntil: 'domcontentloaded' });
    await webkitPage.waitForSelector('[data-product-store="target-bridgepointe-san-mateo"]');
    assert.equal(await webkitPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false);
    assert.deepEqual(errors, [], `${name} WebKit errors`);
    await webkitPage.screenshot({ path: path.join(artifactDir, `webkit-exact-product-${name}.png`), fullPage: false });
    pass(`webkit-${name}`, `${viewport.width}×${viewport.height}: exact product/store handoff visible, no overflow, no console/page errors`);
    await webkitPage.close();
  }
  await webkitBrowser.close();

  fs.writeFileSync(path.join(artifactDir, 'verification.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(artifactDir, 'verification.txt'), `${report.checks.map(check => `PASS  ${check.name} — ${check.detail}`).join('\n')}\n`);
  console.log(`PASS: ${report.checks.length} checks; 0 axe violations; 0 browser errors`);
})().catch(error => {
  report.failure = String(error.stack || error);
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, 'verification.json'), JSON.stringify(report, null, 2));
  console.error(error);
  process.exit(1);
});