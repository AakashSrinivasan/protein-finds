const products = window.PROTEIN_PRODUCTS;
const groceryProducts = products.filter(product => product.category !== 'Restaurant');
const groceryIds = new Set(groceryProducts.map(product => product.id));
const locationData = window.PROTEIN_LOCATION;
const app = document.querySelector('#appMain');
const liveRegion = document.querySelector('#liveRegion');
const toastRegion = document.querySelector('#toastRegion');
const { answerAsk } = window.AskProtein;
const productScreener = window.ProductScreener;
const storageKey = 'protein-finds-shell-state-v1';
const scrollKey = 'protein-finds-scroll-v1';
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

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
const screenerCategories = () => [...new Set(groceryProducts.map(product => product.category).filter(category => typeof category === 'string' && category.trim()))].sort((a, b) => a.localeCompare(b));
const storedCompareContext = stored.compareContext && ['discover', 'screener'].includes(stored.compareContext.origin)
  ? { origin: stored.compareContext.origin, sort: productScreener.SORTS[stored.compareContext.sort] ? stored.compareContext.sort : 'recommended' }
  : { origin: 'discover', sort: 'recommended' };
const storedSightings = Object.fromEntries(Object.entries(stored.sightings || {}).filter(([key, report]) =>
  /^[a-z0-9-]+:[a-z0-9-]+$/.test(key) && report?.status === 'pending-local' && typeof report.reportedAt === 'string'
));
const state = {
  saved: new Set((stored.saved || []).filter(id => groceryIds.has(id))),
  basket: (stored.basket || []).filter(id => groceryIds.has(id)),
  compare: new Set((stored.compare || []).filter(id => groceryIds.has(id)).slice(0, 3)),
  search: stored.search || '',
  category: Object.hasOwn(categoryFilters, storedCategory) ? storedCategory : 'All groceries',
  sort: stored.sort || 'recommended',
  dataState: navigator.onLine ? 'ready' : 'offline',
  scroll: readJson(sessionStorage, scrollKey, {}),
  locationStatus: 'idle',
  locationMessage: '',
  location: null,
  mapCenter: { lat: locationData.ZIP_CENTERS['94404'].lat, lon: locationData.ZIP_CENTERS['94404'].lon },
  mapMoved: false,
  locationView: 'map',
  storeFilter: 'all',
  selectedStore: null,
  askQuery: '',
  askAnswer: null,
  screener: productScreener.normalize(stored.screener, screenerCategories()),
  screenerPage: Number.isInteger(stored.screenerPage) && stored.screenerPage > 0 ? stored.screenerPage : 1,
  screenerBuilderOpen: matchMedia('(min-width: 700px) and (min-height: 501px)').matches,
  compareContext: storedCompareContext,
  sightings: storedSightings
};
let currentRoute = null;
let deferredInstallPrompt = null;
let nearbyMap = null;
let toastTimer = null;

const money = value => `$${Number(value).toFixed(2)}`;
const byId = id => groceryProducts.find(product => product.id === id);
const hasKnownPrice = product => product.availability !== 'demo-unavailable' && Number.isFinite(product.price);
const priceLabel = product => hasKnownPrice(product) ? `${money(product.price)} demo pack` : 'Price unknown';
const numberLabel = (value, suffix = '') => Number.isFinite(value) ? `${value}${suffix}` : 'Unknown';
const textLabel = value => typeof value === 'string' && value.trim() ? value : 'Unknown';
const productVerdict = product => product.role === 'anchor' ? 'Strong main protein' : 'Useful supporting pick';
const rankingReason = product => `${product.protein}g protein / ${product.calories} cal.`;
const scoreProduct = product => product.efficiency * 5 + product.protein * 1.5 - (hasKnownPrice(product) ? product.pricePer25 : 0) + (product.role === 'anchor' ? 12 : 0);
const goalDefinitions = Object.freeze({
  recommended: { short: 'Best fit', title: 'Balanced shelf', reason: 'Balances protein, calories, value, and usefulness across a grocery trip.' },
  protein: { short: 'Protein', title: 'Highest protein first', reason: 'Ranks protein grams from highest to lowest.' },
  efficiency: { short: 'Lean', title: 'Most protein per calorie', reason: 'Ranks grams of protein per 100 calories.' },
  price: { short: 'Value', title: 'Lowest recorded cost', reason: 'Ranks known cost per 25g of protein; unknown prices follow.' }
});
const routeKey = route => route.name === 'product' ? `product/${route.id}` : route.name;

function persist() {
  localStorage.setItem(storageKey, JSON.stringify({
    saved: [...state.saved], basket: state.basket, search: state.search,
    compare: [...state.compare], category: state.category, sort: state.sort,
    screener: state.screener, screenerPage: state.screenerPage, compareContext: state.compareContext,
    sightings: state.sightings
  }));
  updateCounts();
}

function captureDecisionContext() {
  if (currentRoute?.name === 'screener') state.compareContext = { origin: 'screener', sort: state.screener.sort };
  else if (currentRoute?.name === 'discover') state.compareContext = { origin: 'discover', sort: state.sort };
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
  return { name: ['discover', 'screener', 'nearby', 'ask', 'saved', 'basket', 'compare'].includes(hash) ? hash : 'discover' };
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
    const initials = product.brand.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
    return `<div class="image-needed" data-image-needed><span aria-hidden="true">${escapeHtml(initials)}</span><small>Exact package photo unavailable</small></div>`;
  }
  const image = product.image;
  return `<img src="${image.path}" alt="Exact package front: ${image.variant}" data-product-image data-upc="${image.upc}" data-image-license="${image.license}" ${detail ? '' : 'loading="lazy"'}>`;
}

function productCard(product) {
  const saved = state.saved.has(product.id);
  const nearby = nearestStoreForProduct(product);
  const inBasket = state.basket.includes(product.id);
  const comparing = state.compare.has(product.id);
  const value = product.exactSku ? 'Price unknown' : hasKnownPrice(product) ? money(product.pricePer25) : 'Price unknown';
  const exactHandoff = product.exactSku?.retailerHandoffs?.find(handoff => handoff.type === 'exact-product');
  const storeSearch = product.exactSku?.retailerHandoffs?.find(handoff => handoff.type === 'retailer-search');
  const storeTruth = exactHandoff ? `${exactHandoff.retailer} · exact order handoff` : storeSearch ? `${storeSearch.retailer} · catalog-only search` : `${product.stores[0] || 'Store unknown'} · ${product.availabilityLabel}`;
  const freshnessTruth = exactHandoff ? `Unknown inventory · price unknown · checked ${exactHandoff.checkedAt}` : storeSearch ? `Unknown inventory · checked ${storeSearch.checkedAt}` : 'Stale seed · checked 2026-08-13 · inventory unknown';
  return `<article class="product-card" data-product-id="${product.id}">
    <div class="product-media">${imageMarkup(product)}</div>
    <div class="product-copy">
      <p class="decision-verdict"><b>${productVerdict(product)}</b></p>
      <h2><a class="product-link" href="#product/${product.id}">${product.name}</a></h2>
      <p class="brand-line">${product.brand} · ${product.category}</p>
      <div class="card-decision-strip"><div><b>${product.protein}g</b><span>protein</span></div><div><b>${product.calories}</b><span>calories</span></div><div class="decision-price"><b>${value}</b><span>${product.exactSku ? 'store price' : 'seeded / 25g'}</span></div></div>
      <p class="decision-store"><b>${storeTruth}</b></p>
      <p class="decision-freshness">${freshnessTruth}</p>
      ${nearby ? `<p class="nearby-product"><b>${nearby.name}</b> · ${nearby.distanceMiles.toFixed(1)} mi · unknown inventory</p>` : ''}
      <div class="card-actions"><a class="secondary" href="#product/${product.id}">Details</a><button class="primary" type="button" data-add="${product.id}" ${inBasket ? 'disabled' : ''}>${inBasket ? 'In basket' : 'Add to basket'}</button></div>
    </div>
    <button class="compare-button" type="button" data-compare="${product.id}" aria-label="${comparing ? 'Remove' : 'Add'} ${product.name} ${comparing ? 'from' : 'to'} comparison" aria-pressed="${comparing}">${comparing ? '✓ Comparing' : '+ Compare'}</button>
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
    const haystack = [product.name, product.brand, product.category, product.base, product.use, product.blurb, ...(product.stores || []), product.exactSku?.upc, product.exactSku?.variant, ...(product.useCases || [])].filter(Boolean).join(' ').toLowerCase();
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

function productsForStore(store) {
  return groceryProducts.filter(product => product.stores.includes(store.name)).sort((a, b) => {
    const connectionRank = product => product.exactSku?.retailerHandoffs?.some(handoff => handoff.storeId === store.id && handoff.type === 'exact-product') ? 3
      : product.exactSku?.retailerHandoffs?.some(handoff => handoff.storeId === store.id && handoff.type === 'retailer-search') ? 2
      : product.image ? 1 : 0;
    return connectionRank(b) - connectionRank(a) || b.protein - a.protein || a.name.localeCompare(b.name);
  });
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
  const matching = productsForStore(store);
  const exactPaths = matching.filter(product => product.exactSku?.retailerHandoffs?.some(handoff => handoff.storeId === store.id));
  return `<article class="store-card" data-store-card="${store.id}" ${selected ? 'data-selected="true"' : ''}>
    <button class="store-rank" type="button" data-select-store="${store.id}" aria-label="Open ${store.name} details on the map"><span>${index + 1}</span><small>Map</small></button>
    <div class="store-copy"><p class="store-distance">${store.distanceMiles.toFixed(1)} mi away</p><h3>${store.name}</h3><p>${store.address}</p>
      <div class="store-tags"><span>${exactPaths.length} exact SKU ${exactPaths.length === 1 ? 'path' : 'paths'}</span><span>${matching.length - exactPaths.length} broad catalog matches</span><span>Unknown inventory</span></div>
      ${matching.length ? `<div class="store-products">${matching.slice(0, 3).map(product => `<a href="#product/${product.id}">${product.name}</a>`).join('')}</div>` : ''}
      <p class="availability-note">${store.availabilityLabel} · checked ${store.availabilityObservedAt}</p>
    </div>
    <div class="store-actions"><a class="store-handoff" href="${store.retailerUrl}" target="_blank" rel="noopener">${store.retailerActionLabel}</a><a class="store-source" href="${store.coordinateSourceUrl}" target="_blank" rel="noopener">Map source</a></div>
  </article>`;
}

function mapMarkup(stores) {
  const selectedIndex = stores.findIndex(store => store.id === state.selectedStore);
  return `<div class="map-wrap">
    <div class="map-status"><span>OpenStreetMap</span><b>${state.mapMoved ? 'Map moved · results unchanged' : 'Map and list synchronized'}</b></div>
    <div class="store-map" id="storeMap" data-store-map aria-label="Interactive geographic map of ${stores.length} grocery stores"></div>
    <button class="map-recenter" type="button" data-map-recenter aria-label="Recenter map on ${state.location ? state.location.label : 'Foster City'}">◎</button>
    <button class="primary search-here" type="button" data-search-here ${state.mapMoved ? '' : 'disabled'}>Search this area</button>
    <div class="map-store-sheet" aria-live="polite">${selectedIndex >= 0 ? `<div class="sheet-heading"><span aria-hidden="true"></span><b>Selected grocery store</b></div>${storeCard(stores[selectedIndex], selectedIndex)}` : '<p>Tap a grocery marker to compare distance, catalog matches, and product details.</p>'}</div>
    <p class="map-fallback">© OpenStreetMap contributors · store coordinates are seeded fixtures · proximity never means in stock.</p>
  </div>`;
}

function initializeNearbyMap(stores) {
  const node = document.querySelector('#storeMap');
  if (!node || !window.L) return;
  const center = state.mapCenter || state.location || locationData.ZIP_CENTERS['94404'];
  nearbyMap = window.L.map(node, { zoomControl: true }).setView([center.lat, center.lon], 12);
  window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(nearbyMap);
  const markers = new Map();
  const visualOffsets = [[0, 0], [-15, -5], [15, -5], [0, 12]];
  stores.forEach((store, index) => {
    const overlaps = stores.filter(candidate => locationData.distanceMiles(store, candidate) < 0.18);
    const overlapIndex = overlaps.findIndex(candidate => candidate.id === store.id);
    const [offsetX, offsetY] = overlaps.length > 1 ? visualOffsets[overlapIndex % visualOffsets.length] : [0, 0];
    const icon = window.L.divIcon({
      className: `store-pin${store.id === state.selectedStore ? ' is-selected' : ''}`,
      html: `<span>${index + 1}</span>`, iconSize: [34, 42], iconAnchor: [17 + offsetX, 42 + offsetY]
    });
    const marker = window.L.marker([store.lat, store.lon], {
      title: store.name,
      alt: `${store.name}, ${store.distanceMiles.toFixed(1)} miles away`,
      icon
    }).addTo(nearbyMap);
    marker.bindTooltip(`${index + 1}. ${store.name}`);
    marker.on('click', event => {
      if (event.originalEvent) window.L.DomEvent.stopPropagation(event.originalEvent);
      state.selectedStore = store.id;
      renderNearby();
    });
    marker.getElement()?.setAttribute('data-store-marker', store.id);
    marker.getElement()?.setAttribute('aria-current', store.id === state.selectedStore ? 'true' : 'false');
    markers.set(store.id, marker);
  });
  const selectedStore = stores.find(store => store.id === state.selectedStore);
  if (selectedStore) {
    nearbyMap.setView([selectedStore.lat, selectedStore.lon], 15, { animate: false });
    node.dataset.selectedStore = selectedStore.id;
    node.dataset.centerLat = String(nearbyMap.getCenter().lat);
    node.dataset.centerLon = String(nearbyMap.getCenter().lng);
    markers.get(selectedStore.id)?.openTooltip();
  }
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
      <form id="locationForm" class="location-form"><label for="zipInput">Search a ZIP</label><div><input id="zipInput" name="zip" inputmode="numeric" autocomplete="postal-code" pattern="[0-9]{5}(-[0-9]{4})?" placeholder="94404" aria-describedby="zipHelp"><button class="primary" type="submit">Go</button></div><small id="zipHelp">Foster City is the first indexed market. Bay Area demo ZIPs also remain available.</small></form>
      <button class="secondary current-location" type="button" data-use-location ${state.locationStatus === 'searching' ? 'disabled' : ''}>Use current location</button>
      ${message}
      <div class="nearby-toolbar"><div class="location-heading"><b>${ready ? state.location.label : 'Foster City'}</b><span>${stores.length} stores sorted by distance</span></div><div class="view-toggle" aria-label="Store results view"><button type="button" data-location-view="map" aria-pressed="${state.locationView === 'map'}">⌖ Map</button><button type="button" data-location-view="list" aria-pressed="${state.locationView === 'list'}">☷ List</button></div></div>
      <div class="filter-pills" aria-label="Filter grocery stores">${['all', ...new Set(locationData.STORES.map(store => store.name))].map(filter => `<button type="button" data-store-filter="${filter}" aria-pressed="${state.storeFilter === filter}">${filter === 'all' ? 'All stores' : filter}</button>`).join('')}</div>
      <div class="store-results" data-store-results data-view="${state.locationView}">${state.locationView === 'map' ? mapMarkup(stores) : stores.map(storeCard).join('')}</div>
    </section>
  </section>`;
  if (state.locationView === 'map') requestAnimationFrame(() => initializeNearbyMap(stores));
}

function featuredCard(product, index, goal) {
  const label = index === 0 ? `${goal.short} leader` : `#${index + 1} for ${goal.short.toLowerCase()}`;
  return `<article class="featured-card" data-featured-id="${product.id}">
    <a class="featured-media" href="#product/${product.id}" aria-label="View ${product.name}">${imageMarkup(product)}</a>
    <div class="featured-copy"><div class="featured-info"><span>${label}</span><h2><a href="#product/${product.id}">${product.name}</a></h2><p>${product.brand} · ${product.stores[0] || 'Store unknown'}</p><div class="featured-metrics"><b>${product.protein}g</b><small>protein</small><b>${product.calories}</b><small>cal</small></div><p class="featured-tradeoff"><b>Trade-off:</b> ${product.tradeoff}</p></div><div class="featured-actions"><a class="secondary" href="#product/${product.id}">Details</a><button class="secondary" type="button" data-compare="${product.id}" aria-pressed="${state.compare.has(product.id)}">${state.compare.has(product.id) ? 'Comparing' : 'Compare'}</button><button class="primary" type="button" data-add="${product.id}" aria-label="Add ${product.name} to basket" ${state.basket.includes(product.id) ? 'disabled' : ''}>${state.basket.includes(product.id) ? 'Added' : 'Add'}</button></div></div>
  </article>`;
}

function compareTrayMarkup() {
  const selected = [...state.compare].map(byId).filter(Boolean);
  if (!selected.length) return '';
  return `<aside class="compare-tray" data-compare-tray aria-live="polite"><div><span>${selected.map(product => `<i title="${product.name}">${product.name.slice(0, 1)}</i>`).join('')}</span><p><b>${selected.length}/3 selected</b><small>${selected.length < 2 ? 'Choose one more to compare' : 'Ready for a side-by-side decision'}</small></p></div><button type="button" data-clear-compare>Clear</button><a class="primary" href="#compare" ${selected.length < 2 ? 'aria-disabled="true"' : ''}>Compare</a></aside>`;
}

function renderDiscover() {
  const list = filteredProducts();
  const goal = goalDefinitions[state.sort] || goalDefinitions.recommended;
  const featured = list.slice(0, 3);
  const leader = list[0];
  const categories = Object.keys(categoryFilters);
  const forcedState = state.dataState;
  let content;
  if (['loading', 'error'].includes(forcedState)) content = stateMarkup(forcedState);
  else if (forcedState === 'empty' || !list.length) content = stateMarkup('empty');
  else content = `${['offline', 'stale'].includes(forcedState) ? stateMarkup(forcedState) : ''}<p class="results-meta">${list.length} grocery options</p><div class="product-list">${list.map(productCard).join('')}</div>`;
  app.innerHTML = `<section class="screen discover-screen" data-screen="discover">
    <section class="discover-hero"><div class="hero-orbit" aria-hidden="true"><i></i><i></i><i></i></div><p class="eyebrow">Vegetarian protein, decoded</p><h1 id="screenTitle">Build a better <br><em>grocery run.</em></h1><p>Choose what matters, compare the strongest options, and build the trip.</p><div class="hero-actions" aria-label="Shopping goal">${[['protein','Most protein'],['efficiency','Leanest picks'],['price','Best value']].map(([value,label]) => `<button type="button" data-quick-sort="${value}" aria-pressed="${state.sort === value}">${label}</button>`).join('')}</div>${leader ? `<div class="hero-leader" aria-live="polite"><span>${goal.title}</span><b>${leader.name}</b><small>${leader.protein}g protein · ${leader.calories} cal · ${hasKnownPrice(leader) ? `${money(leader.pricePer25)} value / 25g` : 'price unknown'}</small></div>` : ''}</section>
    ${featured.length ? `<section class="featured-section"><div class="section-title"><div><p class="eyebrow">Goal-matched shortlist</p><h2>${goal.title}</h2><small>${goal.reason}</small></div><span>Swipe →</span></div><div class="featured-rail">${featured.map((product, index) => featuredCard(product, index, goal)).join('')}</div></section>` : ''}
    <details class="surface-truth"><summary>About these results</summary><p>Demo catalog recorded Aug 13, 2026. Prices and inventory are not live; exact package photos appear only when the variant and rights are known.</p></details>
    <div class="discovery-tools">
      <label class="search-field"><span aria-hidden="true">⌕</span><input id="search" type="search" value="${state.search.replaceAll('"', '&quot;')}" aria-label="Search products" placeholder="Search products"></label>
      <select id="sort" aria-label="Sort products"><option value="recommended">Best fit</option><option value="protein">Protein</option><option value="efficiency">Efficiency</option><option value="price">Seed price</option></select>
    </div>
    <div class="category-row" aria-label="Product categories">${categories.map(category => `<button type="button" data-category="${category}" aria-pressed="${state.category === category}">${category}</button>`).join('')}</div>
    <div class="section-title catalog-title"><div><p class="eyebrow">The full shelf</p><h2>Compare every find</h2></div></div>
    <div id="catalogState">${content}</div>
    ${compareTrayMarkup()}
  </section>`;
  document.querySelector('#sort').value = state.sort;
}

function screenerResultMarkup(product, rank) {
  const value = productScreener.hasKnownPrice(product) ? money(product.pricePer25) : 'Unknown';
  const comparing = state.compare.has(product.id);
  const inBasket = state.basket.includes(product.id);
  return `<article class="screen-result" data-screen-result="${product.id}">
    <div class="screen-rank" aria-label="Result rank ${rank}">${rank}</div>
    <div class="screen-product"><p>${escapeHtml(textLabel(product.brand))}</p><h3><a href="#product/${escapeHtml(product.id)}">${escapeHtml(textLabel(product.name))}</a></h3><small>${escapeHtml(textLabel(product.category))} · ${escapeHtml(textLabel(product.prep))}</small></div>
    <div class="screen-result-metrics"><div class="screen-metric"><b>${numberLabel(product.protein, 'g')}</b><span>protein</span></div><div class="screen-metric"><b>${numberLabel(product.calories)}</b><span>calories</span></div><div class="screen-metric"><b>${numberLabel(product.efficiency)}</b><span>g / 100 cal</span></div><div class="screen-metric"><b>${value}</b><span>seeded / 25g</span></div></div>
    <div class="screen-result-actions"><a class="secondary" href="#product/${escapeHtml(product.id)}">Details</a><button class="secondary" type="button" data-compare="${escapeHtml(product.id)}" aria-pressed="${comparing}">${comparing ? 'Comparing' : 'Compare'}</button><button class="primary" type="button" data-add="${escapeHtml(product.id)}" ${inBasket ? 'disabled' : ''}>${inBasket ? 'Added' : 'Add'}</button></div>
  </article>`;
}

function renderScreener() {
  const run = productScreener.run(groceryProducts, state.screener);
  state.screener = run.screen;
  const pagination = productScreener.paginate(run.results, state.screenerPage, 24);
  state.screenerPage = pagination.page;
  const clauses = productScreener.clauses(run.screen);
  const categoryOptions = ['All groceries', ...screenerCategories()].map(category => `<option value="${escapeHtml(category)}" ${run.screen.category === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('');
  const exclusions = Object.entries(productScreener.EXCLUSIONS).map(([key, definition]) => `<label class="screen-check"><input type="checkbox" data-screen-exclusion="${key}" ${run.screen.exclusions.includes(key) ? 'checked' : ''}><span>${definition.label}</span></label>`).join('');
  const sortOptions = Object.entries(productScreener.SORTS).map(([key, definition]) => `<option value="${key}" ${run.screen.sort === key ? 'selected' : ''}>${definition.label}</option>`).join('');
  const activeCriteria = clauses.length
    ? clauses.map(clause => `<button type="button" data-remove-screen-clause="${clause.key}" aria-label="Remove ${escapeHtml(clause.label)}">${escapeHtml(clause.label)} <span aria-hidden="true">×</span></button>`).join('')
    : '<span class="screen-no-criteria">No filters yet · showing the complete grocery seed</span>';
  const results = run.results.length
    ? `<div class="screen-page-summary" data-screen-page-summary>Showing ${pagination.start}–${pagination.end} of ${pagination.totalResults}</div><div class="screen-result-head" aria-hidden="true"><span>#</span><span>Product</span><span>Protein</span><span>Calories</span><span>Efficiency</span><span>Value</span><span>Actions</span></div><div class="screen-results">${pagination.items.map((product, index) => screenerResultMarkup(product, pagination.start + index)).join('')}</div>${pagination.pageCount > 1 ? `<nav class="screen-pagination" aria-label="Screener result pages"><button type="button" data-screen-page="${pagination.page - 1}" ${pagination.page === 1 ? 'disabled' : ''}>← Previous</button><span>Page ${pagination.page} of ${pagination.pageCount}</span><button type="button" data-screen-page="${pagination.page + 1}" ${pagination.page === pagination.pageCount ? 'disabled' : ''}>Next →</button></nav>` : ''}`
    : `<div class="empty-card screen-empty"><span class="state-icon">∅</span><h2>No products match all of that</h2><p>Remove one criterion to widen the screen. Protein Finds will not invent a match.</p><button class="primary" type="button" data-screen-reset>Clear screen</button></div>`;

  app.innerHTML = `<section class="screen screener-screen" data-screen="screener">
    ${screenHead('Universal product screener', 'Find exactly what fits', 'Choose normal food preferences. Results update from the catalog—no formulas, mystery score, or invented products.')}
    <div class="screener-presets" aria-label="Quick screens"><button type="button" data-screen-template="high-protein">20g+ under 200 cal</button><button type="button" data-screen-template="soy-free">Soy-free standouts</button><button type="button" data-screen-template="ready-now">Ready-now 10g+</button></div>
    <div class="screener-workspace">
      <details class="screen-builder" id="screenBuilder" ${state.screenerBuilderOpen ? 'open' : ''}>
        <summary><div><p class="eyebrow">Build your screen</p><h2>What should make the cut?</h2></div><span>${clauses.length ? `${clauses.length} active` : 'Customize'}</span></summary>
        <form class="screen-builder-form"><div class="screen-builder-actions"><button type="button" data-screen-reset>Reset all filters</button></div>
        <label class="screen-field"><span>Product type</span><select id="screenCategory">${categoryOptions}</select></label>
        <fieldset><legend>Nutrition</legend><div class="screen-number-grid"><label class="screen-field"><span>At least</span><div><input id="screenMinProtein" type="number" min="0" step="1" inputmode="numeric" value="${run.screen.minProtein ?? ''}" placeholder="Any"><b>g protein</b></div></label><label class="screen-field"><span>No more than</span><div><input id="screenMaxCalories" type="number" min="0" step="10" inputmode="numeric" value="${run.screen.maxCalories ?? ''}" placeholder="Any"><b>calories</b></div></label></div></fieldset>
        <fieldset><legend>Avoid</legend><div class="screen-check-grid">${exclusions}</div></fieldset>
        <label class="screen-field"><span>Preparation</span><select id="screenPrep"><option value="all" ${run.screen.prep === 'all' ? 'selected' : ''}>Any preparation</option><option value="ready" ${run.screen.prep === 'ready' ? 'selected' : ''}>Ready to eat or drink now</option><option value="heat" ${run.screen.prep === 'heat' ? 'selected' : ''}>Cooking or heating is okay</option></select></label>
        <p class="screen-builder-note">Thresholds include the number you enter. Supported fields are present for every product in this seed.</p></form>
      </details>
      <section class="screen-output" aria-live="polite">
        <div class="screen-output-head"><div><p class="eyebrow">Live catalog results</p><h2><b data-screen-result-count>${run.results.length}</b> of ${run.total} products</h2></div><label><span>Sort by</span><select id="screenSort">${sortOptions}</select></label></div>
        <div class="active-screen" aria-label="Active screening criteria">${activeCriteria}</div>
        ${run.unknownSortCount ? `<p class="screen-unknown-note">${run.unknownSortCount} ${run.unknownSortCount === 1 ? 'result has' : 'results have'} an unknown ${escapeHtml(productScreener.SORTS[run.screen.sort].label.toLowerCase())} value and ${run.unknownSortCount === 1 ? 'is' : 'are'} shown last.</p>` : ''}
        ${results}
      </section>
    </div>
    <details class="surface-truth screen-truth"><summary>Coverage and data policy</summary><p>This proves the screening workflow against ${run.total} grocery records—not a comprehensive market database. Every result is an existing catalog record. Prices are seeded, inventory is not live, and unsupported fields are not offered as filters.</p></details>
    ${compareTrayMarkup()}
  </section>`;
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

function exactSkuMarkup(product) {
  const sku = product.exactSku;
  if (!sku) return '';
  return `<section class="exact-sku" data-exact-sku>
    <p class="eyebrow">Exact package identity</p>
    <h2>${escapeHtml(sku.variant)} · ${escapeHtml(sku.size)}</h2>
    <dl><div><dt>UPC</dt><dd>${escapeHtml(sku.upc)}</dd></div><div><dt>Serving</dt><dd>${escapeHtml(sku.servingSize)}</dd></div><div><dt>Package</dt><dd>${escapeHtml(String(sku.servingsPerPackage))} servings</dd></div></dl>
  </section>`;
}

function productEvidenceMarkup(product) {
  const sku = product.exactSku;
  if (!sku) return '';
  return `<section class="product-evidence" data-product-evidence>
    <p class="eyebrow">Evaluate the fit</p>
    <h2>${product.protein}g protein · ${product.calories} calories · ${product.efficiency}g / 100 cal</h2>
    <div class="evidence-tags">${sku.dietaryLabels.map(label => `<span>${escapeHtml(label)}</span>`).join('')}<span>Contains ${escapeHtml(sku.allergens.join(', '))}</span></div>
    <p><b>Ingredients:</b> ${escapeHtml(product.ingredients)}</p>
    <p class="evidence-source">Nutrition and ingredients checked ${escapeHtml(sku.nutritionCheckedAt)}. <a href="${escapeHtml(sku.nutritionSourceUrl)}" target="_blank" rel="noopener">Open manufacturer evidence ↗</a></p>
  </section>`;
}

function productStoreMarkup(product) {
  const sku = product.exactSku;
  const handoffs = sku?.retailerHandoffs || [];
  if (!handoffs.length) return `<section class="product-store-panel"><p>No exact retailer handoff or official retailer search is attached.</p></section>`;
  const origin = state.location || locationData.ZIP_CENTERS['94404'];
  const stores = locationData.storesNear(origin);
  return handoffs.map(handoff => {
    const store = stores.find(candidate => candidate.id === handoff.storeId);
    const isExact = handoff.type === 'exact-product';
    const key = store ? `${product.id}:${store.id}` : null;
    const report = key ? state.sightings[key] : null;
    return `<section class="product-store-panel" ${store ? `data-product-store="${escapeHtml(store.id)}"` : ''} data-retailer-connection="${escapeHtml(handoff.type)}">
      <div class="product-store-head"><div><p class="eyebrow">${isExact ? 'Exact retailer/order handoff' : 'Official retailer search fallback'}</p><h2>${escapeHtml(store ? `${store.name} · ${store.distanceMiles.toFixed(1)} mi from ${state.location?.label || '94404'}` : handoff.retailer)}</h2>${store ? `<p>${escapeHtml(store.address)}</p>` : ''}</div><span data-availability="unknown">Unknown inventory</span></div>
      <p class="store-observation"><b>Price unknown · inventory confidence unknown.</b><br>${escapeHtml(isExact ? handoff.detail : 'No exact Target product page or local stock observation is attached. Search uses the exact UPC.')} Checked ${escapeHtml(handoff.checkedAt)}.</p>
      <div class="product-store-actions">${store ? `<a class="secondary" data-directions href="${escapeHtml(store.directionsUrl)}" target="_blank" rel="noopener">Directions ↗</a>` : ''}<a class="primary" data-retailer-handoff="${escapeHtml(handoff.type)}" href="${escapeHtml(handoff.url)}" target="_blank" rel="noopener">${escapeHtml(handoff.label)} ↗</a></div>
      ${store ? `<div class="sighting-box"><button class="secondary" type="button" data-report-sighting="${escapeHtml(key)}" aria-pressed="${Boolean(report)}">${report ? '✓ Report saved' : 'I found this here'}</button><p data-sighting-status>${report ? 'Pending report stored only on this device. It is unverified and does not confirm inventory.' : 'Your report will stay only on this device as pending-local. It will not confirm inventory.'}</p></div>` : ''}
    </section>`;
  }).join('');
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
        ${exactSkuMarkup(product)}
        <div class="detail-metrics"><div><b>${product.protein}g</b><span>protein</span></div><div><b>${product.calories}</b><span>calories</span></div><div><b>${product.efficiency}</b><span>g / 100 cal</span></div></div>
        ${product.exactSku ? `<div class="detail-decision"><span><b>Price unknown</b><small>No store price observation attached</small></span><span><b>${escapeHtml(product.exactSku.retailerHandoffs?.find(handoff => handoff.type === 'exact-product')?.retailer || product.exactSku.retailerHandoffs?.[0]?.retailer || 'Store unknown')}</b><small>Unknown inventory · checked ${escapeHtml(product.exactSku.retailerHandoffs?.find(handoff => handoff.type === 'exact-product')?.checkedAt || product.exactSku.nutritionCheckedAt)}</small></span></div>` : `<div class="detail-decision"><span><b>${priceLabel(product)}</b><small>not a live price</small></span><span><b>${product.stores[0] || 'Store unknown'}</b><small>${product.availabilityLabel} · checked Aug 13</small></span></div>`}
        <p>${product.blurb}</p><p><b>Best use:</b> ${product.use}</p><p><b>Trade-off:</b> ${product.tradeoff}</p>
        ${productEvidenceMarkup(product)}
        <div class="truth-note"><b>${product.exactSku ? 'Exact identity; bounded evidence.' : 'Seeded demo record.'}</b> ${product.exactSku ? 'The package identity and attached sources are exact. Current store price and inventory remain unknown.' : 'Nutrition, price and availability are not a current exact-SKU claim. Verify the linked current source before buying.'}</div>
        ${productStoreMarkup(product)}
        <div class="detail-actions"><button class="primary detail-primary-action" type="button" data-add="${product.id}" ${state.basket.includes(product.id) ? 'disabled' : ''}>${state.basket.includes(product.id) ? 'Added to basket' : 'Add to basket'}</button><button class="secondary" type="button" data-save="${product.id}" aria-pressed="${saved}">${saved ? 'Saved' : 'Save product'}</button><button class="secondary" type="button" data-compare="${product.id}" aria-pressed="${state.compare.has(product.id)}">${state.compare.has(product.id) ? '✓ Comparing' : 'Compare'}</button><a class="secondary" href="#basket">View basket</a><a class="source-link" target="_blank" rel="noopener" href="${product.source}">Verify current source ↗</a></div>
        ${imageCredit}
      </div>
    </article>
  </section>`;
}

function comparisonDecision(items, sort = 'recommended') {
  const bestKnown = (field, direction, known = product => Number.isFinite(product[field])) => {
    const values = items.filter(known).map(product => product[field]);
    return values.length ? (direction === 'min' ? Math.min(...values) : Math.max(...values)) : null;
  };
  const metricDefinitions = [
    { key: 'protein', label: 'protein', best: bestKnown('protein', 'max'), value: product => Number.isFinite(product.protein) ? product.protein : null },
    { key: 'calories', label: 'calories', best: bestKnown('calories', 'min'), value: product => Number.isFinite(product.calories) ? product.calories : null },
    { key: 'value', label: 'value', best: bestKnown('pricePer25', 'min', hasKnownPrice), value: product => hasKnownPrice(product) ? product.pricePer25 : null },
    { key: 'efficiency', label: 'efficiency', best: bestKnown('efficiency', 'max'), value: product => Number.isFinite(product.efficiency) ? product.efficiency : null }
  ];
  const winsFor = product => metricDefinitions.filter(metric => metric.best !== null && metric.value(product) === metric.best);
  const balanced = [...items].sort((a, b) => winsFor(b).length - winsFor(a).length || productScreener.SORTS.protein.compare(a, b))[0];
  const sortDefinition = productScreener.SORTS[sort];
  const sortedWinner = sortDefinition ? [...items].sort(sortDefinition.compare).find(sortDefinition.known) : null;
  const criterionLabels = {
    protein: 'Most protein screen', calories: 'Fewest calories screen', efficiency: 'Protein-per-calorie screen',
    price: 'Lowest seeded cost screen', name: 'Product-name screen'
  };
  const proof = {
    protein: product => `${numberLabel(product.protein, 'g')} protein is the highest known value shown.`,
    calories: product => `${numberLabel(product.calories)} calories is the lowest known value shown.`,
    efficiency: product => `${numberLabel(product.efficiency)}g protein per 100 calories is the highest known value shown.`,
    price: product => `${money(product.pricePer25)} per 25g protein is the lowest known value shown.`,
    name: product => `${textLabel(product.name)} appears first under the active product-name sort.`
  };
  const activeCriterion = sortedWinner && criterionLabels[sort] ? { product: sortedWinner, label: criterionLabels[sort], proof: proof[sort] } : null;
  const product = activeCriterion?.product || balanced;
  const wins = winsFor(product);
  const evidence = wins.map(metric => metric.label);
  const explanation = activeCriterion
    ? `${activeCriterion.proof(product)} It wins ${wins.length} of ${metricDefinitions.length} visible metrics overall.`
    : `${textLabel(product.name)} wins ${wins.length} of ${metricDefinitions.length} visible metrics${evidence.length ? `: ${evidence.join(', ')}` : '.'}`;
  return { product, label: activeCriterion?.label || 'Visible-metric winner', explanation, evidence, metrics: metricDefinitions };
}

function renderCompare() {
  const items = [...state.compare].map(byId).filter(Boolean);
  const compareContext = state.compareContext?.origin === 'screener'
    ? { origin: 'screener', sort: productScreener.SORTS[state.compareContext.sort] ? state.compareContext.sort : 'protein' }
    : { origin: 'discover', sort: state.compareContext?.sort || 'recommended' };
  const backHref = `#${compareContext.origin}`;
  const backLabel = compareContext.origin === 'screener' ? 'Back to Screener' : 'Back to Discover';
  if (items.length < 2) {
    app.innerHTML = `<section class="screen" data-screen="compare"><a class="detail-back" href="${backHref}">← ${backLabel}</a><div class="empty-card"><span class="state-icon">⇄</span><h1 id="screenTitle">Choose at least two</h1><p>Select up to three products to compare protein, calories, value, store, and trade-offs without tab hopping.</p><a class="primary" href="${backHref}">Choose products</a></div></section>`;
    return;
  }
  const knownProtein = items.map(product => product.protein).filter(Number.isFinite);
  const knownCalories = items.map(product => product.calories).filter(Number.isFinite);
  const knownEfficiency = items.map(product => product.efficiency).filter(Number.isFinite);
  const highestProtein = knownProtein.length ? Math.max(...knownProtein) : null;
  const lowestCalories = knownCalories.length ? Math.min(...knownCalories) : null;
  const highestEfficiency = knownEfficiency.length ? Math.max(...knownEfficiency) : null;
  const knownValues = items.filter(hasKnownPrice).map(product => product.pricePer25);
  const lowestValue = knownValues.length ? Math.min(...knownValues) : null;
  const decision = comparisonDecision(items, compareContext.sort);
  const recommended = decision.product;
  const matrixRow = (label, value, winner) => `<div class="compare-matrix-row"><b>${label}</b>${items.map(product => `<span ${winner(product) ? 'data-winner="true"' : ''}>${value(product)}${winner(product) ? '<i>Best</i>' : ''}</span>`).join('')}</div>`;
  app.innerHTML = `<section class="screen compare-screen" data-screen="compare"><a class="detail-back" href="${backHref}">← ${backLabel}</a>${screenHead('Side-by-side decision', 'Pick the basket winner', compareContext.origin === 'screener' ? 'Recommendation follows your active Screener ranking; exact product detail follows.' : 'A phone-sized decision summary first; exact product detail follows without a hidden sideways gesture.')}<aside class="compare-recommendation" data-recommendation-id="${escapeHtml(recommended.id)}" data-recommendation-goal="${escapeHtml(compareContext.sort)}"><span>${escapeHtml(decision.label)}</span><h2>${escapeHtml(textLabel(recommended.name))}</h2><p>${escapeHtml(decision.explanation)}</p><div class="recommendation-evidence" aria-label="Visible metric wins">${decision.evidence.map(metric => `<b>Best ${escapeHtml(metric)}</b>`).join('')}</div><a class="primary" href="#product/${escapeHtml(recommended.id)}">Review recommendation</a></aside><div class="compare-matrix" style="--compare-count:${items.length}"><div class="compare-matrix-head"><b>Metric</b>${items.map(product => `<a href="#product/${escapeHtml(product.id)}">${escapeHtml(textLabel(product.name))}</a>`).join('')}</div>${matrixRow('Protein', product => numberLabel(product.protein, 'g'), product => highestProtein !== null && product.protein === highestProtein)}${matrixRow('Calories', product => numberLabel(product.calories), product => lowestCalories !== null && product.calories === lowestCalories)}${matrixRow('Value / 25g', product => hasKnownPrice(product) ? money(product.pricePer25) : 'Unknown', product => lowestValue !== null && product.pricePer25 === lowestValue)}${matrixRow('Efficiency', product => numberLabel(product.efficiency), product => highestEfficiency !== null && product.efficiency === highestEfficiency)}</div><div class="compare-pick-list">${items.map(product => `<article class="compare-pick" data-compare-product="${escapeHtml(product.id)}"><button type="button" data-compare="${escapeHtml(product.id)}" aria-label="Remove ${escapeHtml(textLabel(product.name))} from comparison">×</button><a class="compare-thumb" href="#product/${escapeHtml(product.id)}" aria-label="Open ${escapeHtml(textLabel(product.name))} details">${imageMarkup(product)}</a><div class="compare-pick-copy"><p class="eyebrow">${escapeHtml(productVerdict(product))}</p><h2><a href="#product/${escapeHtml(product.id)}">${escapeHtml(textLabel(product.name))}</a></h2><p>${escapeHtml(textLabel(product.brand))} · ${escapeHtml(product.stores?.[0] || 'Store unknown')}</p><dl><div><dt>Best use</dt><dd>${escapeHtml(textLabel(product.use))}</dd></div><div><dt>Trade-off</dt><dd>${escapeHtml(textLabel(product.tradeoff))}</dd></div></dl><button class="primary" type="button" data-add="${escapeHtml(product.id)}" ${state.basket.includes(product.id) ? 'disabled' : ''}>${state.basket.includes(product.id) ? 'In basket' : 'Choose this'}</button></div></article>`).join('')}</div><aside class="compare-footnote">Best labels compare only these selected seeded records. Price and inventory are not live.</aside></section>`;
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
  const previousRoute = currentRoute;
  const nextRoute = parseRoute();
  const sameRoute = previousRoute && routeKey(previousRoute) === routeKey(nextRoute);
  const restoredScroll = sameRoute ? scrollY : (state.scroll[routeKey(nextRoute)] || 0);
  currentRoute = nextRoute;
  const renderedRoute = nextRoute;
  document.querySelectorAll('[data-tab]').forEach(tab => tab.setAttribute('aria-current', tab.dataset.tab === currentRoute.name ? 'page' : 'false'));
  document.querySelector('[data-header-saved]')?.setAttribute('aria-current', currentRoute.name === 'saved' ? 'page' : 'false');
  if (currentRoute.name === 'discover') renderDiscover();
  else if (currentRoute.name === 'screener') renderScreener();
  else if (currentRoute.name === 'nearby') renderNearby();
  else if (currentRoute.name === 'ask') renderAsk();
  else if (currentRoute.name === 'saved') renderSaved();
  else if (currentRoute.name === 'basket') renderBasket();
  else if (currentRoute.name === 'compare') renderCompare();
  else renderProduct(currentRoute.id);
  updateCounts();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (routeKey(currentRoute) === routeKey(renderedRoute)) scrollTo(0, restoredScroll);
  }));
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
  if (event.target.id === 'screenCategory') { state.screener = { ...state.screener, category: event.target.value }; state.screenerPage = 1; persist(); renderScreener(); }
  if (event.target.id === 'screenMinProtein') { state.screener = { ...state.screener, minProtein: event.target.value }; state.screenerPage = 1; persist(); renderScreener(); }
  if (event.target.id === 'screenMaxCalories') { state.screener = { ...state.screener, maxCalories: event.target.value }; state.screenerPage = 1; persist(); renderScreener(); }
  if (event.target.id === 'screenPrep') { state.screener = { ...state.screener, prep: event.target.value }; state.screenerPage = 1; persist(); renderScreener(); }
  if (event.target.id === 'screenSort') { state.screener = { ...state.screener, sort: event.target.value }; state.screenerPage = 1; persist(); renderScreener(); }
  if (event.target.matches('[data-screen-exclusion]')) {
    const key = event.target.dataset.screenExclusion;
    const exclusions = new Set(state.screener.exclusions);
    event.target.checked ? exclusions.add(key) : exclusions.delete(key);
    state.screener = { ...state.screener, exclusions: [...exclusions] };
    state.screenerPage = 1;
    persist(); renderScreener();
  }
});

document.addEventListener('toggle', event => {
  if (event.target.id === 'screenBuilder') state.screenerBuilderOpen = event.target.open;
}, true);

document.addEventListener('submit', event => {
  if (event.target.id === 'locationForm') {
    event.preventDefault();
    const center = locationData.findZipCenter(new FormData(event.target).get('zip'));
    if (center) setLocation(center);
    else {
      state.locationStatus = 'denied';
      state.locationMessage = 'That ZIP is outside this demo. Try 94404, 95113, 95129, or 95014.';
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
  const compare = event.target.closest('[data-compare]');
  if (compare) {
    event.stopPropagation();
    captureDecisionContext();
    const id = compare.dataset.compare;
    const product = byId(id);
    if (state.compare.has(id)) state.compare.delete(id);
    else if (state.compare.size < 3) state.compare.add(id);
    else { showToast('Compare up to three products. Remove one to add another.'); return; }
    persist(); render();
    showToast(`${product?.name || 'Product'} ${state.compare.has(id) ? 'added to' : 'removed from'} comparison`);
    return;
  }
  const clearCompare = event.target.closest('[data-clear-compare]');
  if (clearCompare) { state.compare.clear(); persist(); render(); showToast('Comparison cleared'); return; }
  const screenTemplate = event.target.closest('[data-screen-template]');
  if (screenTemplate) { state.screener = productScreener.applyTemplate(screenTemplate.dataset.screenTemplate, screenerCategories()); state.screenerPage = 1; persist(); renderScreener(); liveRegion.textContent = `${screenTemplate.textContent} screen applied`; return; }
  const screenReset = event.target.closest('[data-screen-reset]');
  if (screenReset) { state.screener = productScreener.normalize({}, screenerCategories()); state.screenerPage = 1; persist(); renderScreener(); liveRegion.textContent = 'Screen cleared'; return; }
  const screenPage = event.target.closest('[data-screen-page]');
  if (screenPage) {
    state.screenerPage = Number(screenPage.dataset.screenPage);
    persist(); renderScreener();
    requestAnimationFrame(() => document.querySelector('.screen-output')?.scrollIntoView({ block: 'start' }));
    return;
  }
  const removeScreenClause = event.target.closest('[data-remove-screen-clause]');
  if (removeScreenClause) {
    const key = removeScreenClause.dataset.removeScreenClause;
    if (key.startsWith('exclude:')) state.screener = { ...state.screener, exclusions: state.screener.exclusions.filter(item => item !== key.slice(8)) };
    else if (key === 'category') state.screener = { ...state.screener, category: 'All groceries' };
    else if (key === 'prep') state.screener = { ...state.screener, prep: 'all' };
    else state.screener = { ...state.screener, [key]: null };
    state.screenerPage = 1;
    persist(); renderScreener(); return;
  }
  const quickSort = event.target.closest('[data-quick-sort]');
  if (quickSort) {
    state.sort = quickSort.dataset.quickSort;
    persist(); renderDiscover();
    liveRegion.textContent = `Shelf sorted by ${quickSort.textContent.toLowerCase()}`;
    return;
  }
  const reportSighting = event.target.closest('[data-report-sighting]');
  if (reportSighting) {
    const [productId, storeId] = reportSighting.dataset.reportSighting.split(':');
    const product = byId(productId);
    const validStore = locationData.STORES.some(store => store.id === storeId);
    if (!product?.exactSku?.retailerHandoffs?.some(handoff => handoff.storeId === storeId) || !validStore) return;
    state.sightings[`${productId}:${storeId}`] = { productId, storeId, reportedAt: new Date().toISOString(), status: 'pending-local' };
    persist(); renderProduct(productId);
    liveRegion.textContent = 'Pending report saved only on this device. It does not confirm inventory.';
    return;
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
  if (recenter && nearbyMap) { const center = state.location || locationData.ZIP_CENTERS['94404']; nearbyMap.setView([center.lat, center.lon], 12); return; }
  const searchHere = event.target.closest('[data-search-here]');
  if (searchHere) { setLocation({ ...state.mapCenter, label: 'Searched map area' }); return; }
  const card = event.target.closest('[data-product-id]');
  if (card) { captureDecisionContext(); persist(); navigate(`#product/${card.dataset.productId}`); return; }
  const localLink = event.target.closest('a[href^="#"]');
  if (localLink) { event.preventDefault(); captureDecisionContext(); persist(); navigate(localLink.getAttribute('href')); }
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