import {assert} from './common.mjs';
export const PILOT_PROFILE = 'main-stage-test-5m';
export const PILOT_OFFER = Object.freeze({
 id:PILOT_PROFILE, placementId:'main_stage_screen', plan:'TIME', units:1,
 durationMs:300000, amountUnits:'50000000', designAmount:'0',
 label:'5 USDC de prueba · 5 minutos acumulados',
});
export const isPilotConfig = config => config.profile === PILOT_PROFILE;
export function applyPilotConfig(source={}) {
 return {...source,profile:PILOT_PROFILE,timeUnitMs:PILOT_OFFER.durationMs,maxUnits:1,
  pricing:{...source.pricing,main_stage_screen:{...source.pricing?.main_stage_screen,
   TIME:{unitAmount:PILOT_OFFER.amountUnits,designAmount:PILOT_OFFER.designAmount}}}};
}
export function resolveQuoteOffer(payload,config) {
 assert(payload&&typeof payload==='object'&&!Array.isArray(payload),400,'invalid_quote','Provide an advertisement quote request.');
 if(!isPilotConfig(config)){
  assert(payload.offerId===undefined,400,'offer_unavailable','This offer is not available in the configured catalogue.');
  return payload;
 }
 assert(payload.offerId===PILOT_PROFILE,400,'offer_unavailable','Choose the five-minute Testnet main-stage offer.');
 const allowed=new Set(['campaignId','offerId','startsAt','endsAt']);
 assert(Object.keys(payload).every(key=>allowed.has(key)),400,'offer_override','Price, placement, units and duration are fixed by the server for this offer.');
 return {...payload,placements:[PILOT_OFFER.placementId],plan:PILOT_OFFER.plan,units:PILOT_OFFER.units};
}
