'use strict';
// Executes the production browser scripts in an isolated VM. No browser/Google/
// payment traffic. A script's onload is deliberately controlled by each test.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const root = path.join(__dirname, '..');
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('PASS ' + name); }
function page({host = 'localhost', query = '', consent, storage = {}, testId = 'G-TESTLOCAL1', blockedStorage = false} = {}) {
  const listeners = {}, scripts = [], elements = {}, timers = [];
  if (consent) storage.vinko_consent = consent;
  function el() { return {hidden:false, textContent:'', href:'', className:'',
    classList:{add(){}}, setAttribute(){}, remove(){this.removed=true;},
    addEventListener(n,f){this[n]=f;}}; }
  const ready = el(), loading = el(), fallback = el(), link = el();
  Object.assign(elements, {'[data-vk-ty-ready]':ready,'[data-vk-ty-loading]':loading,
    '[data-vk-ty-email]':fallback,'[data-vk-ty-link]':link,
    '[data-vk-allow]':el(),'[data-vk-deny]':el()});
  const localStorage = {getItem(k){if(blockedStorage) throw Error('blocked'); return storage[k] ?? null;},
    setItem(k,v){if(blockedStorage) throw Error('blocked'); storage[k]=v;}};
  const session = {};
  const document = {readyState:'complete', querySelector:s=>elements[s] || null,
    querySelectorAll:()=>[], createElement:tag=>{const e=el(); e.tagName=tag;
      e.querySelector=s=>elements[s] || null; return e;},
    head:{appendChild:e=>scripts.push(e)}, body:{firstChild:null, insertBefore:e=>{elements.banner=e;}}};
  const c = {document, location:{hostname:host, search:query}, localStorage,
    sessionStorage:{getItem:k=>session[k] || null}, URLSearchParams, Date, console,
    CustomEvent:function(n){this.type=n;},
    setTimeout:f=>timers.push(f), clearTimeout(){}, setInterval(){}, clearInterval(){},
    addEventListener(n,f){(listeners[n] ||= []).push(f);},
    dispatchEvent(e){for(const f of listeners[e.type] || []) f(e);}};
  c.window=c;
  c.VINKO_CONFIG={ANALYTICS:{GA4_ID:'G-W9W53C5DWS',GA4_TEST_ID:testId}};
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root,'assets/js/site.js'),'utf8'),c);
  return {c,storage,scripts,elements,session,timers,
    runThankYou(payload){c.fetch=async()=>({json:async()=>payload});
      vm.runInContext(fs.readFileSync(path.join(root,'assets/js/thank-you.js'),'utf8'),c);},
    load(){scripts[0].onload();}, allow(){elements['[data-vk-allow]'].click();},
    events(){return (c.dataLayer || []).filter(x=>x[0]==='event');}};
}
const utm='?utm_source=Offline&utm_medium=xstand&utm_campaign=t21korat_sep2026&utm_content=qr_xs_a_line_01&activation_id=QR-XS-A-LINE-01__T21KORAT-2026-09__r01';
const p={transaction_id:'VK-2609-9001',value:399,currency:'THB',item_id:'BUNDLE',item_name:'VINKO BUNDLE',payment_mode:'test'};
const delivery={ok:true,ready:true,download_url:'/download?token=TEST_FIXTURE',purchase:p};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  let x=page({query:utm});
  check('no analytics script or attribution writes before consent',()=>{
    assert.equal(x.scripts.length,0); assert.equal(x.storage.vinko_attr,undefined);
    assert.equal(x.c.VINKO.track('free_sample_download'),false);
    assert.equal(x.events().length,0);
  });
  x.allow();
  check('grant stores first/last touch and preserves activation case',()=>{
    const a=JSON.parse(x.storage.vinko_attr); assert.equal(a.first.utm_source,'offline');
    assert.equal(a.last.activation_id,'QR-XS-A-LINE-01__T21KORAT-2026-09__r01');
    assert.equal(x.scripts.length,1); assert.match(x.scripts[0].src,/G-TESTLOCAL1$/);
  });
  check('gtag queue alone is not readiness',()=>assert.equal(x.c.VINKO.track('free_sample_download'),false));
  x.load();
  check('event has explicit test destination and separate first/last attribution',()=>{
    assert.equal(x.c.VINKO.track('free_sample_download',{entry:'web'}),true);
    const e=x.events()[0][2]; assert.equal(e.send_to,'G-TESTLOCAL1');
    assert.equal(e.first_utm_source,'offline'); assert.equal(e.last_utm_campaign,'t21korat_sep2026');
    assert.equal(e.activation_id,'QR-XS-A-LINE-01__T21KORAT-2026-09__r01');
    assert.equal(e.utm_id,undefined);
  });
  let next=page({query:'?utm_source=line&utm_medium=line_broadcast&utm_campaign=followup',storage:x.storage}); next.load();
  check('second campaign updates last touch and retains first',()=>{
    next.c.VINKO.track('purchase',p); const e=next.events()[0][2];
    assert.equal(e.first_utm_source,'offline'); assert.equal(e.last_utm_source,'line');
  });
  let direct=page({storage:x.storage}); direct.load(); direct.c.VINKO.track('purchase',p);
  check('direct navigation retains last non-direct purchase attribution',()=>assert.equal(direct.events()[0][2].last_utm_source,'line'));
  for(const host of ['localhost','127.0.0.1','preview.vercel.app','vinko.quest.evil.example']) {
    const no=page({host,consent:'granted',testId:''});
    check(host+' never loads production ID when test ID absent',()=>assert.equal(no.scripts.length,0));
    const same=page({host,consent:'granted',testId:'G-W9W53C5DWS'});
    check(host+' rejects production ID accidentally used as test ID',()=>assert.equal(same.scripts.length,0));
  }
  for(const host of ['vinko.quest','www.vinko.quest']) {
    const prod=page({host,consent:'granted'}); prod.load();
    check(host+' refuses test and unknown purchases even with consent',()=>{
      for(const mode of ['test','unknown',undefined]) assert.equal(prod.c.VINKO.track('purchase',{...p,payment_mode:mode}),false);
      assert.equal(prod.events().length,0);
    });
    check(host+' sends only server-verified live purchase to production ID',()=>{
      assert.equal(prod.c.VINKO.track('purchase',{...p,payment_mode:'live'}),true);
      assert.equal(prod.events()[0][2].send_to,'G-W9W53C5DWS');
    });
  }
  const denied=page({consent:'denied',query:utm});
  check('deny consent neither loads tags nor captures attribution',()=>{
    assert.equal(denied.scripts.length,0); assert.equal(denied.storage.vinko_attr,undefined);
  });
  const stale=page({consent:'denied',storage:{vinko_attr:'{"first":{"utm_source":"offline"}}'}});
  check('attribution is not exposed without current consent',()=>assert.equal(Object.keys(stale.c.VINKO.attribution()).length,0));
  const bad=page({consent:'granted'}); bad.scripts[0].onerror();
  check('tag loading error does not claim event was sent',()=>assert.equal(bad.c.VINKO.track('purchase',p),false));

  x=page({query:'?ref=VK-2609-9001'+utm.replace('?','&')});
  x.session.vinko_last_order=JSON.stringify({ref:p.transaction_id,rid:'fixture-rid-123456789'});
  x.runThankYou(delivery); await tick();
  check('delivery works before consent and purchase remains unsent',()=>{
    assert.equal(x.elements['[data-vk-ty-ready]'].hidden,false);
    assert.equal(x.elements['[data-vk-ty-link]'].href,delivery.download_url);
    assert.equal(x.storage['vinko_ga_purchase_sent:'+p.transaction_id],undefined);
  });
  x.allow();
  check('late consent still waits for loader and sets no premature flag',()=>assert.equal(x.events().length,0));
  x.load();
  check('late loader dispatch sends pending purchase once with correct items',()=>{
    assert.equal(x.events().length,1); const e=x.events()[0][2];
    assert.equal(e.transaction_id,p.transaction_id); assert.equal(e.value,399);
    assert.equal(e.items[0].item_id,'BUNDLE'); assert.equal(e.items[0].quantity,1);
    assert.equal(x.storage['vinko_ga_purchase_sent:'+p.transaction_id],'1');
  });
  x.c.dispatchEvent({type:'vinko:consent-granted'}); x.c.dispatchEvent({type:'vinko:analytics-ready'});
  check('repeated readiness/consent does not send twice',()=>assert.equal(x.events().length,1));
  const refreshed=page({consent:'granted',storage:x.storage,query:'?ref='+p.transaction_id});
  refreshed.session.vinko_last_order=x.session.vinko_last_order; refreshed.load();
  refreshed.runThankYou(delivery); await tick();
  check('refresh keeps delivery and suppresses repeated transaction',()=>{
    assert.equal(refreshed.events().length,0); assert.equal(refreshed.elements['[data-vk-ty-ready]'].hidden,false);
  });
  for(const kind of ['blocked-tag','throwing-gtag','no-test-id','blocked-storage']) {
    const b=page({consent:'granted',testId:kind==='no-test-id'?'':'G-TESTLOCAL1',blockedStorage:kind==='blocked-storage'});
    b.session.vinko_last_order=JSON.stringify({ref:p.transaction_id,rid:'fixture-rid-123456789'});
    if(kind==='blocked-storage') b.allow();
    if(kind!=='blocked-tag' && b.scripts.length) b.load();
    if(kind==='throwing-gtag') b.c.gtag=()=>{throw Error('analytics failure');};
    b.runThankYou(delivery); await tick();
    check(kind+' never prevents file delivery',()=>assert.equal(b.elements['[data-vk-ty-link]'].href,delivery.download_url));
    if(kind!=='blocked-storage') check(kind+' does not set sent flag',()=>assert.equal(b.storage['vinko_ga_purchase_sent:'+p.transaction_id],undefined));
    else {
      b.c.dispatchEvent({type:'vinko:consent-granted'});
      check('blocked storage still deduplicates within the page',()=>assert.equal(b.events().length,1));
    }
  }
  console.log(`\nTracking: ${passed} passed, 0 failed (VM only; no GA4 receipt claimed).`);
})().catch(e=>{console.error(e);process.exitCode=1;});
