'use strict';

(function expose(factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.AskProtein = api;
})(function buildAskProtein() {
  const tripGroups = [
    {key:'main', label:'main protein', categories:['Plant meat','Egg']},
    {key:'breakfast', label:'breakfast option', categories:['Breakfast','Wraps & breads']},
    {key:'dairy-drink', label:'dairy or drink', categories:['Dairy','Milk & shakes']},
    {key:'snack', label:'snack', categories:['Snack']}
  ];

  const normalizedTokens = query => String(query || '').trim().toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || [];

  function planAsk(query) {
    const tokens = normalizedTokens(query);
    const text = tokens.join(' ');
    if (/\b(improve|fix|complete|round out)\b/.test(text) && /\bbasket\b/.test(text)) {
      return {intent:'basket-improvement', filters:{basket:'current'}, sort:'missing-category-fit', constraints:[], tokens};
    }
    if (/\bcereal\b/.test(text)) {
      return {intent:'discover', filters:{category:'Breakfast', text:'cereal'}, sort:'efficiency', constraints:[], tokens};
    }
    if (/\bsoy-free\b/.test(text) && /\bsnacks?\b/.test(text)) {
      return {intent:'discover', filters:{useCase:'snack'}, sort:'recommended', constraints:['soyFree'], tokens};
    }
    if (/\bcheap\b/.test(text) && /\bbreakfast\b/.test(text) && /\bprotein\b/.test(text)) {
      return {intent:'discover', filters:{useCase:'breakfast'}, sort:'pricePer25', constraints:[], tokens};
    }
    return {intent:'unsupported', filters:{}, sort:null, constraints:[], tokens};
  }

  const knownPrice = product => product.availability !== 'demo-unavailable' && Number.isFinite(product.price) && Number.isFinite(product.servings) && product.servings > 0;
  const score = product => Number(product.efficiency || 0) * 5 + Number(product.protein || 0) * 1.5 - (Number.isFinite(product.pricePer25) ? product.pricePer25 : 0) + (product.role === 'anchor' ? 12 : 0);
  const safeStore = product => Array.isArray(product.stores) && product.stores.length ? `${product.stores[0]} (seeded; not location availability)` : 'Store unknown';
  const freshness = product => product.verified ? `Seeded ${product.verified}; not live` : 'Freshness unknown';
  const availability = product => product.availability === 'demo-unavailable' ? 'Availability unknown; demo marks this unavailable' : 'Availability unknown; no live stock check';
  const price = product => knownPrice(product) ? `$${Number(product.price / product.servings).toFixed(2)} seeded / serving; not live` : 'Price unknown';

  function citations(product, plan) {
    const fields = ['protein','calories'];
    if (plan.sort === 'pricePer25') fields.push('pricePer25');
    if (plan.sort === 'efficiency') fields.push('efficiency');
    if (plan.filters.category) fields.push('category');
    if (plan.filters.useCase) fields.push('useCases');
    for (const constraint of plan.constraints) fields.push(constraint);
    fields.push('stores','availability','verified');
    return [...new Set(fields)].filter(field => Object.hasOwn(product, field)).map(field => ({field, value:product[field]}));
  }

  function recommendation(product, plan, reason) {
    return {
      productId: product.id,
      reason,
      citations: citations(product, plan),
      facts: {protein:`${product.protein}g`, calories:`${product.calories}`, price:price(product), store:safeStore(product), freshness:freshness(product), availability:availability(product)}
    };
  }

  function discover(products, plan) {
    let candidates = products.filter(product => {
      if (!product || typeof product.id !== 'string') return false;
      if (plan.filters.category && product.category !== plan.filters.category) return false;
      if (plan.filters.text && ![product.name, product.brand, product.category].join(' ').toLowerCase().includes(plan.filters.text)) return false;
      if (plan.filters.useCase && (!Array.isArray(product.useCases) || !product.useCases.includes(plan.filters.useCase))) return false;
      return plan.constraints.every(constraint => product[constraint] === true);
    });
    const sorters = {
      pricePer25: (left, right) => Number(!knownPrice(left)) - Number(!knownPrice(right)) || Number(left.pricePer25 ?? Infinity) - Number(right.pricePer25 ?? Infinity) || left.id.localeCompare(right.id),
      efficiency: (left, right) => Number(right.efficiency || 0) - Number(left.efficiency || 0) || left.id.localeCompare(right.id),
      recommended: (left, right) => Number(right.category === 'Snack') - Number(left.category === 'Snack') || score(right) - score(left) || left.id.localeCompare(right.id)
    };
    candidates = candidates.sort(sorters[plan.sort]).slice(0, 3);
    return candidates.map(product => recommendation(product, plan, plan.sort === 'pricePer25'
      ? `Lower seeded cost per 25g protein among matching breakfast records: ${product.pricePer25}.`
      : plan.sort === 'efficiency'
        ? `Higher protein efficiency among matching cereal records: ${product.efficiency}g per 100 calories.`
        : `Matches snack use and soy-free catalog fields; ranked by category fit and protein return.`));
  }

  function improveBasket(products, basketIds, plan) {
    const ids = new Set(products.filter(product => product && typeof product.id === 'string').map(product => product.id));
    const basketContext = [...new Set((Array.isArray(basketIds) ? basketIds : []).filter(id => ids.has(id)))];
    const basket = basketContext.map(id => products.find(product => product.id === id));
    const missing = tripGroups.filter(group => !basket.some(product => group.categories.includes(product.category)));
    const recommendations = [];
    for (const group of missing) {
      const candidate = products.filter(product => !basketContext.includes(product.id) && group.categories.includes(product.category))
        .sort((left, right) => score(right) - score(left) || left.id.localeCompare(right.id))[0];
      if (candidate) recommendations.push(recommendation(candidate, plan, `Adds a catalog ${group.label}, which is missing from the current basket.`));
    }
    return {basketContext, missing, recommendations:recommendations.slice(0, 3)};
  }

  function answerAsk({query, products = [], basketIds = []} = {}) {
    const queryPlan = planAsk(query);
    const base = {mode:'deterministic', queryPlan, basketContext:[], recommendations:[]};
    if (queryPlan.intent === 'unsupported') {
      return {...base, summary:'I could not map that request to a supported catalog filter. Ask for cheap breakfast protein, soy-free snacks, best protein cereal, or improve my basket.'};
    }
    if (queryPlan.intent === 'basket-improvement') {
      const result = improveBasket(products, basketIds, queryPlan);
      return {...base, basketContext:result.basketContext, recommendations:result.recommendations, summary:result.missing.length ? `Your basket is missing ${result.missing.map(group => group.label).join(', ')}.` : 'Your basket already covers the four demo trip categories.'};
    }
    const recommendations = discover(products, queryPlan);
    return {...base, recommendations, summary:recommendations.length ? `${recommendations.length} catalog-grounded ${recommendations.length === 1 ? 'match' : 'matches'}.` : 'No catalog record matches every parsed filter. Nothing was invented.'};
  }

  return { planAsk, answerAsk };
});
