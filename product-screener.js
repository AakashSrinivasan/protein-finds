(function initializeProductScreener(global) {
  'use strict';

  function hasKnownText(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function compareKnown(a, b, known, value, direction) {
    const aKnown = known(a);
    const bKnown = known(b);
    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    if (!aKnown) return 0;
    const difference = value(a) - value(b);
    return direction === 'desc' ? -difference : difference;
  }

  function compareNumber(field, direction) {
    return (a, b) => compareKnown(a, b, product => Number.isFinite(product[field]), product => product[field], direction);
  }

  function compareText(field) {
    return (a, b) => {
      const aKnown = hasKnownText(a[field]);
      const bKnown = hasKnownText(b[field]);
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      if (!aKnown) return 0;
      return a[field].localeCompare(b[field]);
    };
  }

  function hasKnownPrice(product) {
    return product.availability !== 'demo-unavailable' && Number.isFinite(product.pricePer25);
  }

  const SORTS = Object.freeze({
    protein: { label: 'Most protein', known: product => Number.isFinite(product.protein), compare: compareNumber('protein', 'desc') },
    calories: { label: 'Fewest calories', known: product => Number.isFinite(product.calories), compare: compareNumber('calories', 'asc') },
    efficiency: { label: 'Protein per calorie', known: product => Number.isFinite(product.efficiency), compare: compareNumber('efficiency', 'desc') },
    price: { label: 'Seeded cost / 25g', known: hasKnownPrice, compare: (a, b) => compareKnown(a, b, hasKnownPrice, product => product.pricePer25, 'asc') },
    name: { label: 'Product name', known: product => hasKnownText(product.name), compare: compareText('name') }
  });

  const EXCLUSIONS = Object.freeze({
    soy: { label: 'Soy-free', field: 'soyFree' },
    dairy: { label: 'Dairy-free', field: 'dairyFree' },
    gluten: { label: 'Gluten-free', field: 'glutenFree' },
    stevia: { label: 'No stevia', field: 'steviaFree' }
  });

  const TEMPLATES = Object.freeze({
    'high-protein': { category: 'All groceries', minProtein: 20, maxCalories: 200, exclusions: [], prep: 'all', sort: 'protein' },
    'soy-free': { category: 'All groceries', minProtein: null, maxCalories: null, exclusions: ['soy'], prep: 'all', sort: 'efficiency' },
    'ready-now': { category: 'All groceries', minProtein: 10, maxCalories: null, exclusions: [], prep: 'ready', sort: 'protein' }
  });

  const DEFAULT_SCREEN = Object.freeze({
    category: 'All groceries',
    minProtein: null,
    maxCalories: null,
    exclusions: [],
    prep: 'all',
    sort: 'protein'
  });

  const toThreshold = value => {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  };

  function normalize(screen, categories = []) {
    const source = screen || {};
    const allowedCategories = new Set(['All groceries', ...categories]);
    return {
      category: allowedCategories.has(source.category) ? source.category : DEFAULT_SCREEN.category,
      minProtein: toThreshold(source.minProtein),
      maxCalories: toThreshold(source.maxCalories),
      exclusions: [...new Set(Array.isArray(source.exclusions) ? source.exclusions.filter(key => EXCLUSIONS[key]) : [])],
      prep: ['all', 'ready', 'heat'].includes(source.prep) ? source.prep : DEFAULT_SCREEN.prep,
      sort: SORTS[source.sort] ? source.sort : DEFAULT_SCREEN.sort
    };
  }

  function matches(product, screen) {
    if (screen.category !== 'All groceries' && product.category !== screen.category) return false;
    if (screen.minProtein !== null && (!Number.isFinite(product.protein) || product.protein < screen.minProtein)) return false;
    if (screen.maxCalories !== null && (!Number.isFinite(product.calories) || product.calories > screen.maxCalories)) return false;
    if (screen.prep === 'ready' && product.prep !== 'Ready now') return false;
    if (screen.prep === 'heat' && !['Cook', 'Heat'].includes(product.prep)) return false;
    return screen.exclusions.every(key => product[EXCLUSIONS[key].field] === true);
  }

  function run(products, input) {
    const categories = [...new Set(products.map(product => product.category))];
    const screen = normalize(input, categories);
    const results = products.filter(product => matches(product, screen));
    results.sort((a, b) => SORTS[screen.sort].compare(a, b) || compareText('name')(a, b) || compareText('id')(a, b));
    return {
      screen,
      results,
      total: products.length,
      unknownPriceCount: results.filter(product => !hasKnownPrice(product)).length,
      unknownSortCount: results.filter(product => !SORTS[screen.sort].known(product)).length
    };
  }

  function paginate(results, requestedPage = 1, pageSize = 24) {
    const size = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 24;
    const pageCount = Math.max(1, Math.ceil(results.length / size));
    const requested = Number(requestedPage);
    const page = Math.min(pageCount, Math.max(1, Number.isInteger(requested) ? requested : 1));
    const offset = (page - 1) * size;
    const items = results.slice(offset, offset + size);
    return {
      items,
      page,
      pageCount,
      pageSize: size,
      totalResults: results.length,
      start: items.length ? offset + 1 : 0,
      end: offset + items.length
    };
  }

  function clauses(screen) {
    const list = [];
    if (screen.category !== 'All groceries') list.push({ key: 'category', label: `Type is ${screen.category}` });
    if (screen.minProtein !== null) list.push({ key: 'minProtein', label: `At least ${screen.minProtein}g protein` });
    if (screen.maxCalories !== null) list.push({ key: 'maxCalories', label: `No more than ${screen.maxCalories} calories` });
    screen.exclusions.forEach(key => list.push({ key: `exclude:${key}`, label: EXCLUSIONS[key].label }));
    if (screen.prep === 'ready') list.push({ key: 'prep', label: 'Ready to eat or drink now' });
    if (screen.prep === 'heat') list.push({ key: 'prep', label: 'Cooking or heating is okay' });
    return list;
  }

  function applyTemplate(name, categories = []) {
    return normalize(TEMPLATES[name] || DEFAULT_SCREEN, categories);
  }

  global.ProductScreener = Object.freeze({
    SORTS, EXCLUSIONS, TEMPLATES, DEFAULT_SCREEN, normalize, run, paginate, clauses, applyTemplate, hasKnownPrice
  });
})(typeof window === 'undefined' ? globalThis : window);
