import {applyPilotConfig,isPilotConfig,PILOT_OFFER} from './offers.mjs';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {StrKey,Keypair} from '@stellar/stellar-sdk';
import {AdsError} from './common.mjs';
export const NETWORK='stellar:testnet';
export const ASSET='CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
export const ISSUER='GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
export const PLACEMENTS=Object.freeze(['venue_center_banner','main_stage_screen']);
export const PLANS=Object.freeze(['TIME','PASSES','EXCLUSIVE']);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const money=v=>typeof v==='string'&&/^(0|[1-9]\d*)$/.test(v);
export function validateAdsConfig(c){
 const pilot=isPilotConfig(c);
 const missing=[],need=(key,ok)=>{if(!ok)missing.push(key);};
 need('network',c.network===NETWORK);need('asset',c.asset===ASSET);need('issuer',c.issuer===ISSUER);need('payTo',StrKey.isValidEd25519PublicKey(c.payTo||''));
 for(const key of ['termsVersion','policyVersion','disputeAuthority','privacyNotice','interruptions'])need(key,typeof c[key]==='string'&&c[key].trim().length>0);
 need('refundPolicy',['FULL','PRO_RATA'].includes(c.refundPolicy));need('refundDesign',['ALWAYS','IF_UNDELIVERED','NEVER'].includes(c.refundDesign));
 for(const key of ['timeUnitMs','rotationMs',...(pilot?[]:['passMs','exclusiveUnitMs']),'reservationMs','processingMs','refundDeadlineMs','retentionMs','maxUnits','maxWindowMs','maxCampaignSharePercent'])need(key,positive(c[key]));
 need('includedRevisions',Number.isSafeInteger(c.includedRevisions)&&c.includedRevisions>=0);need('policyVersion',c.policyVersion==='ads-content-v1');
 need('maxCampaignSharePercent',c.maxCampaignSharePercent<=100);
 for(const key of ['uploadBytes','imagePixels','imageWidth','imageHeight','nameChars','descriptionChars','textBytes'])need('limits.'+key,positive(c.limits?.[key]));
 for(const key of ['maxCalls','maxTokens','timeoutMs','previewPerHour','maxCostMicrousd','maxInputTokens','preauditPerHour'])need('model.'+key,positive(c.model?.[key]));
 need('model.id',typeof c.model?.id==='string'&&c.model.id.includes('/'));
 need('model.inputMicrousdPerMillion',money(c.model?.inputMicrousdPerMillion));need('model.outputMicrousdPerMillion',money(c.model?.outputMicrousdPerMillion));
 need('allowedDomains',Array.isArray(c.allowedDomains)&&c.allowedDomains.length>0&&c.allowedDomains.every(d=>typeof d==='string'&&/^[a-z0-9.-]+$/.test(d)));
 need('hostWindows',Array.isArray(c.hostWindows)&&c.hostWindows.every(w=>PLACEMENTS.includes(w.placementId)&&Number.isFinite(Date.parse(w.startsAt))&&Date.parse(w.endsAt)>Date.parse(w.startsAt)));
 for(const id of pilot?['main_stage_screen']:PLACEMENTS){
  const p=c.placements?.[id];need('placements.'+id+'.transform',p?.position?.length===3&&p.position.every(Number.isFinite)&&Number.isFinite(p.width)&&p.width>0&&Number.isFinite(p.height)&&p.height>0);
  for(const plan of pilot?['TIME']:PLANS){const p=c.pricing?.[id]?.[plan];need('pricing.'+id+'.'+plan,money(p?.unitAmount)&&BigInt(p.unitAmount)>0n&&money(p?.designAmount));}
 }
 if(pilot){need('pilot.offer',c.timeUnitMs===PILOT_OFFER.durationMs&&c.maxUnits===1&&c.pricing?.main_stage_screen?.TIME?.unitAmount===PILOT_OFFER.amountUnits&&c.pricing?.main_stage_screen?.TIME?.designAmount==='0');}
 need('operators',Array.isArray(c.operators)&&c.operators.some(a=>StrKey.isValidContract(a||'')));need('disputeAuthority',StrKey.isValidContract(c.disputeAuthority||'')&&c.operators?.includes(c.disputeAuthority));
 need('walletCompatibilityVerified',c.walletCompatibilityVerified===true);need('accountWasmHash',/^[a-f0-9]{64}$/i.test(c.accountWasmHash||''));need('webauthnVerifier',StrKey.isValidContract(c.webauthnVerifier||''));
 return [...new Set(missing)];
}
export function readAdsConfig(env=process.env){
 let source={};try{source=env.ADS_CONFIG_JSON?JSON.parse(env.ADS_CONFIG_JSON):env.ADS_CONFIG_PATH?JSON.parse(readFileSync(env.ADS_CONFIG_PATH,'utf8')):{};}catch{throw new AdsError(503,'config_invalid','Advertising configuration could not be loaded.');}
 source=applyPilotConfig(source);
 const origin=env.ADS_ORIGIN||env.WALLET_ORIGIN||'http://localhost:4318';
 const c={...source,origin,rpId:new URL(origin).hostname,network:source.network||NETWORK,asset:source.asset||ASSET,issuer:source.issuer||ISSUER,rpcUrl:env.ADS_RPC_URL||'https://soroban-testnet.stellar.org',facilitatorUrl:env.ADS_FACILITATOR_URL||'https://x402.org/facilitator',databaseUrl:env.ADS_DATABASE_URL||'',authChallengeMs:120000,sessionMs:1800000,heartbeatMs:1000,publisherLeaseMs:5000,manifestMs:2000,renderLeadMs:2000,operators:source.operators||[],storage:{kind:env.ADS_STORAGE_KIND||'filesystem',root:path.resolve(env.ADS_STORAGE_ROOT||'.ads-private')},limits:source.limits||{},model:source.model||{},payTo:source.payTo||'',publisherOrigin:env.ADS_PUBLISHER_ORIGIN||origin,publisherKey:env.ADS_PUBLISHER_PRIVATE_KEY_FILE?readFileSync(env.ADS_PUBLISHER_PRIVATE_KEY_FILE,'utf8'):(env.ADS_PUBLISHER_PRIVATE_KEY||''),publisherPublicKey:env.ADS_PUBLISHER_PUBLIC_KEY_FILE?readFileSync(env.ADS_PUBLISHER_PUBLIC_KEY_FILE,'utf8'):(env.ADS_PUBLISHER_PUBLIC_KEY||''),registryContract:env.ADS_REGISTRY_CONTRACT||'',registrySignerSecretFile:env.ADS_REGISTRY_SIGNER_KEY_FILE||'',refundSecretFile:env.ADS_REFUND_SIGNER_KEY_FILE||'',publisherToken:env.ADS_PUBLISHER_TOKEN||'',defaultStageUrl:env.ADS_DEFAULT_STAGE_URL||'/assets/main-stage-default.mp4'};
 if(c.network!==NETWORK||c.asset!==ASSET||c.issuer!==ISSUER)throw new AdsError(503,'testnet_only','Only the allowlisted Stellar Testnet USDC is permitted.');
 c.missing=validateAdsConfig(c);if(!c.databaseUrl)c.missing.push('ADS_DATABASE_URL');if(!env.AI_GATEWAY_API_KEY&&!env.VERCEL_OIDC_TOKEN)c.missing.push('AI_GATEWAY_API_KEY');if(!c.publisherKey||!c.publisherPublicKey)c.missing.push('ADS_PUBLISHER_KEYS');
 if(!c.publisherToken)c.missing.push('ADS_PUBLISHER_TOKEN');if(!c.refundSecretFile)c.missing.push('ADS_REFUND_SIGNER_KEY_FILE');else{try{if(Keypair.fromSecret(readFileSync(c.refundSecretFile,'utf8').trim()).publicKey()!==c.payTo)c.missing.push('ADS_REFUND_SIGNER_KEY_FILE_MISMATCH');}catch{c.missing.push('ADS_REFUND_SIGNER_KEY_FILE_INVALID');}}if(c.registryContract&&(!Number.isSafeInteger(c.registryEvidenceGraceMs)||c.registryEvidenceGraceMs<=0))c.missing.push('registryEvidenceGraceMs');
 c.enabled=env.ADS_CHECKOUT_ENABLED==='true'&&c.missing.length===0;if(env.ADS_CHECKOUT_ENABLED!=='true')c.missing.push('ADS_CHECKOUT_ENABLED');return c;
}
export function publicAdsConfig(c){return{enabled:c.enabled,missing:c.missing,network:NETWORK,asset:ASSET,payTo:StrKey.isValidEd25519PublicKey(c.payTo||'')?c.payTo:null,profile:c.profile||null,offers:isPilotConfig(c)?[PILOT_OFFER]:[],plans:isPilotConfig(c)?['TIME']:PLANS,placements:PLACEMENTS.map(id=>({id,purchasable:!isPilotConfig(c)||id==='main_stage_screen',label:id==='main_stage_screen'?'Main stage':'Central aerial banner',ratio:id==='main_stage_screen'?'16:9':'4:1',transform:c.placements?.[id]||null})),terms:{version:c.termsVersion||null,interruptions:c.interruptions||null,refundPolicy:c.refundPolicy||null},units:{timeMs:c.timeUnitMs,passMs:c.passMs,exclusiveMs:c.exclusiveUnitMs},registry:c.registryContract?'CONFIGURED_NOT_VERIFIED':'NOT_DEPLOYED',defaultStageUrl:c.defaultStageUrl};}
export function requireCheckout(c){if(!c.enabled)throw new AdsError(503,'checkout_unconfigured','Purchases require complete configuration and integration gates.',{missing:c.missing});}
