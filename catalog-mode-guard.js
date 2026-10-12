// Runtime guard for the legacy broad suites. A malformed URL must not silently change fixture mode.
const assert = require('node:assert/strict');
const playwright = require('playwright');
const configured = new URL(process.env.REVIEW_URL || 'http://127.0.0.1:4321/index.html');
const expectedDemo = configured.searchParams.get('demo') === '1';
for (const engine of [playwright.chromium, playwright.webkit]) {
  const launch = engine.launch.bind(engine);
  engine.launch = async (...args) => {
    const browser = await launch(...args);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...contextArgs) => {
      const context = await newContext(...contextArgs);
      context.on('page', page => {
        for (const method of ['goto', 'reload']) {
          const original = page[method].bind(page);
          page[method] = async (...navigationArgs) => {
            const response = await original(...navigationArgs);
            const actual = new URL(page.url());
            if (actual.origin === configured.origin && actual.pathname === configured.pathname) {
              assert.equal(actual.searchParams.get('demo') === '1', expectedDemo, `mode changed at ${actual.href}`);
              await page.waitForFunction(() => Boolean(window.ProteinFinds?.products), null, { timeout: 10000 });
              const ids = await page.evaluate(() => window.ProteinFinds.products.map(p => p.id).sort());
              if (expectedDemo) { assert.equal(ids.length, 12); assert.ok(ids.includes('magic-spoon')); }
              else assert.deepEqual(ids, ['beyond-steak','boca-original','quest-cookie']);
            }
            return response;
          };
        }
      });
      return context;
    };
    return browser;
  };
}
