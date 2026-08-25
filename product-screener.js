(function initializeProductScreener(global) {
  'use strict';

  const SORTS = Object.freeze({
    protein: { label: 'Most protein', compare: (a, b) => b.protein - a.protein },
    calories: { label: 'Fewest calories', compare: (a, b) => a.calories - b.calories },
    efficiency: { label: 'Best protein for the calories', compare: (a, b) => b.efficiency - a.efficiency },
    price: {
      label: 'Lowest seeded cost per 25g',
      compare: (a, b) => Number(!hasKnownPrice(a)) - Number(!hasKnownPrice(b)) || a.pricePer25 - b.pricePer25
    },
    name: { label: 'Product name', compare: (a, b) => a.name.localeCompare(b.name) }
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

  function hasKnownPrice(product) {
    return product.availability !== 'demo-unavailable' && Number.isFinite(product.pricePer25);
  }

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
    if (screen.prep === 'heat' && product.prep === 'Ready now') return false;
    return screen.exclusions.every(key => product[EXCLUSIONS[key].field] === true);
  }

  function run(products, input) {
    const categories = [...new Set(products.map(product => product.category))];
    const screen = normalize(input, categories);
    const results = products.filter(product => matches(product, screen));
    results.sort((a, b) => SORTS[screen.sort].compare(a, b) || a.name.localeCompare(b.name));
    return { screen, results, total: products.length, unknownPriceCount: results.filter(product => !hasKnownPrice(product)).length };
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
    SORTS, EXCLUSIONS, TEMPLATES, DEFAULT_SCREEN, normalize, run, clauses, applyTemplate, hasKnownPrice
  });
})(typeof window === 'undefined' ? globalThis : window);
