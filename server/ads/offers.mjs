import {assert} from './common.mjs';
export const PILOT_PROFILE = 'main-stage-test-5m';
export const PILOT_OFFER = Object.freeze({
 id:PILOT_PROFILE, offerVersion:2, placementId:'main_stage_screen', plan:'PASSES', units:5,
 durationMs:300000, passMs:60000, minCampaignGapMs:60000, requiredUnits:5, unitAmount:'10000000', amountUnits:'50000000', designAmount:'0',
 label:'5 USDC de prueba · 5 entregas de 1 minuto',
});
export const isPilotConfig = config => config.profile === PILOT_PROFILE;
export function applyPilotConfig(source={}) {
 return {...source,profile:PILOT_PROFILE,timeUnitMs:PILOT_OFFER.durationMs,passMs:PILOT_OFFER.passMs,minCampaignGapMs:PILOT_OFFER.minCampaignGapMs,maxUnits:PILOT_OFFER.units,refundPolicy:'FULFILL_REMAINING',refundDesign:'NEVER',
  pricing:{...source.pricing,main_stage_screen:{...source.pricing?.main_stage_screen,
   PASSES:{unitAmount:PILOT_OFFER.unitAmount,designAmount:PILOT_OFFER.designAmount}}}};
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
