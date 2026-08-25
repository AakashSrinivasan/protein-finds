const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const url = process.env.REVIEW_URL || 'http://127.0.0.1:4173/index.html';

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone', 'manifest launches without browser chrome');
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose.includes('maskable')), 'manifest has a maskable launch icon');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', message => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-product-id]');

  assert.equal(await page.locator('[data-product-id]').count(), 12, 'grocery discovery excludes restaurant records');
  assert.equal(await page.locator('.discover-hero').isVisible(), true, 'discovery opens with a distinct decision-led hero');
  assert.equal(await page.locator('[data-featured-id]').count(), 3, 'three package-forward featured decisions lead the shelf');
  assert.equal(await page.locator('[data-featured-id] .featured-actions').count(), 3, 'every featured recommendation exposes direct decision actions');
  assert.equal(await page.locator('[data-featured-id] [data-add]').count(), 3, 'every featured recommendation can be added without scrolling to the catalog');
  assert.equal(await page.locator('[data-featured-id] [data-compare]').count(), 3, 'every featured recommendation can enter comparison directly');
  const initialFeatured = await page.locator('[data-featured-id]').evaluateAll(cards => cards.map(card => card.dataset.featuredId));
  const initialLeader = await page.locator('.hero-leader b').textContent();
  await page.locator('[data-quick-sort="efficiency"]').click();
  assert.equal(await page.locator('#sort').inputValue(), 'efficiency', 'hero goal controls immediately re-sort the shelf');
  assert.equal(await page.locator('[data-quick-sort="efficiency"]').getAttribute('aria-pressed'), 'true', 'selected goal is visibly and accessibly pressed');
  assert.equal(await page.locator('[data-quick-sort="protein"]').getAttribute('aria-pressed'), 'false', 'inactive goal is not visually represented as selected');
  assert.notDeepEqual(await page.locator('[data-featured-id]').evaluateAll(cards => cards.map(card => card.dataset.featuredId)), initialFeatured, 'goal selection reorders the visible featured shortlist');
  assert.notEqual(await page.locator('.hero-leader b').textContent(), initialLeader, 'goal selection changes the visible current leader');
  await page.selectOption('#sort', 'recommended');
  assert.equal(await page.locator('[data-screen]:visible').count(), 1, 'only one focused screen renders');
  assert.deepEqual(await page.locator('[data-tab]').evaluateAll(tabs => tabs.map(tab => tab.dataset.tab)), ['discover', 'screener', 'nearby', 'ask', 'basket'], 'primary navigation stays at five destinations while retaining Screen, Nearby, and Ask');
  assert.equal(await page.locator('[data-header-saved]').count(), 1, 'Saved remains one tap away outside primary navigation');
  assert.equal(await page.locator('[data-category="Restaurant"]').count(), 0, 'restaurants are not a top-level grocery category');
  assert.equal(await page.locator('[data-product-id] .decision-price').count(), 12, 'every grocery card shows price or an honest unknown state');
  assert.equal(await page.locator('[data-product-id] .decision-store').count(), 12, 'every grocery card shows its seeded store');
  assert.equal(await page.locator('[data-product-id] .decision-freshness').count(), 12, 'every grocery card shows availability freshness');
  assert.equal(await page.locator('[data-product-id] .decision-verdict').count(), 12, 'every grocery card shows a plain-English verdict');
  assert.match(await page.locator('[data-product-id="magic-spoon"] .decision-price').textContent(), /Price unknown/i, 'unsupported package price is not presented as current');
  assert.equal(await page.locator('.role-pill').count(), 0, 'internal ranking labels are not exposed to shoppers');
  assert.equal(await page.locator('link[rel="manifest"]').count(), 1, 'install manifest is linked');
  assert.equal(await page.locator('[data-product-id] [data-product-image]').count(), 3, 'only three exact licensed images are attached to catalog cards');
  assert.equal(await page.locator('[data-image-needed]').count(), 9, 'uncertain grocery variants use image-needed states');
  assert.equal(await page.getByText('Image needed', { exact: true }).count(), 0, 'missing media degrades to a quiet provenance state instead of a dominant error panel');

  const imageRecords = await page.locator('[data-product-image]').evaluateAll(images => images.map(image => ({
    src: image.getAttribute('src'), upc: image.dataset.upc, license: image.dataset.imageLicense
  })));
  for (const image of imageRecords) {
    assert.match(image.upc, /^\d{13}$/, 'exact image has a 13-digit UPC');
    assert.equal(image.license, 'CC BY-SA 3.0', 'exact image carries its license');
    assert.ok(fs.existsSync(path.join(root, image.src)), `local image exists: ${image.src}`);
  }

  const compareIds = ['egg-whites', 'good-culture'];
  for (const id of compareIds) await page.locator(`[data-compare="${id}"]`).click();
  assert.match(await page.locator('[data-compare-tray]').textContent(), /2\/3 selected[\s\S]*Ready for a side-by-side decision/, 'comparison tray confirms a decision-ready selection');
  await page.locator('[data-compare-tray] a[href="#compare"]').click();
  await page.waitForSelector('[data-screen="compare"] [data-compare-product]');
  assert.equal(await page.locator('[data-compare-product]').count(), 2, 'comparison aligns two exact products');
  assert.ok(await page.locator('[data-winner="true"]').count() >= 2, 'comparison marks metric leaders');
  assert.equal(await page.locator('.compare-recommendation').count(), 1, 'comparison leads with one concise overall recommendation');
  assert.equal(await page.locator('.compare-recommendation').getAttribute('data-recommendation-id'), 'egg-whites', 'balanced recommendation agrees with the product winning three of four visible metrics');
  assert.match(await page.locator('.compare-recommendation').textContent(), /wins 3 of 4 visible metrics[\s\S]*calories[\s\S]*value[\s\S]*efficiency/i, 'balanced recommendation explains its visible matrix evidence');
  assert.equal(await page.locator('.compare-scroll').count(), 0, 'comparison does not require a hidden horizontal gesture');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, 'comparison never overflows the phone viewport');
  assert.equal(await page.locator('.compare-thumb [data-image-needed]').count(), 2, 'missing comparison imagery uses compact identity tiles');
  await page.locator('a[href="#discover"]').first().click();
  await page.locator('[data-clear-compare]').click();
  await page.locator('[data-quick-sort="protein"]').click();
  for (const id of compareIds) await page.locator(`[data-compare="${id}"]`).click();
  await page.locator('[data-compare-tray] a[href="#compare"]').click();
  assert.equal(await page.locator('.compare-recommendation').getAttribute('data-recommendation-id'), 'good-culture', 'most-protein goal explicitly changes the comparison recommendation');
  assert.match(await page.locator('.compare-recommendation').textContent(), /Most protein screen[\s\S]*14g/i, 'goal-aware recommendation states the exact winning criterion');
  await page.locator('a[href="#discover"]').first().click();
  await page.locator('[data-clear-compare]').click();
  await page.selectOption('#sort', 'recommended');

  await page.locator('[data-tab="ask"]').click();
  await page.fill('#askInput', 'best protein cereal');
  await page.click('#askForm button[type="submit"]');
  assert.equal(await page.locator('[data-query-plan]').isVisible(), true, 'Ask exposes the deterministic query plan');
  assert.equal(await page.locator('[data-ask-product-id="magic-spoon"]').count(), 1, 'cereal intent resolves to a catalog record');
  assert.match(await page.locator('[data-ask-product-id="magic-spoon"]').textContent(), /Price unknown[\s\S]*Availability unknown/, 'Ask exposes unsupported price and availability honestly');
  assert.match(await page.locator('.field-citations').textContent(), /protein[\s\S]*calories[\s\S]*efficiency/, 'Ask cites actual ranking fields');
  const askIds = await page.locator('[data-ask-product-id]').evaluateAll(nodes => nodes.map(node => node.dataset.askProductId));
  const catalogIds = await page.evaluate(() => window.ProteinFinds.products.map(product => product.id));
  assert.ok(askIds.every(id => catalogIds.includes(id)), 'every Ask recommendation resolves to the browser catalog');
  await page.fill('#askInput', '<img src=x onerror=alert(1)>');
  await page.click('#askForm button[type="submit"]');
  assert.equal(await page.locator('[data-ask-product-id]').count(), 0, 'unsupported hostile input fails closed');
  assert.equal(await page.locator('.ask-answer img').count(), 0, 'Ask input is not interpreted as markup');
  await page.locator('[data-tab="discover"]').click();

  await page.locator('[data-tab="screener"]').click();
  await page.waitForSelector('[data-screen="screener"]');
  assert.equal(await page.locator('[data-screen-result]').count(), 12, 'default screen shows the complete grocery seed');
  assert.match(await page.locator('.screener-screen').textContent(), /no formulas, mystery score, or invented products/i, 'screener explains its plain-language contract');
  assert.equal(await page.locator('[data-screen-template]').count(), 3, 'quick screens provide approachable starting points');
  await page.locator('[data-screen-template="high-protein"]').click();
  assert.deepEqual(await page.locator('[data-screen-result]').evaluateAll(nodes => nodes.map(node => node.dataset.screenResult)), ['beyond-steak', 'oikos-pro'], '20g under 200 screen applies inclusive AND criteria');
  assert.match(await page.locator('.active-screen').textContent(), /At least 20g protein[\s\S]*No more than 200 calories/i, 'active criteria are stated as removable plain-English clauses');
  await page.locator('#screenBuilder > summary').click();
  await page.locator('[data-screen-reset]').first().click();
  await page.selectOption('#screenCategory', 'Plant meat');
  await page.fill('#screenMinProtein', '21');
  await page.locator('#screenMinProtein').press('Tab');
  await page.fill('#screenMaxCalories', '170');
  await page.locator('#screenMaxCalories').press('Tab');
  await page.locator('[data-screen-exclusion="soy"]').check();
  await page.selectOption('#screenPrep', 'heat');
  assert.deepEqual(await page.locator('[data-screen-result]').evaluateAll(nodes => nodes.map(node => node.dataset.screenResult)), ['beyond-steak'], 'category, thresholds, exclusion, and preparation compose to one exact match');
  assert.equal(await page.locator('[data-screen-result="beyond-steak"] [data-add]').isVisible(), true, 'screen result exposes a direct basket action');
  assert.equal(await page.locator('[data-screen-result="beyond-steak"] [data-compare]').isVisible(), true, 'screen result exposes a direct comparison action');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-screen="screener"] [data-screen-result="beyond-steak"]');
  assert.equal(await page.locator('[data-screen-result]').count(), 1, 'screen persists across refresh');
  await page.locator('#screenBuilder > summary').click();
  await page.locator('[data-screen-reset]').first().click();
  await page.selectOption('#screenSort', 'price');
  assert.match(await page.locator('.screen-unknown-note').textContent(), /1 result has an unknown seeded cost.*shown last/i, 'unknown values are explicitly disclosed');
  assert.equal(await page.locator('[data-screen-result]').last().getAttribute('data-screen-result'), 'magic-spoon', 'unknown seeded price sorts last');
  await page.fill('#screenMaxCalories', '20');
  await page.locator('#screenMaxCalories').press('Tab');
  assert.equal(await page.locator('[data-screen-result]').count(), 0, 'impossible screen returns no fabricated matches');
  assert.match(await page.locator('.screen-empty').textContent(), /No products match all of that[\s\S]*will not invent a match/i, 'empty state fails closed');
  await page.locator('[data-screen-reset]').first().click();

  await page.fill('#screenMinProtein', '10');
  await page.locator('#screenMinProtein').press('Tab');
  await page.selectOption('#screenSort', 'protein');
  for (const id of ['beyond-steak', 'oikos-pro', 'good-culture']) await page.locator(`[data-screen-result="${id}"] [data-compare]`).click();
  const screenerScroll = await page.evaluate(() => { scrollTo(0, document.body.scrollHeight - innerHeight - 80); return scrollY; });
  assert.ok(screenerScroll > 0, 'screener comparison fixture records an independent scroll position');
  await page.locator('[data-compare-tray] a[href="#compare"]').click();
  await page.waitForSelector('[data-screen="compare"]');
  const savedScreenerScroll = await page.evaluate(() => JSON.parse(sessionStorage.getItem('protein-finds-scroll-v1')).screener);
  assert.equal(await page.locator('.detail-back').getAttribute('href'), '#screener', 'comparison returns to the originating Screener route');
  assert.match(await page.locator('.detail-back').textContent(), /Back to Screener/, 'comparison names the originating Screener route');
  assert.equal(await page.locator('.compare-recommendation').getAttribute('data-recommendation-goal'), 'protein', 'comparison preserves the active Screener ranking intent');
  assert.equal(await page.locator('.compare-recommendation').getAttribute('data-recommendation-id'), 'beyond-steak', 'most-protein screen recommends the selected product with the highest known protein');
  await page.locator('.detail-back').click();
  await page.waitForSelector('[data-screen="screener"]');
  await page.waitForFunction(expected => Math.abs(scrollY - expected) < 8, savedScreenerScroll, { polling: 100 });
  assert.equal(await page.locator('#screenMinProtein').inputValue(), '10', 'Screener criteria survive comparison');
  assert.equal(await page.locator('#screenSort').inputValue(), 'protein', 'Screener sort survives comparison');
  assert.ok(await page.evaluate(expected => Math.abs(scrollY - expected) < 8, savedScreenerScroll), 'Screener scroll survives comparison');
  await page.locator('[data-clear-compare]').click();

  const originalProductCount = await page.evaluate(() => window.ProteinFinds.products.length);
  await page.evaluate(() => {
    const base = window.ProteinFinds.products[0];
    for (let index = 0; index < 40; index += 1) window.ProteinFinds.products.push({
      ...base, id: `generated-browser-${String(index).padStart(2, '0')}`, name: `Generated browser ${String(index).padStart(2, '0')}`,
      category: 'Generated imports', protein: index, calories: 100 + index, efficiency: index / 2, image: null
    });
    window.ProteinFinds.products.push({
      ...base,
      id: 'hostile-import',
      name: '<svg onload="window.__catalogInjected=true">',
      brand: '<script>window.__catalogInjected=true</script>',
      category: '<img src=x onerror="window.__catalogInjected=true">',
      prep: undefined,
      protein: undefined,
      calories: undefined,
      efficiency: undefined,
      image: null
    });
  });
  await page.locator('[data-tab="ask"]').click();
  await page.locator('[data-tab="screener"]').click();
  await page.locator('[data-screen-reset]').first().click();
  assert.equal(await page.locator('[data-screen-result]').count(), 24, 'Screener renders only one bounded result page');
  assert.match(await page.locator('[data-screen-page-summary]').textContent(), /Showing 1–24 of 53/, 'pagination preserves the stable total result count');
  assert.match(await page.locator('.screen-pagination').textContent(), /Page 1 of 3/, 'pagination reports deterministic page boundaries');
  await page.locator('[data-screen-page="2"]').click();
  assert.equal(await page.locator('[data-screen-result]').count(), 24, 'second page remains bounded to 24 rendered cards');
  assert.match(await page.locator('[data-screen-page-summary]').textContent(), /Showing 25–48 of 53/, 'second-page range is correct');
  assert.equal(await page.locator('.screen-rank').first().textContent(), '25', 'global rank remains stable across pages');
  await page.selectOption('#screenCategory', '<img src=x onerror="window.__catalogInjected=true">');
  assert.equal(await page.locator('[data-screen-result]').count(), 1, 'hostile imported category remains selectable as inert text');
  assert.equal(await page.locator('#screenCategory option:checked').textContent(), '<img src=x onerror="window.__catalogInjected=true">', 'catalog-derived category label renders literally');
  assert.equal(await page.locator('[data-screen-result] script,[data-screen-result] svg,[data-screen-result] img').count(), 0, 'hostile imported text never becomes executable markup');
  assert.match(await page.locator('[data-screen-result]').textContent(), /Unknown/, 'unknown imported fields render as Unknown rather than undefined');
  assert.equal(await page.evaluate(() => window.__catalogInjected === true), false, 'hostile imported strings do not execute');
  await page.selectOption('#screenPrep', 'heat');
  assert.equal(await page.locator('[data-screen-result]').count(), 0, 'unknown preparation fails closed in the rendered Screener');
  await page.evaluate(count => window.ProteinFinds.products.splice(count), originalProductCount);
  await page.locator('[data-screen-reset]').first().click();
  await page.locator('[data-tab="discover"]').click();

  await page.locator('[data-category="Main proteins"]').click();
  assert.equal(await page.locator('[data-product-id]').count(), 5, 'trip-led category groups egg and plant-meat mains');
  await page.locator('[data-category="All groceries"]').click();

  await page.fill('#search', 'BOCA');
  assert.equal(await page.locator('[data-product-id]').count(), 3, 'search includes both BOCA products and one seeded comparison reference');
  await page.locator('[data-save="boca-original"]').click();
  assert.equal(await page.locator('#savedCount').textContent(), '1', 'save count updates');
  await page.locator('[data-header-saved]').click();
  await page.waitForSelector('[data-screen="saved"] [data-product-id]');
  assert.equal(await page.locator('[data-screen="saved"] [data-product-id]').count(), 1, 'saved screen contains the exact saved product');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-screen="saved"] [data-product-id]');
  assert.equal(await page.locator('[data-screen="saved"] [data-product-id]').count(), 1, 'saved product persists across refresh');

  await page.locator('[data-product-id]').click();
  assert.match(page.url(), /#product\/boca-original$/, 'product has an exact deep link');
  await page.locator('[data-add="boca-original"]').click();
  assert.equal(await page.locator('#basketCount').textContent(), '1', 'basket count updates');
  await page.locator('[data-tab="basket"]').click();
  await page.waitForSelector('[data-screen="basket"] .basket-line');
  assert.match(await page.locator('[data-screen="basket"]').textContent(), /Original Vegan Veggie Burger/, 'basket preserves exact product identity');
  assert.match(await page.locator('[data-screen="basket"]').textContent(), /Safeway[\s\S]*Plant meat/, 'basket groups items by store and category');
  assert.match(await page.locator('[data-missing-categories]').textContent(), /Trip ideas, not nutrition requirements/i, 'missing-category prompts avoid medical framing');
  assert.match(await page.locator('[data-screen="basket"]').textContent(), /No order or payment is submitted/, 'basket is source-honest');
  await page.locator('[data-tab="ask"]').click();
  await page.locator('[data-ask-prompt="improve my basket"]').click();
  assert.match(await page.locator('.ask-summary').textContent(), /basket is missing/i, 'basket improvement reads the current persisted basket');
  assert.equal(await page.locator('[data-ask-product-id="boca-original"]').count(), 0, 'basket improvement does not recommend an item already in the basket');
  assert.ok(await page.locator('[data-ask-product-id]').count() > 0, 'basket improvement fills missing trip categories from catalog records');
  await page.locator('[data-tab="basket"]').click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-screen="basket"] .basket-line');
  assert.equal(await page.locator('[data-screen="basket"] .basket-line').count(), 1, 'basket persists across refresh');

  assert.deepEqual(errors, [], 'zero browser errors');
  await browser.close();
  console.log('PASS: grocery-only decision cards, focused navigation, search, saves, exact deep links, persistent store/category basket, honest prompts, and standalone manifest');
})().catch(error => {
  console.error(error);
  process.exit(1);
});