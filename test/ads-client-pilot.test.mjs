import test from 'node:test';
import assert from 'node:assert/strict';
import { PILOT_PROFILE, configuredPilotOffer, advertisementQuotePayload, validatePilotQuote, createAdsApi, requestPaymentAuthorization, fulfillmentRemaining, deliveryProgress, quoteUnitsDescription, orderProgress } from '../dist/ads.mjs';
const offer={id:PILOT_PROFILE,offerVersion:2,placementId:'main_stage_screen',plan:'PASSES',units:5,requiredUnits:5,passMs:60000,durationMs:300000,unitAmount:'10000000',amountUnits:'50000000',designAmount:'0'};
const config={profile:PILOT_PROFILE,offers:[offer],plans:['PASSES'],units:{passMs:60000},network:'stellar:testnet',asset:'USDC',payTo:'recipient'};
const input={campaignId:'campaign',placements:['main_stage_screen'],plan:'EXCLUSIVE',units:9000,amountUnits:'1',startsAt:'2026-10-26T10:00:00.000Z',endsAt:'2026-10-26T10:20:00.000Z'};
const quote={offerId:offer.id,offerVersion:2,amountUnits:offer.amountUnits,plan:'PASSES',units:5,requiredUnits:5,unit:'PASSES',passMs:60000,placements:['main_stage_screen'],terms:{refundPolicy:'FULFILL_REMAINING'},lines:[{placementId:'main_stage_screen',plan:'PASSES',units:5,unitAmount:offer.unitAmount,designAmount:'0',deliveryAmount:offer.amountUnits,amountUnits:offer.amountUnits}]};

test('pilot checkout sends only campaign, server offer and exact selected window despite stale hidden form values',()=>{
 assert.deepEqual(advertisementQuotePayload(config,input),{campaignId:input.campaignId,offerId:offer.id,startsAt:input.startsAt,endsAt:input.endsAt});
 assert.equal(configuredPilotOffer(config),offer);
 for(const placements of [[],['venue_center_banner'],['main_stage_screen','venue_center_banner']])assert.throws(()=>advertisementQuotePayload(config,{...input,placements}),/únicamente/);
});

test('pilot catalogue rejects changed money, duration, placement, plan, units or design before checkout',()=>{
 for(const change of [{offerVersion:1},{amountUnits:'50000001'},{unitAmount:'50000000'},{durationMs:299999},{passMs:59000},{requiredUnits:300000},{placementId:'venue_center_banner'},{plan:'TIME'},{units:1},{designAmount:'1'}])assert.throws(()=>configuredPilotOffer({...config,offers:[{...offer,...change}]}),/oferta/);
 assert.throws(()=>configuredPilotOffer({...config,offers:[]}),/oferta/);
 assert.throws(()=>configuredPilotOffer({...config,offers:[offer,offer]}),/oferta/);
 assert.throws(()=>configuredPilotOffer({...config,plans:['TIME','PASSES']}),/oferta/);
 assert.throws(()=>configuredPilotOffer({...config,units:{passMs:1000}}),/oferta/);
 assert.throws(()=>configuredPilotOffer({...config,profile:'unknown'}),/catálogo/);
});

test('pilot quote freezes five complete sixty-second passes and five-USDC total with zero design charge',()=>{
 assert.equal(validatePilotQuote(quote,offer),quote);
 for(const change of [{offerId:'other'},{offerVersion:1},{amountUnits:'1'},{plan:'TIME'},{units:1},{requiredUnits:300000},{unit:'MILLISECONDS'},{passMs:1000},{placements:['venue_center_banner']},{terms:{refundPolicy:'PRO_RATA'}},{lines:[]},{lines:[{...quote.lines[0],units:1}]},{lines:[{...quote.lines[0],unitAmount:'50000000'}]},{lines:[{...quote.lines[0],deliveryAmount:'1'}]},{lines:[{...quote.lines[0],designAmount:'1'}]},{lines:[{...quote.lines[0],amountUnits:'50000001'}]},{lines:[{...quote.lines[0],placementId:'venue_center_banner'}]}])assert.throws(()=>validatePilotQuote({...quote,...change},offer),/cotización/);
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


test('pass progress counts only server-confirmed whole deliveries and keeps every unfinished pass owed',()=>{
 const item={placementId:'main_stage_screen',required:5,unit:'PASSES',delivered:2,elapsedMs:59000,status:'PARTIAL'};
 assert.deepEqual(deliveryProgress(item,quote),{valid:true,completed:2,required:5,owed:3});
 assert.deepEqual(deliveryProgress({...item,elapsedMs:60000},quote),{valid:true,completed:2,required:5,owed:3},'local elapsed time never credits a third delivery');
 assert.deepEqual(deliveryProgress({...item,delivered:5},quote),{valid:true,completed:5,required:5,owed:0});
 for(const change of [{delivered:2.5},{delivered:6},{required:4}])assert.deepEqual(deliveryProgress({...item,...change},quote),{valid:false});
 assert.match(quoteUnitsDescription(quote),/5 entregas completas de 60 segundos/);assert.match(quoteUnitsDescription(quote),/interrumpida no cuenta/);
});

test('fulfillment policy keeps the debt open even if a remedy label claims completion',()=>{
 const item={required:5,delivered:2,unit:'PASSES',status:'CLOSED_WITH_REMEDY'},order={status:'COMPLETED',payment:{status:'SETTLED'},quote,placements:[item]};
 assert.equal(fulfillmentRemaining(order),true);assert.equal(orderProgress(order).delivery,false);
 assert.equal(orderProgress({...order,placements:[{...item,delivered:5,status:'FULFILLED'}]}).delivery,true);
 assert.equal(fulfillmentRemaining(null,{terms:{refundPolicy:'FULFILL_REMAINING'}}),true);
});

test('historical TIME orders display their frozen duration and preserve their original refund policy',()=>{
 const historical={plan:'TIME',units:1,timeUnitMs:300000,requiredUnits:300000,terms:{refundPolicy:'PRO_RATA'}},catalogue={...config,units:{timeMs:1000,passMs:60000},terms:{refundPolicy:'FULFILL_REMAINING'}};
 assert.match(quoteUnitsDescription(historical,catalogue),/1 unidad\(es\) de 300 segundos de actividad acumulada/);
 assert.equal(deliveryProgress({required:300000,delivered:120000,unit:'MILLISECONDS'},historical),null);
 assert.equal(fulfillmentRemaining({quote:historical,payment:{status:'SETTLED'}},catalogue),false,'a new catalogue cannot rewrite an old paid order');
 assert.equal(validatePilotQuote(historical,null),historical);
});

test('new pilot offer freezes a minute between campaign plays while historical quotes remain readable',async()=>{
 const {PILOT_OFFER,applyPilotConfig}=await import('../server/ads/offers.mjs');assert.equal(PILOT_OFFER.minCampaignGapMs,60000);assert.equal(applyPilotConfig({}).minCampaignGapMs,60000);const spacedOffer={...offer,minCampaignGapMs:60000},spacedQuote={...quote,minCampaignGapMs:60000};assert.equal(validatePilotQuote(spacedQuote,spacedOffer),spacedQuote);assert.equal(validatePilotQuote(quote,spacedOffer),quote);assert.throws(()=>validatePilotQuote({...spacedQuote,minCampaignGapMs:1},spacedOffer),/cotiz/);assert.match(quoteUnitsDescription(spacedQuote),/anfitri/);assert.doesNotMatch(quoteUnitsDescription(quote),/anfitri/);
});
