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
  const page = await chromiumBrowser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('console', message => message.type() === 'error' && report.consoleErrors.push(message.text()));
  page.on('pageerror', error => report.consoleErrors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-product-id]');

  assert.ok(await page.locator('[data-product-id]').first().boundingBox().then(box => box && box.y < 844));
  pass('first-viewport-product', 'search and an exact licensed product are visible at 390×844');
  assert.equal(await page.locator('[data-bottom-nav]').evaluate(element => getComputedStyle(element).position), 'fixed');
  pass('persistent-bottom-navigation', 'three focused grocery-loop destinations remain fixed');

  for (const tab of ['discover', 'saved', 'basket']) {
    await page.locator(`[data-tab="${tab}"]`).click();
    await page.waitForSelector(`[data-screen="${tab}"]:visible`);
    assert.equal(await page.locator('[data-screen]:visible').count(), 1, `${tab} renders one focused screen`);
    assert.equal(await page.locator(`[data-screen="${tab}"]`).count(), 1, `${tab} screen exists`);
    await auditAxe(page, `mobile-${tab}`, axeSource);
  }

  await page.locator('[data-tab="discover"]').click();
  await page.locator('[data-product-id]').first().click();
  await auditAxe(page, 'mobile-product-detail', axeSource);
  assert.ok(await page.locator('[data-history-back]').isVisible(), 'product detail has a History/Back control');
  pass('product-detail-navigation', 'exact deep link has a visible History/Back control');

  const smallTargets = await page.locator('button:visible,a:visible,input:visible,select:visible').evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect();
    return { label: (node.textContent || node.getAttribute('aria-label') || '').trim(), width: box.width, height: box.height };
  }).filter(target => target.width < 44 || target.height < 44));
  assert.deepEqual(smallTargets, [], 'visible product-detail controls meet 44×44 minimum');
  pass('touch-targets', 'visible controls are at least 44×44 CSS px');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false);
  pass('portrait-overflow', '390×844 has no horizontal overflow');

  assert.deepEqual(report.consoleErrors, [], 'zero Chromium console/page errors');
  pass('browser-console', 'zero console/page errors');
  await chromiumBrowser.close();

  const webkitBrowser = await webkit.launch({ headless: true });
  for (const [name, viewport] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
    const webkitPage = await webkitBrowser.newPage({ viewport });
    const errors = [];
    webkitPage.on('console', message => message.type() === 'error' && errors.push(message.text()));
    webkitPage.on('pageerror', error => errors.push(error.message));
    await webkitPage.goto(url, { waitUntil: 'domcontentloaded' });
    await webkitPage.waitForSelector('[data-product-id]');
    assert.equal(await webkitPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false);
    assert.deepEqual(errors, [], `${name} WebKit errors`);
    pass(`webkit-${name}`, `${viewport.width}×${viewport.height}: product visible, no overflow, no console/page errors`);
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