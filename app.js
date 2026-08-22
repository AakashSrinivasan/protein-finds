const products=window.PROTEIN_PRODUCTS;
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const stored=JSON.parse(localStorage.getItem('protein-finds-state')||'{}');
const filterDefaults={role:[],store:[],vegan:false,soyFree:false,dairyFree:false,eggFree:false,steviaFree:false,glutenFree:false,restaurantOnly:false,simpleOnly:false,hideCrossContact:false,category:'all',useCase:'all',prep:'all',minProtein:0,maxCalories:99999,maxSugar:99999,maxServingPrice:99999,minFiber:0,maxSodium:99999};
const state={search:'',sort:'recommended',view:'grid',saved:new Set(stored.saved||[]),compare:new Set(),basket:stored.basket||[],savedOnly:false,filters:{...filterDefaults},visibleLimit:matchMedia('(max-width:620px)').matches?6:9,recommendation:null};
let lastFocus=null;
let deferredInstallPrompt=null;
const money=n=>`$${Number(n).toFixed(2)}`;
const byId=id=>products.find(p=>p.id===id);
const isAvailable=p=>p.availability!=='demo-unavailable';
const tier=p=>p.efficiency>=10?'elite':p.efficiency>=7?'strong':p.efficiency>=5?'support':'halo';
const persist=()=>localStorage.setItem('protein-finds-state',JSON.stringify({saved:[...state.saved],basket:state.basket}));
function track(event,data={}){const log=JSON.parse(localStorage.getItem('protein-finds-events')||'[]');log.push({event,data,at:new Date().toISOString()});localStorage.setItem('protein-finds-events',JSON.stringify(log.slice(-100)));}
function pageSize(){return matchMedia('(max-width:620px)').matches?6:9;}
function scoreProduct(p,priority='balanced',goal='day'){
  let score=p.efficiency*5+p.protein*1.5-p.pricePer25;
  if(p.role==='anchor')score+=12;
  if(priority==='efficiency')score+=p.efficiency*5;
  if(priority==='price')score-=p.pricePer25*5;
  if(priority==='simple')score+=p.simple?18:-4;
  if(priority==='convenience'||goal==='snack')score+=p.prep==='Ready now'?16:p.prep==='Heat'?5:-5;
  return score;
}
function allVisibleProducts(){
  let list=products.filter(p=>{
    const f=state.filters,q=state.search.trim().toLowerCase();
    const hay=[p.name,p.brand,p.category,p.base,p.use,p.blurb,p.ingredients,p.family,...p.useCases].join(' ').toLowerCase();
    if(q&&!hay.includes(q))return false;
    if(state.savedOnly&&!state.saved.has(p.id))return false;
    if(f.role.length&&!f.role.includes(p.role))return false;
    if(f.store.length&&!f.store.some(s=>p.stores.includes(s)))return false;
    for(const key of ['soyFree','dairyFree','eggFree','steviaFree','glutenFree'])if(f[key]&&!p[key])return false;
    if(f.vegan&&p.diet!=='vegan')return false;
    if(f.restaurantOnly&&p.category!=='Restaurant')return false;
    if(f.simpleOnly&&!p.simple)return false;
    if(f.hideCrossContact&&p.category==='Restaurant')return false;
    if(f.category!=='all'&&p.category!==f.category)return false;
    if(f.useCase!=='all'&&!p.useCases.includes(f.useCase))return false;
    if(f.prep!=='all'&&p.prep!==f.prep)return false;
    if(p.protein<f.minProtein||p.calories>f.maxCalories||p.sugar>f.maxSugar||p.price/p.servings>f.maxServingPrice||p.fiber<f.minFiber||p.sodium>f.maxSodium)return false;
    return true;
  });
  const sorters={efficiency:(a,b)=>b.efficiency-a.efficiency,protein:(a,b)=>b.protein-a.protein,price:(a,b)=>a.pricePer25-b.pricePer25,calories:(a,b)=>a.calories-b.calories,recommended:(a,b)=>scoreProduct(b)-scoreProduct(a)};
  return list.sort(sorters[state.sort]);
}
function visibleProducts(){return allVisibleProducts().slice(0,state.visibleLimit);}
function card(p){
  const saved=state.saved.has(p.id),comp=state.compare.has(p.id);
  return `<article class="product-card" data-card="${p.id}">
    <div class="card-heading"><div class="card-top"><span class="role ${p.role}">${p.role==='halo'?'protein halo':p.role}</span><span class="seed-stamp">seed · ${p.verified}</span></div><div class="availability ${isAvailable(p)?'listed':'unavailable'}">${p.availabilityLabel}</div><h3>${p.name}</h3><div class="brand-name">${p.brand} · ${p.category}</div><button class="family-link" data-family="${p.family}">${p.family}</button></div>
    <div class="metric-row"><div><b>${p.protein}g</b><span>protein</span></div><div><b>${p.calories}</b><span>calories</span></div><div><b>${p.efficiency}</b><span>g / 100 cal</span></div></div>
    <div class="efficiency-bar"><span style="width:${Math.min(100,p.efficiency/18*100)}%"></span></div>
    <p class="card-blurb">${p.blurb}</p><div class="tag-row"><span>${p.base}</span><span>${p.prep}</span><span>${p.fiber}g fiber</span><span>~${money(p.price/p.servings)}/serving</span></div>
    <div class="card-actions"><button data-open="${p.id}">Inspect</button><button data-save="${p.id}" aria-pressed="${saved}">${saved?'Saved':'Save'}</button><button data-compare="${p.id}" aria-pressed="${comp}">${comp?'Selected':'Compare'}</button></div>
  </article>`;
}
function activeFilterCount(){const f=state.filters;return f.role.length+f.store.length+['vegan','soyFree','dairyFree','eggFree','steviaFree','glutenFree','restaurantOnly','simpleOnly','hideCrossContact'].filter(k=>f[k]).length+['category','useCase','prep'].filter(k=>f[k]!=='all').length+['minProtein','minFiber'].filter(k=>f[k]>0).length+['maxCalories','maxSugar','maxServingPrice','maxSodium'].filter(k=>f[k]<99999).length;}
function renderCatalog(){
  const all=allVisibleProducts(),list=all.slice(0,state.visibleLimit);
  $('#catalog').className=`catalog ${state.view==='list'?'list':''}`;
  $('#catalog').innerHTML=list.length?list.map(card).join(''):'<div class="empty" role="status"><h3>No honest demo match.</h3><p>Relax one constraint or reset. The instrument will not invent a fit.</p><button class="button primary" data-reset-results>Reset search and filters</button></div>';
  $('#resultCount').textContent=`Showing ${list.length} of ${all.length} matching demo records · ${products.length} total`;
  $('#filterCount').textContent=activeFilterCount();
  $('#showSaved').textContent=state.savedOnly?'Showing saved · reset':'Show saved only';
  $('#loadMore').hidden=list.length>=all.length;
}
function resetFilters(){
  state.filters={...filterDefaults,role:[],store:[]};state.visibleLimit=pageSize();
  $$('[data-filter]').forEach(i=>{if(i.type==='checkbox')i.checked=false;else i.value=i.querySelector('option[value="all"]')?'all':i.querySelector('option[value="0"]')?'0':'99999';});
  renderCatalog();
}
function resetResults(){state.search='';state.savedOnly=false;$('#search').value='';resetFilters();$('#search').focus();}
function toggleSave(id){state.saved.has(id)?state.saved.delete(id):state.saved.add(id);persist();updateCounts();renderCatalog();}
function toggleCompare(id){if(state.compare.has(id))state.compare.delete(id);else if(state.compare.size<3)state.compare.add(id);else showModal('Three at a time','<p>Remove one comparison before adding another.</p>');updateCompare();renderCatalog();}
function updateCompare(){const n=state.compare.size;$('#compareCount').textContent=n;$('#compareTray').hidden=!n;}
function updateCounts(){$('#savedCount').textContent=state.saved.size;$('#basketCount').textContent=state.basket.length;}
function addBasket(id){const p=byId(id);if(!p||!isAvailable(p))return false;if(!state.basket.includes(id))state.basket.push(id);persist();updateCounts();renderBasket();return true;}
function removeBasket(id){state.basket=state.basket.filter(x=>x!==id);persist();updateCounts();renderBasket();}
function familyMembers(p){return products.filter(x=>x.family===p.family&&x.id!==p.id);}
function openFamily(name){const items=products.filter(p=>p.family===name);compare(items.map(p=>p.id),`${name} · decision family`);}
function openProduct(id){
  const p=byId(id);if(!p)return;const siblings=familyMembers(p);track('product_opened',{id});
  $('#detailContent').innerHTML=`<div class="detail-hero"><span class="role ${p.role}">${p.role==='halo'?'protein halo':p.role}</span><h2 id="detailTitle">${p.name}</h2><p>${p.brand} · ${p.category} · ${p.base}</p><p class="detail-summary">${p.blurb}</p></div>
  <div class="truth-banner"><b>Seeded demo record.</b> These values, date and availability are interaction fixtures—not a current exact-SKU claim.</div>
  <div class="detail-metrics"><div><strong>${p.protein}g</strong><span>protein</span></div><div><strong>${p.calories}</strong><span>calories</span></div><div><strong>${p.efficiency}</strong><span>g / 100 cal</span></div><div><strong>${p.proteinCalories}%</strong><span>calories from protein</span></div></div>
  <section class="dose-grid"><div><b>20g protein</b><span>${p.servingsFor20} servings · ${p.caloriesFor20} calories</span></div><div><b>30g protein</b><span>${p.servingsFor30} servings · ${p.caloriesFor30} calories</span></div></section>
  <section class="detail-section"><h3>Use and verdict</h3><p><b>Best use:</b> ${p.use}</p><p><b>Trade-off:</b> ${p.tradeoff}</p><p><b>Preparation:</b> ${p.prep}</p><p><b>Cross-contact:</b> ${p.crossContact}</p></section>
  <section class="detail-section family-panel"><h3>Decision family</h3><p><b>${p.family}</b></p>${siblings.length?`<p>${siblings.length} comparable demo ${siblings.length===1?'record':'records'} available.</p><button class="button ghost" data-family="${p.family}">Compare family</button>`:'<p>This is a singleton in the demo. Production acceptance requires a current exact-SKU sibling audit.</p>'}</section>
  <section class="detail-section ingredient-disclosure"><h3>Ingredient disclosure</h3><p>${p.ingredients}</p><small>${p.ingredientStatus}. Re-read the current exact package/menu for allergens and formula changes.</small></section>
  ${p.restaurantBuild?`<section class="detail-section restaurant-build"><h3>Restaurant build handoff</h3><p>${p.restaurantBuild}</p><p class="helper">This is a seeded build instruction; restaurant ingredients, portions and cross-contact require a fresh location check.</p></section>`:''}
  <section class="detail-section"><h3>Seed provenance</h3><p>${p.evidence} · seed date ${p.verified}</p><p>${p.sourceStatus}</p><a class="source-link" target="_blank" rel="noopener" href="${p.source}">${p.actionLabel} ↗</a></section>
  <section class="acquire"><h3>Action</h3><p>${p.availabilityLabel}. Estimated seed price ${money(p.price)}; no stock is checked.</p><div class="acquire-actions"><a class="button ghost" target="_blank" rel="noopener" href="${p.source}">${p.actionLabel}</a><button class="button primary" data-add="${p.id}" ${isAvailable(p)?'':'disabled'}>${isAvailable(p)?'Add to planning basket':'Unavailable in demo'}</button><button class="button ghost" data-swap="${p.id}" data-scope="detail">Find substitute</button></div></section>`;
  setDrawer('detailDrawer',true);
}
function setDrawer(id,open){const d=$('#'+id);if(open)lastFocus=document.activeElement;d.setAttribute('aria-hidden',String(!open));d.style.display=open?'block':'none';document.body.classList.toggle('locked',open);if(open)requestAnimationFrame(()=>$('.drawer-close',d)?.focus());else lastFocus?.focus?.();}
function swapCandidates(p){let list=products.filter(x=>x.id!==p.id&&isAvailable(x)&&x.family===p.family);if(!list.length)list=products.filter(x=>x.id!==p.id&&isAvailable(x)&&(x.category===p.category||x.role===p.role));return list.sort((a,b)=>scoreProduct(b)-scoreProduct(a)).slice(0,5);}
function openSwap(id,scope='basket'){
  const p=byId(id);if(!p)return;const occupied=scope==='recommendation'&&state.recommendation?state.recommendation.items.map(x=>x.id):scope==='basket'?state.basket:[];let alts=swapCandidates(p).filter(x=>!occupied.includes(x.id));if(!alts.length)alts=products.filter(x=>x.id!==p.id&&!occupied.includes(x.id)&&isAvailable(x)&&(x.role===p.role||x.locationType===p.locationType)).sort((a,b)=>scoreProduct(b)-scoreProduct(a)).slice(0,5);
  showModal(`Swap ${p.name}`,alts.length?`<p>Choose a seeded substitute. Nothing is ordered.</p><div class="swap-list">${alts.map(a=>`<button data-choose-swap="${a.id}" data-old="${p.id}" data-scope="${scope}"><b>${a.name}</b><span>${a.protein}g · ${a.calories} cal · ${a.efficiency}g/100 cal</span></button>`).join('')}</div>`:'<p>No substitute survives the current demo catalog.</p>');
}
function applySwap(oldId,newId,scope){
  if(scope==='recommendation'&&state.recommendation){state.recommendation.items=state.recommendation.items.map(x=>x.id===oldId?byId(newId):x);renderRecommendation();}
  else if(scope==='basket'){state.basket=state.basket.map(x=>x===oldId?newId:x).filter((x,i,a)=>a.indexOf(x)===i);persist();updateCounts();renderBasket();}
  else {setDrawer('detailDrawer',false);openProduct(newId);}closeModal();
}
function renderBasket(){
  const items=state.basket.map(byId).filter(Boolean),protein=items.reduce((n,p)=>n+p.protein,0),calories=items.reduce((n,p)=>n+p.calories,0),cost=items.reduce((n,p)=>n+p.price/p.servings,0);
  $('#basketContent').innerHTML=`<h2 id="basketTitle">Planning basket</h2><div class="truth-banner"><b>Seeded action rehearsal.</b> Quantities, price and availability require current exact listings.</div>${items.length?items.map(p=>`<div class="basket-line"><div><b>${p.name}</b><small>${p.protein}g · ${p.calories} cal · ~${money(p.price/p.servings)}/serving</small><a target="_blank" rel="noopener" href="${p.source}">${p.actionLabel} ↗</a></div><div class="basket-controls"><button data-swap="${p.id}" data-scope="basket">Swap</button><button data-remove="${p.id}" aria-label="Remove ${p.name}">Remove</button></div></div>`).join(''):`<div class="empty"><h3>Your basket is empty.</h3><p>Build a recommendation or add a demo product.</p></div>`}${items.length?`<div class="basket-total"><div><span>Seed protein</span><b>${protein}g</b></div><div><span>Seed calories</span><b>${calories}</b></div><div><span>Est. cost</span><b>${money(cost)}</b></div></div><div class="handoff"><h3>Outbound handoffs</h3><p>Open each exact source/listing above, or preview grouped handoff instructions. No order or payment is submitted.</p><button class="button primary" data-handoff="retailer">Retailer/source checklist</button>${items.some(p=>p.category==='Restaurant')?'<button class="button ghost" data-handoff="restaurant">Restaurant build handoff</button>':''}</div>`:''}`;
}
function showHandoff(type,items){
  const restaurant=items.filter(p=>p.category==='Restaurant'),picked=type==='restaurant'?restaurant:items;
  const title=type==='restaurant'?'Restaurant build handoff':'Retailer/source checklist';
  const body=`<div class="truth-banner">Seeded names only. Open the linked source and verify the exact current item, price, location, ingredients and stock.</div><ol class="handoff-list">${picked.map(p=>`<li><b>${p.brand} · ${p.name}</b>${p.restaurantBuild?`<p>${p.restaurantBuild}</p>`:''}<a target="_blank" rel="noopener" href="${p.source}">${p.actionLabel} ↗</a></li>`).join('')}</ol>`;
  showModal(title,body);
}
function buildBasket(form){
  const fd=new FormData(form),target=Number($('#target').value),constraints={vegan:fd.has('vegan'),soyFree:fd.has('soyFree'),dairyFree:fd.has('dairyFree'),eggFree:fd.has('eggFree'),steviaFree:fd.has('steviaFree'),glutenFree:fd.has('glutenFree')},priority=fd.get('priority'),store=fd.get('store'),goal=fd.get('goal');
  let candidates=products.filter(p=>isAvailable(p)&&p.role!=='halo'&&(!constraints.vegan||p.diet==='vegan')&&(!constraints.soyFree||p.soyFree)&&(!constraints.dairyFree||p.dairyFree)&&(!constraints.eggFree||p.eggFree)&&(!constraints.steviaFree||p.steviaFree)&&(!constraints.glutenFree||p.glutenFree)&&(store==='all'||p.stores.includes(store)));
  candidates.sort((a,b)=>scoreProduct(b,priority,goal)-scoreProduct(a,priority,goal));
  const chosen=[];
  for(const p of candidates){if(chosen.reduce((n,x)=>n+x.protein,0)>=target||chosen.length>=6)break;if(!chosen.some(x=>x.brand===p.brand))chosen.push(p);}
  for(const p of candidates){if(chosen.reduce((n,x)=>n+x.protein,0)>=target||chosen.length>=6)break;if(!chosen.includes(p))chosen.push(p);}
  state.recommendation={items:chosen,target,priority,constraints,goal,store,candidates};renderRecommendation();track('planner_completed',{target,count:chosen.length,protein:chosen.reduce((n,p)=>n+p.protein,0)});
}
function basketReason(items,priority){const anchors=items.filter(p=>p.role==='anchor').length;let why=`${anchors} ${anchors===1?'anchor':'anchors'} plus ${items.length-anchors} supporting ${items.length-anchors===1?'item':'items'}.`;if(priority==='efficiency')why+=' Protein return drove the order.';if(priority==='price')why+=' Seed cost per 25g carried extra weight.';if(priority==='simple')why+=' Simpler seeded bases were favored.';if(priority==='convenience')why+=' Ready-now options were favored.';return why;}
function renderRecommendation(){
  const r=state.recommendation,box=$('#recommendation');if(!r)return;const items=r.items,total=items.reduce((n,p)=>n+p.protein,0),cost=items.reduce((n,p)=>n+p.price/p.servings,0),short=Math.max(0,r.target-total),next=r.candidates.find(p=>!items.some(x=>x.id===p.id));
  box.hidden=false;box.innerHTML=`<div class="rec-head"><p class="section-number">BASKET OUTPUT</p><h3>${items.length} practical picks · ${total}g seeded protein</h3><p>${basketReason(items,r.priority)}</p><div class="target-status ${short?'short':'met'}">${short?`Short by <b>${short}g</b> against the ${r.target}g request.`:`Target met: <b>${total}g</b> covers the ${r.target}g request.`}${short?(next?` Next substitute/addition: <b>${next.name}</b> (+${next.protein}g).`:' No eligible substitute remains under these constraints.') :''}</div></div><div class="rec-items">${items.map((p,i)=>`<article><span>0${i+1}</span><div><h4>${p.name}</h4><p>${p.protein}g · ${p.calories} cal · ${p.efficiency}g/100 cal</p><small>${p.use}</small></div><button data-swap="${p.id}" data-scope="recommendation">Swap</button></article>`).join('')}</div><div class="rec-footer"><div><span>Est. seed total</span><b>${money(cost)}</b><small>one serving each · not a live quote</small></div>${short&&next?`<button class="button ghost" data-add-next="${next.id}">Add next substitute</button>`:''}<button id="useRec" class="button primary">Use this basket</button></div>`;
  box.scrollIntoView({behavior:'smooth',block:'start'});
}
function compare(ids=[...state.compare],title='Side-by-side demo comparison'){
  const items=ids.map(byId).filter(Boolean);if(!items.length)return;const rows=[['Protein',p=>`${p.protein}g`],['Calories',p=>p.calories],['Protein return',p=>`${p.efficiency} g/100 cal`],['Protein-calorie share',p=>`${p.proteinCalories}%`],['20g requires',p=>`${p.servingsFor20} servings · ${p.caloriesFor20} cal`],['30g requires',p=>`${p.servingsFor30} servings · ${p.caloriesFor30} cal`],['Seed cost / 25g',p=>money(p.pricePer25)],['Sugar',p=>`${p.sugar}g`],['Fiber',p=>`${p.fiber}g`],['Sodium',p=>`${p.sodium}mg`],['Base',p=>p.base],['Preparation',p=>p.prep],['Availability',p=>p.availabilityLabel],['Ingredient disclosure',p=>p.ingredients],['Family',p=>p.family],['Verdict',p=>p.tradeoff]];
  showModal(title,`<div class="truth-banner">All values are seeded demo records; open current exact sources before acting.</div><div class="compare-scroll"><table class="compare-table"><thead><tr><th>Dimension</th>${items.map(p=>`<th>${p.name}</th>`).join('')}</tr></thead><tbody>${rows.map(([label,fn])=>`<tr><th>${label}</th>${items.map(p=>`<td>${fn(p)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
}
function showModal(title,body){lastFocus=document.activeElement;$('#modalTitle')?.remove();$('#modalContent').innerHTML=`<h2 id="modalTitle">${title}</h2>${body}`;$('#modal').hidden=false;document.body.classList.add('locked');requestAnimationFrame(()=>$('#modal .drawer-close')?.focus());}
function closeModal(){$('#modal').hidden=true;document.body.classList.remove('locked');lastFocus?.focus?.();}
function activeLayer(){if(!$('#modal').hidden)return $('#modal');for(const id of ['detailDrawer','basketDrawer']){const el=$('#'+id);if(el.getAttribute('aria-hidden')==='false')return el;}return null;}
function trapFocus(e,layer){const focusable=$$('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',layer).filter(el=>el.offsetParent!==null);if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
document.addEventListener('keydown',e=>{const layer=activeLayer();if(!layer)return;if(e.key==='Escape'){e.preventDefault();if(layer.id==='modal')closeModal();else setDrawer(layer.id,false);}else if(e.key==='Tab')trapFocus(e,layer);});
document.addEventListener('click',e=>{
  if(e.target.closest('[data-close-drawer]')){setDrawer('detailDrawer',false);return;}
  if(e.target.closest('[data-close-basket]')){setDrawer('basketDrawer',false);return;}
  if(e.target.closest('[data-close-modal]')){closeModal();return;}
  const b=e.target.closest('button,a');if(!b)return;
  if(b.dataset.open)openProduct(b.dataset.open);
  if(b.dataset.save)toggleSave(b.dataset.save);
  if(b.dataset.compare)toggleCompare(b.dataset.compare);
  if(b.dataset.add){if(addBasket(b.dataset.add)){setDrawer('detailDrawer',false);setDrawer('basketDrawer',true);}}
  if(b.dataset.remove)removeBasket(b.dataset.remove);
  if(b.dataset.swap)openSwap(b.dataset.swap,b.dataset.scope);
  if(b.dataset.chooseSwap)applySwap(b.dataset.old,b.dataset.chooseSwap,b.dataset.scope);
  if(b.dataset.family)openFamily(b.dataset.family);
  if(b.dataset.resetResults!==undefined)resetResults();
  if(b.dataset.handoff)showHandoff(b.dataset.handoff,state.basket.map(byId).filter(Boolean));
  if(b.dataset.addNext&&state.recommendation){state.recommendation.items.push(byId(b.dataset.addNext));renderRecommendation();}
  if(b.hasAttribute('data-close-drawer'))setDrawer('detailDrawer',false);
  if(b.hasAttribute('data-close-basket'))setDrawer('basketDrawer',false);
  if(b.hasAttribute('data-close-modal'))closeModal();
  if(b.hasAttribute('data-open-planner')){$('#planner').scrollIntoView({behavior:'smooth'});$('#target').focus({preventScroll:true});}
});
$('#search').oninput=e=>{state.search=e.target.value;state.visibleLimit=pageSize();renderCatalog();};
$('#sort').onchange=e=>{state.sort=e.target.value;state.visibleLimit=pageSize();renderCatalog();track('sort_used',{sort:state.sort});};
$('#filterToggle').onclick=()=>{const p=$('#filterPanel'),show=p.hidden;p.hidden=!show;$('#filterToggle').setAttribute('aria-expanded',String(show));};
$$('[data-filter]').forEach(i=>i.onchange=()=>{const k=i.dataset.filter;if(['role','store'].includes(k))state.filters[k]=$$(`[data-filter="${k}"]:checked`).map(x=>x.value);else if(['minProtein','maxCalories','maxSugar','maxServingPrice','minFiber','maxSodium'].includes(k))state.filters[k]=Number(i.value);else if(['category','useCase','prep'].includes(k))state.filters[k]=i.value;else state.filters[k]=i.checked;state.visibleLimit=pageSize();renderCatalog();track('filter_used',{filter:k});});
$('#clearFilters').onclick=resetFilters;
$('#loadMore').onclick=()=>{state.visibleLimit+=pageSize();renderCatalog();};
$$('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;$$('[data-view]').forEach(x=>x.classList.toggle('active',x===b));renderCatalog();});
$('#showSaved').onclick=()=>{state.savedOnly=!state.savedOnly;state.visibleLimit=pageSize();renderCatalog();};
$('#savedNav').onclick=()=>{state.savedOnly=true;state.visibleLimit=pageSize();renderCatalog();$('#finder').scrollIntoView({behavior:'smooth'});};
$('#basketNav').onclick=()=>{renderBasket();setDrawer('basketDrawer',true);};
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;$('#installNav').textContent='Install app';});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;$('#installNav').textContent='Installed';$('#installNav').disabled=true;track('app_installed');});
$('#installNav').onclick=async()=>{
  if(deferredInstallPrompt){deferredInstallPrompt.prompt();const choice=await deferredInstallPrompt.userChoice;track('install_prompt',{outcome:choice.outcome});deferredInstallPrompt=null;return;}
  showModal('Put Protein Finds on your phone','<div class="install-steps"><p><b>iPhone / iPad</b><br>Open this page in Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.</p><p><b>Android</b><br>Open this page in Chrome, open the menu, then tap <b>Install app</b> or <b>Add to Home screen</b>.</p><p class="helper">It opens like an app and costs nothing. Updates arrive from the same web address.</p></div>');
};
$('#compareOpen').onclick=()=>compare();
$('#compareClear').onclick=()=>{state.compare.clear();updateCompare();renderCatalog();};
$('#target').oninput=e=>$('#targetOut').value=`${e.target.value}g`;
$('#plannerForm').onsubmit=e=>{e.preventDefault();buildBasket(e.target);};
document.addEventListener('click',e=>{if(e.target.id==='useRec'&&state.recommendation){state.basket=[...new Set([...state.basket,...state.recommendation.items.map(p=>p.id)])];persist();updateCounts();renderBasket();setDrawer('basketDrawer',true);}});
setDrawer('detailDrawer',false);setDrawer('basketDrawer',false);updateCounts();updateCompare();renderCatalog();renderBasket();track('landing_view',{products:products.length,data:'seeded-demo'});
if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./service-worker.js').catch(error=>console.warn('Offline install unavailable',error));
window.ProteinFinds={products,state,visibleProducts,allVisibleProducts,buildBasket,scoreProduct,tier,openSwap};
