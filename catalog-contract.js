'use strict';

const CATALOG_VERSION = 'protein-finds.catalog.v0';
const VERIFICATION_STATES = Object.freeze([
  'unverified',
  'source-backed',
  'conflict',
  'stale',
  'rejected'
]);
const OBSERVATION_FIELDS = Object.freeze([
  'nutrition',
  'ingredients',
  'price',
  'availability'
]);
const SCORE_AXIS_NAMES = Object.freeze([
  'proteinEfficiency',
  'value',
  'proteinQuality',
  'foodQuality',
  'personalFit',
  'convenience'
]);

const clamp = number => Math.max(0, Math.min(100, number));
const rounded = number => Math.round(number * 10) / 10;
const isFiniteNonNegative = value => Number.isFinite(value) && value >= 0;
const known = (score, inputs, formula, explanation) => ({
  score: rounded(clamp(score)),
  status: 'scored',
  inputs,
  formula,
  explanation
});
const unknown = (inputs, formula, explanation) => ({
  score: null,
  status: 'unknown',
  inputs,
  formula,
  explanation
});

function scoreProteinEfficiency(input) {
  const inputs = {proteinG: input.proteinG ?? null, calories: input.calories ?? null};
  const formula = 'clamp((proteinG / calories * 100) / 20 * 100, 0, 100)';
  if (!isFiniteNonNegative(input.proteinG) || !Number.isFinite(input.calories) || input.calories <= 0) {
    return unknown(inputs, formula, 'Protein and positive calorie observations are required.');
  }
  const gramsPer100Calories = input.proteinG / input.calories * 100;
  return known(
    gramsPer100Calories / 20 * 100,
    {...inputs, gramsPer100Calories: rounded(gramsPer100Calories)},
    formula,
    `${rounded(gramsPer100Calories)} g protein per 100 calories; 20 g/100 cal maps to 100.`
  );
}

function scoreValue(input) {
  const inputs = {
    proteinG: input.proteinG ?? null,
    priceAmount: input.priceAmount ?? null,
    currency: input.currency ?? null
  };
  const formula = 'clamp(100 - (priceAmount / proteinG * 25) * 6.4, 0, 100)';
  if (!Number.isFinite(input.proteinG) || input.proteinG <= 0 || !isFiniteNonNegative(input.priceAmount) || !input.currency) {
    return unknown(inputs, formula, 'Protein, non-negative price, and currency observations are required.');
  }
  const pricePer25G = input.priceAmount / input.proteinG * 25;
  return known(
    100 - pricePer25G * 6.4,
    {...inputs, pricePer25G: rounded(pricePer25G)},
    formula,
    `${rounded(pricePer25G)} ${input.currency} per 25 g protein; lower cost scores higher.`
  );
}

function scoreProteinQuality(input) {
  const inputs = {proteinQuality: input.proteinQuality ?? null};
  const formula = 'complete=100; complementary=75; incomplete=50; unknown=null';
  const scores = {complete: 100, complementary: 75, incomplete: 50};
  if (!Object.hasOwn(scores, input.proteinQuality)) {
    return unknown(inputs, formula, 'A sourced protein-quality classification is required.');
  }
  return known(scores[input.proteinQuality], inputs, formula, `${input.proteinQuality} protein-quality classification.`);
}

function scoreFoodQuality(input) {
  const inputs = {
    processingLevel: input.processingLevel ?? null,
    fiberG: input.fiberG ?? null,
    sodiumMg: input.sodiumMg ?? null
  };
  const formula = 'processing base + min(fiberG,10)*2 - max(sodiumMg-300,0)/30; clamp 0..100';
  const processingBase = {
    'whole-food': 80,
    'minimally-processed': 75,
    processed: 55,
    'ultra-processed': 35
  };
  if (!Object.hasOwn(processingBase, input.processingLevel) || !isFiniteNonNegative(input.fiberG) || !isFiniteNonNegative(input.sodiumMg)) {
    return unknown(inputs, formula, 'Processing level, fiber, and sodium observations are all required.');
  }
  const fiberBonus = Math.min(input.fiberG, 10) * 2;
  const sodiumPenalty = Math.max(input.sodiumMg - 300, 0) / 30;
  return known(
    processingBase[input.processingLevel] + fiberBonus - sodiumPenalty,
    {...inputs, processingBase: processingBase[input.processingLevel], fiberBonus: rounded(fiberBonus), sodiumPenalty: rounded(sodiumPenalty)},
    formula,
    `Processing base ${processingBase[input.processingLevel]}, fiber +${rounded(fiberBonus)}, sodium -${rounded(sodiumPenalty)}.`
  );
}

function scorePersonalFit(input) {
  const inputs = {
    dietaryTags: Array.isArray(input.dietaryTags) ? [...input.dietaryTags].sort() : null,
    requiredTags: Array.isArray(input.requiredTags) ? [...input.requiredTags].sort() : null,
    excludedTags: Array.isArray(input.excludedTags) ? [...input.excludedTags].sort() : null
  };
  const formula = '100 when every required tag is present and no excluded tag is present; otherwise 0';
  if (!inputs.dietaryTags || !inputs.requiredTags || !inputs.excludedTags) {
    return unknown(inputs, formula, 'Product tags plus explicit required and excluded preferences are required.');
  }
  const tags = new Set(inputs.dietaryTags);
  const missing = inputs.requiredTags.filter(tag => !tags.has(tag));
  const conflicts = inputs.excludedTags.filter(tag => tags.has(tag));
  const score = missing.length || conflicts.length ? 0 : 100;
  return known(score, {...inputs, missing, conflicts}, formula, score ? 'All explicit dietary constraints match.' : 'One or more explicit dietary constraints fail.');
}

function scoreConvenience(input) {
  const inputs = {prepMinutes: input.prepMinutes ?? null, availability: input.availability ?? null};
  const formula = 'prep: <=0 100, <=5 90, <=15 70, <=30 50, >30 25; limited-stock -15; clamp 0..100';
  if (!isFiniteNonNegative(input.prepMinutes) || !['in-stock', 'limited-stock', 'out-of-stock'].includes(input.availability)) {
    return unknown(inputs, formula, 'Preparation time and a current availability observation are required.');
  }
  const prepScore = input.prepMinutes <= 0 ? 100 : input.prepMinutes <= 5 ? 90 : input.prepMinutes <= 15 ? 70 : input.prepMinutes <= 30 ? 50 : 25;
  const availabilityAdjustment = input.availability === 'in-stock' ? 0 : input.availability === 'limited-stock' ? -15 : -100;
  return known(
    prepScore + availabilityAdjustment,
    {...inputs, prepScore, availabilityAdjustment},
    formula,
    `Preparation contributes ${prepScore}; ${input.availability} adjusts by ${availabilityAdjustment}.`
  );
}

function scoreAxes(input = {}) {
  return {
    proteinEfficiency: scoreProteinEfficiency(input),
    value: scoreValue(input),
    proteinQuality: scoreProteinQuality(input),
    foodQuality: scoreFoodQuality(input),
    personalFit: scorePersonalFit(input),
    convenience: scoreConvenience(input)
  };
}

function rankCatalog(candidates, weights) {
  if (!weights || typeof weights !== 'object') throw new TypeError('Explicit score-axis weights are required.');
  const entries = Object.entries(weights);
  if (!entries.length || entries.some(([axis, weight]) => !SCORE_AXIS_NAMES.includes(axis) || !Number.isFinite(weight) || weight < 0)) {
    throw new TypeError('Weights must name score axes and contain finite non-negative numbers.');
  }
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (totalWeight <= 0) throw new TypeError('At least one score-axis weight must be positive.');

  return candidates.map(candidate => {
    const axes = scoreAxes(candidate.input);
    let availableWeight = 0;
    let weightedTotal = 0;
    for (const [axis, weight] of entries) {
      if (axes[axis].score !== null) {
        availableWeight += weight;
        weightedTotal += axes[axis].score * weight;
      }
    }
    return {
      id: candidate.id,
      weightedScore: availableWeight ? rounded(weightedTotal / availableWeight) : null,
      coverage: rounded(availableWeight / totalWeight),
      axes
    };
  }).sort((left, right) => {
    if (left.weightedScore === null && right.weightedScore === null) return left.id.localeCompare(right.id);
    if (left.weightedScore === null) return 1;
    if (right.weightedScore === null) return -1;
    return right.weightedScore - left.weightedScore || right.coverage - left.coverage || left.id.localeCompare(right.id);
  });
}

function validateCatalog(catalog) {
  const errors = [];
  if (!catalog || typeof catalog !== 'object') return ['catalog must be an object'];
  if (catalog.version !== CATALOG_VERSION) errors.push(`version must equal ${CATALOG_VERSION}`);
  for (const collection of ['products', 'stores', 'sources', 'observations', 'conflicts']) {
    if (!Array.isArray(catalog[collection])) errors.push(`${collection} must be an array`);
  }
  if (errors.some(error => error.endsWith('must be an array'))) return errors;

  const uniqueIds = (items, collection) => {
    const ids = new Set();
    for (const [index, item] of items.entries()) {
      if (!item || typeof item.id !== 'string' || !item.id) errors.push(`${collection}[${index}] requires id`);
      else if (ids.has(item.id)) errors.push(`${collection} contains duplicate id ${item.id}`);
      else ids.add(item.id);
    }
    return ids;
  };
  const productIds = uniqueIds(catalog.products, 'products');
  const storeIds = uniqueIds(catalog.stores, 'stores');
  const sourceIds = uniqueIds(catalog.sources, 'sources');
  const observationIds = uniqueIds(catalog.observations, 'observations');
  uniqueIds(catalog.conflicts, 'conflicts');

  for (const store of catalog.stores) {
    if (!store || !store.id) continue;
    if (!store.name || !store.kind) errors.push(`store ${store.id} requires name and kind`);
    if (!store.location || typeof store.location !== 'object') errors.push(`store ${store.id} requires location`);
  }

  for (const source of catalog.sources) {
    if (!source || !source.id) continue;
    if (!source.kind || !source.title || !source.publisher) errors.push(`source ${source.id} requires kind, title, and publisher`);
    if (!source.locator) errors.push(`source ${source.id} requires locator`);
    if (!source.accessedAt || Number.isNaN(Date.parse(source.accessedAt))) errors.push(`source ${source.id} requires ISO accessedAt`);
  }

  for (const product of catalog.products) {
    if (!product || !product.id) continue;
    for (const forbidden of ['nutrition', 'ingredients', 'price', 'availability']) {
      if (Object.hasOwn(product, forbidden)) errors.push(`product ${product.id} must not embed ${forbidden}; use observations`);
    }
    if (!['packaged', 'whole-food'].includes(product.kind)) errors.push(`product ${product.id} has invalid kind`);
    if (!product.identity || typeof product.identity !== 'object') errors.push(`product ${product.id} requires identity`);
    if (!product.images || !['front', 'nutrition', 'ingredients'].every(slot => product.images[slot])) {
      errors.push(`product ${product.id} requires front, nutrition, and ingredients image contracts`);
    } else {
      for (const [slot, image] of Object.entries(product.images)) {
        if (!['needed', 'verified'].includes(image.status)) errors.push(`product ${product.id} image ${slot} has invalid status`);
        if (image.status === 'verified' && (!image.sourceId || !sourceIds.has(image.sourceId) || !image.license || image.license === 'unknown' || image.exactPackage !== true)) {
          errors.push(`product ${product.id} verified image ${slot} requires source, license, and exactPackage=true`);
        }
      }
    }
  }

  for (const observation of catalog.observations) {
    if (!observation || !observation.id) continue;
    if (!productIds.has(observation.productId)) errors.push(`observation ${observation.id} references unknown product`);
    if (!sourceIds.has(observation.sourceId)) errors.push(`observation ${observation.id} references unknown source`);
    if (!OBSERVATION_FIELDS.includes(observation.field)) errors.push(`observation ${observation.id} has invalid field`);
    if (!VERIFICATION_STATES.includes(observation.verificationState)) errors.push(`observation ${observation.id} has invalid verificationState`);
    if (!observation.observedAt || Number.isNaN(Date.parse(observation.observedAt))) errors.push(`observation ${observation.id} requires ISO observedAt`);
    if (['price', 'availability'].includes(observation.field) && !observation.storeId) errors.push(`${observation.field} observations require storeId (${observation.id})`);
    if (observation.storeId && !storeIds.has(observation.storeId)) errors.push(`observation ${observation.id} references unknown store`);
    if (observation.value === undefined) errors.push(`observation ${observation.id} requires value`);
  }

  const observationsById = new Map(catalog.observations.map(observation => [observation.id, observation]));
  for (const conflict of catalog.conflicts) {
    if (!conflict || !conflict.id) continue;
    if (!Array.isArray(conflict.observationIds) || conflict.observationIds.length < 2) errors.push(`conflict ${conflict.id} requires at least two observations`);
    else if (conflict.observationIds.some(id => !observationIds.has(id))) errors.push(`conflict ${conflict.id} references unknown observation`);
    else {
      const observations = conflict.observationIds.map(id => observationsById.get(id));
      if (observations.some(observation => observation.productId !== conflict.productId || !conflict.field.startsWith(observation.field))) {
        errors.push(`conflict ${conflict.id} must reference one product and field`);
      }
    }
    if (conflict.status !== 'open') errors.push(`conflict ${conflict.id} must remain open until reviewed`);
  }
  return errors;
}

module.exports = {
  CATALOG_VERSION,
  VERIFICATION_STATES,
  OBSERVATION_FIELDS,
  SCORE_AXIS_NAMES,
  validateCatalog,
  scoreAxes,
  rankCatalog
};
