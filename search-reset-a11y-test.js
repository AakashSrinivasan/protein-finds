const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const axeSource = require('axe-core').source;

const base = process.env.REVIEW_URL || 'http://127.0.0.1:4173/index.html';

function channel(value) {
  value /= 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
function rgba(value) {
  const channels = value.match(/[\d.]+/g).map(Number);
  return { rgb: channels.slice(0, 3), alpha: channels[3] ?? 1 };
}
function contrast(foreground, background) {
  const fg = rgba(foreground);
  const bg = rgba(background);
  const composited = fg.rgb.map((value, index) => value * fg.alpha + bg.rgb[index] * (1 - fg.alpha));
  const luminances = [composited, bg.rgb].map(rgb => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]));
  return (Math.max(...luminances) + 0.05) / (Math.min(...luminances) + 0.05);
}
async function resetStyle(reset) {
  return reset.evaluate(element => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
      color: style.color,
      background: style.backgroundColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      width: box.width,
      height: box.height
    };
  });
}
async function audit(page, engine, state) {
  await page.waitForTimeout(500);
  await page.addScriptTag({ content: axeSource });
  const reset = page.locator('.screen-control-bar [data-screen-reset]');
  const styles = { default: await resetStyle(reset) };

  await reset.hover();
  await page.waitForTimeout(220);
  styles.hover = await resetStyle(reset);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(220);

  await page.keyboard.press('Tab');
  await reset.focus();
  styles.focus = await resetStyle(reset);

  const box = await reset.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(220);
  styles.pressed = await resetStyle(reset);
  await page.mouse.up();
  await page.waitForTimeout(220);

  await reset.evaluate(element => { element.disabled = true; });
  await page.waitForTimeout(220);
  styles.disabled = await resetStyle(reset);
  await reset.evaluate(element => { element.disabled = false; });

  for (const [mode, style] of Object.entries(styles)) {
    const ratio = contrast(style.color, style.background);
    assert.ok(ratio >= 4.5, `${engine}/${state}/${mode}: Reset contrast ${ratio.toFixed(2)} must be at least 4.5:1`);
    assert.ok(style.width >= 44 && style.height >= 44, `${engine}/${state}/${mode}: Reset target must be at least 44px`);
  }
  assert.notEqual(styles.focus.outlineStyle, 'none', `${engine}/${state}: Reset has a visible focus ring`);
  assert.ok(parseFloat(styles.focus.outlineWidth) >= 2, `${engine}/${state}: Reset focus ring is at least 2px`);

  const axe = await page.evaluate(() => window.axe.run(document));
  const severe = axe.violations.filter(item => ['critical', 'serious'].includes(item.impact));
  assert.deepEqual(
    severe.map(item => ({ id: item.id, nodes: item.nodes.map(node => ({ target: node.target, failure: node.failureSummary })) })),
    [],
    `${engine}/${state}: no serious or critical Axe violations`
  );
  return Object.fromEntries(Object.entries(styles).map(([mode, style]) => [mode, Number(contrast(style.color, style.background).toFixed(2))]));
}

(async () => {
  const receipt = {};
  for (const [engine, browserType] of [['Chromium', chromium], ['WebKit', webkit]]) {
    const browser = await browserType.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.goto(`${base.split('#')[0]}#screener`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-screen="screener"]');
    await page.locator('[data-open-filter]').click();
    receipt[`${engine}/default-filter`] = await audit(page, engine, 'default-filter');
    await page.locator('.filter-sheet header [data-close-filter]').click();

    await page.fill('#searchAskInput', 'best protein cereal');
    await page.locator('#searchAskForm button[type="submit"]').click();
    await page.waitForSelector('[data-screen-result="magic-spoon"]');
    await page.locator('[data-open-filter]').click();
    receipt[`${engine}/populated-filter`] = await audit(page, engine, 'populated-filter');

    await page.locator('.screen-control-bar [data-screen-reset]').click();
    await page.selectOption('#criterionPicker', 'numeric:protein');
    await page.locator('[data-add-criterion]').click();
    await page.waitForSelector('[data-criterion="protein"]');
    receipt[`${engine}/filter-open`] = await audit(page, engine, 'filter-open');

    await context.close();
    await browser.close();
  }
  console.log('PASS: Search Reset contrast, focus, target size, and full Axe scan in populated, empty, and filter-open states across Chromium and WebKit');
  console.log(JSON.stringify(receipt, null, 2));
})().catch(error => {
  console.error(error);
  process.exit(1);
});
