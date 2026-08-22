'use strict';

const CATALOG_VERSION = 'protein-finds.catalog.v0';
const VERIFICATION_STATES = Object.freeze([
  'unverified',
  'source-backed',
  'conflict',
  'stale',
  'rejected'
]);
const OBSERVATION_FIELDS = Object.freeze(['nutrition', 'ingredients', 'price', 'availability']);
const MEDIA_ROLES = Object.freeze(['front', 'nutrition', 'ingredients']);
const SCORE_AXIS_NAMES = Object.freeze([
  'proteinEfficiency',
  'value',
  'proteinQuality',
  'foodQuality',
  'personalFit',
  'convenience'
]);
const PACKAGE_UNITS = Object.freeze(['g', 'kg', 'ml', 'l', 'fl-oz', 'oz', 'lb', 'count']);
const SERVING_UNITS = Object.freeze(['g', 'ml', 'oz', 'count']);
const V0_CURRENCIES = Object.freeze(['USD']);
const CONFLICT_FIELDS = new Set([
  'nutrition', 'nutrition.servingSize', 'nutrition.servingSize.value', 'nutrition.servingSize.unit',
  'nutrition.calories', 'nutrition.proteinG', 'nutrition.fiberG', 'nutrition.sodiumMg', 'nutrition.proteinQuality',
  'ingredients', 'ingredients.text', 'ingredients.normalized', 'ingredients.processingLevel',
  'price', 'price.amount', 'price.currency',
  'availability', 'availability.status'
]);

const clamp = number => Math.max(0, Math.min(100, number));
const rounded = number => Math.round(number * 10) / 10;
const isFiniteNonNegative = value => Number.isFinite(value) && value >= 0;
const isFinitePositive = value => Number.isFinite(value) && value > 0;
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = value => typeof value === 'string' && value.trim().length > 0;
const isNullableNonEmptyString = value => value === null || isNonEmptyString(value);
const hasOnlyKeys = (value, allowed) => isPlainObject(value) && Object.keys(value).every(key => allowed.includes(key));
const isStringArray = (value, {nonEmpty = false} = {}) => Array.isArray(value) && (!nonEmpty || value.length > 0) && value.every(isNonEmptyString);
const canonicalJson = value => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
};
const sameJson = (left, right) => JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));

function isStrictUtcTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  const canonical = new Date(milliseconds).toISOString();
  return canonical === (value.includes('.') ? value : value.replace('Z', '.000Z'));
}

function isPackageSize(value) {
  return isPlainObject(value) && Object.keys(value).length === 2 &&
    isFinitePositive(value.value) && PACKAGE_UNITS.includes(value.unit);
}

function isPackagedIdentity(identity) {
  return isPlainObject(identity) && hasOnlyKeys(identity, ['brand', 'variant', 'packageSize', 'upc']) &&
    isNonEmptyString(identity.brand) && isNullableNonEmptyString(identity.variant) &&
    isPackageSize(identity.packageSize) &&
    (identity.upc === null || (typeof identity.upc === 'string' && /^\d{8,14}$/.test(identity.upc)));
}

function isWholeFoodIdentity(identity) {
  return isPlainObject(identity) && hasOnlyKeys(identity, ['brand', 'variant', 'packageSize', 'upc']) &&
    identity.brand === null && isNonEmptyString(identity.variant) &&
    identity.packageSize === null && identity.upc === null;
}

function isUnknownValue(value) {
  return isPlainObject(value) && Object.keys(value).length === 2 &&
    value.knowledge === 'unknown' && isNonEmptyString(value.reasonUnknown);
}

function isNutritionValue(value) {
  if (isUnknownValue(value)) return true;
  if (!isPlainObject(value) || value.knowledge !== 'known' ||
      !hasOnlyKeys(value, ['knowledge', 'servingSize', 'calories', 'proteinG', 'fiberG', 'sodiumMg', 'proteinQuality'])) return false;
  const serving = value.servingSize;
  return isPlainObject(serving) && Object.keys(serving).length === 2 &&
    isFinitePositive(serving.value) && SERVING_UNITS.includes(serving.unit) &&
    isFiniteNonNegative(value.calories) && isFiniteNonNegative(value.proteinG) &&
    isFiniteNonNegative(value.fiberG) && isFiniteNonNegative(value.sodiumMg) &&
    (value.proteinQuality === undefined || ['complete', 'complementary', 'incomplete'].includes(value.proteinQuality));
}

function isIngredientsValue(value) {
  if (isUnknownValue(value)) return true;
  if (!isPlainObject(value) || value.knowledge !== 'known' ||
      !hasOnlyKeys(value, ['knowledge', 'text', 'normalized', 'processingLevel'])) return false;
  return isNonEmptyString(value.text) && isStringArray(value.normalized, {nonEmpty: true}) &&
    (value.processingLevel === undefined || ['whole-food', 'minimally-processed', 'processed', 'ultra-processed'].includes(value.processingLevel));
}

function isPriceValue(value) {
  if (isUnknownValue(value)) return true;
  return isPlainObject(value) && Object.keys(value).length === 3 && value.knowledge === 'known' &&
    isFiniteNonNegative(value.amount) && V0_CURRENCIES.includes(value.currency);
}

function isAvailabilityValue(value) {
  if (isUnknownValue(value)) return true;
  return isPlainObject(value) && Object.keys(value).length === 2 && value.knowledge === 'known' &&
    ['in-stock', 'limited-stock', 'out-of-stock'].includes(value.status);
}

const OBSERVATION_VALUE_VALIDATORS = Object.freeze({
  nutrition: isNutritionValue,
  ingredients: isIngredientsValue,
  price: isPriceValue,
  availability: isAvailabilityValue
});

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
  if (!Number.isFinite(input.proteinG) || input.proteinG <= 0 || !isFiniteNonNegative(input.priceAmount) || !V0_CURRENCIES.includes(input.currency)) {
    return unknown(inputs, formula, 'Protein, non-negative price, and a supported currency observation are required.');
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
  if (!isPlainObject(catalog)) return ['catalog must be an object'];
  if (catalog.version !== CATALOG_VERSION) errors.push(`version must equal ${CATALOG_VERSION}`);
  for (const collection of ['products', 'stores', 'sources', 'observations', 'conflicts', 'mediaAssets']) {
    if (!Array.isArray(catalog[collection])) errors.push(`${collection} must be an array`);
  }
  if (errors.some(error => error.endsWith('must be an array'))) return errors;

  const uniqueIds = (items, collection) => {
    const ids = new Set();
    for (const [index, item] of items.entries()) {
      if (!item || !isNonEmptyString(item.id)) errors.push(`${collection}[${index}] requires id`);
      else if (ids.has(item.id)) errors.push(`${collection} contains duplicate id ${item.id}`);
      else ids.add(item.id);
    }
    return ids;
  };
  const productIds = uniqueIds(catalog.products, 'products');
  const storeIds = uniqueIds(catalog.stores, 'stores');
  const sourceIds = uniqueIds(catalog.sources, 'sources');
  const observationIds = uniqueIds(catalog.observations, 'observations');
  const conflictIds = uniqueIds(catalog.conflicts, 'conflicts');
  const mediaAssetIds = uniqueIds(catalog.mediaAssets, 'mediaAssets');
  const productsById = new Map(catalog.products.map(product => [product.id, product]));
  const observationsById = new Map(catalog.observations.map(observation => [observation.id, observation]));
  const conflictsById = new Map(catalog.conflicts.map(conflict => [conflict.id, conflict]));
  const mediaAssetsById = new Map(catalog.mediaAssets.map(asset => [asset.id, asset]));

  for (const store of catalog.stores) {
    if (!store || !store.id) continue;
    if (!isNonEmptyString(store.name) || !isNonEmptyString(store.kind)) errors.push(`store ${store.id} requires name and kind`);
    if (!isPlainObject(store.location)) errors.push(`store ${store.id} requires location`);
  }

  for (const source of catalog.sources) {
    if (!source || !source.id) continue;
    if (!isNonEmptyString(source.kind) || !isNonEmptyString(source.title) || !isNonEmptyString(source.publisher)) {
      errors.push(`source ${source.id} requires kind, title, and publisher`);
    }
    if (!isNonEmptyString(source.locator)) errors.push(`source ${source.id} requires locator`);
    if (!isStrictUtcTimestamp(source.accessedAt)) errors.push(`source ${source.id} requires strict UTC ISO accessedAt`);
  }

  for (const product of catalog.products) {
    if (!product || !product.id) continue;
    for (const forbidden of ['nutrition', 'ingredients', 'price', 'availability']) {
      if (Object.hasOwn(product, forbidden)) errors.push(`product ${product.id} must not embed ${forbidden}; use observations`);
    }
    if (!['packaged', 'whole-food'].includes(product.kind)) errors.push(`product ${product.id} has invalid kind`);
    if (!isNonEmptyString(product.name)) errors.push(`product ${product.id} requires non-empty name`);
    if (!isNonEmptyString(product.category)) errors.push(`product ${product.id} requires non-empty category`);
    if (!isStringArray(product.markets, {nonEmpty: true})) errors.push(`product ${product.id} requires non-empty markets array`);
    if (!isStringArray(product.dietaryTags)) errors.push(`product ${product.id} requires dietaryTags array`);
    if (product.preparationMinutes !== null && !isFiniteNonNegative(product.preparationMinutes)) {
      errors.push(`product ${product.id} preparationMinutes must be null or finite non-negative`);
    }
    if (product.kind === 'packaged' && !isPackagedIdentity(product.identity)) errors.push(`product ${product.id} has invalid packaged identity`);
    if (product.kind === 'whole-food' && !isWholeFoodIdentity(product.identity)) errors.push(`product ${product.id} has invalid whole-food identity`);
    if (!isPlainObject(product.images) || !MEDIA_ROLES.every(role => isPlainObject(product.images[role]))) {
      errors.push(`product ${product.id} requires front, nutrition, and ingredients image contracts`);
      continue;
    }
    for (const role of MEDIA_ROLES) {
      const image = product.images[role];
      if (image.status === 'needed') {
        if (Object.keys(image).length !== 2 || !isNonEmptyString(image.reasonMissing)) {
          errors.push(`product ${product.id} needed image ${role} requires reasonMissing`);
        }
      } else if (image.status === 'verified') {
        const asset = mediaAssetsById.get(image.assetId);
        if (Object.keys(image).length !== 2 || !mediaAssetIds.has(image.assetId)) {
          errors.push(`product ${product.id} verified image ${role} references unknown asset`);
        } else if (asset.productId !== product.id || asset.role !== role) {
          errors.push(`product ${product.id} verified image ${role} must reference matching product and role`);
        }
      } else {
        errors.push(`product ${product.id} image ${role} has invalid status`);
      }
    }
  }

  for (const asset of catalog.mediaAssets) {
    if (!asset || !asset.id) continue;
    const product = productsById.get(asset.productId);
    if (!product) errors.push(`media asset ${asset.id} references unknown product`);
    if (!MEDIA_ROLES.includes(asset.role)) errors.push(`media asset ${asset.id} has invalid role`);
    if (!isNonEmptyString(asset.locator) || !/^(https:\/\/|asset:\/\/)/.test(asset.locator)) {
      errors.push(`media asset ${asset.id} requires retrievable locator`);
    }
    if (typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) errors.push(`media asset ${asset.id} requires sha256`);
    if (!sourceIds.has(asset.sourceId)) errors.push(`media asset ${asset.id} references unknown source`);
    if (!isNonEmptyString(asset.license) || asset.license === 'unknown') errors.push(`media asset ${asset.id} requires explicit license`);
    if (!isStrictUtcTimestamp(asset.capturedAt)) errors.push(`media asset ${asset.id} requires strict UTC ISO capturedAt`);
    if (asset.verificationState !== 'source-backed') errors.push(`media asset ${asset.id} must be source-backed`);
    if (product && !sameJson(asset.identityBinding, product.identity)) errors.push(`media asset ${asset.id} must exactly bind product identity`);
  }

  for (const observation of catalog.observations) {
    if (!observation || !observation.id) continue;
    if (!productIds.has(observation.productId)) errors.push(`observation ${observation.id} references unknown product`);
    if (!sourceIds.has(observation.sourceId)) errors.push(`observation ${observation.id} references unknown source`);
    if (!OBSERVATION_FIELDS.includes(observation.field)) errors.push(`observation ${observation.id} has invalid field`);
    if (!VERIFICATION_STATES.includes(observation.verificationState)) errors.push(`observation ${observation.id} has invalid verificationState`);
    if (!isStrictUtcTimestamp(observation.observedAt)) errors.push(`observation ${observation.id} requires strict UTC ISO observedAt`);
    if (['price', 'availability'].includes(observation.field) && !observation.storeId) errors.push(`${observation.field} observations require storeId (${observation.id})`);
    if (observation.storeId && !storeIds.has(observation.storeId)) errors.push(`observation ${observation.id} references unknown store`);
    const valueValidator = OBSERVATION_VALUE_VALIDATORS[observation.field];
    if (!valueValidator || !valueValidator(observation.value)) errors.push(`observation ${observation.id} has invalid ${observation.field} value`);
    if (observation.verificationState === 'conflict' && !conflictIds.has(observation.conflictId)) {
      errors.push(`observation ${observation.id} in conflict requires reciprocal conflict linkage`);
    }
    if (observation.conflictId && !conflictIds.has(observation.conflictId)) errors.push(`observation ${observation.id} references unknown conflict`);
  }

  for (const conflict of catalog.conflicts) {
    if (!conflict || !conflict.id) continue;
    if (!productIds.has(conflict.productId)) errors.push(`conflict ${conflict.id} references unknown product`);
    if (!Array.isArray(conflict.observationIds) || conflict.observationIds.length < 2 || new Set(conflict.observationIds).size !== conflict.observationIds.length) {
      errors.push(`conflict ${conflict.id} requires at least two unique observations`);
      continue;
    }
    if (conflict.observationIds.some(id => !observationIds.has(id))) {
      errors.push(`conflict ${conflict.id} references unknown observation`);
      continue;
    }
    const observations = conflict.observationIds.map(id => observationsById.get(id));
    const exactFieldMatch = CONFLICT_FIELDS.has(conflict.field) && observations.every(observation =>
      observation.productId === conflict.productId &&
      (conflict.field === observation.field || conflict.field.startsWith(`${observation.field}.`))
    );
    if (!exactFieldMatch) errors.push(`conflict ${conflict.id} must reference one exact product field`);
    if (observations.some(observation => observation.conflictId !== conflict.id)) {
      errors.push(`conflict ${conflict.id} requires reciprocal conflict linkage`);
    }
    if (conflict.status === 'open') {
      if (conflict.resolution !== null || observations.some(observation => observation.verificationState !== 'conflict')) {
        errors.push(`open conflict ${conflict.id} requires null resolution and conflict-marked observations`);
      }
    } else if (conflict.status === 'resolved') {
      const resolution = conflict.resolution;
      const validResolution = isPlainObject(resolution) && conflict.observationIds.includes(resolution.winningObservationId) &&
        isNonEmptyString(resolution.reason) && isNonEmptyString(resolution.reviewer) && isStrictUtcTimestamp(resolution.reviewedAt);
      if (!validResolution) {
        errors.push(`resolved conflict ${conflict.id} requires winner, reason, reviewer, and reviewedAt`);
      } else {
        for (const observation of observations) {
          const expectedState = observation.id === resolution.winningObservationId ? 'source-backed' : 'rejected';
          if (observation.verificationState !== expectedState) errors.push(`resolved conflict ${conflict.id} requires winner source-backed and alternatives rejected`);
        }
      }
    } else {
      errors.push(`conflict ${conflict.id} has invalid status`);
    }
  }

  for (const observation of catalog.observations) {
    if (!observation || !observation.conflictId || !conflictsById.has(observation.conflictId)) continue;
    if (!conflictsById.get(observation.conflictId).observationIds.includes(observation.id)) {
      errors.push(`observation ${observation.id} requires reciprocal conflict linkage`);
    }
  }
  return errors;
}

function scoreCatalogProduct(catalog, options = {}) {
  const contractErrors = validateCatalog(catalog);
  if (contractErrors.length) throw new TypeError(`Cannot score invalid catalog: ${contractErrors.join('; ')}`);
  if (!isStrictUtcTimestamp(options.now) || !isFinitePositive(options.maxAgeDays)) {
    throw new TypeError('Scoring requires strict UTC ISO now and positive maxAgeDays.');
  }
  if (!V0_CURRENCIES.includes(options.expectedCurrency)) throw new TypeError('Scoring requires an explicit supported expectedCurrency.');
  const product = catalog.products.find(candidate => candidate.id === options.productId);
  if (!product) throw new TypeError(`Unknown product ${options.productId}`);
  const observationsById = new Map(catalog.observations.map(observation => [observation.id, observation]));
  const conflictsById = new Map(catalog.conflicts.map(conflict => [conflict.id, conflict]));
  const evidence = isPlainObject(options.evidence) ? options.evidence : {};
  const nowMs = Date.parse(options.now);
  const maxAgeMs = options.maxAgeDays * 24 * 60 * 60 * 1000;

  const admission = (selectionName, field) => {
    const selectedId = evidence[selectionName];
    const observation = observationsById.get(selectedId);
    const reasons = [];
    if (!selectedId) reasons.push(`no ${field} evidence selected`);
    else if (!observation) reasons.push(`unknown evidence ${selectedId}`);
    if (!observation) return {observation: null, reasons};
    if (observation.field !== field) reasons.push(`${selectedId} is not ${field} evidence`);
    if (observation.productId !== product.id) reasons.push(`${selectedId} belongs to another product`);
    if (['price', 'availability'].includes(field) && observation.storeId !== options.storeId) reasons.push(`${selectedId} belongs to another store`);
    if (observation.verificationState !== 'source-backed') reasons.push(`${selectedId} is not source-backed (${observation.verificationState})`);
    if (observation.value.knowledge === 'unknown') reasons.push(`${selectedId} has unknown value`);
    const age = nowMs - Date.parse(observation.observedAt);
    if (age < 0) reasons.push(`${selectedId} is future-dated`);
    if (age > maxAgeMs) reasons.push(`${selectedId} is stale for ${options.maxAgeDays}-day policy`);
    if (observation.conflictId && conflictsById.get(observation.conflictId)?.status === 'open') reasons.push(`${selectedId} is in an open conflict`);
    return {observation, reasons};
  };

  const nutrition = admission('nutritionId', 'nutrition');
  const ingredients = admission('ingredientsId', 'ingredients');
  const price = admission('priceId', 'price');
  const availability = admission('availabilityId', 'availability');
  if (price.observation?.value.knowledge === 'known' && price.observation.value.currency !== options.expectedCurrency) {
    price.reasons.push(`currency mismatch: ${price.observation.value.currency} cannot be scored as ${options.expectedCurrency}`);
  }

  const admittedValue = item => item.reasons.length === 0 ? item.observation.value : {};
  const nutritionValue = admittedValue(nutrition);
  const ingredientsValue = admittedValue(ingredients);
  const priceValue = admittedValue(price);
  const availabilityValue = admittedValue(availability);
  const preferences = isPlainObject(options.preferences) ? options.preferences : {};
  const input = {
    proteinG: nutritionValue.proteinG,
    calories: nutritionValue.calories,
    proteinQuality: nutritionValue.proteinQuality,
    fiberG: nutritionValue.fiberG,
    sodiumMg: nutritionValue.sodiumMg,
    processingLevel: ingredientsValue.processingLevel,
    priceAmount: priceValue.amount,
    currency: priceValue.currency,
    dietaryTags: product.dietaryTags,
    requiredTags: preferences.requiredTags,
    excludedTags: preferences.excludedTags,
    prepMinutes: product.preparationMinutes,
    availability: availabilityValue.status
  };
  const axes = scoreAxes(input);

  const attach = (axis, admissions, identityIds = []) => {
    const selected = admissions.map(item => item.observation).filter(Boolean);
    const reasons = [...new Set(admissions.flatMap(item => item.reasons))];
    axes[axis] = {
      ...axes[axis],
      evidenceIds: selected.map(observation => observation.id),
      verificationStates: selected.map(observation => observation.verificationState),
      identityIds,
      ineligibleReasons: reasons
    };
  };
  attach('proteinEfficiency', [nutrition]);
  attach('value', [nutrition, price]);
  attach('proteinQuality', [nutrition]);
  attach('foodQuality', [nutrition, ingredients]);
  attach('personalFit', [], [product.id]);
  attach('convenience', [availability], [product.id]);
  return {productId: product.id, storeId: options.storeId ?? null, expectedCurrency: options.expectedCurrency, axes};
}

module.exports = {
  CATALOG_VERSION,
  VERIFICATION_STATES,
  OBSERVATION_FIELDS,
  MEDIA_ROLES,
  SCORE_AXIS_NAMES,
  validateCatalog,
  scoreAxes,
  scoreCatalogProduct,
  rankCatalog
};