const {chromium, webkit} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
 const url=process.env.REVIEW_URL || 'http://127.0.0.1:4187/index.html';
 const prefix=url.includes('127.0.0.1')?'local':'production';
 for (const [name,type,viewport] of [['phone',webkit,{width:390,height:844}],['desktop',chromium,{width:1440,height:900}],['landscape',webkit,{width:844,height:390}]]) {
  const browser=await type.launch();
  const page=await browser.newPage({viewport});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url,{waitUntil:'networkidle'});
  await page.locator('.featured-rail').waitFor();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(11, 16, 14)');
  await page.screenshot({path:`review/dark-premium/${prefix}-${name}-home.png`});
  if(name==='phone') {
   const rail=page.locator('.featured-rail');
   await page.getByRole('button',{name:'Next product',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.featured-rail').scrollLeft>100);
   assert.ok(await rail.evaluate(el=>el.scrollLeft)>100);
  }
  await page.locator('[data-tab="screener"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({path:`review/dark-premium/${prefix}-${name}-search.png`});
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.screen-enter').evaluate(el=>getComputedStyle(el).animationName),'none');
  assert.deepEqual(errors,[]);
  await browser.close();
 }
 fs.writeFileSync(`review/dark-premium/${prefix}-visual-receipt.txt`,'PASS: dark rendered styles, mobile next-product interaction, reduced-motion disabling, page-error guard, phone/desktop/landscape captures\n');
 console.log('PASS: final dark release captures and interaction assertions');
})().catch(e=>{console.error(e);process.exit(1)});
