const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const url = process.env.REVIEW_URL || 'http://127.0.0.1:4173/index.html';
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const artifactDir = path.join(__dirname, 'review-artifacts');
fs.mkdirSync(artifactDir, { recursive: true });

async function exerciseJourney(browserType) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', message => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', error => errors.push(error.message));

  await page.goto(`${url.split('#')[0]}#nearby`, { waitUntil: 'domcontentloaded' });
  await page.fill('#zipInput', '94404');
  await page.locator('#locationForm button[type="submit"]').click();
  await page.locator('[data-location-view="list"]').click();
  const targetCard = page.locator('[data-store-card="target-bridgepointe-san-mateo"]');
  await targetCard.locator('[data-select-store]').click();
  await page.waitForSelector('[data-store-map][data-selected-store="target-bridgepointe-san-mateo"]');
  const targetSheet = page.locator('.map-store-sheet [data-store-card="target-bridgepointe-san-mateo"]');
  assert.match(await targetSheet.locator('.store-tags').textContent(), /3 exact SKU paths/i);
  await targetSheet.locator('.store-products a', { hasText: 'Plant-Based Seared Tips' }).click();
  await page.waitForSelector('[data-screen="product"] [data-exact-sku]');

  const identity = await page.locator('[data-exact-sku]').textContent();
  assert.match(identity, /Plant-Based Seared Tips/i);
  assert.match(identity, /10 oz/i);
  assert.match(identity, /0810057290831/);
  assert.equal(await page.locator('[data-product-image][data-upc="0810057290831"]').count(), 1);

  const evaluation = await page.locator('[data-product-evidence]').textContent();
  assert.match(evaluation, /21g protein/i);
  assert.match(evaluation, /170 calories/i);
  assert.match(evaluation, /vegan/i);
  assert.match(evaluation, /soy-free/i);
  assert.match(evaluation, /wheat/i);
  assert.match(evaluation, /ingredients/i);
  assert.match(await page.locator('.detail-decision').textContent(), /Price unknown/i);
  assert.doesNotMatch(await page.locator('[data-screen="product"]').textContent(), /\$7\.99 demo pack/i);

  const exactHandoff = page.locator('[data-retailer-connection="exact-product"]');
  assert.match(await exactHandoff.textContent(), /Check Safeway on Instacart/i);
  assert.match(await exactHandoff.textContent(), /Price unknown/i);
  assert.match(await exactHandoff.textContent(), /Unknown inventory/i);
  const exactUrl = await exactHandoff.locator('[data-retailer-handoff="exact-product"]').getAttribute('href');
  assert.match(exactUrl, /^https:\/\/www\.instacart\.com\/products\/27918479-/);

  const nearby = page.locator('[data-product-store="target-bridgepointe-san-mateo"]');
  await nearby.waitFor();
  const nearbyText = await nearby.textContent();
  assert.match(nearbyText, /Target/i);
  assert.match(nearbyText, /2220 Bridgepointe Pkwy/i);
  assert.match(nearbyText, /mi from 94404/i);
  assert.match(nearbyText, /unknown/i);
  assert.match(nearbyText, /Search Target/i);
  assert.match(nearbyText, /No exact Target product page/i);
  assert.equal(await nearby.locator('[data-retailer-handoff="retailer-search"]').getAttribute('href'), 'https://www.target.com/s?searchTerm=0810057290831');
  assert.match(await nearby.locator('[data-directions]').getAttribute('href'), /^https:\/\/www\.openstreetmap\.org\/directions/);

  await nearby.locator('[data-report-sighting]').click();
  assert.match(await nearby.locator('[data-sighting-status]').textContent(), /stored only on this device/i);
  assert.match(await nearby.locator('[data-sighting-status]').textContent(), /does not confirm inventory/i);
  assert.equal(await nearby.locator('[data-report-sighting]').getAttribute('aria-pressed'), 'true');

  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('[data-report-sighting]').getAttribute('aria-pressed'), 'true', 'pending local confirmation persists');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('protein-finds-shell-state-v1')));
  assert.equal(stored.sightings['beyond-steak:target-bridgepointe-san-mateo'].status, 'pending-local');
  assert.equal(Object.keys(stored.sightings).length, 1, 'duplicate product/store reports cannot inflate local counts');

  await page.locator('[data-compare="beyond-steak"]').click();
  await page.locator('[data-tab="screener"]').click();
  await page.waitForSelector('[data-screen="screener"]');
  const builder = page.locator('#screenBuilder');
  if (!(await builder.getAttribute('open'))) await builder.locator('summary').click();
  await page.fill('#screenMinProtein', '10');
  await page.locator('#screenMinProtein').press('Tab');
  await page.selectOption('#screenSort', 'protein');
  await page.locator('[data-screen-result="quest-cookie"] [data-compare]').click();
  await page.evaluate(() => scrollTo(0, Math.min(1400, document.documentElement.scrollHeight - innerHeight)));
  const selectedCriteria = await page.evaluate(() => ({
    minProtein: document.querySelector('#screenMinProtein').value,
    sort: document.querySelector('#screenSort').value
  }));
  await page.evaluate(() => document.querySelector('[data-compare-tray] a[href="#compare"]').click());
  await page.waitForSelector('[data-screen="compare"]');
  const savedScreenerScroll = await page.evaluate(() => JSON.parse(sessionStorage.getItem('protein-finds-scroll-v1')).screener);
  assert.ok(savedScreenerScroll > 0, 'Screener navigation stores a non-zero route scroll');
  await page.locator('a[href="#screener"]', { hasText: 'Back to Screener' }).click();
  await page.waitForSelector('[data-screen="screener"]');
  await page.waitForFunction(expected => Math.abs(scrollY - expected) < 8, savedScreenerScroll);
  assert.deepEqual(await page.evaluate(() => ({
    minProtein: document.querySelector('#screenMinProtein').value,
    sort: document.querySelector('#screenSort').value
  })), selectedCriteria, 'Compare/Back restores exact Screener criteria');

  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => (await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
  })).violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.length })));
  assert.deepEqual(violations, [], `${browserType.name()} exact-SKU journey has no Axe A/AA violations`);
  await page.screenshot({ path: path.join(artifactDir, `foster-city-journey-${browserType.name()}-390x844.png`), fullPage: true });

  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false);
  assert.deepEqual(errors, [], `${browserType.name()} has no console/page errors`);
  if (browserType.name() === 'chromium') {
    const handoffPage = await context.newPage();
    await handoffPage.goto(exactUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await handoffPage.waitForFunction(() => /Safeway Beyond Meat Beyond Steak.*Instacart/i.test(document.title), null, { timeout: 30000 });
    assert.match(handoffPage.url(), /instacart\.com\/products\/27918479-/);
    assert.match(await handoffPage.title(), /Safeway Beyond Meat Beyond Steak, Plant-Based Seared Tips Same-Day Delivery or Pickup \| Instacart/i);
    await handoffPage.close();
  }
  await browser.close();
}

(async () => {
  await exerciseJourney(chromium);
  await exerciseJourney(webkit);
  console.log('PASS: exact SKU → evaluate → nearby Target → retailer handoff → pending-local confirmation in Chromium and WebKit');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
