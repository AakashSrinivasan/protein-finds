const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function writePortableLegacyRelease(destination) {
  const legacy = path.join(destination, 'legacy');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'index.html'), `<!doctype html>
<meta charset="utf-8"><title>Protein Finds legacy fixture</title>
<main><article data-product-id="legacy-product">Legacy catalog product</article></main>
<nav><button data-tab="discover">Discover</button><button data-tab="nearby">Nearby</button><button data-tab="ask">Ask</button><button data-tab="basket">Basket</button></nav>
<script>navigator.serviceWorker.register('./service-worker.js');</script>`);
  fs.writeFileSync(path.join(legacy, 'service-worker.js'), `const CACHE='protein-finds-shell-v10';
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['./','./index.html']))).then(() => self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request)));
});`);
}

function extractLegacyRelease(destination) {
  const archive = path.join(destination, 'legacy.tar');
  const result = childProcess.spawnSync('git', ['archive', '--format=tar', '-o', archive, 'b2ebbf8'], {
    cwd: __dirname,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    writePortableLegacyRelease(destination);
    return;
  }
  fs.mkdirSync(path.join(destination, 'legacy'), { recursive: true });
  const extract = childProcess.spawnSync('tar', ['-xf', archive, '-C', path.join(destination, 'legacy')], { encoding: 'utf8' });
  assert.equal(extract.status, 0, `legacy release extract failed: ${extract.stderr}`);
}

(async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'protein-finds-upgrade-'));
  const profile = path.join(scratch, 'browser-profile');
  extractLegacyRelease(scratch);
  let activeRoot = path.join(scratch, 'legacy');

  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const resolved = path.resolve(activeRoot, relative);
    if (!resolved.startsWith(`${path.resolve(activeRoot)}${path.sep}`) && resolved !== path.resolve(activeRoot, 'index.html')) {
      response.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(resolved, (error, bytes) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
        return;
      }
      response.writeHead(200, {
        'Content-Type': MIME[path.extname(resolved)] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      response.end(bytes);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'allow'
  });

  try {
    const legacyPage = await context.newPage();
    await legacyPage.goto(`${origin}/index.html#discover`, { waitUntil: 'domcontentloaded' });
    await legacyPage.waitForSelector('[data-product-id]');
    await legacyPage.evaluate(() => navigator.serviceWorker.ready);
    await legacyPage.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await legacyPage.locator('[data-tab="screener"]').count(), 0, 'prior release is genuinely cached without Screener');
    assert.ok(await legacyPage.evaluate(async () => (await caches.keys()).includes('protein-finds-shell-v10')), 'returning profile contains the prior v10 shell cache');
    await legacyPage.close();

    activeRoot = __dirname;
    const returningPage = await context.newPage();
    const errors = [];
    returningPage.on('console', message => message.type() === 'error' && errors.push(message.text()));
    returningPage.on('pageerror', error => errors.push(error.message));
    await returningPage.goto(`${origin}/index.html#discover`, { waitUntil: 'domcontentloaded' });
    await returningPage.waitForSelector('[data-tab="screener"]');

    assert.deepEqual(
      await returningPage.locator('[data-tab]').evaluateAll(tabs => tabs.map(tab => tab.dataset.tab)),
      ['discover', 'screener', 'nearby', 'saved', 'basket'],
      'first post-deploy visit upgrades the returning profile to the five-tab shell'
    );
    const criticalAssets = await returningPage.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
    for (const asset of ['app-shell.css', 'data.js', 'product-screener.js', 'location-data.js', 'ask-protein.js', 'app.js']) {
      const expectedVersion = asset === 'app-shell.css' ? 19 : asset === 'app.js' ? 20 : asset === 'product-screener.js' ? 17 : 12;
      assert.ok(criticalAssets.some(url => url.includes(`/${asset}?v=${expectedVersion}`)), `${asset} loads through its v${expectedVersion} cache-miss URL`);
    }

    await returningPage.locator('[data-tab="screener"]').click();
    await returningPage.waitForSelector('[data-screen="screener"]');
    await returningPage.click('[data-open-filter]');
    await returningPage.selectOption('#criterionPicker', 'numeric:protein');
    await returningPage.click('[data-add-criterion]');
    await returningPage.fill('[data-criterion-number="min"][data-key="protein"]', '10');
    await returningPage.locator('[data-criterion-number="min"][data-key="protein"]').press('Tab');
    await returningPage.click('.filter-sheet header [data-close-filter]');
    const beforeNavigation = await returningPage.evaluate(() => {
      scrollTo(0, Math.max(1, document.documentElement.scrollHeight - innerHeight - 80));
      return scrollY;
    });
    assert.ok(beforeNavigation > 0, 'upgrade fixture has a meaningful Screener scroll position');
    await returningPage.locator('[data-screen-result] .screen-product a').last().click();
    await returningPage.waitForSelector('[data-screen="product"]');
    const savedScrollState = await returningPage.evaluate(() => JSON.parse(sessionStorage.getItem('protein-finds-scroll-v1') || '{}'));
    const savedScroll = savedScrollState.screener;
    assert.ok(savedScroll > 0, `Screener scroll position is persisted before product navigation: ${JSON.stringify(savedScrollState)}`);
    await returningPage.goBack();
    await returningPage.waitForSelector('[data-screen="screener"]');
    await returningPage.waitForFunction(expected => Math.abs(scrollY - expected) < 8, savedScroll, { polling: 100 });
    assert.match(await returningPage.locator('.personal-chips').innerText(), /Protein ≥ 10g/, 'restored Search exposes the active protein filter');
    await returningPage.click('[data-open-filter]');
    assert.equal(await returningPage.inputValue('[data-criterion-number="min"][data-key="protein"]'), '10', 'Screener state survives the first upgraded visit');
    assert.deepEqual(errors, [], 'returning-client upgrade has zero console or page errors');

    console.log('PASS: cached v10 profile upgrades on its first post-deploy visit via versioned critical assets and preserves Screener state/scroll');
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
