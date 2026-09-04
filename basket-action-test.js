const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const base=process.env.REVIEW_URL||'http://127.0.0.1:4173/index.html';
const storageKey='protein-finds-shell-state-v1';
async function run(engine,offline){
  const browser=await engine.launch({headless:true});
  const webkitOffline=engine.name()==='webkit'&&offline;
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:webkitOffline?'block':'allow'});
  const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>m.type()==='error'&&errors.push(m.text()));
  await page.goto(`${base}?basket-contract=${engine.name()}-${offline?'offline':'online'}#screener`,{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{localStorage.clear();sessionStorage.clear()});await page.reload({waitUntil:'domcontentloaded'});
  if(offline){if(!webkitOffline)await page.evaluate(async()=>{if('serviceWorker'in navigator)await navigator.serviceWorker.ready});await context.setOffline(true)}
  await page.fill('#searchAskInput','best protein cereal');await page.click('#searchAskForm button[type="submit"]');
  const add=page.locator('[data-screen-result="magic-spoon"] [data-add="magic-spoon"]');await add.waitFor();
  const contract=await add.evaluate(button=>({dataAdd:button.getAttribute('data-add'),type:button.getAttribute('type'),disabled:button.disabled,count:document.querySelectorAll('[data-screen-result="magic-spoon"] [data-add="magic-spoon"]').length}));
  assert.deepEqual(contract,{dataAdd:'magic-spoon',type:'button',disabled:false,count:1});
  await add.click();assert.equal(await page.locator('#basketCount').textContent(),'1');
  let stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),storageKey);assert.deepEqual(stored.basket,['magic-spoon']);
  await page.click('[data-tab="basket"]');await page.waitForSelector('[data-screen="basket"] [data-remove="magic-spoon"]');assert.equal(await page.locator('[data-screen="basket"] [data-remove="magic-spoon"]').count(),1);assert.match(await page.locator('[data-screen="basket"]').innerText(),/High-protein cereal/);
  if(!webkitOffline){const basketUrl=page.url();await page.goto(basketUrl,{waitUntil:'domcontentloaded'});await page.waitForSelector('[data-remove="magic-spoon"]')}
  assert.equal(await page.locator('#basketCount').textContent(),'1');
  await page.click('[data-tab="screener"]');await page.waitForSelector('[data-screen-result="magic-spoon"] [data-add="magic-spoon"]:disabled');
  await page.locator('[data-screen-result="magic-spoon"] [data-add="magic-spoon"]').dispatchEvent('click');
  stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),storageKey);assert.deepEqual(stored.basket,['magic-spoon'],'repeat Add is idempotent');
  await page.click('[data-tab="basket"]');await page.click('[data-remove="magic-spoon"]');assert.equal(await page.locator('#basketCount').textContent(),'0');
  await page.click('[data-tab="screener"]');await page.click('[data-open-filter]');await page.click('[data-screen-reset]');await page.selectOption('#criterionPicker','numeric:protein');await page.click('[data-add-criterion]');
  const numeric=page.locator('[data-criterion-number="min"][data-key="protein"]');await numeric.fill('20');await numeric.press('Tab');
  await page.click('.filter-sheet header [data-close-filter]');
  const structured=page.locator('[data-screen-result]:not([data-screen-result="magic-spoon"]) [data-add]').first();await structured.waitFor();const structuredId=await structured.getAttribute('data-add');assert.ok(structuredId&&structuredId!=='magic-spoon');await structured.click();assert.equal(await page.locator('#basketCount').textContent(),'1');
  const detailId=structuredId==='beyond-steak'?'egg-whites':'beyond-steak';
  if(webkitOffline)await page.evaluate(id=>{location.hash=`#product/${id}`},detailId);else await page.goto(`${base}#product/${detailId}`);
  await page.waitForSelector(`[data-add="${detailId}"]`);await page.click(`[data-add="${detailId}"]`);
  stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),storageKey);assert.equal(new Set(stored.basket).size,stored.basket.length);assert.ok(stored.basket.includes(structuredId));assert.ok(stored.basket.includes(detailId));assert.equal(await page.locator('#basketCount').textContent(),String(stored.basket.length));
  const actionableErrors=errors.filter(error=>!(/WebKit encountered an internal error/.test(error)&&offline));assert.deepEqual(actionableErrors,[]);await browser.close();console.log(`PASS basket contract ${engine.name()} ${offline?'offline':'online'}`);
}
(async()=>{for(const engine of[chromium,webkit])for(const offline of[false,true])await run(engine,offline)})().catch(e=>{console.error(e);process.exit(1)});
