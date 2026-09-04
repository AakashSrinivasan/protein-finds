(function initializeProductScreener(global) {
  'use strict';

  const knownText = value => typeof value === 'string' && value.trim().length > 0;
  const numeric = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const cleanNumber = value => value === '' || value === null || value === undefined ? null : numeric(value);
  const singularize = token => token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token;
  const tokenize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[‐‑‒–—-]/g, ' ').replace(/[^a-z0-9$./]+/g, ' ').trim().split(/\s+/).filter(Boolean).map(singularize);
  const searchableTokens = product => new Set(tokenize([
    product.name, product.brand, product.category, product.type, product.use,
    ...(Array.isArray(product.useCases) ? product.useCases : []),
    ...(Array.isArray(product.useCase) ? product.useCase : [product.useCase]),
    ...(Array.isArray(product.ingredients) ? product.ingredients : [product.ingredients])
  ].filter(Boolean).join(' ')));
  const getMetric = (product, key) => {
    if (key === 'proteinPerDollar') return Number.isFinite(product.protein) && Number.isFinite(product.price) && product.price > 0 ? +(product.protein / product.price).toFixed(2) : null;
    return Number.isFinite(product[key]) ? product[key] : null;
  };

  const CRITERIA = Object.freeze({
    protein: { label: 'Protein', unit: 'g', step: 1, direction: 'more' },
    calories: { label: 'Calories', unit: 'cal', step: 10, direction: 'less' },
    price: { label: 'Package price', unit: '$', step: .25, direction: 'less' },
    efficiency: { label: 'Protein / 100 cal', unit: 'g', step: .1, direction: 'more' },
    proteinPerDollar: { label: 'Protein / dollar', unit: 'g / $', step: .1, direction: 'more' },
    fiber: { label: 'Fiber', unit: 'g', step: 1, direction: 'more' },
    sugar: { label: 'Sugar', unit: 'g', step: 1, direction: 'less' },
    sodium: { label: 'Sodium', unit: 'mg', step: 10, direction: 'less' }
  });

  const SORTS = Object.freeze({
    protein: { label: 'Most protein', key: 'protein', direction: 'desc' },
    calories: { label: 'Fewest calories', key: 'calories', direction: 'asc' },
    efficiency: { label: 'Protein / 100 cal', key: 'efficiency', direction: 'desc' },
    proteinPerDollar: { label: 'Protein / dollar', key: 'proteinPerDollar', direction: 'desc' },
    price: { label: 'Lowest package price', key: 'price', direction: 'asc' },
    fiber: { label: 'Most fiber', key: 'fiber', direction: 'desc' },
    sugar: { label: 'Least sugar', key: 'sugar', direction: 'asc' },
    sodium: { label: 'Least sodium', key: 'sodium', direction: 'asc' },
    name: { label: 'Product name', key: 'name', direction: 'asc' }
  });

  const EXCLUSIONS = Object.freeze({
    soy: { label: 'Soy-free', field: 'soyFree' }, dairy: { label: 'Dairy-free', field: 'dairyFree' },
    gluten: { label: 'Gluten-free', field: 'glutenFree' }, stevia: { label: 'No stevia', field: 'steviaFree' }
  });
  const DEFAULT_SCREEN = Object.freeze({ criteria: [], diet: 'all', categories: [], stores: [], prep: [], ingredientInclude: '', ingredientExclude: '', allergens: [], sort: 'protein', density: 'list', metricOrder: ['protein','calories','efficiency','price'] });
  const TEMPLATES = Object.freeze({
    'high-protein': { criteria: [{ key:'protein', min:20, max:null, includeUnknown:false }, { key:'calories', min:null, max:200, includeUnknown:false }], sort:'protein' },
    'soy-free': { allergens:['soy'], sort:'efficiency' },
    'ready-now': { criteria:[{ key:'protein', min:10, max:null, includeUnknown:false }], prep:['Ready now'], sort:'protein' }
  });

  function bounds(products, key) {
    const definition = CRITERIA[key];
    if (!definition) return null;
    const values = products.map(product => getMetric(product, key)).filter(Number.isFinite);
    if (!values.length) return null;
    const step = definition.step;
    return { min: Math.floor(Math.min(...values) / step) * step, max: Math.ceil(Math.max(...values) / step) * step, known: values.length, unknown: products.length - values.length, step };
  }

  function normalizeCriterion(raw) {
    if (!raw || !CRITERIA[raw.key]) return null;
    let min = cleanNumber(raw.min), max = cleanNumber(raw.max);
    if (min !== null && min < 0) min = null;
    if (max !== null && max < 0) max = null;
    if (min !== null && max !== null && min > max) [min, max] = [max, min];
    return { key: raw.key, min, max, includeUnknown: raw.includeUnknown === true };
  }

  function normalize(screen, categories = [], stores = []) {
    const source = screen || {};
    let criteria = Array.isArray(source.criteria) ? source.criteria.map(normalizeCriterion).filter(Boolean) : [];
    if (!criteria.length) {
      if (cleanNumber(source.minProtein) !== null) criteria.push(normalizeCriterion({ key:'protein', min:source.minProtein }));
      if (cleanNumber(source.maxCalories) !== null) criteria.push(normalizeCriterion({ key:'calories', max:source.maxCalories }));
    }
    const unique = new Map(criteria.map(item => [item.key, item]));
    const allowedCategories = new Set(categories), allowedStores = new Set(stores);
    const legacyExclusions = Array.isArray(source.exclusions) ? source.exclusions.filter(key => EXCLUSIONS[key]).map(key => key) : [];
    const allergens = [...new Set([...(Array.isArray(source.allergens) ? source.allergens : []), ...legacyExclusions].map(value => String(value).trim().toLowerCase()).filter(Boolean))];
    const prep = Array.isArray(source.prep) ? source.prep : source.prep === 'ready' ? ['Ready now'] : source.prep === 'heat' ? ['Cook','Heat'] : [];
    return {
      criteria: [...unique.values()], diet: ['all','vegetarian','vegan'].includes(source.diet) ? source.diet : 'all',
      categories: [...new Set((Array.isArray(source.categories) ? source.categories : source.category && source.category !== 'All groceries' ? [source.category] : []).filter(value => allowedCategories.has(value)))],
      stores: [...new Set((Array.isArray(source.stores) ? source.stores : []).filter(value => allowedStores.has(value)))],
      prep: [...new Set(prep.filter(value => ['Ready now','Cook','Heat'].includes(value)))],
      activeFacets: [...new Set((Array.isArray(source.activeFacets) ? source.activeFacets : []).filter(value => ['diet','categories','stores','prep','ingredients','allergens'].includes(value)))],
      query: [...new Set(tokenize(source.query))].join(' ').slice(0,80),
      unparsed: [...new Set((Array.isArray(source.unparsed) ? source.unparsed : []).flatMap(tokenize))].slice(0,12),
      ingredientInclude: String(source.ingredientInclude || '').trim().slice(0,120), ingredientExclude: String(source.ingredientExclude || '').trim().slice(0,120),
      allergens, sort: SORTS[source.sort] ? source.sort : 'protein', density: ['list','grid'].includes(source.density) ? source.density : 'list',
      metricOrder: [...new Set((Array.isArray(source.metricOrder) ? source.metricOrder : DEFAULT_SCREEN.metricOrder).filter(key => CRITERIA[key]))].slice(0,6)
    };
  }

  function allergenPass(product, allergen) {
    const token = allergen.toLowerCase();
    if (EXCLUSIONS[token]) return product[EXCLUSIONS[token].field] === true;
    const declared = product.exactSku?.allergens;
    if (!Array.isArray(declared)) return false;
    return !declared.some(value => String(value).toLowerCase().includes(token));
  }

  function evaluate(product, screen) {
    const reasons = [], failures = [], unknowns = [];
    if (screen.query) {
      const wanted = tokenize(screen.query), searchable = searchableTokens(product);
      if (!wanted.every(token => searchable.has(token))) failures.push(`Does not match “${screen.query}”`);
      else reasons.push(`Matches “${screen.query}”`);
    }
    for (const criterion of screen.criteria) {
      const value = getMetric(product, criterion.key), definition = CRITERIA[criterion.key];
      if (!Number.isFinite(value)) {
        unknowns.push(criterion.key);
        if (!criterion.includeUnknown) failures.push(`${definition.label} is unknown`);
        continue;
      }
      if (criterion.min !== null && value < criterion.min) failures.push(`${definition.label} is below ${criterion.min}${definition.unit}`);
      if (criterion.max !== null && value > criterion.max) failures.push(`${definition.label} is above ${criterion.max}${definition.unit}`);
      if ((criterion.min === null || value >= criterion.min) && (criterion.max === null || value <= criterion.max)) reasons.push(`${definition.label}: ${value}${definition.unit}`);
    }
    if (screen.diet === 'vegan' && product.diet !== 'vegan') failures.push('Not labeled vegan');
    if (screen.diet === 'vegetarian' && !['vegetarian','vegan'].includes(product.diet)) failures.push('Not vegetarian');
    if (screen.categories.length && !screen.categories.includes(product.category)) failures.push('Product type excluded');
    if (screen.stores.length && !screen.stores.some(store => product.stores?.includes(store))) failures.push('Preferred store not listed');
    if (screen.prep.length && !screen.prep.includes(product.prep)) failures.push('Preparation excluded');
    const ingredients = String(product.ingredients || '').toLowerCase();
    if (screen.ingredientInclude && !ingredients.includes(screen.ingredientInclude.toLowerCase())) failures.push('Required ingredient not evidenced');
    if (screen.ingredientExclude && (!ingredients || ingredients.includes(screen.ingredientExclude.toLowerCase()))) failures.push('Excluded ingredient present or ingredients unknown');
    for (const allergen of screen.allergens) if (!allergenPass(product, allergen)) failures.push(`${allergen} cannot be ruled out`);
    if (screen.diet !== 'all') reasons.push(product.diet === 'vegan' ? 'Vegan' : 'Vegetarian');
    if (screen.stores.length) reasons.push(`Listed at ${screen.stores.filter(store => product.stores?.includes(store)).join(', ')}`);
    return { match: failures.length === 0, reasons, failures, unknowns };
  }

  function compareProducts(a, b, sort) {
    const definition = SORTS[sort] || SORTS.protein;
    if (definition.key === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
    const av = getMetric(a, definition.key), bv = getMetric(b, definition.key);
    if (Number.isFinite(av) !== Number.isFinite(bv)) return Number.isFinite(av) ? -1 : 1;
    if (!Number.isFinite(av)) return String(a.name || '').localeCompare(String(b.name || ''));
    return (definition.direction === 'desc' ? bv - av : av - bv) || String(a.name || '').localeCompare(String(b.name || ''));
  }

  function run(products, input) {
    const categories = [...new Set(products.map(p => p.category))], stores = [...new Set(products.flatMap(p => p.stores || []))];
    const screen = normalize(input, categories, stores), evaluations = new Map(products.map(product => [product.id, evaluate(product, screen)]));
    const results = products.filter(product => evaluations.get(product.id).match).sort((a,b) => compareProducts(a,b,screen.sort));
    const excludedUnknownCount = products.filter(product => !evaluations.get(product.id).match && evaluations.get(product.id).unknowns.length).length;
    return { screen, results, total:products.length, evaluations, excludedUnknownCount, unknownPriceCount:results.filter(p=>!Number.isFinite(p.price)).length, unknownSortCount:results.filter(p=>screen.sort!=='name'&&!Number.isFinite(getMetric(p,SORTS[screen.sort].key))).length };
  }

  function clauses(screen) {
    const list = screen.criteria.map(item => { const d=CRITERIA[item.key]; const range=item.min!==null&&item.max!==null?`${item.min}–${item.max}${d.unit}`:item.min!==null?`≥ ${item.min}${d.unit}`:item.max!==null?`≤ ${item.max}${d.unit}`:'Any'; return {key:`criterion:${item.key}`,label:`${d.label} ${range}${item.includeUnknown?' + unknowns':''}`}; });
    if (screen.query) list.push({key:'query',label:`Search: ${screen.query}`});
    if (screen.unparsed.length) list.push({key:'unparsed',label:`Unparsed: ${screen.unparsed.join(', ')}`});
    if (screen.diet !== 'all') list.push({key:'diet',label:screen.diet[0].toUpperCase()+screen.diet.slice(1)});
    screen.categories.forEach(value=>list.push({key:`category:${value}`,label:value})); screen.stores.forEach(value=>list.push({key:`store:${value}`,label:value}));
    screen.prep.forEach(value=>list.push({key:`prep:${value}`,label:value})); screen.allergens.forEach(value=>list.push({key:`allergen:${value}`,label:`Avoid ${value}`}));
    if(screen.ingredientInclude) list.push({key:'ingredientInclude',label:`Includes ${screen.ingredientInclude}`}); if(screen.ingredientExclude) list.push({key:'ingredientExclude',label:`Excludes ${screen.ingredientExclude}`});
    return list;
  }

  function compile(query, current, products) {
    const q=String(query||'').toLowerCase(), allTokens=tokenize(q), next=normalize(current,[...new Set(products.map(p=>p.category))],[...new Set(products.flatMap(p=>p.stores||[]))]);
    const criteria=[]; const add=(key,min,max)=>criteria.push({key,min:min??null,max:max??null,includeUnknown:false});
    let m; if((m=q.match(/(?:at least|minimum|min|over)\s*\$?(\d+(?:\.\d+)?)\s*g?\s*protein/))) add('protein',+m[1]); else if(/high[- ]protein/.test(q)) add('protein',20);
    if((m=q.match(/(?:under|below|maximum|max|no more than)\s*(\d+)\s*(?:cal|calories)/))) add('calories',null,+m[1]);
    if((m=q.match(/(?:under|below|max|less than)\s*\$\s*(\d+(?:\.\d+)?)/))) add('price',null,+m[1]);
    if(/low[- ]sugar/.test(q)) add('sugar',null,5); if(/high[- ]fiber/.test(q)) add('fiber',5);
    next.criteria=criteria.length?criteria:next.criteria;
    if(/vegan/.test(q)) next.diet='vegan'; else if(/vegetarian/.test(q)) next.diet='vegetarian';
    for(const key of Object.keys(EXCLUSIONS)) if(new RegExp(`${key}[- ]free|no ${key}|avoid ${key}`).test(q)&&!next.allergens.includes(key)) next.allergens.push(key);
    next.categories=[...new Set(products.filter(p=>q.includes(String(p.category).toLowerCase())).map(p=>p.category))];
    next.stores=[...new Set(products.flatMap(p=>p.stores||[]).filter(store=>q.includes(store.toLowerCase())))];
    if(/ready|grab[- ]and[- ]go/.test(q)) next.prep=['Ready now'];
    if(/cheap|budget|value/.test(q)) next.sort='price'; else if(/lean|efficient/.test(q)) next.sort='efficiency'; else if(/fiber/.test(q)) next.sort='fiber'; else if(/protein/.test(q)) next.sort='protein';
    const corpus=new Set(products.flatMap(product=>[...searchableTokens(product)]));
    const structural=new Set(tokenize('best most highest lowest least minimum min maximum max at over under below no more than less with without avoid free vegan vegetarian ready now grab and go cheap budget value lean efficient efficiency protein calorie calories cal price dollar fiber sugar sodium gram g mg at least high low product find show me the for in of from'));
    const storeTokens=new Set(products.flatMap(p=>(p.stores||[]).flatMap(tokenize)));
    const categoryTokens=new Set(products.flatMap(p=>tokenize(p.category)));
    const textTokens=allTokens.filter(token=>corpus.has(token)&&!structural.has(token)&&!storeTokens.has(token)&&!categoryTokens.has(token));
    next.query=[...new Set(textTokens)].join(' ');
    next.unparsed=[...new Set(allTokens.filter(token=>!corpus.has(token)&&!structural.has(token)&&!storeTokens.has(token)&&!/^\d/.test(token)))];
    return normalize(next,[...new Set(products.map(p=>p.category))],[...new Set(products.flatMap(p=>p.stores||[]))]);
  }

  function applyTemplate(name,categories=[],stores=[]) { return normalize(TEMPLATES[name]||DEFAULT_SCREEN,categories,stores); }
  function paginate(results,requestedPage=1,pageSize=24){const size=Number.isInteger(pageSize)&&pageSize>0?pageSize:24,pageCount=Math.max(1,Math.ceil(results.length/size)),requested=Number(requestedPage),page=Math.min(pageCount,Math.max(1,Number.isInteger(requested)?requested:1)),offset=(page-1)*size,items=results.slice(offset,offset+size);return{items,page,pageCount,pageSize:size,totalResults:results.length,start:items.length?offset+1:0,end:offset+items.length};}
  const encode=screen=>btoa(unescape(encodeURIComponent(JSON.stringify(screen)))).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
  const decode=value=>{try{return JSON.parse(decodeURIComponent(escape(atob(String(value).replace(/-/g,'+').replace(/_/g,'/')))))}catch{return null}};
  global.ProductScreener=Object.freeze({CRITERIA,SORTS,EXCLUSIONS,TEMPLATES,DEFAULT_SCREEN,normalize,run,paginate,clauses,applyTemplate,bounds,compile,evaluate,getMetric,encode,decode,hasKnownPrice:p=>p.availability!=='demo-unavailable'&&Number.isFinite(p.pricePer25)});
})(typeof window==='undefined'?globalThis:window);
