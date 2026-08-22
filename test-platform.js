const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
(async()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'manifest.webmanifest'),'utf8'));
  assert.equal(manifest.display,'standalone','manifest launches without browser chrome');
  assert.ok(manifest.icons.some(icon=>icon.sizes==='512x512'&&icon.purpose.includes('maskable')),'manifest has a maskable launch icon');
  assert.match(fs.readFileSync(path.join(__dirname,'service-worker.js'),'utf8'),/addEventListener\('fetch'/,'offline worker handles requests');
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  const errors=[];page.on('console',m=>m.type()==='error'&&errors.push(m.text()));page.on('pageerror',e=>errors.push(e.message));
  const url=process.env.REVIEW_URL||'file://'+path.resolve(__dirname,'index.html');
  await page.goto(url);await page.evaluate(()=>localStorage.clear());await page.reload();await page.waitForSelector('[data-card]');
  assert.equal(await page.locator('link[rel="manifest"]').count(),1,'install manifest is linked');
  assert.equal(await page.locator('#installNav').isVisible(),true,'install action is visible');
  assert.equal(await page.locator('[data-card]').count(),9,'desktop progressively renders nine');
  assert.match(await page.locator('#resultCount').textContent(),/Showing 9 of 16/);
  await page.click('#loadMore');assert.equal(await page.locator('[data-card]').count(),16,'load more reveals complete demo catalog');
  assert.equal(await page.locator('text=/checked|label-backed|verified bank/i').count(),0,'no unsupported truth language in visible UI');

  await page.fill('#search','BOCA');assert.equal(await page.locator('[data-card]').count(),3,'BOCA returns sibling records plus one textual comparison reference');
  await page.fill('#search','');await page.click('#filterToggle');
  const filterCases=[
    ['#categoryFilter','Restaurant',4],['#useCaseFilter','meal',1],['#prepFilter','Cook',1],['#minProtein','20',1],['#maxCalories','100',1],['#maxSugar','0',1],['#maxServingPrice','1',1],['#minFiber','5',1],['#maxSodium','250',1]
  ];
  for(const [selector,value,min] of filterCases){await page.selectOption(selector,value);assert.ok(await page.locator('[data-card]').count()>=min,`${selector} retains valid matches`);await page.click('#clearFilters');}
  await page.check('[data-filter="restaurantOnly"]');assert.equal(await page.locator('[data-card]').count(),4,'restaurant-only filter works');await page.click('#clearFilters');
  await page.check('[data-filter="simpleOnly"]');assert.ok(await page.locator('[data-card]').count()>=4,'ingredient-complexity filter works');await page.click('#clearFilters');
  await page.check('[data-filter="hideCrossContact"]');assert.equal((await page.locator('[data-card]').allTextContents()).some(t=>/Starbucks|Chipotle|Whopper/.test(t)),false,'cross-contact filter removes restaurant records');await page.click('#clearFilters');
  await page.check('[data-filter="dairyFree"]');await page.check('[data-filter="eggFree"]');assert.ok(await page.locator('[data-card]').count()>=4,'dairy- and egg-free finder combination works');await page.click('#clearFilters');

  await page.click('[data-open="boca-original"]');await page.waitForSelector('#detailDrawer[aria-hidden="false"]');const detail=await page.locator('#detailContent').textContent();assert.match(detail,/Seeded demo record/);assert.match(detail,/not proof of a current exact SKU listing/);assert.match(detail,/Decision family/);assert.match(detail,/Ingredient disclosure/);await page.click('#detailContent [data-family="BOCA burger variants"]');await page.waitForSelector('.compare-table');assert.equal(await page.locator('.compare-table thead th').count(),3,'family compare has BOCA siblings');await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.fill('#search','Chipotle');
  await page.click('[data-open="chipotle-sofritas"]');assert.match(await page.locator('#detailContent').textContent(),/Restaurant build handoff/);assert.match(await page.locator('#detailContent').textContent(),/cross-contact/);await page.click('[data-close-drawer]');

  await page.click('#plannerForm button[type="submit"]');await page.waitForSelector('#recommendation:not([hidden])');assert.match(await page.locator('.target-status').textContent(),/Target met/);assert.ok((await page.locator('#recommendation').textContent()).includes('50g request'),'default request is explicit');
  const before=await page.locator('.rec-items h4').first().textContent();await page.locator('.rec-items [data-swap]').first().click();await page.waitForSelector('[data-choose-swap]');await page.locator('[data-choose-swap]').first().click();const after=await page.locator('.rec-items h4').first().textContent();assert.notEqual(after,before,'recommendation swap changes the pick');const recNames=await page.locator('.rec-items h4').allTextContents();assert.equal(new Set(recNames).size,recNames.length,'recommendation swap cannot duplicate a selected item');
  await page.click('#useRec');await page.waitForSelector('#basketDrawer[aria-hidden="false"]');assert.ok(await page.locator('.basket-line').count()>0);assert.match(await page.locator('#basketContent').textContent(),/Outbound handoffs/);assert.ok(await page.locator('.basket-line a').count()>0,'basket contains direct source/listing links');
  const basketBefore=await page.locator('.basket-line b').first().textContent();await page.locator('.basket-line [data-swap]').first().click();await page.locator('[data-choose-swap]').first().click();const basketAfter=await page.locator('.basket-line b').first().textContent();assert.notEqual(basketAfter,basketBefore,'basket swap changes the item');const basketNames=await page.locator('.basket-line b').allTextContents();assert.equal(new Set(basketNames).size,basketNames.length,'basket swap cannot duplicate a selected item');await page.click('[data-close-basket]');

  await page.check('input[name="dairyFree"]');await page.check('input[name="eggFree"]');await page.selectOption('select[name="store"]','Costco');await page.$eval('#target',e=>{e.value='100';e.dispatchEvent(new Event('input',{bubbles:true}))});await page.click('#plannerForm button[type="submit"]');assert.match(await page.locator('.target-status').textContent(),/Short by|Target met/);if((await page.locator('.target-status').textContent()).includes('Short by'))assert.match(await page.locator('.target-status').textContent(),/substitute|No eligible substitute/);
  assert.deepEqual(errors,[],'zero desktop browser errors');

  const mobile=await browser.newPage({viewport:{width:390,height:844}});const mobileErrors=[];mobile.on('console',m=>m.type()==='error'&&mobileErrors.push(m.text()));mobile.on('pageerror',e=>mobileErrors.push(e.message));await mobile.goto(url);await mobile.evaluate(()=>localStorage.clear());await mobile.reload();await mobile.waitForSelector('[data-card]');
  assert.equal(await mobile.locator('[data-card]').count(),6,'mobile progressively renders six');assert.equal(await mobile.locator('.mobile-explore').isVisible(),true,'mobile browse shortcut is visible');
  const sticky=await mobile.locator('.finder-bar').evaluate(el=>getComputedStyle(el).position);assert.equal(sticky,'sticky','mobile finder controls are sticky');
  const initialHeight=await mobile.evaluate(()=>document.documentElement.scrollHeight);assert.ok(initialHeight<9000,`initial mobile page is compact (${initialHeight}px)`);await mobile.click('#loadMore');assert.equal(await mobile.locator('[data-card]').count(),12,'mobile progressive load reveals six more');
  const overflow=await mobile.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1);assert.equal(overflow,false,'no mobile horizontal overflow');assert.deepEqual(mobileErrors,[],'zero mobile browser errors');
  await browser.close();console.log('PASS: truth labels, complete controls, target accounting, substitutions, family/restaurant handoffs, progressive mobile IA, zero browser errors');
})().catch(e=>{console.error(e);process.exit(1)});
