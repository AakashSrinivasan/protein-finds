const products = window.PROTEIN_PRODUCTS;
const locationData = window.PROTEIN_LOCATION;
const app = document.querySelector('#appMain');
const liveRegion = document.querySelector('#liveRegion');
const storageKey = 'protein-finds-shell-state-v1';
const scrollKey = 'protein-finds-scroll-v1';

function readJson(storage, key, fallback) {
  try { return JSON.parse(storage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

const stored = readJson(localStorage, storageKey, {});
const state = {
  saved: new Set(stored.saved || []),
  basket: stored.basket || [],
  search: stored.search || '',
  category: stored.category || 'All',
  sort: stored.sort || 'recommended',
  dataState: navigator.onLine ? 'ready' : 'offline',
  scroll: readJson(sessionStorage, scrollKey, {}),
  plannerResult: [],
  locationStatus: 'idle',
  locationMessage: '',
  location: null,
  mapCenter: null,
  mapMoved: false,
  locationView: 'list',
  selectedStore: null
};
let currentRoute = null;
let deferredInstallPrompt = null;

const money = value => `$${Number(value).toFixed(2)}`;
const byId = id => products.find(product => product.id === id);
const scoreProduct = product => product.efficiency * 5 + product.protein * 1.5 - product.pricePer25 + (product.role === 'anchor' ? 12 : 0);
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
  return { name: ['discover', 'saved', 'planner', 'basket'].includes(hash) ? hash : 'discover' };
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
  const nearby = nearestStoreForProduct(product);
  return `<article class="product-card" data-product-id="${product.id}">
    <div class="product-media">${imageMarkup(product)}</div>
    <div class="product-copy">
      <span class="role-pill">${product.role === 'halo' ? 'protein halo' : product.role}</span>
      <h2><a class="product-link" href="#product/${product.id}">${product.name}</a></h2>
      <p class="brand-line">${product.brand} · ${product.category}</p>
      <div class="metrics"><div><b>${product.protein}g</b><span>protein</span></div><div><b>${product.calories}</b><span>calories</span></div><div><b>${product.efficiency}</b><span>g/100 cal</span></div></div>
      ${nearby ? `<p class="nearby-product">${nearby.name} · ${nearby.distanceMiles.toFixed(1)} mi · inventory not checked</p>` : ''}
      <p class="tradeoff">${product.tradeoff}</p>
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
  let list = products.filter(product => {
    const haystack = [product.name, product.brand, product.category, product.base, product.use, product.blurb].join(' ').toLowerCase();
    return (!query || haystack.includes(query)) && (state.category === 'All' || product.category === state.category);
  });
  const sorters = {
    recommended: (a, b) => Number(Boolean(b.image)) - Number(Boolean(a.image)) || scoreProduct(b) - scoreProduct(a),
    protein: (a, b) => b.protein - a.protein,
    efficiency: (a, b) => b.efficiency - a.efficiency,
    price: (a, b) => a.pricePer25 - b.pricePer25
  };
  return list.sort(sorters[state.sort]);
}

function nearbyStores() {
  return state.location ? locationData.storesNear(state.location) : [];
}

function nearestStoreForProduct(product) {
  if (!state.location) return null;
  return nearbyStores().find(store => product.stores.includes(store.name)) || null;
}

function setLocation(center) {
  state.location = { lat: center.lat, lon: center.lon, label: center.label };
  state.mapCenter = { lat: center.lat, lon: center.lon };
  state.mapMoved = false;
  state.locationStatus = 'ready';
  state.locationMessage = '';
  state.selectedStore = null;
  renderDiscover();
}

function storeCard(store) {
  const selected = state.selectedStore === store.id;
  return `<article class="store-card" data-store-card="${store.id}" ${selected ? 'data-selected="true"' : ''}>
    <div><p class="store-distance">${store.distanceMiles.toFixed(1)} mi away</p><h3>${store.name}</h3><p>${store.address}</p></div>
    <p class="availability-note"><b>Availability:</b> ${store.availabilityLabel} · checked ${store.availabilityObservedAt}</p>
    <a href="${store.coordinateSourceUrl}" target="_blank" rel="noopener">Coordinate source</a>
  </article>`;
}

function mapMarkup(stores) {
  const center = state.mapCenter || state.location;
  const markers = stores.map((store, index) => {
    const point = locationData.projectStore(store, center);
    return `<button class="map-marker" style="--x:${point.x}%;--y:${point.y}%" type="button" data-store-marker="${store.id}" aria-label="${store.name}, ${store.distanceMiles.toFixed(1)} miles away" aria-pressed="${state.selectedStore === store.id}"><span>${index + 1}</span></button>`;
  }).join('');
  const selected = stores.find(store => store.id === state.selectedStore);
  return `<div class="map-wrap">
    <div class="map-status"><span>Schematic, zero-tile map</span><b>${state.mapMoved ? 'Map moved · results unchanged' : 'Map and list synchronized'}</b></div>
    <div class="store-map" data-store-map aria-label="Schematic map of ${stores.length} seeded store coordinates">
      <span class="map-road road-one"></span><span class="map-road road-two"></span>${markers}
      <div class="map-pan" aria-label="Move map center"><button type="button" data-map-pan="north" aria-label="Move map north">↑</button><div><button type="button" data-map-pan="west" aria-label="Move map west">←</button><button type="button" data-map-pan="east" aria-label="Move map east">→</button></div><button type="button" data-map-pan="south" aria-label="Move map south">↓</button></div>
    </div>
    <button class="primary search-here" type="button" data-search-here ${state.mapMoved ? '' : 'disabled'}>Search here</button>
    <p class="map-fallback">No map-tile request or API key is required. If an external coordinate source is unavailable, this list and deterministic distance view remain usable.</p>
    ${selected ? storeCard(selected) : ''}
  </div>`;
}

function locationMarkup() {
  const ready = state.locationStatus === 'ready' && state.location;
  const stores = ready ? nearbyStores() : [];
  const message = state.locationMessage ? `<p class="location-message" role="${state.locationStatus === 'searching' ? 'status' : 'alert'}">${state.locationMessage}</p>` : '';
  return `<section class="location-card" data-location-status="${state.locationStatus}">
    <div class="location-heading"><div><p class="eyebrow">Local grocery discovery</p><h2>Shop nearby</h2></div>${ready ? `<span>${state.location.label}</span>` : ''}</div>
    <p class="location-truth">Use a supported ZIP or choose current location. Permission is requested only after you tap the button; exact device coordinates are not stored.</p>
    <form id="locationForm" class="location-form">
      <label for="zipInput">ZIP code</label><div><input id="zipInput" name="zip" inputmode="numeric" autocomplete="postal-code" pattern="[0-9]{5}(-[0-9]{4})?" placeholder="95113" aria-describedby="zipHelp"><button class="primary" type="submit">Find stores</button></div>
      <small id="zipHelp">Demo coverage: 95113, 95129, and 95014.</small>
    </form>
    <button class="secondary current-location" type="button" data-use-location ${state.locationStatus === 'searching' ? 'disabled' : ''}>Use current location</button>
    ${message}
    ${ready ? `<div class="location-summary"><b>${stores.length} seeded stores by distance</b><span>Coordinates are fixtures; inventory is not checked.</span></div>
      <div class="view-toggle" aria-label="Store results view"><button type="button" data-location-view="list" aria-pressed="${state.locationView === 'list'}">List</button><button type="button" data-location-view="map" aria-pressed="${state.locationView === 'map'}">Map</button></div>
      <div class="store-results" data-store-results data-view="${state.locationView}">${state.locationView === 'map' ? mapMarkup(stores) : stores.map(storeCard).join('')}</div>` : ''}
  </section>`;
}

function renderDiscover() {
  const list = filteredProducts();
  const categories = ['All', 'Plant meat', 'Dairy', 'Breakfast', 'Milk & shakes', 'Restaurant'];
  const forcedState = state.dataState;
  let content;
  if (['loading', 'error'].includes(forcedState)) content = stateMarkup(forcedState);
  else if (forcedState === 'empty' || !list.length) content = stateMarkup('empty');
  else content = `${['offline', 'stale'].includes(forcedState) ? stateMarkup(forcedState) : ''}<p class="results-meta">${list.length} seeded products · exact package images only where rights and variant identity are recorded</p><div class="product-list">${list.map(productCard).join('')}</div>`;
  app.innerHTML = `<section class="screen" data-screen="discover">
    ${screenHead('Complete the grocery trip', 'Find protein worth a basket spot', 'Search the shelf, understand the trade-off, then save or plan.')}
    <div class="freshness">Demo records · seeded 2026-08-13 · not live price or inventory</div>
    ${locationMarkup()}
    <div class="discovery-tools">
      <label class="search-field"><span aria-hidden="true">⌕</span><input id="search" type="search" value="${state.search.replaceAll('"', '&quot;')}" aria-label="Search products" placeholder="Search products"></label>
      <select id="sort" aria-label="Sort products"><option value="recommended">Best fit</option><option value="protein">Protein</option><option value="efficiency">Efficiency</option><option value="price">Cost / 25g</option></select>
    </div>
    <div class="category-row" aria-label="Product categories">${categories.map(category => `<button type="button" data-category="${category}" aria-pressed="${state.category === category}">${category}</button>`).join('')}</div>
    <div id="catalogState">${content}</div>
  </section>`;
  document.querySelector('#sort').value = state.sort;
}

function renderSaved() {
  const saved = products.filter(product => state.saved.has(product.id));
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
        <span class="role-pill">${product.role}</span><h1 id="screenTitle">${product.name}</h1><p class="brand-line">${product.brand} · ${product.category} · ${product.base}</p>
        <div class="detail-metrics"><div><b>${product.protein}g</b><span>protein</span></div><div><b>${product.calories}</b><span>calories</span></div><div><b>${product.efficiency}</b><span>g / 100 cal</span></div></div>
        <p>${product.blurb}</p><p><b>Best use:</b> ${product.use}</p><p><b>Trade-off:</b> ${product.tradeoff}</p>
        <div class="truth-note"><b>Seeded demo record.</b> Nutrition, price and availability are not a current exact-SKU claim. Verify the linked current source before buying.</div>
        <div class="detail-actions"><button class="secondary" type="button" data-save="${product.id}" aria-pressed="${saved}">${saved ? 'Saved' : 'Save product'}</button><button class="primary" type="button" data-add="${product.id}">${state.basket.includes(product.id) ? 'In basket' : 'Add to basket'}</button><a class="secondary" target="_blank" rel="noopener" href="${product.source}">Open source</a><a class="secondary" href="#planner">Plan with this</a></div>
        ${imageCredit}
      </div>
    </article>
  </section>`;
}

function buildPlan(target, priority) {
  const available = products.filter(product => product.availability !== 'demo-unavailable').sort((a, b) => {
    if (priority === 'price') return a.pricePer25 - b.pricePer25;
    if (priority === 'convenience') return Number(b.prep === 'Ready now') - Number(a.prep === 'Ready now') || scoreProduct(b) - scoreProduct(a);
    return scoreProduct(b) - scoreProduct(a);
  });
  const result = [];
  for (const product of available) {
    if (result.reduce((sum, item) => sum + item.protein, 0) >= target || result.length >= 5) break;
    if (!result.some(item => item.brand === product.brand)) result.push(product);
  }
  return result;
}

function renderPlanner() {
  const result = state.plannerResult;
  const total = result.reduce((sum, product) => sum + product.protein, 0);
  app.innerHTML = `<section class="screen" data-screen="planner">${screenHead('Deterministic basket builder', 'Plan the protein gap', 'Pick a target. The demo ranks only catalog products and shows its arithmetic.')}
    <form id="plannerForm" class="planner-form">
      <div class="form-card"><div class="range-output"><label for="target">Protein target</label><output id="targetOutput">50g</output></div><input id="target" name="target" type="range" min="20" max="100" step="5" value="50"></div>
      <div class="form-card"><label for="priority">What should win?</label><select id="priority" name="priority"><option value="balanced">Practical balance</option><option value="price">Lowest seed cost / 25g</option><option value="convenience">Ready-now convenience</option></select></div>
      <button class="primary" type="submit">Build a demo basket</button>
    </form>
    ${result.length ? `<div class="plan-result" aria-live="polite"><h2>${result.length} products · ${total}g protein</h2><p>${total >= 50 ? 'Default target met.' : 'The current constraints leave a shortfall.'} Values remain seeded demos.</p>${result.map(product => `<p><b>${product.name}</b> · ${product.protein}g</p>`).join('')}<button class="primary" type="button" data-use-plan>Use this basket</button></div>` : ''}
  </section>`;
}

function renderBasket() {
  const items = state.basket.map(byId).filter(Boolean);
  const totalProtein = items.reduce((sum, product) => sum + product.protein, 0);
  const totalCost = items.reduce((sum, product) => sum + product.price / product.servings, 0);
  const groups = Object.groupBy ? Object.groupBy(items, product => product.stores[0] || 'Source') : items.reduce((result, product) => { const key = product.stores[0] || 'Source'; (result[key] ||= []).push(product); return result; }, {});
  app.innerHTML = `<section class="screen" data-screen="basket">${screenHead('Store-grouped trip', 'Planning basket', 'One grocery trip view. Prices and inventory still require a current check.')}${items.length ? `${Object.entries(groups).map(([store, storeItems]) => `<section><h2>${store}</h2>${storeItems.map(product => `<div class="basket-line"><div><b>${product.name}</b><small>${product.protein}g · ~${money(product.price / product.servings)} / serving</small></div><button type="button" data-remove="${product.id}" aria-label="Remove ${product.name}">Remove</button></div>`).join('')}</section>`).join('')}<div class="basket-total"><span>Seeded one-serving total</span><br><b>${totalProtein}g · ${money(totalCost)}</b><p>No order or payment is submitted.</p></div>` : `<div class="empty-card"><span class="state-icon">▣</span><h2>Your basket is empty</h2><p>Add a product directly or build a deterministic plan.</p><a class="primary" href="#discover">Find products</a></div>`}</section>`;
}

function render() {
  currentRoute = parseRoute();
  document.querySelectorAll('[data-tab]').forEach(tab => tab.setAttribute('aria-current', tab.dataset.tab === currentRoute.name ? 'page' : 'false'));
  if (currentRoute.name === 'discover') renderDiscover();
  else if (currentRoute.name === 'saved') renderSaved();
  else if (currentRoute.name === 'planner') renderPlanner();
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
  if (event.target.id === 'target') document.querySelector('#targetOutput').value = `${event.target.value}g`;
});

document.addEventListener('change', event => {
  if (event.target.id === 'sort') { state.sort = event.target.value; persist(); renderDiscover(); }
});

document.addEventListener('submit', event => {
  if (event.target.id === 'locationForm') {
    event.preventDefault();
    const center = locationData.findZipCenter(new FormData(event.target).get('zip'));
    if (center) setLocation(center);
    else {
      state.locationStatus = 'denied';
      state.locationMessage = 'That ZIP is outside this demo. Try 95113, 95129, or 95014.';
      renderDiscover();
      requestAnimationFrame(() => document.querySelector('#zipInput')?.focus());
    }
    return;
  }
  if (event.target.id !== 'plannerForm') return;
  event.preventDefault();
  const form = new FormData(event.target);
  state.plannerResult = buildPlan(Number(form.get('target')), form.get('priority'));
  renderPlanner();
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
  const useLocation = event.target.closest('[data-use-location]');
  if (useLocation) {
    if (!navigator.geolocation) {
      state.locationStatus = 'denied'; state.locationMessage = 'Location is unavailable. Enter a ZIP instead.'; renderDiscover(); return;
    }
    state.locationStatus = 'searching'; state.locationMessage = 'Waiting for location permission…'; renderDiscover();
    navigator.geolocation.getCurrentPosition(
      position => setLocation({ lat: position.coords.latitude, lon: position.coords.longitude, label: 'Current location' }),
      () => {
        state.locationStatus = 'denied'; state.locationMessage = 'Location was not shared. Enter a ZIP to keep browsing.'; renderDiscover();
        requestAnimationFrame(() => document.querySelector('#zipInput')?.focus());
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
    return;
  }
  const view = event.target.closest('[data-location-view]');
  if (view) { state.locationView = view.dataset.locationView; renderDiscover(); return; }
  const marker = event.target.closest('[data-store-marker]');
  if (marker) { state.selectedStore = marker.dataset.storeMarker; renderDiscover(); return; }
  const pan = event.target.closest('[data-map-pan]');
  if (pan) {
    const moves = { north: [0.01, 0], south: [-0.01, 0], east: [0, 0.01], west: [0, -0.01] };
    const [lat, lon] = moves[pan.dataset.mapPan];
    state.mapCenter = { lat: state.mapCenter.lat + lat, lon: state.mapCenter.lon + lon };
    state.mapMoved = true; renderDiscover(); return;
  }
  const searchHere = event.target.closest('[data-search-here]');
  if (searchHere) { setLocation({ ...state.mapCenter, label: 'Searched map area' }); return; }
  const usePlan = event.target.closest('[data-use-plan]');
  if (usePlan) { state.basket = [...new Set([...state.basket, ...state.plannerResult.map(product => product.id)])]; persist(); navigate('#basket'); return; }
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
  products, state, scoreProduct, filteredProducts, buildPlan, nearbyStores,
  setDataState(value) { state.dataState = value; if (currentRoute?.name !== 'discover') navigate('#discover'); else renderDiscover(); }
};