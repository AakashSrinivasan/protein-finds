const products = window.PROTEIN_PRODUCTS;
const groceryProducts = products.filter(product => product.category !== 'Restaurant');
const groceryIds = new Set(groceryProducts.map(product => product.id));
const locationData = window.PROTEIN_LOCATION;
const app = document.querySelector('#appMain');
const liveRegion = document.querySelector('#liveRegion');
const toastRegion = document.querySelector('#toastRegion');
const { answerAsk } = window.AskProtein;
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
  scroll: readJson(sessionStorage, scrollKey, {}),
  locationStatus: 'idle',
  locationMessage: '',
  location: null,
  mapCenter: { lat: locationData.ZIP_CENTERS['95113'].lat, lon: locationData.ZIP_CENTERS['95113'].lon },
  mapMoved: false,
  locationView: 'map',
  storeFilter: 'all',
  selectedStore: null,
  askQuery: '',
  askAnswer: null
};
let currentRoute = null;
let deferredInstallPrompt = null;
let nearbyMap = null;
let toastTimer = null;

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
  return { name: ['discover', 'nearby', 'ask', 'saved', 'basket'].includes(hash) ? hash : 'discover' };
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

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

function showToast(message, action = null) {
  clearTimeout(toastTimer);
  liveRegion.textContent = message;
  toastRegion.innerHTML = `<div class="toast" role="status"><span>${escapeHtml(message)}</span>${action ? `<a href="${action.href}">${escapeHtml(action.label)}</a>` : ''}<button type="button" data-dismiss-toast aria-label="Dismiss notification">×</button></div>`;
  toastRegion.dataset.visible = 'true';
  toastTimer = setTimeout(() => {
    toastRegion.dataset.visible = 'false';
    toastRegion.innerHTML = '';
  }, 4200);
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
  const inBasket = state.basket.includes(product.id);
  const value = hasKnownPrice(product) ? money(product.pricePer25) : 'Price unknown';
  return `<article class="product-card" data-product-id="${product.id}">
    <div class="product-media">${imageMarkup(product)}</div>
    <div class="product-copy">
      <p class="decision-verdict"><b>${productVerdict(product)}</b></p>
      <h2><a class="product-link" href="#product/${product.id}">${product.name}</a></h2>
      <p class="brand-line">${product.brand} · ${product.category}</p>
      <div class="card-decision-strip"><div><b>${product.protein}g</b><span>protein</span></div><div><b>${product.calories}</b><span>calories</span></div><div class="decision-price"><b>${value}</b><span>seeded / 25g</span></div></div>
      <p class="decision-store"><b>${product.stores[0] || 'Store unknown'}</b> · ${product.availabilityLabel}</p>
      <p class="decision-freshness">Checked Aug 13 · inventory not live</p>
      ${nearby ? `<p class="nearby-product"><b>${nearby.name}</b> · ${nearby.distanceMiles.toFixed(1)} mi · inventory not checked</p>` : ''}
      <div class="card-actions"><a class="secondary" href="#product/${product.id}">Details</a><button class="primary" type="button" data-add="${product.id}" ${inBasket ? 'disabled' : ''}>${inBasket ? 'In basket' : 'Add to basket'}</button></div>
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

function nearbyStores() {
  return state.location ? locationData.storesNear(state.location) : [];
}

function visibleNearbyStores() {
  const origin = state.location || state.mapCenter;
  const stores = locationData.storesNear(origin);
  return state.storeFilter === 'all' ? stores : stores.filter(store => store.name === state.storeFilter);
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
  state.locationView = 'map';
  renderNearby();
}

function storeCard(store, index) {
  const selected = state.selectedStore === store.id;
  const matching = groceryProducts.filter(product => product.stores.includes(store.name));
  return `<article class="store-card" data-store-card="${store.id}" ${selected ? 'data-selected="true"' : ''}>
    <button class="store-rank" type="button" data-select-store="${store.id}" aria-label="Select ${store.name}">${index + 1}</button>
    <div class="store-copy"><p class="store-distance">${store.distanceMiles.toFixed(1)} mi away</p><h3>${store.name}</h3><p>${store.address}</p>
      <div class="store-tags"><span>${matching.length} catalog matches</span><span>Inventory not checked</span></div>
      ${matching.length ? `<div class="store-products">${matching.slice(0, 3).map(product => `<a href="#product/${product.id}">${product.name}</a>`).join('')}</div>` : ''}
      <p class="availability-note">${store.availabilityLabel} · checked ${store.availabilityObservedAt}</p>
    </div>
    <a class="store-source" href="${store.coordinateSourceUrl}" target="_blank" rel="noopener">Source</a>
  </article>`;
}

function mapMarkup(stores) {
  const selectedIndex = stores.findIndex(store => store.id === state.selectedStore);
  return `<div class="map-wrap">
    <div class="map-status"><span>OpenStreetMap</span><b>${state.mapMoved ? 'Map moved · results unchanged' : 'Map and list synchronized'}</b></div>
    <div class="store-map" id="storeMap" data-store-map aria-label="Interactive geographic map of ${stores.length} grocery stores"></div>
    <button class="map-recenter" type="button" data-map-recenter aria-label="Recenter map on ${state.location ? state.location.label : 'Downtown San Jose'}">◎</button>
    <button class="primary search-here" type="button" data-search-here ${state.mapMoved ? '' : 'disabled'}>Search this area</button>
    <div class="map-store-sheet" aria-live="polite">${selectedIndex >= 0 ? `<div class="sheet-heading"><span aria-hidden="true"></span><b>Selected grocery store</b></div>${storeCard(stores[selectedIndex], selectedIndex)}` : '<p>Tap a grocery marker to compare distance, catalog matches, and product details.</p>'}</div>
    <p class="map-fallback">© OpenStreetMap contributors · store coordinates are seeded fixtures · proximity never means in stock.</p>
  </div>`;
}

function initializeNearbyMap(stores) {
  const node = document.querySelector('#storeMap');
  if (!node || !window.L) return;
  const center = state.mapCenter || state.location || locationData.ZIP_CENTERS['95113'];
  nearbyMap = window.L.map(node, { zoomControl: true }).setView([center.lat, center.lon], 12);
  window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(nearbyMap);
  stores.forEach((store, index) => {
    const marker = window.L.marker([store.lat, store.lon], {
      title: store.name,
      alt: `${store.name}, ${store.distanceMiles.toFixed(1)} miles away`
    }).addTo(nearbyMap);
    marker.bindTooltip(`${index + 1}. ${store.name}`);
    marker.on('click', event => {
      if (event.originalEvent) window.L.DomEvent.stopPropagation(event.originalEvent);
      state.selectedStore = store.id;
      renderNearby();
    });
    marker.getElement()?.setAttribute('data-store-marker', store.id);
  });
  if (state.location) {
    window.L.circleMarker([state.location.lat, state.location.lon], {
      radius: 8, color: '#fff', weight: 3, fillColor: '#2877d4', fillOpacity: 1
    }).addTo(nearbyMap).bindTooltip(state.location.label).getElement()?.setAttribute('data-location-puck', 'true');
  }
  nearbyMap.whenReady(() => {
    nearbyMap.on('moveend zoomend', () => {
      const moved = nearbyMap.getCenter();
      state.mapCenter = { lat: moved.lat, lon: moved.lng };
      state.mapMoved = true;
      document.querySelector('[data-search-here]')?.removeAttribute('disabled');
      const status = document.querySelector('.map-status b');
      if (status) status.textContent = 'Map moved · results unchanged';
    });
  });
}

function renderNearby() {
  if (nearbyMap) { nearbyMap.remove(); nearbyMap = null; }
  const ready = state.locationStatus === 'ready' && state.location;
  const stores = visibleNearbyStores();
  const message = state.locationMessage ? `<p class="location-message" role="${state.locationStatus === 'searching' ? 'status' : 'alert'}">${state.locationMessage}</p>` : '';
  app.innerHTML = `<section class="screen nearby-screen" data-screen="nearby">
    ${screenHead('Grocery map', 'Protein near you', 'Fast switching between one store list and one synchronized map, built for grocery decisions.')}
    <div class="freshness">Coordinates are fixtures · inventory is never inferred from distance</div>
    <section class="location-card" data-location-status="${state.locationStatus}">
      <form id="locationForm" class="location-form"><label for="zipInput">Search a ZIP</label><div><input id="zipInput" name="zip" inputmode="numeric" autocomplete="postal-code" pattern="[0-9]{5}(-[0-9]{4})?" placeholder="95113" aria-describedby="zipHelp"><button class="primary" type="submit">Go</button></div><small id="zipHelp">Demo coverage: 95113, 95129, and 95014.</small></form>
      <button class="secondary current-location" type="button" data-use-location ${state.locationStatus === 'searching' ? 'disabled' : ''}>Use current location</button>
      ${message}
      <div class="nearby-toolbar"><div class="location-heading"><b>${ready ? state.location.label : 'Downtown San Jose'}</b><span>${stores.length} stores sorted by distance</span></div><div class="view-toggle" aria-label="Store results view"><button type="button" data-location-view="map" aria-pressed="${state.locationView === 'map'}">⌖ Map</button><button type="button" data-location-view="list" aria-pressed="${state.locationView === 'list'}">☷ List</button></div></div>
      <div class="filter-pills" aria-label="Filter grocery stores">${['all', ...new Set(locationData.STORES.map(store => store.name))].map(filter => `<button type="button" data-store-filter="${filter}" aria-pressed="${state.storeFilter === filter}">${filter === 'all' ? 'All stores' : filter}</button>`).join('')}</div>
      <div class="store-results" data-store-results data-view="${state.locationView}">${state.locationView === 'map' ? mapMarkup(stores) : stores.map(storeCard).join('')}</div>
    </section>
  </section>`;
  if (state.locationView === 'map') requestAnimationFrame(() => initializeNearbyMap(stores));
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

function askPlanMarkup(answer) {
  const plan = answer.queryPlan;
  const filters = Object.entries(plan.filters).map(([field, value]) => `${field}: ${value}`).join(' · ') || 'none';
  const constraints = plan.constraints.join(', ') || 'none';
  return `<details class="query-plan" data-query-plan><summary>How the agent answered</summary><dl><div><dt>Intent</dt><dd>${escapeHtml(plan.intent)}</dd></div><div><dt>Filters</dt><dd>${escapeHtml(filters)}</dd></div><div><dt>Constraints</dt><dd>${escapeHtml(constraints)}</dd></div><div><dt>Sort</dt><dd>${escapeHtml(plan.sort || 'none')}</dd></div></dl><p>Grounded local catalog rules · no invented products</p></details>`;
}

function askRecommendationMarkup(item) {
  const product = byId(item.productId);
  if (!product) return '';
  const citations = item.citations.map(citation => `<li><code>${escapeHtml(citation.field)}</code>: ${escapeHtml(Array.isArray(citation.value) ? citation.value.join(', ') : citation.value)}</li>`).join('');
  return `<article class="ask-result" data-ask-product-id="${escapeHtml(product.id)}"><p class="eyebrow">Catalog match</p><h2><a href="#product/${escapeHtml(product.id)}">${escapeHtml(product.name)}</a></h2><p>${escapeHtml(item.reason)}</p><div class="ask-facts"><span><b>${escapeHtml(item.facts.protein)}</b> protein</span><span><b>${escapeHtml(item.facts.calories)}</b> calories</span><span><b>${escapeHtml(item.facts.price)}</b></span><span><b>${escapeHtml(item.facts.store)}</b></span><span><b>${escapeHtml(item.facts.freshness)}</b></span><span><b>${escapeHtml(item.facts.availability)}</b></span></div><details class="field-citations"><summary>Fields used</summary><ul>${citations}</ul></details><div class="ask-actions"><a class="secondary" href="#product/${escapeHtml(product.id)}">View product</a><button class="primary" type="button" data-add="${escapeHtml(product.id)}">${state.basket.includes(product.id) ? 'In basket' : 'Add to basket'}</button></div></article>`;
}

function renderAsk() {
  const answer = state.askAnswer;
  const output = answer ? `<section class="ask-answer" aria-live="polite"><div class="ask-summary"><span class="agent-avatar" aria-hidden="true">PF</span><div><b>${escapeHtml(answer.summary)}</b><span>${answer.recommendations.length ? 'These are grounded catalog results; price, location and stock remain labeled seeded or unknown.' : 'Try a supported shopping prompt. Unsupported requests fail closed.'}</span></div></div>${answer.recommendations.map(askRecommendationMarkup).join('') || '<div class="empty-card"><h2>No grounded match</h2><p>No catalog record survived the request. Nothing was invented.</p></div>'}${askPlanMarkup(answer)}</section>` : '<div class="ask-starter"><span class="agent-avatar" aria-hidden="true">PF</span><div><h2>Ask me what to buy</h2><p>I can find cheap breakfast protein, soy-free snacks, protein cereal, or improve the basket already on this device.</p></div></div>';
  app.innerHTML = `<section class="screen" data-screen="ask">${screenHead('Your grocery agent', 'Ask Protein Finds', 'Ask a normal shopping question and get an immediate catalog-grounded answer.')}<div class="freshness">Demo catalog · no live price or inventory · no health advice</div><form class="ask-form" id="askForm"><label for="askInput">What do you need?</label><div><input id="askInput" name="query" value="${escapeHtml(state.askQuery)}" autocomplete="off" placeholder="e.g. cheap breakfast protein"><button class="primary" type="submit" aria-label="Send question">↑</button></div></form><div class="prompt-row" aria-label="Example questions">${['cheap breakfast protein','soy-free snacks','best protein cereal','improve my basket'].map(prompt => `<button type="button" data-ask-prompt="${prompt}">${prompt}</button>`).join('')}</div>${output}</section>`;
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
        <div class="detail-actions"><button class="primary detail-primary-action" type="button" data-add="${product.id}" ${state.basket.includes(product.id) ? 'disabled' : ''}>${state.basket.includes(product.id) ? 'Added to basket' : 'Add to basket'}</button><button class="secondary" type="button" data-save="${product.id}" aria-pressed="${saved}">${saved ? 'Saved' : 'Save product'}</button><a class="secondary" href="#basket">View basket</a><a class="source-link" target="_blank" rel="noopener" href="${product.source}">Verify current source ↗</a></div>
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
    return `<section class="basket-store"><h2>${store}</h2>${Object.entries(categories).map(([category, categoryItems]) => `<div class="basket-category"><h3>${category}</h3>${categoryItems.map(product => `<div class="basket-line"><div><a href="#product/${product.id}"><b>${product.name}</b></a><small>${product.protein}g · ${hasKnownPrice(product) ? `~${money(product.price / product.servings)} seeded / serving` : 'price unknown'}</small></div><button type="button" data-remove="${product.id}" aria-label="Remove ${product.name}">Remove</button></div>`).join('')}</div>`).join('')}</section>`;
  }).join('');
  const subtotal = unknownPriceCount ? `${money(totalCost)} known + ${unknownPriceCount} unknown` : money(totalCost);
  app.innerHTML = `<section class="screen" data-screen="basket">${screenHead('Store-grouped trip', 'Grocery basket', 'Your saved trip, grouped for the store. Prices and inventory still require a current check.')}${items.length ? `<div class="basket-progress"><b>${items.length} products across ${Object.keys(groups).length} ${Object.keys(groups).length === 1 ? 'store' : 'stores'}</b><span>Use this as your store plan; Protein Finds does not submit an order.</span></div>${storeGroups}${prompts}<div class="basket-total"><span>Seeded one-serving subtotal</span><br><b>${totalProtein}g · ${subtotal}</b><p>No order or payment is submitted.</p></div><div class="basket-next"><div><b>Keep building this trip</b><span>Add another category or ask the catalog agent to inspect what is missing.</span></div><a class="primary" href="#discover">Continue shopping</a><a class="secondary" href="#ask">Improve my basket</a></div>` : `<div class="empty-card"><span class="state-icon">▣</span><h2>Your basket is empty</h2><p>Add grocery products from Discover. Your trip stays on this device.</p><a class="primary" href="#discover">Find products</a></div>`}</section>`;
}

function render() {
  currentRoute = parseRoute();
  document.querySelectorAll('[data-tab]').forEach(tab => tab.setAttribute('aria-current', tab.dataset.tab === currentRoute.name ? 'page' : 'false'));
  if (currentRoute.name === 'discover') renderDiscover();
  else if (currentRoute.name === 'nearby') renderNearby();
  else if (currentRoute.name === 'ask') renderAsk();
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

document.addEventListener('submit', event => {
  if (event.target.id === 'locationForm') {
    event.preventDefault();
    const center = locationData.findZipCenter(new FormData(event.target).get('zip'));
    if (center) setLocation(center);
    else {
      state.locationStatus = 'denied';
      state.locationMessage = 'That ZIP is outside this demo. Try 95113, 95129, or 95014.';
      renderNearby();
      requestAnimationFrame(() => document.querySelector('#zipInput')?.focus());
    }
    return;
  }
  if (event.target.id !== 'askForm') return;
  event.preventDefault();
  state.askQuery = String(new FormData(event.target).get('query') || '').trim();
  state.askAnswer = answerAsk({query:state.askQuery, products:groceryProducts, basketIds:state.basket});
  renderAsk();
  document.querySelector('.ask-answer')?.scrollIntoView({block:'start'});
});

document.addEventListener('click', event => {
  const tab = event.target.closest('[data-tab]');
  if (tab) { event.preventDefault(); navigate(tab.getAttribute('href')); return; }
  const back = event.target.closest('[data-history-back]');
  if (back) { event.preventDefault(); saveScroll(); history.length > 1 ? history.back() : navigate('#discover'); return; }
  const save = event.target.closest('[data-save]');
  if (save) {
    event.stopPropagation();
    const product = byId(save.dataset.save);
    const wasSaved = state.saved.has(save.dataset.save);
    wasSaved ? state.saved.delete(save.dataset.save) : state.saved.add(save.dataset.save);
    persist(); render(); showToast(`${product?.name || 'Product'} ${wasSaved ? 'removed from saved' : 'saved'}`); return;
  }
  const add = event.target.closest('[data-add]');
  if (add) {
    const product = byId(add.dataset.add);
    if (!state.basket.includes(add.dataset.add)) {
      state.basket.push(add.dataset.add); persist(); render();
      showToast(`${product?.name || 'Product'} added to basket`, { href: '#basket', label: 'View basket' });
    } else showToast(`${product?.name || 'Product'} is already in your basket`, { href: '#basket', label: 'View basket' });
    return;
  }
  const remove = event.target.closest('[data-remove]');
  if (remove) { const product = byId(remove.dataset.remove); state.basket = state.basket.filter(id => id !== remove.dataset.remove); persist(); renderBasket(); showToast(`${product?.name || 'Product'} removed from basket`); return; }
  const dismissToast = event.target.closest('[data-dismiss-toast]');
  if (dismissToast) { clearTimeout(toastTimer); toastRegion.dataset.visible = 'false'; toastRegion.innerHTML = ''; return; }
  const category = event.target.closest('[data-category]');
  if (category) { state.category = category.dataset.category; persist(); renderDiscover(); return; }
  const askPrompt = event.target.closest('[data-ask-prompt]');
  if (askPrompt) { state.askQuery = askPrompt.dataset.askPrompt; state.askAnswer = answerAsk({query:state.askQuery, products:groceryProducts, basketIds:state.basket}); renderAsk(); return; }
  const stateAction = event.target.closest('[data-state-action]');
  if (stateAction) { state.dataState = navigator.onLine ? 'ready' : 'offline'; renderDiscover(); return; }
  const useLocation = event.target.closest('[data-use-location]');
  if (useLocation) {
    if (!navigator.geolocation) { state.locationStatus = 'denied'; state.locationMessage = 'Location is unavailable. Enter a ZIP instead.'; renderNearby(); return; }
    state.locationStatus = 'searching'; state.locationMessage = 'Waiting for location permission…'; renderNearby();
    navigator.geolocation.getCurrentPosition(
      position => setLocation({ lat: position.coords.latitude, lon: position.coords.longitude, label: 'Current location' }),
      () => { state.locationStatus = 'denied'; state.locationMessage = 'Location was not shared. Enter a ZIP to keep browsing.'; renderNearby(); requestAnimationFrame(() => document.querySelector('#zipInput')?.focus()); },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
    return;
  }
  const view = event.target.closest('[data-location-view]');
  if (view) { state.locationView = view.dataset.locationView; renderNearby(); return; }
  const storeFilter = event.target.closest('[data-store-filter]');
  if (storeFilter) { state.storeFilter = storeFilter.dataset.storeFilter; state.selectedStore = null; renderNearby(); return; }
  const selectStore = event.target.closest('[data-select-store]');
  if (selectStore) { state.selectedStore = selectStore.dataset.selectStore; state.locationView = 'map'; renderNearby(); return; }
  const marker = event.target.closest('[data-store-marker]');
  if (marker) { state.selectedStore = marker.dataset.storeMarker; renderNearby(); return; }
  const recenter = event.target.closest('[data-map-recenter]');
  if (recenter && nearbyMap) { const center = state.location || locationData.ZIP_CENTERS['95113']; nearbyMap.setView([center.lat, center.lon], 12); return; }
  const searchHere = event.target.closest('[data-search-here]');
  if (searchHere) { setLocation({ ...state.mapCenter, label: 'Searched map area' }); return; }
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
  products: groceryProducts, state, scoreProduct, filteredProducts, nearbyStores,
  setDataState(value) { state.dataState = value; if (currentRoute?.name !== 'discover') navigate('#discover'); else renderDiscover(); }
};