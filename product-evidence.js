(function initializeEvidence(global) {
  'use strict';
  const exclusions = { soy: 'soyFree', dairy: 'dairyFree', gluten: 'glutenFree', stevia: 'steviaFree', egg: 'eggFree' };
  const aliases = { dairy: ['dairy', 'milk', 'whey', 'casein', 'cream', 'cheese'], gluten: ['gluten', 'wheat', 'barley', 'rye'], soy: ['soy'], egg: ['egg'], stevia: ['stevia'] };
  const canonical = value => ({ milk: 'dairy', wheat: 'gluten', eggs: 'egg' }[String(value).toLowerCase()] || String(value).toLowerCase());
  function exclusionState(product, allergen, now = Date.now()) {
    const key = canonical(allergen);
    const declarations = product.exactSku?.allergens || [];
    const tokens = aliases[key] || [key];
    const hits = declarations.filter(value => tokens.some(token => String(value).toLowerCase().split(/[^a-z0-9]+/).includes(token)));
    if (hits.some(value => !/may contain|processed with|equipment/i.test(value))) return 'contains';
    if (hits.length) return 'may_contain';
    const evidence = product.exclusionEvidence?.[key];
    if (['contains', 'may_contain'].includes(evidence?.state)) return evidence.state;
    const observed = Date.parse(evidence?.observedAt), expires = Date.parse(evidence?.expiresAt);
    if (evidence?.state === 'free' && evidence.verificationState === 'source-backed' &&
        evidence.productId === product.id && /^\d{8,14}$/.test(product.exactSku?.upc || '') && evidence.upc === product.exactSku.upc &&
        /^https:\/\//.test(evidence.sourceUrl || '') && Number.isFinite(observed) &&
        observed <= now && Number.isFinite(expires) && expires > now) return 'free';
    return 'unknown';
  }
  function exclusionPass(product, allergen, now = Date.now()) { return exclusionState(product, allergen, now) === 'free'; }
  function safeFlags(product) {
    const result = { ...product };
    for (const [key, field] of Object.entries(exclusions)) {
      const state = exclusionState(product, key);
      result[field] = state === 'free' ? true : state === 'unknown' ? null : false;
    }
    return result;
  }
  function consumerProduct(product) {
    const sku = product.exactSku;
    return { ...safeFlags(product), price: null, pricePer25: null, ingredients: null,
      blurb: 'A documented package from our limited catalog. Nutrition shown is historical, not a reverified current label.',
      tradeoff: 'Check the physical label for current ingredients and allergen warnings. Store price and stock are unknown.',
      stores: [...new Set((sku?.retailerHandoffs || []).map(h => h.retailer))],
      availability: 'unknown', availabilityLabel: 'Store stock not checked',
      ingredientStatus: 'Ingredients not verified for this exact package',
      fieldEvidence: {
        package: { status: 'documented', upc: sku?.upc, sourceUrl: product.image?.sourceUrl },
        image: { status: 'documented', sourceUrl: product.image?.sourceUrl, license: product.image?.license },
        nutrition: { status: 'historical-unverified', observedAt: product.verified, sourceUrl: sku?.nutritionSourceUrl, reason: 'Historical catalog values; exact panel not reverified' },
        ingredients: { status: 'unknown', reason: 'Seed transcription is not exact-package evidence' },
        price: { status: 'unknown', reason: 'No current store-specific observation' },
        availability: { status: 'unknown', reason: 'No current branch-specific observation' }
      }
    };
  }
  function audit(products) {
    return products.flatMap(product => Object.entries(exclusions).map(([allergen, field]) => ({
      productId: product.id, upc: product.exactSku?.upc || null, allergen, legacyFlag: product[field],
      declarations: product.exactSku?.allergens || [], state: exclusionState(product, allergen),
      passes: exclusionPass(product, allergen), contradiction: product[field] === true && ['contains', 'may_contain'].includes(exclusionState(product, allergen))
    })));
  }
  const api = Object.freeze({ exclusionState, exclusionPass, safeFlags, consumerProduct, audit });
  global.ProteinEvidence = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
