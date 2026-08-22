'use strict';

const {validateCatalog} = require('./catalog-contract.js');

const IMPORT_VERSION = 'protein-finds.catalog-import.v0';
const PACKAGE_UNITS = new Set(['g', 'kg', 'ml', 'l', 'fl-oz', 'oz', 'lb', 'count']);
const SERVING_UNITS = new Set(['g', 'ml', 'oz', 'count']);
const DIETARY_FLAGS = new Set(['vegetarian', 'vegan', 'gluten-free', 'dairy', 'soy', 'legume', 'produce']);
const ALLERGEN_FLAGS = new Set(['none', 'milk', 'egg', 'fish', 'shellfish', 'tree-nut', 'peanut', 'wheat', 'soy', 'sesame']);
const AVAILABILITY = new Set(['in-stock', 'limited-stock', 'out-of-stock']);
const REQUIRED_FIELDS = ['source_row_id', 'name', 'kind', 'category', 'markets', 'dietary_tags', 'allergens', 'observed_at'];
const CSV_COLUMNS = [
  'source_row_id', 'name', 'kind', 'brand', 'variant', 'package_value', 'package_unit', 'upc',
  'category', 'markets', 'dietary_tags', 'allergens', 'store_id', 'observed_at', 'serving_value',
  'serving_unit', 'calories', 'protein_g', 'fiber_g', 'sodium_mg', 'ingredients', 'price_amount',
  'currency', 'availability'
];

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = value => typeof value === 'string' && value.trim().length > 0;
const clone = value => structuredClone(value);
const normalizeText = value => String(value ?? '').trim();
const slug = value => normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sameJson = (left, right) => JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right));

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortJson(value[key])]));
}

function isStrictUtcTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  const canonical = new Date(milliseconds).toISOString();
  return canonical === (value.includes('.') ? value : value.replace('Z', '.000Z'));
}

function parseCsvRows(input) {
  if (typeof input !== 'string') throw new TypeError('CSV input must be a string.');
  const rows = [];
  let fields = [];
  let field = '';
  let raw = '';
  let quoted = false;
  let rowNumber = 1;
  let rowStart = 1;

  const pushRow = () => {
    fields.push(field);
    if (fields.some(value => value.length > 0) || raw.trim().length > 0) {
      rows.push({fields, raw: raw.replace(/\r?\n$/, ''), rowNumber: rowStart});
    }
    fields = [];
    field = '';
    raw = '';
    rowStart = rowNumber;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    raw += character;
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        raw += input[index + 1];
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
        if (character === '\n') rowNumber += 1;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      fields.push(field);
      field = '';
    } else if (character === '\n') {
      rowNumber += 1;
      pushRow();
    } else if (character !== '\r') {
      field += character;
    }
  }
  if (quoted) throw new TypeError('CSV contains an unterminated quoted field.');
  if (field.length || fields.length || raw.length) pushRow();
  return rows;
}

function parseCsvRecords(input) {
  const rows = parseCsvRows(input);
  if (rows.length === 0) throw new TypeError('CSV requires a header row.');
  const headers = rows[0].fields.map(header => header.trim());
  if (new Set(headers).size !== headers.length || headers.some(header => !nonEmpty(header))) {
    throw new TypeError('CSV headers must be unique and non-empty.');
  }
  const unknown = headers.filter(header => !CSV_COLUMNS.includes(header));
  if (unknown.length) throw new TypeError(`CSV contains unsupported columns: ${unknown.join(', ')}`);
  return rows.slice(1).map(row => {
    if (row.fields.length !== headers.length) {
      throw new TypeError(`CSV row ${row.rowNumber} column count ${row.fields.length} does not match header count ${headers.length}.`);
    }
    return {
      rowNumber: row.rowNumber,
      raw: row.raw,
      value: Object.fromEntries(headers.map((header, index) => [header, row.fields[index]]))
    };
  });
}

function parseJsonRecords(input) {
  let records = input;
  if (typeof input === 'string') {
    try {
      records = JSON.parse(input);
    } catch (error) {
      throw new TypeError(`JSON input is invalid: ${error.message}`);
    }
  }
  if (!Array.isArray(records)) throw new TypeError('JSON input must be an array of row objects.');
  return records.map((value, index) => {
    if (!isObject(value)) throw new TypeError(`JSON row ${index + 1} must be an object.`);
    return {rowNumber: index + 1, raw: JSON.stringify(value), value: clone(value)};
  });
}

function listValue(value) {
  if (Array.isArray(value)) return value.map(item => normalizeText(item)).filter(Boolean);
  if (!nonEmpty(value)) return [];
  return value.split('|').map(item => item.trim()).filter(Boolean);
}

function numericValue(value) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizedRow(row) {
  const value = row.value;
  const normalized = {
    source_row_id: normalizeText(value.source_row_id),
    name: normalizeText(value.name),
    kind: normalizeText(value.kind),
    brand: normalizeText(value.brand) || null,
    variant: normalizeText(value.variant) || null,
    package_value: numericValue(value.package_value),
    package_unit: normalizeText(value.package_unit) || null,
    upc: normalizeText(value.upc) || null,
    category: normalizeText(value.category),
    markets: listValue(value.markets),
    dietary_tags: listValue(value.dietary_tags),
    allergens: listValue(value.allergens),
    store_id: normalizeText(value.store_id) || null,
    observed_at: normalizeText(value.observed_at),
    serving_value: numericValue(value.serving_value),
    serving_unit: normalizeText(value.serving_unit) || null,
    calories: numericValue(value.calories),
    protein_g: numericValue(value.protein_g),
    fiber_g: numericValue(value.fiber_g),
    sodium_mg: numericValue(value.sodium_mg),
    ingredients: normalizeText(value.ingredients) || null,
    price_amount: numericValue(value.price_amount),
    currency: normalizeText(value.currency) || null,
    availability: normalizeText(value.availability) || null
  };
  return normalized;
}

function identityFor(row) {
  if (row.kind === 'whole-food') {
    return {brand: null, variant: row.variant, packageSize: null, upc: null};
  }
  return {
    brand: row.brand,
    variant: row.variant,
    packageSize: {value: row.package_value, unit: row.package_unit},
    upc: row.upc
  };
}

function identityKey(kind, identity) {
  if (identity.upc) return `upc:${identity.upc}`;
  return [kind, identity.brand, identity.variant, identity.packageSize?.value, identity.packageSize?.unit]
    .map(value => normalizeText(value).toLowerCase()).join('|');
}

function reason(code, field, message) {
  return {code, field, message};
}

function validateRow(row, canonical, importedAt, maxAgeDays) {
  const reasons = [];
  for (const field of REQUIRED_FIELDS) {
    const value = row[field];
    if ((Array.isArray(value) && value.length === 0) || (!Array.isArray(value) && !nonEmpty(value))) {
      reasons.push(reason('missing_required_field', field, `${field} is required.`));
    }
  }
  if (!['packaged', 'whole-food'].includes(row.kind)) reasons.push(reason('invalid_kind', 'kind', 'kind must be packaged or whole-food.'));
  if (row.kind === 'packaged') {
    if (!nonEmpty(row.brand)) reasons.push(reason('missing_required_field', 'brand', 'Packaged products require brand.'));
    if (!Number.isFinite(row.package_value) || row.package_value <= 0) reasons.push(reason('invalid_package_size', 'package_value', 'Package value must be finite and positive.'));
    if (!PACKAGE_UNITS.has(row.package_unit)) reasons.push(reason('invalid_package_unit', 'package_unit', 'Package unit is unsupported.'));
    if (row.upc !== null && !/^\d{8,14}$/.test(row.upc)) reasons.push(reason('invalid_upc', 'upc', 'UPC must contain 8 to 14 digits.'));
  }
  if (row.kind === 'whole-food') {
    if (!nonEmpty(row.variant)) reasons.push(reason('missing_required_field', 'variant', 'Whole foods require a generic variant descriptor.'));
    if (row.brand !== null || row.package_value !== null || row.package_unit !== null || row.upc !== null) {
      reasons.push(reason('invalid_whole_food_identity', 'identity', 'Whole-food identity cannot carry brand, package, or UPC values.'));
    }
  }
  for (const flag of row.dietary_tags) {
    if (!DIETARY_FLAGS.has(flag)) reasons.push(reason('invalid_dietary_flag', 'dietary_tags', `Unsupported dietary flag: ${flag}.`));
  }
  for (const flag of row.allergens) {
    if (!ALLERGEN_FLAGS.has(flag)) reasons.push(reason('invalid_allergen_flag', 'allergens', `Unsupported allergen flag: ${flag}.`));
  }
  if (row.allergens.includes('none') && row.allergens.length > 1) reasons.push(reason('invalid_allergen_flag', 'allergens', 'none cannot be combined with another allergen.'));
  if (!isStrictUtcTimestamp(row.observed_at)) {
    if (nonEmpty(row.observed_at)) reasons.push(reason('invalid_timestamp', 'observed_at', 'observed_at must be a strict UTC ISO timestamp.'));
  } else {
    const age = Date.parse(importedAt) - Date.parse(row.observed_at);
    if (age < 0) reasons.push(reason('future_observation', 'observed_at', 'Observation timestamp is later than importedAt.'));
    if (age > maxAgeDays * 86400000) reasons.push(reason('stale_observation', 'observed_at', `Observation exceeds the ${maxAgeDays}-day freshness policy.`));
  }
  const nutritionValues = [row.serving_value, row.serving_unit, row.calories, row.protein_g, row.fiber_g, row.sodium_mg];
  const hasNutrition = nutritionValues.some(value => value !== null);
  if (!hasNutrition && row.ingredients === null && row.price_amount === null && row.availability === null) {
    reasons.push(reason('missing_observation_data', 'observations', 'At least one complete observation payload is required.'));
  }
  if (hasNutrition) {
    if (!Number.isFinite(row.serving_value) || row.serving_value <= 0 || !SERVING_UNITS.has(row.serving_unit)) {
      reasons.push(reason('invalid_serving_size', 'serving_value', 'Nutrition requires a positive serving value and supported unit.'));
    }
    if ([row.calories, row.protein_g, row.fiber_g, row.sodium_mg].some(value => !Number.isFinite(value) || value < 0)) {
      reasons.push(reason('invalid_nutrition', 'nutrition', 'Calories, protein, fiber, and sodium must be finite and non-negative.'));
    } else if (row.calories > 2000 || row.protein_g > 200 || row.fiber_g > 100 || row.sodium_mg > 10000 || row.protein_g * 4 > row.calories * 1.25) {
      reasons.push(reason('implausible_nutrition', 'nutrition', 'Nutrition exceeds conservative per-serving plausibility bounds.'));
    }
  }
  if (row.price_amount !== null && (!Number.isFinite(row.price_amount) || row.price_amount < 0 || row.currency !== 'USD')) {
    reasons.push(reason('invalid_price', 'price_amount', 'Price must be finite, non-negative, and denominated in USD.'));
  }
  if (row.availability !== null && !AVAILABILITY.has(row.availability)) reasons.push(reason('invalid_availability', 'availability', 'Availability value is unsupported.'));
  if ((row.price_amount !== null || row.availability !== null) && !row.store_id) reasons.push(reason('missing_required_field', 'store_id', 'Store is required for price or availability.'));
  if (row.store_id && !canonical.stores.some(store => store.id === row.store_id)) reasons.push(reason('unknown_store', 'store_id', `Unknown canonical store: ${row.store_id}.`));
  return {reasons, hasNutrition};
}

function productFor(row) {
  const identity = identityFor(row);
  const idPart = identity.upc || [row.brand, row.variant, row.package_value, row.package_unit].filter(value => value !== null).join('-');
  return {
    id: `product-${slug(idPart || row.name)}`,
    kind: row.kind,
    name: row.name,
    category: row.category,
    markets: row.markets,
    identity,
    dietaryTags: row.dietary_tags,
    allergens: row.allergens,
    preparationMinutes: null,
    images: {
      front: {status: 'needed', reasonMissing: 'No exact-package front image is licensed and verified.'},
      nutrition: {status: 'needed', reasonMissing: 'No exact-package nutrition panel image is licensed and verified.'},
      ingredients: {status: 'needed', reasonMissing: 'No exact-package ingredient panel image is licensed and verified.'}
    }
  };
}

function observationsFor(row, productId, sourceId) {
  const base = {
    productId,
    storeId: null,
    sourceId,
    observedAt: row.observed_at,
    verificationState: 'unverified'
  };
  const observations = [];
  const idBase = `${slug(sourceId)}-${slug(row.source_row_id)}`;
  if ([row.serving_value, row.serving_unit, row.calories, row.protein_g, row.fiber_g, row.sodium_mg].some(value => value !== null)) {
    observations.push({...base, id: `obs-${idBase}-nutrition`, field: 'nutrition', value: {
      knowledge: 'known', servingSize: {value: row.serving_value, unit: row.serving_unit}, calories: row.calories,
      proteinG: row.protein_g, fiberG: row.fiber_g, sodiumMg: row.sodium_mg
    }});
  }
  if (row.ingredients !== null) {
    observations.push({...base, id: `obs-${idBase}-ingredients`, field: 'ingredients', value: {
      knowledge: 'known', text: row.ingredients,
      normalized: row.ingredients.split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
    }});
  }
  if (row.price_amount !== null) {
    observations.push({...base, id: `obs-${idBase}-price`, storeId: row.store_id, field: 'price', value: {
      knowledge: 'known', amount: row.price_amount, currency: row.currency
    }});
  }
  if (row.availability !== null) {
    observations.push({...base, id: `obs-${idBase}-availability`, storeId: row.store_id, field: 'availability', value: {
      knowledge: 'known', status: row.availability
    }});
  }
  return observations;
}

function matchProduct(canonical, product) {
  const key = identityKey(product.kind, product.identity);
  return canonical.products.find(existing => identityKey(existing.kind, existing.identity) === key) || null;
}

function stageCatalogImport(options) {
  if (!isObject(options)) throw new TypeError('Import options are required.');
  const {format, input, source, canonical, importedAt, maxAgeDays} = options;
  if (!['csv', 'json'].includes(format)) throw new TypeError('Import format must be csv or json.');
  if (!isObject(source) || !nonEmpty(source.id) || !nonEmpty(source.kind) || !nonEmpty(source.title) ||
      !nonEmpty(source.publisher) || !nonEmpty(source.locator) || !isStrictUtcTimestamp(source.accessedAt)) {
    throw new TypeError('Import source requires id, kind, title, publisher, locator, and strict UTC accessedAt.');
  }
  const canonicalErrors = validateCatalog(canonical);
  if (canonicalErrors.length) throw new TypeError(`Canonical catalog is invalid: ${canonicalErrors.join('; ')}`);
  if (!isStrictUtcTimestamp(importedAt)) throw new TypeError('importedAt must be a strict UTC ISO timestamp.');
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) throw new TypeError('maxAgeDays must be finite and positive.');
  const parsed = format === 'csv' ? parseCsvRecords(input) : parseJsonRecords(input);
  const normalized = parsed.map(row => ({...row, normalized: normalizedRow(row)}));
  const existingSource = canonical.sources.find(candidate => candidate.id === source.id);
  const sourceConflict = existingSource && !sameJson(existingSource, source);
  const identityCounts = new Map();
  const sourceRowKeyCounts = new Map();
  const proposedProductIdCounts = new Map();
  for (const row of normalized) {
    const identity = identityFor(row.normalized);
    const key = identityKey(row.normalized.kind, identity);
    identityCounts.set(key, (identityCounts.get(key) || 0) + 1);
    const sourceRowKey = slug(row.normalized.source_row_id);
    sourceRowKeyCounts.set(sourceRowKey, (sourceRowKeyCounts.get(sourceRowKey) || 0) + 1);
    const proposedProductId = productFor(row.normalized).id;
    proposedProductIdCounts.set(proposedProductId, (proposedProductIdCounts.get(proposedProductId) || 0) + 1);
  }

  const stagedRows = normalized.map(row => {
    const item = row.normalized;
    const validation = validateRow(item, canonical, importedAt, maxAgeDays);
    const reasons = [...validation.reasons];
    const hardFailure = reasons.some(entry => entry.code !== 'stale_observation');
    let candidate = null;
    if (!hardFailure) {
      const proposedProduct = productFor(item);
      const key = identityKey(proposedProduct.kind, proposedProduct.identity);
      if (identityCounts.get(key) > 1) reasons.push(reason('duplicate_identity', 'identity', 'Multiple staged rows resolve to the same product identity.'));
      if (sourceRowKeyCounts.get(slug(item.source_row_id)) > 1) reasons.push(reason('duplicate_source_row_id', 'source_row_id', 'Multiple staged row IDs generate the same observation ID namespace.'));
      if (sourceConflict) reasons.push(reason('source_definition_conflict', 'source', `Source id ${source.id} already has different canonical provenance.`));
      const matched = matchProduct(canonical, proposedProduct);
      if (matched) {
        if (matched.kind !== proposedProduct.kind || !sameJson(matched.identity, proposedProduct.identity)) {
          reasons.push(reason('product_identity_conflict', 'identity', `Matched product ${matched.id} has a different canonical identity.`));
        }
        const metadataFields = ['name', 'category', 'markets', 'dietaryTags'];
        if (metadataFields.some(field => !sameJson(matched[field], proposedProduct[field])) ||
            (Object.hasOwn(matched, 'allergens') && !sameJson(matched.allergens, proposedProduct.allergens))) {
          reasons.push(reason('product_metadata_conflict', 'product', `Matched product ${matched.id} has different canonical metadata.`));
        }
      } else if (canonical.products.some(product => product.id === proposedProduct.id) || proposedProductIdCounts.get(proposedProduct.id) > 1) {
        reasons.push(reason('product_id_collision', 'identity', `Generated product id ${proposedProduct.id} is not unique to this identity.`));
      }
      const productId = matched?.id || proposedProduct.id;
      const observations = observationsFor(item, productId, source.id);
      for (const observation of observations) {
        const openConflicts = canonical.conflicts.filter(conflict =>
          conflict.status === 'open' && conflict.productId === productId &&
          (conflict.field === observation.field || conflict.field.startsWith(`${observation.field}.`))
        );
        if (openConflicts.length) {
          reasons.push(reason('open_canonical_conflict', observation.field, `Proposed field is already under open review: ${openConflicts.map(entry => entry.id).join(', ')}.`));
        }
        const conflicting = canonical.observations.filter(existing =>
          existing.productId === productId && existing.field === observation.field &&
          existing.storeId === observation.storeId && existing.verificationState === 'source-backed' &&
          !sameJson(existing.value, observation.value)
        );
        if (conflicting.length) {
          reasons.push(reason('verified_value_conflict', observation.field, `Proposed value conflicts with verified observation(s): ${conflicting.map(entry => entry.id).join(', ')}.`));
        }
        if (canonical.observations.some(existing => existing.id === observation.id)) {
          reasons.push(reason('duplicate_observation_id', observation.field, `Observation id already exists: ${observation.id}.`));
        }
      }
      candidate = {productId, product: matched ? null : proposedProduct, observations};
    }
    const rejected = reasons.some(entry => ![
      'stale_observation', 'duplicate_identity', 'duplicate_source_row_id', 'verified_value_conflict',
      'open_canonical_conflict', 'duplicate_observation_id',
      'source_definition_conflict', 'product_identity_conflict', 'product_metadata_conflict', 'product_id_collision'
    ].includes(entry.code));
    const disposition = rejected ? 'rejected' : reasons.length ? 'needs-review' : 'accepted';
    return {
      sourceRowId: item.source_row_id || `row-${row.rowNumber}`,
      rowNumber: row.rowNumber,
      rawSource: {format, raw: row.raw, record: clone(row.value)},
      normalized: item,
      disposition,
      reasons,
      candidate: disposition === 'rejected' ? null : candidate
    };
  });

  const count = disposition => stagedRows.filter(row => row.disposition === disposition).length;
  const idsFor = disposition => stagedRows.filter(row => row.disposition === disposition).map(row => row.sourceRowId);
  return {
    version: IMPORT_VERSION,
    importedAt,
    source: clone(source),
    policy: {maxAgeDays},
    summary: {total: stagedRows.length, accepted: count('accepted'), rejected: count('rejected'), needsReview: count('needs-review')},
    results: {accepted: idsFor('accepted'), rejected: idsFor('rejected'), needsReview: idsFor('needs-review')},
    stagedRows
  };
}

function applyAcceptedImport(canonical, stagedImport) {
  const canonicalErrors = validateCatalog(canonical);
  if (canonicalErrors.length) throw new TypeError(`Canonical catalog is invalid: ${canonicalErrors.join('; ')}`);
  if (!isObject(stagedImport) || stagedImport.version !== IMPORT_VERSION || !Array.isArray(stagedImport.stagedRows)) {
    throw new TypeError('A valid staged import is required.');
  }
  if (!isObject(stagedImport.policy) || !stagedImport.stagedRows.every(row => isObject(row.rawSource) && isObject(row.rawSource.record))) {
    throw new TypeError('The staged import must retain its policy and every raw source record.');
  }
  const refreshed = stageCatalogImport({
    format: 'json',
    input: stagedImport.stagedRows.map(row => clone(row.rawSource.record)),
    source: stagedImport.source,
    canonical,
    importedAt: stagedImport.importedAt,
    maxAgeDays: stagedImport.policy.maxAgeDays
  });
  const originallyAccepted = new Set(stagedImport.stagedRows
    .filter(row => row.disposition === 'accepted')
    .map(row => row.sourceRowId));
  const noLongerAccepted = refreshed.stagedRows.filter(row =>
    originallyAccepted.has(row.sourceRowId) && row.disposition !== 'accepted'
  );
  if (noLongerAccepted.length) {
    throw new TypeError(`Staged row(s) are no longer accepted against the current canonical catalog: ${noLongerAccepted.map(row => row.sourceRowId).join(', ')}.`);
  }
  const next = clone(canonical);
  const accepted = refreshed.stagedRows.filter(row =>
    row.disposition === 'accepted' && originallyAccepted.has(row.sourceRowId)
  );
  if (accepted.length && !next.sources.some(source => source.id === stagedImport.source.id)) next.sources.push(clone(stagedImport.source));
  for (const row of accepted) {
    if (!row.candidate) throw new TypeError(`Accepted row ${row.sourceRowId} is missing its candidate.`);
    if (row.candidate.product) next.products.push(clone(row.candidate.product));
    next.observations.push(...clone(row.candidate.observations));
  }
  const errors = validateCatalog(next);
  if (errors.length) throw new TypeError(`Accepted import does not produce a valid catalog: ${errors.join('; ')}`);
  return next;
}

module.exports = {
  IMPORT_VERSION,
  parseCsvRecords,
  stageCatalogImport,
  applyAcceptedImport
};
