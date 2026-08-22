'use strict';

const imageContract = () => ({
  front: {status: 'needed', sourceId: null, license: null, exactPackage: null},
  nutrition: {status: 'needed', sourceId: null, license: null, exactPackage: null},
  ingredients: {status: 'needed', sourceId: null, license: null, exactPackage: null}
});

module.exports = {
  version: 'protein-finds.catalog.v0',
  generatedAt: '2026-08-22T00:00:00Z',
  fixtureNotice: 'Demonstration records for contract tests. Observations are historical examples, not current price, inventory, or package claims.',
  products: [
    {
      id: 'product-nasoya-extra-firm-tofu-14oz',
      kind: 'packaged',
      name: 'Organic Extra Firm Tofu',
      category: 'tofu-tempeh',
      markets: ['mainstream-grocery'],
      identity: {brand: 'Nasoya', variant: 'Organic Extra Firm', packageSize: {value: 14, unit: 'oz'}, upc: null},
      dietaryTags: ['vegetarian', 'vegan', 'gluten-free', 'soy'],
      images: imageContract()
    },
    {
      id: 'product-lentils-cooked-generic',
      kind: 'whole-food',
      name: 'Lentils, mature seeds, cooked',
      category: 'beans-lentils',
      markets: ['mainstream-grocery'],
      identity: {brand: null, variant: 'generic cooked food', packageSize: null, upc: null},
      dietaryTags: ['vegetarian', 'vegan', 'gluten-free', 'legume'],
      images: imageContract()
    },
    {
      id: 'product-deep-paneer-12oz',
      kind: 'packaged',
      name: 'Paneer',
      category: 'indian-dairy',
      markets: ['indian-grocery'],
      identity: {brand: 'Deep', variant: null, packageSize: {value: 12, unit: 'oz'}, upc: null},
      dietaryTags: ['vegetarian', 'dairy'],
      images: imageContract()
    },
    {
      id: 'product-broccoli-raw-generic',
      kind: 'whole-food',
      name: 'Broccoli, raw',
      category: 'produce',
      markets: ['mainstream-grocery'],
      identity: {brand: null, variant: 'generic raw produce', packageSize: null, upc: null},
      dietaryTags: ['vegetarian', 'vegan', 'gluten-free', 'produce'],
      images: imageContract()
    }
  ],
  stores: [
    {
      id: 'store-target-sunnyvale',
      name: 'Target Sunnyvale',
      kind: 'retailer-location',
      location: {city: 'Sunnyvale', region: 'CA', country: 'US'},
      externalId: null
    },
    {
      id: 'store-indian-grocery-demo',
      name: 'Indian grocery demo location',
      kind: 'fixture-location',
      location: {city: 'Sunnyvale', region: 'CA', country: 'US'},
      externalId: null
    }
  ],
  sources: [
    {
      id: 'source-nasoya-product-page',
      kind: 'manufacturer-product-page',
      title: 'Nasoya Organic Extra Firm Tofu product page',
      publisher: 'Nasoya',
      locator: 'https://www.nasoya.com/products/organic-extra-firm-tofu/',
      accessedAt: '2026-08-13T12:00:00Z'
    },
    {
      id: 'source-target-search-tofu',
      kind: 'retailer-search-page',
      title: 'Target tofu search fixture source',
      publisher: 'Target',
      locator: 'https://www.target.com/s?searchTerm=nasoya+extra+firm+tofu',
      accessedAt: '2026-08-13T12:05:00Z'
    },
    {
      id: 'source-usda-lentils-search',
      kind: 'government-database-search',
      title: 'USDA FoodData Central lentils search',
      publisher: 'USDA',
      locator: 'https://fdc.nal.usda.gov/food-search/?query=lentils%20mature%20seeds%20cooked',
      accessedAt: '2026-08-13T12:10:00Z'
    },
    {
      id: 'source-deep-paneer-search',
      kind: 'manufacturer-search-page',
      title: 'Deep Foods paneer search fixture source',
      publisher: 'Deep Foods',
      locator: 'https://deepfoods.com/search?q=paneer',
      accessedAt: '2026-08-13T12:15:00Z'
    },
    {
      id: 'source-usda-broccoli-search',
      kind: 'government-database-search',
      title: 'USDA FoodData Central broccoli search',
      publisher: 'USDA',
      locator: 'https://fdc.nal.usda.gov/food-search/?query=broccoli%20raw',
      accessedAt: '2026-08-13T12:20:00Z'
    }
  ],
  observations: [
    {
      id: 'obs-tofu-nutrition-manufacturer',
      productId: 'product-nasoya-extra-firm-tofu-14oz',
      storeId: null,
      field: 'nutrition',
      value: {servingSize: {value: 85, unit: 'g'}, calories: 90, proteinG: 9, fiberG: 1, sodiumMg: 10},
      sourceId: 'source-nasoya-product-page',
      observedAt: '2026-08-13T12:00:00Z',
      verificationState: 'conflict'
    },
    {
      id: 'obs-tofu-nutrition-retailer',
      productId: 'product-nasoya-extra-firm-tofu-14oz',
      storeId: 'store-target-sunnyvale',
      field: 'nutrition',
      value: {servingSize: {value: 85, unit: 'g'}, calories: 80, proteinG: 9, fiberG: 1, sodiumMg: 10},
      sourceId: 'source-target-search-tofu',
      observedAt: '2026-08-13T12:05:00Z',
      verificationState: 'conflict'
    },
    {
      id: 'obs-tofu-ingredients',
      productId: 'product-nasoya-extra-firm-tofu-14oz',
      storeId: null,
      field: 'ingredients',
      value: {text: null, normalized: null, reasonUnknown: 'Exact current package panel was not captured.'},
      sourceId: 'source-nasoya-product-page',
      observedAt: '2026-08-13T12:00:00Z',
      verificationState: 'unverified'
    },
    {
      id: 'obs-tofu-price-target',
      productId: 'product-nasoya-extra-firm-tofu-14oz',
      storeId: 'store-target-sunnyvale',
      field: 'price',
      value: {amount: 2.49, currency: 'USD'},
      sourceId: 'source-target-search-tofu',
      observedAt: '2026-08-13T12:05:00Z',
      verificationState: 'unverified'
    },
    {
      id: 'obs-tofu-availability-target',
      productId: 'product-nasoya-extra-firm-tofu-14oz',
      storeId: 'store-target-sunnyvale',
      field: 'availability',
      value: {status: 'unknown', reasonUnknown: 'Search result did not prove location-level stock.'},
      sourceId: 'source-target-search-tofu',
      observedAt: '2026-08-13T12:05:00Z',
      verificationState: 'unverified'
    },
    {
      id: 'obs-lentils-nutrition',
      productId: 'product-lentils-cooked-generic',
      storeId: null,
      field: 'nutrition',
      value: {servingSize: {value: 100, unit: 'g'}, calories: 116, proteinG: 9.02, fiberG: 7.9, sodiumMg: 2},
      sourceId: 'source-usda-lentils-search',
      observedAt: '2026-08-13T12:10:00Z',
      verificationState: 'unverified'
    },
    {
      id: 'obs-paneer-ingredients',
      productId: 'product-deep-paneer-12oz',
      storeId: 'store-indian-grocery-demo',
      field: 'ingredients',
      value: {text: null, normalized: null, reasonUnknown: 'No exact-package ingredient image is licensed or verified.'},
      sourceId: 'source-deep-paneer-search',
      observedAt: '2026-08-13T12:15:00Z',
      verificationState: 'unverified'
    },
    {
      id: 'obs-broccoli-nutrition',
      productId: 'product-broccoli-raw-generic',
      storeId: null,
      field: 'nutrition',
      value: {servingSize: {value: 100, unit: 'g'}, calories: 34, proteinG: 2.82, fiberG: 2.6, sodiumMg: 33},
      sourceId: 'source-usda-broccoli-search',
      observedAt: '2026-08-13T12:20:00Z',
      verificationState: 'unverified'
    }
  ],
  conflicts: [
    {
      id: 'conflict-tofu-calories',
      productId: 'product-nasoya-extra-firm-tofu-14oz',
      field: 'nutrition.calories',
      observationIds: ['obs-tofu-nutrition-manufacturer', 'obs-tofu-nutrition-retailer'],
      status: 'open',
      resolution: null,
      reviewNote: 'Do not choose either calorie value until the exact package identity and current panel are verified.'
    }
  ]
};
