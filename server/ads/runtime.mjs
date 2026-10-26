import {readAdsConfig} from './config.mjs';
import {createDatabase} from './db.mjs';
import {createStorage} from './storage.mjs';
import {createCreativeService} from './creative.mjs';
import {createCorrectionService} from './corrections.mjs';
import {createAuthService} from './auth.mjs';
import {createPaymentService} from './payments.mjs';
import {createStellarPaymentRuntime} from './stellar-payments.mjs';
import {createRefundService} from './refunds.mjs';
import {createRegistryService} from './registry.mjs';
import {createAdsService,confirmPaidOrder} from './service.mjs';
import {createAdsHandler,adsNodeHandler} from './http.mjs';
let runtime;
export function createAdsRuntime({env=process.env,config=readAdsConfig(env),db=createDatabase({connectionString:config.databaseUrl}),storage=createStorage({config}),creative=createCreativeService({config:{model:config.model,limits:config.limits,allowedDomains:config.allowedDomains,policyVersion:config.policyVersion},storage}),auth=createAuthService({config,db}),paymentRuntime,refundRuntime,registryRuntime}={}){
 const payments=createPaymentService({db,config,runtime:paymentRuntime||createStellarPaymentRuntime({config}),onSettled:(tx,order,receipt)=>confirmPaidOrder(tx,order,receipt,{config})});
 const refunds=createRefundService({db,config,runtime:refundRuntime}),registry=createRegistryService({db,config,runtime:registryRuntime});
 const service=createAdsService({db,config,storage,creative,payments,refunds,registry});
 const corrections=createCorrectionService({db,config});
 const handler=createAdsHandler({config,db,auth,service,refunds,corrections});
 return {config,db,storage,creative,auth,payments,refunds,registry,service,corrections,handler};
}
export function getAdsRuntime(){return runtime??=createAdsRuntime();}
export async function handleAdsNode(req,res){try{const r=getAdsRuntime();return adsNodeHandler(req,res,r.handler,r.config.origin);}catch{res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:{code:'ads_unconfigured',message:'Advertising is not configured.'}}));}}
