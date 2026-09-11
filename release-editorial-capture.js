const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const url=process.env.REVIEW_URL||'http://127.0.0.1:4187/index.html';const prefix=url.includes('127.0.0.1')?'local':'production';fs.mkdirSync('review/editorial',{recursive:true});
 for(const [name,type,viewport] of [['phone',webkit,{width:390,height:844}],['desktop',chromium,{width:1440,height:900}],['landscape',webkit,{width:844,height:390}]]){
 const browser=await type.launch();const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url,{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(350);
 assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(248, 246, 241)');
 await page.screenshot({path:`review/editorial/${prefix}-${name}-home.png`});
 await page.locator('[data-tab=screener]').click();await page.waitForTimeout(350);await page.screenshot({path:`review/editorial/${prefix}-${name}-search.png`});
 await page.locator('[data-screen-result] .screen-product a').first().click();await page.waitForTimeout(350);await page.screenshot({path:`review/editorial/${prefix}-${name}-product.png`});
 const dock=await page.locator('.detail-actions').boundingBox(),nav=await page.locator('[data-bottom-nav]').boundingBox();assert.ok(dock.y>=0 && dock.y+dock.height<=nav.y+1 && nav.y+nav.height<=viewport.height+1,'action dock and navigation fit without mutual overlap');
 await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(350);const detail=await page.locator('.detail-body').boundingBox();assert.ok(detail.y+detail.height<=dock.y+1,'last product content scrolls fully above dock');await page.screenshot({path:`review/editorial/${prefix}-${name}-product-end.png`});
 await page.locator('.detail-actions [data-add]').click();await page.locator('[data-tab=basket]').click();await page.waitForTimeout(350);await page.screenshot({path:`review/editorial/${prefix}-${name}-basket.png`});
 await page.locator('[data-tab=discover]').click();await page.locator('[data-collection=Breakfast]').click();await page.waitForSelector('[data-screen-result]');assert.match(await page.locator('.personal-chips').innerText(),/Breakfast/);
 await page.locator('[data-tab=discover]').click();await page.locator('#homeSearchForm input').fill('best protein cereal');await page.locator('#homeSearchForm button').click();await page.waitForSelector('[data-screen-result=magic-spoon]');assert.ok(await page.locator('[data-screen-result]').count() > 0);
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.screen-enter').evaluate(el=>getComputedStyle(el).animationName),'none');assert.deepEqual(errors,[]);await browser.close();
 }console.log('PASS editorial Home search, collection facets, detail add, basket, reduced motion; WebKit phone/landscape and Chromium desktop captures');
})().catch(e=>{console.error(e);process.exit(1)});
