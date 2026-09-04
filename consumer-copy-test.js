const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');

const baseUrl = process.env.REVIEW_URL || 'http://127.0.0.1:4173/index.html';
const rootUrl = new URL('./', baseUrl).href;
const forbiddenSource = [
  'restrictive criterion', 'criteria compiled', 'active field', 'evidence-backed matches',
  'catalog products remain', 'seeded / 25g', 'deterministic plan', 'query plan',
  'provenance contract', 'exact-byte', 'fail closed', 'agent output',
  'unsupported field', 'unknown exclusion count', 'confidence score'
];
const forbiddenRendered = [
  /restrictive criterion/i, /\bcriteri(?:on|a)\b/i, /active field/i,
  /evidence-backed matches/i, /catalog products remain/i, /seeded\s*\/\s*25g/i,
  /deterministic plan/i, /query plan/i, /provenance contract/i, /exact-byte/i,
  /fail closed/i, /agent output/i, /unsupported field/i,
  /unknown exclusion count/i, /confidence score/i
];

async function scanSource() {
  const paths = ['index.html', 'app.js?v=20', 'app-shell.css?v=19', 'service-worker.js'];
  for (const path of paths) {
    const response = await fetch(new URL(path, rootUrl));
    assert.equal(response.status, 200, `${path} is served`);
    const source = (await response.text()).toLowerCase();
    for (const phrase of forbiddenSource) assert.ok(!source.includes(phrase), `${path} contains forbidden source phrase: ${phrase}`);
  }
}

async function renderedCorpus(page) {
  return page.evaluate(() => {
    const attributes = [...document.querySelectorAll('*')].flatMap(element =>
      ['aria-label', 'title', 'placeholder', 'alt'].map(name => element.getAttribute(name)).filter(Boolean)
    );
    return [document.body.innerText, ...attributes].join('\n');
  });
}

async function assertClean(page, label) {
  await page.waitForSelector('[data-screen]');
  await page.waitForTimeout(350);
  const corpus = await renderedCorpus(page);
  for (const pattern of forbiddenRendered) assert.doesNotMatch(corpus, pattern, `${label} renders forbidden copy ${pattern}`);
}

async function route(page, hash, label) {
  await page.evaluate(value => { location.hash = value; }, hash);
  await assertClean(page, label);
}

async function exercise(engineName, browserType) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${rootUrl}?copy-guard=${Date.now()}#discover`, { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); location.reload(); });
  await page.waitForLoadState('networkidle');

  await assertClean(page, `${engineName}/home`);
  for (const state of ['loading', 'error', 'empty', 'offline', 'stale']) {
    await page.evaluate(value => window.ProteinFinds.setDataState(value), state);
    await assertClean(page, `${engineName}/home-${state}`);
  }
  await page.evaluate(() => window.ProteinFinds.setDataState('ready'));

  await route(page, '#screener', `${engineName}/search-default`);
  assert.equal(await page.locator('.search-match-context').innerText(), 'Showing all products');
  assert.equal(await page.locator('.search-product-card').first().locator('text=Why it matched').count(), 0, 'no no-filter rationale row');

  await page.locator('[data-open-filter]').click();
  await assertClean(page, `${engineName}/filter-sheet`);
  await page.selectOption('#criterionPicker', 'numeric:protein');
  await page.locator('[data-add-criterion]').click();
  await page.locator('[data-criterion-number="min"][data-key="protein"]').fill('20');
  await page.locator('[data-criterion-number="min"][data-key="protein"]').press('Tab');
  await page.locator('[data-close-filter]').last().click();
  await assertClean(page, `${engineName}/search-active-filter`);
  assert.match(await page.locator('.search-match-context').innerText(), /^Matches your 20g\+ protein/);
  assert.match(await page.locator('.screen-metric').nth(2).innerText(), /(?:\$\d+(?:\.\d+)?|—)\s*per 25g protein/i);

  await page.locator('[data-open-filter]').click();
  await page.locator('[data-criterion-number="min"][data-key="protein"]').fill('999');
  await page.locator('[data-criterion-number="min"][data-key="protein"]').press('Tab');
  await page.locator('[data-close-filter]').last().click();
  await assertClean(page, `${engineName}/search-empty`);
  assert.equal(await page.locator('.screen-empty').count(), 1);

  await page.locator('[data-screen-reset]').click();
  await page.locator('[data-save]').first().click();
  await page.locator('[data-add]').first().click();
  const firstId = await page.locator('[data-screen-result]').first().getAttribute('data-screen-result');
  await page.locator('[data-compare-mode]').click();
  await page.locator('[data-compare]').nth(0).click();
  await page.locator('[data-compare]').nth(1).click();
  await route(page, '#compare', `${engineName}/compare`);
  await route(page, `#product/${firstId}`, `${engineName}/product`);
  await route(page, '#product/not-a-product', `${engineName}/product-error`);
  await route(page, '#nearby', `${engineName}/nearby-map`);
  await page.locator('[data-location-view="list"]').click();
  await assertClean(page, `${engineName}/nearby-list`);
  await route(page, '#saved', `${engineName}/saved-populated`);
  await route(page, '#basket', `${engineName}/basket-populated`);

  await context.clearCookies();
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await route(page, '#saved', `${engineName}/saved-empty`);
  await route(page, '#basket', `${engineName}/basket-empty`);
  await browser.close();
}

(async () => {
  await scanSource();
  await exercise('Chromium', chromium);
  await exercise('WebKit', webkit);
  console.log('PASS: consumer copy guard scanned served source and rendered route/state matrix in Chromium and WebKit');
})().catch(error => { console.error(error); process.exit(1); });
