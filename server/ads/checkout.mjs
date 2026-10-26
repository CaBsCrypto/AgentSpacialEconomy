import {StrKey} from '@stellar/stellar-sdk';
import {AdsError} from './common.mjs';
export const CHECKOUT_MODES=Object.freeze(['DISABLED','CONTROLLED','PUBLIC']);
const purchaseOnly=new Set(['ADS_CHECKOUT_ENABLED','ADS_CHECKOUT_MODE','ADS_ALLOWED_BUYERS','walletCompatibilityVerified']);
export function readCheckoutPolicy(env={}){
 const mode=env.ADS_CHECKOUT_MODE||(env.ADS_CHECKOUT_ENABLED==='true'?'PUBLIC':'DISABLED');
 const missing=[];if(!CHECKOUT_MODES.includes(mode))missing.push('ADS_CHECKOUT_MODE');
 let buyers=[];
 try{buyers=env.ADS_ALLOWED_BUYERS_JSON?JSON.parse(env.ADS_ALLOWED_BUYERS_JSON):[];if(!Array.isArray(buyers)||buyers.some(v=>typeof v!=='string'||!StrKey.isValidContract(v)))throw Error();buyers=[...new Set(buyers)];}catch{missing.push('ADS_ALLOWED_BUYERS');buyers=[];}
 if(mode==='CONTROLLED'&&!buyers.length)missing.push('ADS_ALLOWED_BUYERS');
 return {checkoutMode:CHECKOUT_MODES.includes(mode)?mode:'DISABLED',allowedBuyers:buyers,missing:[...new Set(missing)]};
}
export function operationalConfigurationReady(config){return Array.isArray(config.missing)&&config.missing.every(key=>purchaseOnly.has(key));}
export function purchaseEligibility(config,identity){
 const mode=config.checkoutMode||(config.enabled===true?'PUBLIC':'DISABLED');
 if(config.enabled!==true||mode==='DISABLED')return {canPurchase:false,mode,reason:'checkout_unconfigured'};
 if(mode==='CONTROLLED'&&(!identity?.address||!config.allowedBuyers?.includes(identity.address)))return {canPurchase:false,mode,reason:'controlled_buyer_required'};
 return {canPurchase:true,mode,reason:null};
}
export function assertPurchaseAllowed(config,identity){
 // Explicit policies come from readAdsConfig. Legacy injected services retain their own gate.
 if(config.checkoutMode===undefined)return;
 const result=purchaseEligibility(config,identity);
 if(!result.canPurchase)throw new AdsError(result.reason==='controlled_buyer_required'?403:503,result.reason,result.reason==='controlled_buyer_required'?'La compra de prueba está limitada a la wallet identificada; no se solicitó ningún cobro.':'Las compras están deshabilitadas hasta completar las validaciones.');
}
