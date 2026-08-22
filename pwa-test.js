const {chromium}=require('playwright');
const assert=require('node:assert/strict');

(async()=>{
  const url=process.env.REVIEW_URL||'http://127.0.0.1:4173/index.html';
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow'});
  const page=await context.newPage();
  await page.goto(url);
  await page.waitForSelector('[data-card]');
  await page.evaluate(async()=>{if('serviceWorker' in navigator)await navigator.serviceWorker.ready;});
  assert.ok(context.serviceWorkers().some(worker=>worker.url().endsWith('/service-worker.js')),'service worker controls the app');
  await page.click('#installNav');
  await page.waitForSelector('#modal:not([hidden])');
  assert.match(await page.locator('#modalContent').textContent(),/Add to Home Screen/,'install instructions cover iPhone');
  assert.match(await page.locator('#modalContent').textContent(),/Install app/,'install instructions cover Android');
  await page.click('#modal .drawer-close');
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('[data-card]');
  assert.equal(await page.locator('[data-card]').count(),6,'cached mobile catalog opens offline');
  await browser.close();
  console.log('PASS: install guidance, active service worker, and offline app shell');
})().catch(error=>{console.error(error);process.exit(1)});
