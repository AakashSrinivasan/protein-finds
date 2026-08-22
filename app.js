const products = window.PROTEIN_PRODUCTS;
const groceryProducts = products.filter(product => product.category !== 'Restaurant');
const groceryIds = new Set(groceryProducts.map(product => product.id));
const app = document.querySelector('#appMain');
const liveRegion = document.querySelector('#liveRegion');
const storageKey = 'protein-finds-shell-state-v1';
const scrollKey = 'protein-finds-scroll-v1';

function readJson(storage, key, fallback) {
  try { return JSON.parse(storage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

const stored = readJson(localStorage, storageKey, {});
const categoryFilters = {
  'All groceries': null,
  'Main proteins': ['Plant meat', 'Egg'],
  'Dairy & drinks': ['Dairy', 'Milk & shakes'],
  'Breakfast': ['Breakfast', 'Wraps & breads'],
  'Snacks': ['Snack']
};
const storedCategory = stored.category === 'All' ? 'All groceries' : stored.category;
const state = {
  saved: new Set((stored.saved || []).filter(id => groceryIds.has(id))),
  basket: (stored.basket || []).filter(id => groceryIds.has(id)),
  search: stored.search || '',
  category: Object.hasOwn(categoryFilters, storedCategory) ? storedCategory : 'All groceries',
  sort: stored.sort || 'recommended',
  dataState: navigator.onLine ? 'ready' : 'offline',
  scroll: readJson(sessionStorage, scrollKey, {})
};
let currentRoute = null;
let deferredInstallPrompt = null;

const money = value => `$${Number(value).toFixed(2)}`;
const byId = id => groceryProducts.find(product => product.id === id);
const hasKnownPrice = product => product.availability !== 'demo-unavailable' && Number.isFinite(product.price);
const priceLabel = product => hasKnownPrice(product) ? `${money(product.price)} demo pack` : 'Price unknown';
const productVerdict = product => product.role === 'anchor' ? 'Strong main protein' : 'Useful supporting pick';
const rankingReason = product => `${product.protein}g protein / ${product.calories} cal.`;
const scoreProduct = product => product.efficiency * 5 + product.protein * 1.5 - (hasKnownPrice(product) ? product.pricePer25 : 0) + (product.role === 'anchor' ? 12 : 0);
const routeKey = route => route.name === 'product' ? `product/${route.id}` : route.name;

function persist() {
  localStorage.setItem(storageKey, JSON.stringify({
    saved: [...state.saved], basket: state.basket, search: state.search,
    category: state.category, sort: state.sort
  }));
  updateCounts();
}

function updateCounts() {
  const saved = document.querySelector('#savedCount');
  const basket = document.querySelector('#basketCount');
  saved.textContent = state.saved.size;
  saved.dataset.count = state.saved.size;
  basket.textContent = state.basket.length;
  basket.dataset.count = state.basket.length;
}

function parseRoute() {
  const hash = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (hash.startsWith('product/')) return { name: 'product', id: hash.slice(8) };
  return { name: ['discover', 'saved', 'basket'].includes(hash) ? hash : 'discover' };
}

function saveScroll() {
  if (!currentRoute) return;
  state.scroll[routeKey(currentRoute)] = Math.round(scrollY);
  sessionStorage.setItem(scrollKey, JSON.stringify(state.scroll));
}

function navigate(hash) {
  const target = hash.startsWith('#') ? hash : `#${hash}`;
  if (target === location.hash) return;
  saveScroll();
  location.hash = target;
}

function imageMarkup(product, detail = false) {
  if (!product.image) {
    return `<div class="image-needed" data-image-needed><b>Image needed</b><small>No exact licensed image is attached to this variant.</small></div>`;
  }
  const image = product.image;
  return `<img src="${image.path}" alt="Exact package front: ${image.variant}" data-product-image data-upc="${image.upc}" data-image-license="${image.license}" ${detail ? '' : 'loading="lazy"'}>`;
}

function productCard(product) {
  const saved = state.saved.has(product.id);
  return `<article class="product-card" data-product-id="${product.id}">
    <div class="product-media">${imageMarkup(product)}</div>
    <div class="product-copy">
      <p class="decision-verdict"><b>${productVerdict(product)}</b><span>Why it ranks: ${rankingReason(product)}</span></p>
      <h2><a class="product-link" href="#product/${product.id}">${product.name}</a></h2>
      <p class="brand-line">${product.brand} · ${product.category}</p>
      <div class="metrics"><div><b>${product.protein}g</b><span>protein</span></div><div><b>${product.calories}</b><span>calories</span></div></div>
      <div class="decision-grid"><span class="decision-price">${priceLabel(product)}</span><span class="decision-store">${product.stores[0] || 'Store unknown'}</span></div>
      <p class="decision-freshness">${product.availabilityLabel} · checked Aug 13</p>
    </div>
    <button class="save-button" type="button" data-save="${product.id}" aria-label="${saved ? 'Remove' : 'Save'} ${product.name}" aria-pressed="${saved}">${saved ? '♥' : '♡'}</button>
  </article>`;
}

function screenHead(eyebrow, title, description) {
  return `<header class="screen-head"><div><p class="eyebrow">${eyebrow}</p><h1 id="screenTitle">${title}</h1></div><p>${description}</p></header>`;
}

function stateMarkup(kind) {
  const states = {
    empty: ['∅', 'Nothing matches yet', 'Try another search or clear the category. Protein Finds will not invent a product.', 'Clear filters'],
    loading: ['…', 'Loading protein finds', 'Preparing the seeded catalog and your saved trip.', ''],
    error: ['!', 'The catalog did not load', 'Your saved trip is untouched. Retry the local catalog.', 'Retry'],
    offline: ['↯', 'You are offline', 'The cached catalog remains available after the first visit. Live source links need a connection.', 'Use cached catalog'],
    stale: ['◷', 'Catalog needs a fresh check', 'These demo records were seeded on 2026-08-13. Re-check the exact source before buying.', 'Continue with demo']
  };
  const [icon, title, copy, action] = states[kind];
  if (kind === 'loading') return `<section class="state-card" data-state="loading" role="status"><div class="state-icon">${icon}</div><h2>${title}</h2><p>${copy}</p><div class="loading-lines"><i></i><i></i><i></i></div></section>`;
  return `<section class="state-card" data-state="${kind}" role="status"><div class="state-icon">${icon}</div><h2>${title}</h2><p>${copy}</p>${action ? `<button class="primary" type="button" data-state-action>${action}</button>` : ''}</section>`;
}

function filteredProducts() {
  const query = state.search.trim().toLowerCase();
  const categories = categoryFilters[state.category];
  let list = groceryProducts.filter(product => {
    const haystack = [product.name, product.brand, product.category, product.base, product.use, product.blurb].join(' ').toLowerCase();
    return (!query || haystack.includes(query)) && (!categories || categories.includes(product.category));
  });
  const sorters = {
    recommended: (a, b) => Number(Boolean(b.image)) - Number(Boolean(a.image)) || scoreProduct(b) - scoreProduct(a),
    protein: (a, b) => b.protein - a.protein,
    efficiency: (a, b) => b.efficiency - a.efficiency,
    price: (a, b) => Number(!hasKnownPrice(a)) - Number(!hasKnownPrice(b)) || a.pricePer25 - b.pricePer25
  };
  return list.sort(sorters[state.sort]);
}

function renderDiscover() {
  const list = filteredProducts();
  const categories = Object.keys(categoryFilters);
  const forcedState = state.dataState;
  let content;
  if (['loading', 'error'].includes(forcedState)) content = stateMarkup(forcedState);
  else if (forcedState === 'empty' || !list.length) content = stateMarkup('empty');
  else content = `${['offline', 'stale'].includes(forcedState) ? stateMarkup(forcedState) : ''}<p class="results-meta">${list.length} seeded products · exact package images only where rights and variant identity are recorded</p><div class="product-list">${list.map(productCard).join('')}</div>`;
  app.innerHTML = `<section class="screen" data-screen="discover">
    ${screenHead('Complete the grocery trip', 'Find protein worth a basket spot', 'Search the shelf, understand the trade-off, then save or plan.')}
    <div class="freshness">Demo records · seeded 2026-08-13 · not live price or inventory</div>
    <div class="discovery-tools">
      <label class="search-field"><span aria-hidden="true">⌕</span><input id="search" type="search" value="${state.search.replaceAll('"', '&quot;')}" aria-label="Search products" placeholder="Search products"></label>
      <select id="sort" aria-label="Sort products"><option value="recommended">Best fit</option><option value="protein">Protein</option><option value="efficiency">Efficiency</option><option value="price">Seed price</option></select>
    </div>
    <div class="category-row" aria-label="Product categories">${categories.map(category => `<button type="button" data-category="${category}" aria-pressed="${state.category === category}">${category}</button>`).join('')}</div>
    <div id="catalogState">${content}</div>
  </section>`;
  document.querySelector('#sort').value = state.sort;
}

function renderSaved() {
  const saved = groceryProducts.filter(product => state.saved.has(product.id));
  app.innerHTML = `<section class="screen" data-screen="saved">${screenHead('Your shortlist', 'Saved finds', 'Keep exact products close while you build the trip.')}${saved.length ? `<div class="product-list">${saved.map(productCard).join('')}</div>` : `<div class="empty-card"><span class="state-icon">♡</span><h2>No saved products</h2><p>Save a shelf-worthy option from Discover. It will stay on this device.</p><a class="primary" href="#discover">Browse products</a></div>`}</section>`;
}

function renderProduct(id) {
  const product = byId(id);
  if (!product) {
    app.innerHTML = `<section class="screen" data-screen="product">${stateMarkup('error')}<a class="secondary" href="#discover">Back to Discover</a></section>`;
    return;
  }
  const saved = state.saved.has(product.id);
  const imageCredit = product.image ? `<p class="image-credit">Exact visible variant: <b>${product.image.variant}</b> · UPC ${product.image.upc}. Image by ${product.image.attribution}, <a href="${product.image.licenseUrl}" target="_blank" rel="noopener">${product.image.license}</a>. <a href="${product.image.sourceUrl}" target="_blank" rel="noopener">Image record</a>.</p>` : `<p class="image-credit">No exact licensed image is attached. A generic package substitute is intentionally not shown.</p>`;
  app.innerHTML = `<section class="screen" data-screen="product">
    <a class="detail-back" href="#discover" data-history-back>← Back</a>
    <article class="detail-card">
      <div class="detail-image">${imageMarkup(product, true)}</div>
      <div class="detail-body">
        <p class="detail-verdict"><b>${productVerdict(product)}</b><span>Why it ranks: ${rankingReason(product)}</span></p><h1 id="screenTitle">${product.name}</h1><p class="brand-line">${product.brand} · ${product.category} · ${product.base}</p>
        <div class="detail-metrics"><div><b>${product.protein}g</b><span>protein</span></div><div><b>${product.calories}</b><span>calories</span></div><div><b>${product.efficiency}</b><span>g / 100 cal</span></div></div>
        <div class="detail-decision"><span><b>${priceLabel(product)}</b><small>not a live price</small></span><span><b>${product.stores[0] || 'Store unknown'}</b><small>${product.availabilityLabel} · checked Aug 13</small></span></div>
        <p>${product.blurb}</p><p><b>Best use:</b> ${product.use}</p><p><b>Trade-off:</b> ${product.tradeoff}</p>
        <div class="truth-note"><b>Seeded demo record.</b> Nutrition, price and availability are not a current exact-SKU claim. Verify the linked current source before buying.</div>
        <div class="detail-actions"><button class="secondary" type="button" data-save="${product.id}" aria-pressed="${saved}">${saved ? 'Saved' : 'Save product'}</button><button class="primary" type="button" data-add="${product.id}">${state.basket.includes(product.id) ? 'In basket' : 'Add to basket'}</button><a class="secondary" target="_blank" rel="noopener" href="${product.source}">Open source</a><a class="secondary" href="#basket">View basket</a></div>
        ${imageCredit}
      </div>
    </article>
  </section>`;
}

function renderBasket() {
  const items = state.basket.map(byId).filter(Boolean);
  const totalProtein = items.reduce((sum, product) => sum + product.protein, 0);
  const knownPriceItems = items.filter(hasKnownPrice);
  const totalCost = knownPriceItems.reduce((sum, product) => sum + product.price / product.servings, 0);
  const unknownPriceCount = items.length - knownPriceItems.length;
  const groups = Object.groupBy ? Object.groupBy(items, product => product.stores[0] || 'Source') : items.reduce((result, product) => { const key = product.stores[0] || 'Source'; (result[key] ||= []).push(product); return result; }, {});
  const tripCategories = [
    {label: 'a main protein', categories: ['Plant meat', 'Egg']},
    {label: 'a breakfast option', categories: ['Breakfast', 'Wraps & breads']},
    {label: 'dairy or a drink', categories: ['Dairy', 'Milk & shakes']},
    {label: 'a snack', categories: ['Snack']}
  ];
  const missing = tripCategories.filter(group => !items.some(product => group.categories.includes(product.category)));
  const prompts = `<aside class="missing-categories" data-missing-categories><b>${missing.length ? 'Round out the trip' : 'Core trip categories covered'}</b><p>Trip ideas, not nutrition requirements. ${missing.length ? `You may still want ${missing.map(group => group.label).join(', ')}.` : 'This demo basket includes a main, breakfast, dairy or drink, and snack.'}</p></aside>`;
  const storeGroups = Object.entries(groups).map(([store, storeItems]) => {
    const categories = storeItems.reduce((result, product) => { (result[product.category] ||= []).push(product); return result; }, {});
    return `<section class="basket-store"><h2>${store}</h2>${Object.entries(categories).map(([category, categoryItems]) => `<div class="basket-category"><h3>${category}</h3>${categoryItems.map(product => `<div class="basket-line"><div><b>${product.name}</b><small>${product.protein}g · ${hasKnownPrice(product) ? `~${money(product.price / product.servings)} seeded / serving` : 'price unknown'}</small></div><button type="button" data-remove="${product.id}" aria-label="Remove ${product.name}">Remove</button></div>`).join('')}</div>`).join('')}</section>`;
  }).join('');
  const subtotal = unknownPriceCount ? `${money(totalCost)} known + ${unknownPriceCount} unknown` : money(totalCost);
  app.innerHTML = `<section class="screen" data-screen="basket">${screenHead('Store-grouped trip', 'Grocery basket', 'Your saved trip, grouped for the store. Prices and inventory still require a current check.')}${items.length ? `${storeGroups}${prompts}<div class="basket-total"><span>Seeded one-serving subtotal</span><br><b>${totalProtein}g · ${subtotal}</b><p>No order or payment is submitted.</p></div>` : `<div class="empty-card"><span class="state-icon">▣</span><h2>Your basket is empty</h2><p>Add grocery products from Discover. Your trip stays on this device.</p><a class="primary" href="#discover">Find products</a></div>`}</section>`;
}

function render() {
  currentRoute = parseRoute();
  document.querySelectorAll('[data-tab]').forEach(tab => tab.setAttribute('aria-current', tab.dataset.tab === currentRoute.name ? 'page' : 'false'));
  if (currentRoute.name === 'discover') renderDiscover();
  else if (currentRoute.name === 'saved') renderSaved();
  else if (currentRoute.name === 'basket') renderBasket();
  else renderProduct(currentRoute.id);
  updateCounts();
  requestAnimationFrame(() => scrollTo(0, state.scroll[routeKey(currentRoute)] || 0));
}

document.addEventListener('input', event => {
  if (event.target.id === 'search') {
    state.search = event.target.value;
    persist();
    const position = scrollY;
    renderDiscover();
    document.querySelector('#search').focus({ preventScroll: true });
    requestAnimationFrame(() => scrollTo(0, position));
  }
});

document.addEventListener('change', event => {
  if (event.target.id === 'sort') { state.sort = event.target.value; persist(); renderDiscover(); }
});

document.addEventListener('click', event => {
  const tab = event.target.closest('[data-tab]');
  if (tab) { event.preventDefault(); navigate(tab.getAttribute('href')); return; }
  const back = event.target.closest('[data-history-back]');
  if (back) { event.preventDefault(); saveScroll(); history.length > 1 ? history.back() : navigate('#discover'); return; }
  const save = event.target.closest('[data-save]');
  if (save) {
    event.stopPropagation();
    state.saved.has(save.dataset.save) ? state.saved.delete(save.dataset.save) : state.saved.add(save.dataset.save);
    persist(); render(); return;
  }
  const add = event.target.closest('[data-add]');
  if (add) { if (!state.basket.includes(add.dataset.add)) state.basket.push(add.dataset.add); persist(); render(); liveRegion.textContent = 'Added to basket'; return; }
  const remove = event.target.closest('[data-remove]');
  if (remove) { state.basket = state.basket.filter(id => id !== remove.dataset.remove); persist(); renderBasket(); return; }
  const category = event.target.closest('[data-category]');
  if (category) { state.category = category.dataset.category; persist(); renderDiscover(); return; }
  const stateAction = event.target.closest('[data-state-action]');
  if (stateAction) { state.dataState = navigator.onLine ? 'ready' : 'offline'; renderDiscover(); return; }
  const card = event.target.closest('[data-product-id]');
  if (card) { navigate(`#product/${card.dataset.productId}`); return; }
  const localLink = event.target.closest('a[href^="#"]');
  if (localLink) { event.preventDefault(); navigate(localLink.getAttribute('href')); }
});

window.addEventListener('hashchange', render);
window.addEventListener('beforeunload', saveScroll);
window.addEventListener('offline', () => { state.dataState = 'offline'; if (currentRoute?.name === 'discover') renderDiscover(); });
window.addEventListener('online', () => { state.dataState = 'ready'; if (currentRoute?.name === 'discover') renderDiscover(); });
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstallPrompt = event; document.querySelector('#installButton').textContent = 'Install app'; });
window.addEventListener('appinstalled', () => { deferredInstallPrompt = null; document.querySelector('#installButton').textContent = 'Installed'; document.querySelector('#installButton').disabled = true; });
document.querySelector('#installButton').addEventListener('click', async () => {
  if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; return; }
  liveRegion.textContent = 'On iPhone Safari, use Share then Add to Home Screen. On Android Chrome, choose Install app.';
  document.querySelector('#installButton').textContent = 'Share → Add';
});

if (!location.hash) history.replaceState(null, '', `${location.pathname}${location.search}#discover`);
render();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./service-worker.js').catch(() => {});

window.ProteinFinds = {
  products: groceryProducts, state, scoreProduct, filteredProducts,
  setDataState(value) { state.dataState = value; if (currentRoute?.name !== 'discover') navigate('#discover'); else renderDiscover(); }
};