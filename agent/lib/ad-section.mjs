import { AD_SLOT, AD_SECTION_SLOT } from "../catalog.mjs";
import { adCreative } from "./ads.mjs";
import { parseQuadrant } from "./screen.mjs";
import { sponsorPreflight } from "./income.mjs";
import { toUnits } from "./money.mjs";
export function advertiserOffer(value) {
 if(value===undefined)return {slot:AD_SLOT,section:null};
 const section=parseQuadrant(value);
 if(!section)throw new Error("An explicit section A, B, C or D is required.");
 return {slot:AD_SECTION_SLOT,section};
}
export function sectionRequest(body) {
 const {section}=advertiserOffer(body?.section===undefined?"":body.section);
 const creative=adCreative(body);
 if(!creative)throw new Error("advertiser is required");
 return {...creative,section};
}
// Registered before the x402 gate: invalid section orders are never authorized or charged.
export function validateSectionRequest(req,res,next) {
 try { req.sectionCreative=sectionRequest(req.body); }
 catch(e){return res.status(400).json({error:e.message});}
 next();
}
export function sectionPreflight(paymentRequired,{network,treasury,asset}) {
 const result=sponsorPreflight(paymentRequired,{network,treasury,maxUsdc:AD_SECTION_SLOT.priceUsdc});
 if(!result.ok)return result;
 if(!Array.isArray(paymentRequired?.accepts)||!paymentRequired.accepts.length||
 paymentRequired.accepts.some(a=>a.network!==network||a.scheme!=="exact"||a.asset!==asset||String(a.amount)!==String(toUnits(AD_SECTION_SLOT.priceUsdc)))) {
  return {ok:false,reason:"section payment must request exactly 5 testnet USDC in the configured asset"};
 }
 return result;
}

// Pin every challenge at the signing boundary, including x402/fetch's second request/retry.
// Reserve the sole attempt before awaiting the signer: an exception may follow an uncertain signature.
export function guardSinglePaymentClient(client,{network,treasury,asset,priceUsdc}) {
 let attempted=false;
 const guarded=Object.create(client);
 guarded.createPaymentPayload=async(version,requirements)=>{
  if(attempted)throw new Error("A payment payload was already attempted; reconcile before retrying.");
  if(version!==2||requirements?.scheme!=="exact"||requirements.network!==network||
   requirements.asset!==asset||requirements.payTo!==treasury||
   String(requirements.amount)!==String(toUnits(priceUsdc))){
   throw new Error("Payment challenge changed; refusing to sign.");
  }
  attempted=true;
  return client.createPaymentPayload(version,requirements);
 };
 return guarded;
}
