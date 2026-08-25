const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const url = process.env.REVIEW_URL || 'http://127.0.0.1:4173/index.html';
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const artifactDir = path.join(__dirname, 'review-artifacts');
fs.mkdirSync(artifactDir, { recursive: true });

async function assertNoAxeViolations(page, label) {
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => (await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
  })).violations.map(({ id, impact }) => ({ id, impact })));
  assert.deepEqual(violations, [], `${label} has no Axe A/AA violations`);
}

async function exerciseZipAndMap(browserType) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', message => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-tab="nearby"]').click();

  await page.waitForSelector('.leaflet-tile-pane img');
  assert.equal(await page.locator('[data-store-results]').getAttribute('data-view'), 'map', 'Nearby opens map-first');
  assert.equal(await page.locator('[data-store-marker]').count(), 4, 'real map renders all grocery coordinates before ZIP entry');
  assert.ok(await page.locator('.leaflet-tile-pane img').count() > 0, 'geographic basemap tile elements render');
  assert.match(await page.locator('.leaflet-tile-pane img').first().getAttribute('src'), /tile\.openstreetmap\.org/);
  assert.equal(await page.locator('.leaflet-control-zoom a').count(), 2, 'native map zoom controls render');
  assert.ok(await page.locator('[data-map-recenter]').isVisible(), 'recenter control renders');
  assert.ok(await page.locator('[data-search-here]').isDisabled(), 'Search this area stays hidden until map movement');

  await page.fill('#zipInput', '95113');
  await page.locator('#locationForm button[type="submit"]').click();
  await page.waitForSelector('[data-location-puck]');
  assert.equal(await page.locator('[data-store-marker]').count(), 4);
  assert.equal(await page.locator('[data-location-puck]').count(), 1, 'selected ZIP has a location puck');

  await page.locator('[data-location-view="list"]').click();
  assert.equal(await page.locator('[data-store-results][data-view="list"] [data-store-card]').count(), 4);
  const distances = await page.locator('[data-store-results][data-view="list"] .store-distance').allTextContents();
  const numericDistances = distances.map(value => Number.parseFloat(value));
  assert.deepEqual(numericDistances, [...numericDistances].sort((a, b) => a - b), 'stores are ordered by deterministic distance');
  const availability = (await page.locator('[data-store-results]').textContent()).toLowerCase();
  assert.match(availability, /inventory not checked/);
  assert.doesNotMatch(availability, /in stock/);
  await assertNoAxeViolations(page, `${browserType.name()} list`);
  if (browserType.name() === 'chromium') await page.screenshot({ path: path.join(artifactDir, 'location-list-390x844.png'), fullPage: false });

  await page.locator('[data-location-view="map"]').click();
  await page.waitForSelector('[data-store-marker]');
  await page.locator('[data-store-marker]').first().click();
  await page.waitForSelector('.map-wrap [data-store-card]');
  assert.match(await page.locator('.sheet-heading').textContent(), /selected grocery store/i, 'selected marker exposes a labeled place sheet');
  assert.ok(await page.locator('.map-wrap .store-products a').count() > 0, 'marker sheet links to matching product details');

  const beforeSearch = await page.evaluate(() => window.ProteinFinds.state.location);
  await page.locator('.leaflet-control-zoom-in').click();
  await page.waitForFunction(() => !document.querySelector('[data-search-here]').disabled);
  assert.match(await page.locator('.map-status').textContent(), /results unchanged/);
  assert.deepEqual(await page.evaluate(() => window.ProteinFinds.state.location), beforeSearch, 'panning does not silently refresh results');
  await page.locator('[data-search-here]').click();
  assert.equal(await page.locator('.location-heading > b').textContent(), 'Searched map area');
  assert.ok(await page.locator('[data-search-here]').isDisabled());

  await assertNoAxeViolations(page, `${browserType.name()} map`);
  if (browserType.name() === 'chromium') await page.screenshot({ path: path.join(artifactDir, 'location-map-390x844.png'), fullPage: false });

  await page.locator('[data-store-filter="Target"]').click();
  await page.waitForSelector('[data-store-marker]');
  assert.equal(await page.locator('[data-store-marker]').count(), 1, 'store filters alter map markers');
  assert.equal(await page.locator('[data-store-filter="Target"]').getAttribute('aria-pressed'), 'true');

  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false);
  assert.deepEqual(errors, [], `${browserType.name()} has no console/page errors`);
  await browser.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    window.__geolocationCalls = 0;
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(success, failure) {
          window.__geolocationCalls += 1;
          failure({ code: 1, message: 'denied in test' });
        }
      }
    });
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.evaluate(() => window.__geolocationCalls), 0, 'initial discovery does not ask for location');
  await page.locator('[data-tab="nearby"]').click();
  await page.locator('[data-use-location]').click();
  await page.waitForSelector('[data-location-status="denied"]');
  assert.equal(await page.evaluate(() => window.__geolocationCalls), 1, 'location is requested only after the explicit tap');
  assert.match(await page.locator('.location-message').textContent(), /Enter a ZIP/);
  assert.equal(await page.locator('#zipInput').evaluate(element => element === document.activeElement), true, 'denial focuses the ZIP fallback');

  const grantedContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    geolocation: { latitude: 37.3337, longitude: -121.8907 },
    permissions: ['geolocation']
  });
  const grantedPage = await grantedContext.newPage();
  await grantedPage.goto(url, { waitUntil: 'domcontentloaded' });
  await grantedPage.locator('[data-tab="nearby"]').click();
  await grantedPage.locator('[data-use-location]').click();
  await grantedPage.waitForSelector('[data-location-status="ready"]');
  assert.equal(await grantedPage.locator('.location-heading > b').textContent(), 'Current location');
  assert.deepEqual(await grantedPage.evaluate(() => window.ProteinFinds.state.location), {
    lat: 37.3337, lon: -121.8907, label: 'Current location'
  }, 'granted coordinates drive the same deterministic store results');
  assert.equal(await grantedPage.locator('[data-store-marker]').count(), 4);
  assert.equal(await grantedPage.locator('[data-location-puck]').count(), 1, 'current location is visible as a puck on the map');
  await grantedContext.close();
  await browser.close();

  await exerciseZipAndMap(chromium);
  await exerciseZipAndMap(webkit);
  console.log('PASS: opt-in geolocation, denial fallback, sourced ZIP distances, honest availability, synchronized map/list Search here, mobile WebKit, and Axe');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
