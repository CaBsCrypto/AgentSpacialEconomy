import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Keypair,StrKey} from '@stellar/stellar-sdk';
import sharp from 'sharp';
import {createTestDatabase} from './helpers/ads-db.mjs';
import {ASSET,ISSUER,publicAdsConfig} from '../server/ads/config.mjs';
import {PILOT_OFFER,PILOT_PROFILE,applyPilotConfig} from '../server/ads/offers.mjs';
import {createStorage} from '../server/ads/storage.mjs';
import {createCreativeService} from '../server/ads/creative.mjs';
import {createAdsService,confirmPaidOrder} from '../server/ads/service.mjs';
import {createPaymentService} from '../server/ads/payments.mjs';
import {createJobRunner} from '../server/ads/jobs.mjs';
import {createPublisher,verifyEvidence} from '../server/ads/publisher.mjs';
import {planRotations} from '../server/ads/scheduler.mjs';
import {sha256,uuid} from '../server/ads/common.mjs';

// Explicit local adapters: no wallet signatures, Stellar submissions or model/AR claims.
const payer=StrKey.encodeContract(Buffer.alloc(32,61)),ownerId='stellar:testnet:'+payer;
const total100Usdc=1000000000n,price5Usdc=50000000n,fiveMinutes=300000;
async function setup(t,{pilot=true}={}){
 const db=await createTestDatabase({env:{}});assert.equal(db.testBackend,'pglite');t.after(()=>db.close());
 const root=await mkdtemp(join(tmpdir(),'ads-pilot-local-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const clock={value:Date.now()+60000},now=()=>clock.value,keys=generateKeyPairSync('ed25519');
 const config={
  enabled:true,missing:[],origin:'https://pilot.example',network:'stellar:testnet',asset:ASSET,issuer:ISSUER,
  payTo:Keypair.random().publicKey(),operators:['operator'],termsVersion:'explicit-local-pilot-test-terms',
  policyVersion:'ads-content-v1',refundPolicy:'PRO_RATA',refundDesign:'IF_UNDELIVERED',refundDeadlineMs:60000,
  disputeAuthority:'operator',privacyNotice:'Local synthetic fixture',retentionMs:3600000,
  interruptions:'Host interruptions and unconfirmed intervals do not count as delivery.',
  timeUnitMs:pilot?fiveMinutes:1000,rotationMs:fiveMinutes,passMs:1000,exclusiveUnitMs:1000,
  renderLeadMs:500,reservationMs:60000,processingMs:1000,maxUnits:100,maxWindowMs:3600000,
  maxCampaignSharePercent:100,includedRevisions:1,hostWindows:[],allowedDomains:['x.com','example.com'],
  limits:{uploadBytes:100000,imagePixels:4000000,imageWidth:1920,imageHeight:1080,nameChars:100,descriptionChars:1000,textBytes:4096},
  model:{id:'explicit/local-pilot-fixture',maxCalls:3,maxTokens:200,timeoutMs:5000,maxInputTokens:3000000,maxCostMicrousd:100,inputMicrousdPerMillion:'1',outputMicrousdPerMillion:'1',previewPerHour:10,preauditPerHour:100},
  pricing:Object.fromEntries(['main_stage_screen','venue_center_banner'].map(placement=>[placement,Object.fromEntries(['TIME','PASSES','EXCLUSIVE'].map(plan=>[plan,{unitAmount:'10',designAmount:'5'}]))])),
  publisherKey:keys.privateKey.export({type:'pkcs8',format:'pem'}),publisherPublicKey:keys.publicKey.export({type:'spki',format:'pem'}),
  heartbeatMs:10000,manifestMs:20000,publisherLeaseMs:30000,databaseUrl:'',registryContract:''
 };
 if(pilot)Object.assign(config,applyPilotConfig(config));
 const storage=createStorage({config:{storage:{root}}});
 const baseCreative=createCreativeService({config,storage,urlInspector:async url=>({url}),model:{
  audit:async input=>({decision:'ALLOW',reasons:[],reviewedHash:input.manifestHash})
 }});
 const creative={...baseCreative,async generate({revisionId,placements}){
  const artifacts=[];
  for(const placement of placements){
   const width=placement==='main_stage_screen'?1280:1600,height=placement==='main_stage_screen'?720:400;
   const bytes=await sharp({create:{width,height,channels:3,background:'#17485b'}}).png().toBuffer();
   artifacts.push({placement,...await storage.put(bytes,{mime:'image/png'}),width,height,alt:'Explicit local pilot raster'});
  }
  const manifest={revisionId,artifacts,cta:[{url:'https://example.com/play',domain:'example.com',kind:'website'}]},manifestHash=sha256(manifest);
  return {artifacts,manifest,manifestHash,verdict:{allowed:true,state:'PREAUDITED',reviewedHash:manifestHash}};
 }};
 let funds=total100Usdc,decodes=0,verifications=0,settlements=0,balanceReads=0;
 const debits=[],runtime={
  balance:async address=>{assert.equal(address,payer);balanceReads++;return funds;},
  latestLedger:async()=>100,
  decodePayment:async(payload,expected)=>{decodes++;assert.equal(expected.payer,payer);return {payer,nonce:payload.nonce,expiresLedger:200,authHash:sha256(payload)};},
  verify:async()=>{verifications++;return {isValid:true,payer};},
  settle:async(payload,requirements)=>{
   const amount=BigInt(requirements.amount);assert(funds>=amount,'fixture cannot debit beyond its confirmed balance');
   funds-=amount;debits.push(funds);settlements++;return {success:true,transaction:sha256(payload),payer};
  },
  confirm:async attempt=>attempt.settlement_tx?{state:'CONFIRMED',txHash:attempt.settlement_tx,payer,ledger:101}:{state:'UNKNOWN'}
 };
 const payments=createPaymentService({db,config,runtime,now,onSettled:(tx,order,receipt)=>confirmPaidOrder(tx,order,receipt,{config,now})});
 const registry={syncOrder:async()=>({state:'DISABLED'})},service=createAdsService({db,config,storage,creative,payments,registry,now});
 const runner=createJobRunner({db,config,creative,payments,registry,now});
 const image=await sharp({create:{width:64,height:64,channels:3,background:'#72e3df'}}).png().toBuffer();
 const logo=await service.upload(ownerId,image,'image/png','pilot-upload-logo');
 async function campaign(){
  const draft=await service.campaign(ownerId,{brief:{name:'Aster',description:'An accessible puzzle game.',xUrl:'https://x.com/aster',websiteUrl:'https://example.com/play',rightsAccepted:true},logoId:logo.id},'pilot-campaign-'+uuid());
  assert.equal((await service.preaudit(ownerId,draft.id,'pilot-preaudit-'+draft.id)).allowed,true);return draft;
 }
 const window=(index=0)=>({startsAt:new Date(now()+5000+index*600000).toISOString(),endsAt:new Date(now()+605000+index*600000).toISOString()});
 const quote=(draft,extra={},index=0)=>service.quote(ownerId,{campaignId:draft.id,offerId:PILOT_PROFILE,...window(index),...extra},'pilot-quote-'+uuid());
 return {db,clock,now,config,service,payments,runner,campaign,quote,window,debits,
  get funds(){return funds;},get decodes(){return decodes;},get verifications(){return verifications;},get settlements(){return settlements;},get balanceReads(){return balanceReads;}};
}

test('local pilot freezes one main-stage placement, 5 USDC total and 300000 ms without a design surcharge',async t=>{
 const f=await setup(t),draft=await f.campaign(),quote=await f.quote(draft);
 assert.equal(PILOT_OFFER.id,PILOT_PROFILE);assert.equal(PILOT_OFFER.amountUnits,String(price5Usdc));assert.equal(PILOT_OFFER.durationMs,fiveMinutes);
 const offers=publicAdsConfig(f.config).offers;assert.equal(offers.length,1);assert.equal(offers[0].id,PILOT_PROFILE);
 assert.equal(quote.offerId,PILOT_PROFILE);assert.equal(quote.amountUnits,String(price5Usdc));
 assert.equal(quote.plan,'TIME');assert.equal(quote.units,1);assert.equal(quote.timeUnitMs,fiveMinutes);
 assert.equal(quote.requiredUnits,fiveMinutes);assert.deepEqual(quote.placements,['main_stage_screen']);
 assert.equal(quote.lines.length,1);assert.equal(quote.lines[0].designAmount,'0');assert.equal(quote.lines[0].deliveryAmount,String(price5Usdc));
 const reservations=(await f.db.query('SELECT * FROM ads_reservations WHERE order_id=$1',[quote.orderId])).rows;
 assert.equal(reservations.length,1);assert.equal(Number(reservations[0].delivery_units),fiveMinutes);
 assert.equal((await f.service.getOrder(quote.orderId,ownerId)).placements[0].required,fiveMinutes);
 assert.equal(f.settlements,0,'a reservation must not initiate a payment');
});

test('pilot rejects price, duration, quantity, placement and offer tampering without creating an order',async t=>{
 const f=await setup(t),draft=await f.campaign();
 const mutations=[{amountUnits:'1'},{price:'0.01'},{designAmount:'1'},{durationMs:1000},{timeUnitMs:1000},
  {units:2},{plan:'PASSES'},{placements:['venue_center_banner']},{placements:['main_stage_screen','venue_center_banner']},{offerId:'unapproved-offer'}];
 for(const mutation of mutations)await assert.rejects(f.quote(draft,mutation),error=>error.status===400||error.status===409,JSON.stringify(mutation));
 assert.equal(Number((await f.db.query('SELECT count(*) AS count FROM ads_orders')).rows[0].count),0);
 assert.equal(Number((await f.db.query('SELECT count(*) AS count FROM ads_reservations')).rows[0].count),0);
 assert.equal(f.decodes,0);assert.equal(f.settlements,0);
});

test('activating the pilot preserves an existing legacy quote, its frozen duration and its payable amount',async t=>{
 const f=await setup(t,{pilot:false}),draft=await f.campaign();
 const legacy=await f.service.quote(ownerId,{campaignId:draft.id,placements:['main_stage_screen'],plan:'TIME',units:2,...f.window()},'legacy-frozen-quote');
 assert.equal(legacy.amountUnits,'25');assert.equal(legacy.requiredUnits,2000);
 const before=(await f.db.query('SELECT amount,quote,terms_hash FROM ads_orders WHERE id=$1',[legacy.orderId])).rows[0];
 Object.assign(f.config,applyPilotConfig(f.config));
 const fresh=await f.quote(draft,{},1);assert.equal(fresh.amountUnits,String(price5Usdc));
 const after=(await f.db.query('SELECT amount,quote,terms_hash FROM ads_orders WHERE id=$1',[legacy.orderId])).rows[0];assert.deepEqual(after,before);
 const challenge=await f.service.pay(ownerId,legacy.orderId);assert.equal(challenge.status,402);assert.equal(challenge.paymentRequired.accepts[0].amount,'25');
 assert.equal((await f.service.getOrder(legacy.orderId,ownerId)).placements[0].required,2000);
});

test('20 explicit local 5 USDC settlements debit 100 to 0 once each; the 21st is refused before authorization processing',async t=>{
 const f=await setup(t),draft=await f.campaign();
 for(let index=0;index<20;index++){
  const quote=await f.quote(draft,{},index).catch(error=>{error.message='Purchase '+(index+1)+': '+error.message;throw error;}),key='pilot-payment-'+index,payload={nonce:uuid()};
  const challenge=await f.service.pay(ownerId,quote.orderId);assert.equal(challenge.status,402);assert.equal(challenge.paymentRequired.accepts[0].amount,String(price5Usdc));
  const receipt=await f.service.pay(ownerId,quote.orderId,key,payload);assert.equal(receipt.paymentState,'SETTLED');assert.equal(receipt.orderState,'QUEUED');
  assert.equal(f.funds,total100Usdc-BigInt(index+1)*price5Usdc);
  await f.service.pay(ownerId,quote.orderId,key,payload);assert.equal(f.settlements,index+1,'settled retries cannot charge again, including at balance zero');
 }
 assert.deepEqual(f.debits,Array.from({length:20},(_,index)=>total100Usdc-BigInt(index+1)*price5Usdc));
 assert.equal(f.decodes,20);assert.equal(f.verifications,20);assert.equal(f.settlements,20);
 assert.equal(Number((await f.db.query("SELECT count(*) AS count FROM ads_outbox WHERE topic='creative'")).rows[0].count),20);
 const last=await f.quote(draft,{},20),before={decodes:f.decodes,verifications:f.verifications,settlements:f.settlements};
 const insufficient=error=>/balance|saldo|funds/i.test(error.code+' '+error.message);
 await assert.rejects(f.service.pay(ownerId,last.orderId),insufficient);
 await assert.rejects(f.service.pay(ownerId,last.orderId,'pilot-insufficient-payment',{nonce:uuid()}),insufficient);
 assert.deepEqual({decodes:f.decodes,verifications:f.verifications,settlements:f.settlements},before);
 assert.equal((await f.db.query('SELECT * FROM ads_payment_attempts WHERE order_id=$1',[last.orderId])).rows.length,0);
 assert.equal(f.funds,0n);assert(f.balanceReads>=21);
});

async function startPublisher(f,quote){
 await f.service.pay(ownerId,quote.orderId,'pilot-delivery-'+quote.orderId,{nonce:uuid()});assert.equal(await f.runner.runOnce(),true);
 assert.equal((await f.service.getOrder(quote.orderId,ownerId)).queue.state,'SCHEDULED');
 const slot=(await f.db.query('SELECT * FROM ads_reservations WHERE order_id=$1',[quote.orderId])).rows[0],publisher=createPublisher({db:f.db,config:f.config,now:f.now});
 async function frame(offset){
  f.clock.value=+new Date(slot.starts_at)+offset;await publisher.lease();await publisher.schedule();
  const playlist=await f.service.playlist('main_stage_screen',{publisher:true});assert(playlist.active);
  const active=playlist.active,ack={placementId:'main_stage_screen',version:playlist.version,revisionId:active.revisionId,manifestHash:active.manifestHash,imageHash:active.imageHash,frameAt:f.now()};
  assert.equal(await publisher.acknowledge(ack),true);assert.equal(await publisher.acknowledge(ack),false,'duplicate frames cannot add time');
 }
 return {slot,publisher,frame};
}

test('five minutes require 300000 ms of deduplicated canonical frames; settlement and generation deliver zero',async t=>{
 const f=await setup(t),quote=await f.quote(await f.campaign()),{frame}=await startPublisher(f,quote);
 assert.equal((await f.service.getOrder(quote.orderId,ownerId)).placements[0].delivered,0);
 for(let offset=0;offset<=fiveMinutes;offset+=10000)await frame(offset);
 const state=await f.service.getOrder(quote.orderId,ownerId);assert.equal(state.status,'COMPLETED');assert.equal(state.placements[0].delivered,fiveMinutes);
 const evidence=(await f.db.query('SELECT * FROM ads_delivery WHERE order_id=$1',[quote.orderId])).rows;assert.equal(evidence.reduce((sum,row)=>sum+Number(row.units),0),fiveMinutes);
 for(const row of evidence)assert(verifyEvidence(row.evidence,row.signature,f.config.publisherPublicKey));
 assert.equal((await f.service.playlist('main_stage_screen')).active,null);
});

test('a canonical pause leaves an explicit five-minute delivery deficit instead of counting elapsed wall time',async t=>{
 const f=await setup(t),quote=await f.quote(await f.campaign()),{frame,slot,publisher}=await startPublisher(f,quote);
 await frame(0);await frame(10000);
 // Missing 30000 ms exceeds heartbeat continuity and earns no credit.
 for(let offset=40000;offset<=fiveMinutes;offset+=10000)await frame(offset);
 let state=await f.service.getOrder(quote.orderId,ownerId);assert.equal(state.placements[0].delivered,270000);assert.equal(state.placements[0].deficit,30000);assert.notEqual(state.status,'COMPLETED');
 f.clock.value=+new Date(slot.ends_at);await publisher.lease();await publisher.schedule();
 assert.equal((await f.service.playlist('main_stage_screen')).active,null);state=await f.service.getOrder(quote.orderId,ownerId);
 assert.equal(state.placements[0].delivered,270000,'a slot boundary cannot fabricate missing canonical activity');
});


test('campaign share counts only planned activity inside the relevant window and still caps overlapping demand',()=>{
 const config={rotationMs:fiveMinutes,timeUnitMs:fiveMinutes,renderLeadMs:500,maxUnits:1,maxWindowMs:3600000,maxCampaignSharePercent:100};
 const order=index=>({id:'pilot-'+String(index).padStart(2,'0'),campaignId:'same-pilot-campaign',committedAt:index,plan:'TIME',units:1,startsAt:index*600000,endsAt:(index+1)*600000});
 const slots=planRotations(Array.from({length:20},(_,index)=>order(index)),[],config);
 assert.equal(slots.length,20);assert.equal(slots.reduce((sum,slot)=>sum+slot.deliveryUnits,0),20*fiveMinutes);
 const shared=[{...order(0),endsAt:1000000},{...order(1),startsAt:0,endsAt:1000000}];
 assert.throws(()=>planRotations(shared,[],{...config,maxCampaignSharePercent:50}),/capacity/i);
});


test('same-campaign scheduling preserves millisecond commitment order read from PostgreSQL dates',()=>{
 const config={rotationMs:fiveMinutes,timeUnitMs:fiveMinutes,renderLeadMs:500,maxUnits:1,maxWindowMs:3600000,maxCampaignSharePercent:100};
 const orders=['z','y','x'].map((id,index)=>({id,campaignId:'date-precision-campaign',committedAt:new Date(1000+index*10),plan:'TIME',units:1,startsAt:index*600000,endsAt:(index+1)*600000}));
 assert.deepEqual(planRotations(orders,[],config).map(slot=>slot.orderId),['z','y','x']);
});
