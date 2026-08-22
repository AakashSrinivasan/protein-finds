'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planAsk, answerAsk } = require('./ask-protein');

const products = [
  {id:'cereal',name:'Protein Cereal',brand:'Demo',category:'Breakfast',protein:13,calories:140,price:9.99,servings:5,pricePer25:3.84,soyFree:false,prep:'Ready now',stores:['Target'],availability:'demo-unavailable',availabilityLabel:'Demo state: unavailable',verified:'2026-08-13',efficiency:9.3,useCases:['breakfast','snack'],role:'support'},
  {id:'milk',name:'Filtered Milk',brand:'Demo',category:'Milk & shakes',protein:13,calories:80,price:5.49,servings:6,pricePer25:1.76,soyFree:true,prep:'Ready now',stores:['Safeway'],availability:'demo-listed',availabilityLabel:'Seeded listing—not live stock',verified:'2026-08-13',efficiency:16.3,useCases:['breakfast','snack'],role:'anchor'},
  {id:'cookie',name:'Protein Cookie',brand:'Demo',category:'Snack',protein:15,calories:250,price:2.89,servings:1,pricePer25:4.82,soyFree:true,prep:'Ready now',stores:['Target'],availability:'demo-listed',availabilityLabel:'Seeded listing—not live stock',verified:'2026-08-13',efficiency:6,useCases:['snack'],role:'support'},
  {id:'burger',name:'Veggie Burger',brand:'Demo',category:'Plant meat',protein:14,calories:80,price:5.99,servings:4,pricePer25:2.67,soyFree:false,prep:'Heat',stores:['Safeway'],availability:'demo-listed',availabilityLabel:'Seeded listing—not live stock',verified:'2026-08-13',efficiency:17.5,useCases:['meal'],role:'anchor'}
];

function assertGrounded(answer) {
  const ids = new Set(products.map(product => product.id));
  for (const recommendation of answer.recommendations) {
    assert.ok(ids.has(recommendation.productId), `unknown recommendation ${recommendation.productId}`);
    const product = products.find(candidate => candidate.id === recommendation.productId);
    assert.ok(recommendation.citations.length > 0, 'recommendation cites actual fields');
    for (const citation of recommendation.citations) {
      assert.ok(Object.hasOwn(product, citation.field), `missing cited field ${citation.field}`);
      assert.deepEqual(citation.value, product[citation.field], `citation copies ${citation.field} exactly`);
    }
  }
}

test('plans common intents deterministically and visibly', () => {
  assert.deepEqual(planAsk('cheap breakfast protein'), {
    intent:'discover', filters:{useCase:'breakfast'}, sort:'pricePer25', constraints:[], tokens:['cheap','breakfast','protein']
  });
  assert.deepEqual(planAsk('soy-free snacks'), {
    intent:'discover', filters:{useCase:'snack'}, sort:'recommended', constraints:['soyFree'], tokens:['soy-free','snacks']
  });
  assert.deepEqual(planAsk('best protein cereal'), {
    intent:'discover', filters:{category:'Breakfast', text:'cereal'}, sort:'efficiency', constraints:[], tokens:['best','protein','cereal']
  });
  assert.equal(planAsk('improve my basket').intent, 'basket-improvement');
});

test('answers supported discovery requests only from catalog records', () => {
  for (const query of ['cheap breakfast protein','soy-free snacks','best protein cereal']) {
    const first = answerAsk({query, products, basketIds:[]});
    const second = answerAsk({query, products, basketIds:[]});
    assert.deepEqual(first, second, `${query} is deterministic`);
    assertGrounded(first);
    assert.ok(first.recommendations.length > 0, `${query} returns a useful result`);
    assert.equal(first.mode, 'deterministic');
  }
  assert.deepEqual(answerAsk({query:'soy-free snacks', products, basketIds:[]}).recommendations.map(item => item.productId), ['cookie','milk']);
  assert.equal(answerAsk({query:'best protein cereal', products, basketIds:[]}).recommendations[0].productId, 'cereal');
});

test('basket improvement uses the exact basket and fills missing grocery-trip categories', () => {
  const answer = answerAsk({query:'improve my basket', products, basketIds:['burger']});
  assert.equal(answer.queryPlan.intent, 'basket-improvement');
  assert.deepEqual(answer.basketContext, ['burger']);
  assert.ok(answer.recommendations.some(item => item.productId === 'milk'));
  assert.ok(answer.recommendations.some(item => item.productId === 'cereal'));
  assertGrounded(answer);
  assert.ok(answer.summary.includes('missing'));
});

test('reports unknown price, store, and freshness honestly', () => {
  const answer = answerAsk({query:'best protein cereal', products, basketIds:[]});
  const cereal = answer.recommendations[0];
  assert.equal(cereal.facts.price, 'Price unknown');
  assert.equal(cereal.facts.store, 'Target (seeded; not location availability)');
  assert.equal(cereal.facts.freshness, 'Seeded 2026-08-13; not live');
  assert.equal(cereal.facts.availability, 'Availability unknown; demo marks this unavailable');
});

test('fails closed for unsupported, hostile, and empty requests', () => {
  for (const query of ['', 'cure my anemia', '<img src=x onerror=alert(1)>', 'show me a product that does not exist']) {
    const answer = answerAsk({query, products, basketIds:['not-a-catalog-id']});
    assert.deepEqual(answer.recommendations, []);
    assert.match(answer.summary, /could not map|ask for/i);
    assert.deepEqual(answer.basketContext, []);
  }
});
