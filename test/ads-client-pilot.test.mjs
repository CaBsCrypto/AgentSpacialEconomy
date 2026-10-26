import test from 'node:test';
import assert from 'node:assert/strict';
import { PILOT_PROFILE, configuredPilotOffer, advertisementQuotePayload, validatePilotQuote, createAdsApi, requestPaymentAuthorization } from '../dist/ads.mjs';
const offer={id:PILOT_PROFILE,placementId:'main_stage_screen',plan:'TIME',units:1,durationMs:300000,amountUnits:'50000000',designAmount:'0'};
const config={profile:PILOT_PROFILE,offers:[offer],network:'stellar:testnet',asset:'USDC',payTo:'recipient'};
const input={campaignId:'campaign',placements:['main_stage_screen'],plan:'EXCLUSIVE',units:9000,amountUnits:'1',startsAt:'2026-10-26T10:00:00.000Z',endsAt:'2026-10-26T10:20:00.000Z'};
const quote={offerId:offer.id,amountUnits:offer.amountUnits,plan:'TIME',units:1,requiredUnits:300000,timeUnitMs:300000,placements:['main_stage_screen'],lines:[{placementId:'main_stage_screen',unitAmount:offer.amountUnits,designAmount:'0',amountUnits:offer.amountUnits}]};

test('pilot checkout sends only campaign, server offer and exact selected window despite stale hidden form values',()=>{
 assert.deepEqual(advertisementQuotePayload(config,input),{campaignId:input.campaignId,offerId:offer.id,startsAt:input.startsAt,endsAt:input.endsAt});
 assert.equal(configuredPilotOffer(config),offer);
 for(const placements of [[],['venue_center_banner'],['main_stage_screen','venue_center_banner']])assert.throws(()=>advertisementQuotePayload(config,{...input,placements}),/únicamente/);
});

test('pilot catalogue rejects changed money, duration, placement, plan, units or design before checkout',()=>{
 for(const change of [{amountUnits:'50000001'},{durationMs:299999},{placementId:'venue_center_banner'},{plan:'PASSES'},{units:2},{designAmount:'1'}])assert.throws(()=>configuredPilotOffer({...config,offers:[{...offer,...change}]}),/oferta/);
 assert.throws(()=>configuredPilotOffer({...config,offers:[]}),/oferta/);
 assert.throws(()=>configuredPilotOffer({...config,profile:'unknown'}),/catálogo/);
});

test('pilot quote must retain the exact five-minute obligation and five-USDC total with zero design charge',()=>{
 assert.equal(validatePilotQuote(quote,offer),quote);
 for(const change of [{offerId:'other'},{amountUnits:'1'},{plan:'PASSES'},{units:2},{requiredUnits:299999},{timeUnitMs:1000},{placements:['venue_center_banner']},{lines:[]},{lines:[{...quote.lines[0],designAmount:'1'}]},{lines:[{...quote.lines[0],amountUnits:'50000001'}]},{lines:[{...quote.lines[0],placementId:'venue_center_banner'}]}])assert.throws(()=>validatePilotQuote({...quote,...change},offer),/cotización/);
});

test('legacy explicit catalogues preserve their prior quote contract',()=>{
 assert.equal(configuredPilotOffer({}),null);
 assert.deepEqual(advertisementQuotePayload({},input),{campaignId:input.campaignId,placements:input.placements,plan:input.plan,units:input.units,startsAt:input.startsAt,endsAt:input.endsAt});
 assert.equal(validatePilotQuote(quote,null),quote);
});

test('server insufficient-balance 409 stops before any wallet signature or funding request',async()=>{
 const calls=[];let signatures=0;
 const api=createAdsApi({fetchImpl:async(url,options)=>{calls.push([url,options]);return Response.json({error:{code:'insufficient_balance',message:'Saldo insuficiente.',details:{balanceUnits:'0',requiredUnits:offer.amountUnits}}},{status:409});}});
 await assert.rejects(requestPaymentAuthorization({api,wallet:{signPayment:async()=>{signatures++;}},path:'/orders/order/pay',amountUnits:offer.amountUnits,config,idempotencyKey:'challenge-key'}),error=>error.status===409&&error.reason==='insufficient_balance');
 assert.equal(signatures,0);assert.deepEqual(calls.map(([url])=>url),['/api/ads/orders/order/pay']);assert.equal(calls[0][1].body,undefined);assert.equal(calls[0][1].headers['Idempotency-Key'],'challenge-key');
});

test('only a payment challenge reaches the wallet and server replay never signs again',async()=>{
 let signatures=0;const challenge={x402Version:2},payload={signed:'local fixture'};
 const wallet={signPayment:async options=>{signatures++;assert.deepEqual(options,{challenge,expected:{amountUnits:offer.amountUnits,payTo:config.payTo,asset:config.asset,network:config.network,resourceUrl:'/api/ads/orders/order/pay'}});return payload;}};
 const request={wallet,path:'/orders/order/pay',amountUnits:offer.amountUnits,config,idempotencyKey:'stable'};
 assert.deepEqual(await requestPaymentAuthorization({...request,api:async()=>({paymentRequired:challenge})}),{paymentPayload:payload});
 const settled={order:{id:'order',payment:{status:'SETTLED'}}};assert.equal(await requestPaymentAuthorization({...request,api:async()=>settled}),settled);assert.equal(signatures,1);
});
