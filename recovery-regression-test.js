const assert=require('node:assert/strict');
const {webkit,chromium}=require('playwright');
const fs=require('node:fs');const path=require('node:path');
const url=process.env.REVIEW_URL||'http://127.0.0.1:4321/index.html';
const out=path.join(__dirname,'review/recovery');fs.mkdirSync(out,{recursive:true});
(async()=>{for(const [name,type] of [['webkit',webkit],['chromium',chromium]]){
 const browser=await type.launch();try{for(const viewport of [{width:390,height:844},{width:844,height:390},{width:1440,height:960}]){
 const p=await browser.newPage({viewport,serviceWorkers:'block'});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(url,{waitUntil:'networkidle'});
 await p.locator('[data-tab="screener"]').click();await p.waitForTimeout(400);
 const pin=await p.locator('.search-title svg').boundingBox();assert.ok(pin&&pin.width<=28&&pin.height<=28,'Search location icon is bounded, not a screen-sized SVG');
 for(const tab of ['discover','screener','nearby','saved','basket']){
 await p.locator(`[data-tab="${tab}"]`).click();await p.waitForTimeout(400);
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${tab} overflow`);
 const small=await p.locator('main button:visible, main a:visible, main input:visible, main select:visible').evaluateAll(es=>es.filter(e=>!e.closest('.leaflet-control-attribution')).map(e=>({text:e.textContent.trim().slice(0,45),w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})).filter(e=>e.w<43.5||e.h<43.5));
 assert.deepEqual(small,[],`${tab} tappable targets`);
 await p.screenshot({path:path.join(out,`${name}-${viewport.width}-${tab}.png`)});
 }
 await p.locator('[data-tab="screener"]').click();await p.waitForSelector('[data-screen="screener"]');
 assert.equal(await p.locator('[data-screen-result]').count(),3,'consumer catalog excludes sample/identity-incomplete records');
 assert.equal(await p.locator('[data-image-needed]').count(),0,'every consumer result has identity-bound imagery');
 assert.doesNotMatch(await p.locator('main').innerText(),/Sample price|Seeded generic|verified package listings/);
 await p.locator('[data-compare-mode]').click();await p.locator('[data-compare]').nth(0).click();await p.locator('[data-compare]').nth(1).click();await p.waitForTimeout(300);
 const tray=await p.locator('[data-compare-tray]').boundingBox();const nav=await p.locator('[data-bottom-nav]').boundingBox();assert.ok(tray.y+tray.height<=nav.y,`comparison tray clears navigation ${JSON.stringify({viewport,tray,nav})}`);
 await p.locator('[data-compare-tray] a').click();await p.waitForSelector('[data-screen="compare"]');
 assert.equal(await p.locator('[data-compare-product]').count(),2);
 assert.match(await p.locator('.compare-matrix').innerText(),/Unknown/,'unknown prices cannot win value');
 await p.screenshot({path:path.join(out,`${name}-${viewport.width}-compare.png`)});
 await p.goto(url.split('#')[0]+'#product/beyond-steak');await p.waitForSelector('.detail-card');
 await p.locator('.detail-actions [data-add]').click();await p.locator('[data-tab="basket"]').click();await p.reload();await p.waitForSelector('.basket-line');
 assert.equal(await p.locator('.basket-line').count(),1,'basket survives reload');assert.match(await p.locator('.basket-total').innerText(),/unknown/i);
 await p.screenshot({path:path.join(out,`${name}-${viewport.width}-basket-populated.png`)});
 assert.deepEqual(errors,[]);await p.close();
 }}finally{await browser.close();}}
 console.log('PASS: mobile regression, five tabs, exact consumer data, compare clearance, unknown-price handling and persistent basket in WebKit/Chromium');
})().catch(e=>{console.error(e);process.exit(1)});
