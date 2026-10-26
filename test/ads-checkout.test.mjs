import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,StrKey} from '@stellar/stellar-sdk';
import {readCheckoutPolicy,purchaseEligibility,assertPurchaseAllowed,operationalConfigurationReady} from '../server/ads/checkout.mjs';
import {publicAdsConfig} from '../server/ads/config.mjs';
import {createAdsHandler} from '../server/ads/http.mjs';
const a=StrKey.encodeContract(Buffer.alloc(32,11)),b=StrKey.encodeContract(Buffer.alloc(32,12)),origin='https://ads.example';
const cfg={enabled:true,checkoutMode:'CONTROLLED',allowedBuyers:[a],missing:[],origin,limits:{},network:'stellar:testnet',publisherToken:''};
test('controlled purchases accept only a valid explicit C-wallet allowlist and fail closed for malformed policy',()=>{
 assert.deepEqual(readCheckoutPolicy({ADS_CHECKOUT_MODE:'CONTROLLED',ADS_ALLOWED_BUYERS_JSON:JSON.stringify([a,a])}).allowedBuyers,[a]);
 for(const value of ['oops',JSON.stringify([Keypair.random().publicKey()]),JSON.stringify({address:a})])assert(readCheckoutPolicy({ADS_CHECKOUT_MODE:'CONTROLLED',ADS_ALLOWED_BUYERS_JSON:value}).missing.includes('ADS_ALLOWED_BUYERS'));
 assert(readCheckoutPolicy({ADS_CHECKOUT_MODE:'CONTROLLED'}).missing.includes('ADS_ALLOWED_BUYERS'));assert(readCheckoutPolicy({ADS_CHECKOUT_MODE:'PUBLIK'}).missing.includes('ADS_CHECKOUT_MODE'));
 assert.equal(readCheckoutPolicy({}).checkoutMode,'DISABLED');
});
test('purchase eligibility has no operator bypass and never exposes the buyer list publicly',()=>{
 assert(purchaseEligibility(cfg,{address:a}).canPurchase);assert(!purchaseEligibility(cfg,{address:b,role:'operator'}).canPurchase);
 assert.throws(()=>assertPurchaseAllowed(cfg,{address:b}),e=>e.code==='controlled_buyer_required');
 const publicValue=JSON.stringify(publicAdsConfig(cfg));assert(!publicValue.includes(a));assert(!publicValue.includes('allowedBuyers'));
});
test('closing new sales does not disable technically ready paid obligations',()=>{
 assert(operationalConfigurationReady({missing:['ADS_CHECKOUT_ENABLED','ADS_CHECKOUT_MODE','walletCompatibilityVerified','ADS_ALLOWED_BUYERS']}));
 assert(!operationalConfigurationReady({missing:['AI_GATEWAY_API_KEY','ADS_CHECKOUT_ENABLED']}));
 assert(!purchaseEligibility({...cfg,enabled:false,checkoutMode:'DISABLED'},{address:a}).canPurchase);
});
function fixture(address){let calls=0,quotas=0;const id={ownerId:'stellar:testnet:'+address,address,role:'advertiser'};const handler=createAdsHandler({config:cfg,auth:{authenticate:async()=>id},db:{query:async()=>{quotas++;return{rows:[{count:1}]};}},service:{pay:async()=>{calls++;return {status:402,paymentRequired:{x402Version:2}};},availability:async(owner,campaign,options)=>({owner,campaign,options})}});return{handler,get calls(){return calls;},get quotas(){return quotas;}};}
test('unlisted signed payment cannot reach quotas, decoder or payment service',async()=>{
 const f=fixture(b);const response=await f.handler(new Request(origin+'/api/ads/orders/11111111-1111-4111-8111-111111111111/pay',{method:'POST',headers:{Origin:origin,'Idempotency-Key':'controlled-test-key','Content-Type':'application/json'},body:JSON.stringify({payload:{transaction:'not-transmitted'}})}));
 assert.equal(response.status,403);assert.equal(f.calls,0);assert.equal(f.quotas,0);
});
test('allowlisted buyer reaches the unchanged exact payment challenge',async()=>{
 const f=fixture(a);const response=await f.handler(new Request(origin+'/api/ads/orders/11111111-1111-4111-8111-111111111111/pay',{method:'POST',headers:{Origin:origin,'Idempotency-Key':'controlled-test-key','Content-Type':'application/json'},body:'{}'}));assert.equal(response.status,402);assert.equal(f.calls,1);
});
test('availability is owner-scoped and rejects duplicate campaign identifiers',async()=>{
 const f=fixture(a),id='11111111-1111-4111-8111-111111111111';const r=await f.handler(new Request(origin+'/api/ads/availability?campaignId='+id));assert.equal(r.status,200);assert.equal((await r.json()).owner,'stellar:testnet:'+a);
 const bad=await f.handler(new Request(origin+'/api/ads/availability?campaignId='+id+'&campaignId='+id));assert.equal(bad.status,400);
});


test('controlled checkout deadline closes new purchases while paid work stays operational',()=>{
 const until='2026-10-26T09:15:00.000Z',cutoff=Date.parse(until),controlled={...cfg,checkoutUntil:until};
 assert(purchaseEligibility(controlled,{address:a},{now:()=>cutoff-1}).canPurchase);
 assert.deepEqual(purchaseEligibility(controlled,{address:a},{now:()=>cutoff}),{canPurchase:false,mode:'CONTROLLED',reason:'checkout_window_closed'});
 assert.equal(readCheckoutPolicy({ADS_CHECKOUT_UNTIL:'invalid'}).missing.includes('ADS_CHECKOUT_UNTIL'),true);
 assert(operationalConfigurationReady({missing:['ADS_CHECKOUT_UNTIL']}));
});
