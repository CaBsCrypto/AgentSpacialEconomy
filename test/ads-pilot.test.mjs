import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Keypair,StrKey} from '@stellar/stellar-sdk';
import sharp from 'sharp';
import {createTestDatabase} from './helpers/ads-db.mjs';
import {ASSET,ISSUER,publicAdsConfig,readAdsConfig} from '../server/ads/config.mjs';
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
const total100Usdc=1000000000n,price5Usdc=50000000n,fullPasses=5,passDuration=60000,fiveMinutes=fullPasses*passDuration;
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
  timeUnitMs:1000,rotationMs:passDuration,passMs:passDuration,exclusiveUnitMs:1000,
  renderLeadMs:500,reservationMs:60000,processingMs:1000,maxUnits:100,maxWindowMs:3600000,
  maxCampaignSharePercent:100,includedRevisions:1,hostWindows:[],allowedDomains:['x.com','example.com'],
  limits:{uploadBytes:100000,imagePixels:4000000,imageWidth:1920,imageHeight:1080,nameChars:100,descriptionChars:1000,textBytes:4096},
  model:{id:'explicit/local-pilot-fixture',maxCalls:3,maxTokens:200,timeoutMs:5000,maxInputTokens:3000000,maxCostMicrousd:100,inputMicrousdPerMillion:'1',outputMicrousdPerMillion:'1',previewPerHour:10,preauditPerHour:100},
  pricing:Object.fromEntries(['main_stage_screen','venue_center_banner'].map(placement=>[placement,Object.fromEntries(['TIME','PASSES','EXCLUSIVE'].map(plan=>[plan,{unitAmount:'10',designAmount:'5'}]))])),
  publisherKey:keys.privateKey.export({type:'pkcs8',format:'pem'}),publisherPublicKey:keys.publicKey.export({type:'spki',format:'pem'}),
  heartbeatMs:10000,manifestMs:20000,publisherLeaseMs:45000,databaseUrl:'',registryContract:''
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

test('local pilot fixes 5 USDC for five complete 60-second main-stage passes without a design surcharge',async t=>{
 const f=await setup(t),draft=await f.campaign(),quote=await f.quote(draft);
 assert.equal(PILOT_OFFER.id,PILOT_PROFILE);assert.equal(PILOT_OFFER.offerVersion,2);
 assert.equal(PILOT_OFFER.amountUnits,String(price5Usdc));assert.equal(PILOT_OFFER.plan,'PASSES');
 assert.equal(PILOT_OFFER.units,fullPasses);assert.equal(PILOT_OFFER.passMs,passDuration);
 const offers=publicAdsConfig(f.config).offers;assert.equal(offers.length,1);assert.equal(offers[0].id,PILOT_PROFILE);
 assert.equal(quote.offerId,PILOT_PROFILE);assert.equal(quote.offerVersion,2);assert.equal(quote.amountUnits,String(price5Usdc));
 assert.equal(quote.plan,'PASSES');assert.equal(quote.units,fullPasses);assert.equal(quote.passMs,passDuration);
 assert.equal(quote.requiredUnits,fullPasses);assert.equal(quote.unit,'PASSES');assert.deepEqual(quote.placements,['main_stage_screen']);
 assert.equal(quote.lines.length,1);assert.equal(quote.lines[0].designAmount,'0');assert.equal(quote.lines[0].unitAmount,'10000000');
 assert.equal(quote.lines[0].deliveryAmount,String(price5Usdc));assert.equal(quote.terms.refundPolicy,'FULFILL_REMAINING');
 const reservations=(await f.db.query('SELECT * FROM ads_reservations WHERE order_id=$1 ORDER BY starts_at',[quote.orderId])).rows;
 assert.equal(reservations.length,fullPasses);assert.equal(new Set(reservations.map(slot=>slot.pass_id)).size,fullPasses);
 for(const slot of reservations){assert(slot.pass_id);assert.equal(Number(slot.delivery_units),1);assert(+new Date(slot.ends_at)-+new Date(slot.starts_at)>=passDuration);}
 assert.equal((await f.service.getOrder(quote.orderId,ownerId)).placements[0].required,fullPasses);
 assert.equal(f.settlements,0,'a reservation must not initiate a payment');
});

test('pilot rejects price, duration, quantity, placement, plan and offer-version tampering without creating an order',async t=>{
 const f=await setup(t),draft=await f.campaign();
 const mutations=[{amountUnits:'1'},{price:'0.01'},{designAmount:'1'},{durationMs:1000},{timeUnitMs:1000},{passMs:1000},
  {units:1},{units:6},{plan:'TIME'},{plan:'PASSES'},{offerVersion:1},{placements:['venue_center_banner']},
  {placements:['main_stage_screen','venue_center_banner']},{offerId:'unapproved-offer'}];
 for(const mutation of mutations)await assert.rejects(f.quote(draft,mutation),error=>error.status===400||error.status===409,JSON.stringify(mutation));
 assert.equal(Number((await f.db.query('SELECT count(*) AS count FROM ads_orders')).rows[0].count),0);
 assert.equal(Number((await f.db.query('SELECT count(*) AS count FROM ads_reservations')).rows[0].count),0);
 assert.equal(f.decodes,0);assert.equal(f.settlements,0);
});

test('switching to five passes preserves a legacy TIME quote, its frozen duration and payable amount',async t=>{
 const f=await setup(t,{pilot:false}),draft=await f.campaign();
 const legacy=await f.service.quote(ownerId,{campaignId:draft.id,placements:['main_stage_screen'],plan:'TIME',units:2,...f.window()},'legacy-frozen-quote');
 assert.equal(legacy.amountUnits,'25');assert.equal(legacy.requiredUnits,2000);assert.equal(legacy.plan,'TIME');assert.equal(legacy.renderLeadMs,500);
 const before=(await f.db.query('SELECT amount,quote,terms_hash FROM ads_orders WHERE id=$1',[legacy.orderId])).rows[0];
 Object.assign(f.config,applyPilotConfig(f.config),{renderLeadMs:readAdsConfig({}).renderLeadMs});
 const fresh=await f.quote(draft,{},1);assert.equal(fresh.amountUnits,String(price5Usdc));assert.equal(fresh.plan,'PASSES');assert.equal(fresh.requiredUnits,fullPasses);assert.equal(fresh.renderLeadMs,10000);assert.equal(fresh.passMs,passDuration);
 const after=(await f.db.query('SELECT amount,quote,terms_hash FROM ads_orders WHERE id=$1',[legacy.orderId])).rows[0];assert.deepEqual(after,before);
 const challenge=await f.service.pay(ownerId,legacy.orderId);assert.equal(challenge.status,402);assert.equal(challenge.paymentRequired.accepts[0].amount,'25');
 const order=await f.service.getOrder(legacy.orderId,ownerId);assert.equal(order.placements[0].required,2000);assert.equal(order.placements[0].unit,'MILLISECONDS');
});

test('20 explicit local 5 USDC settlements debit 100 to 0 once each; the 21st is refused before authorization processing',async t=>{
 const f=await setup(t),draft=await f.campaign();
 for(let index=0;index<20;index++){
  const quote=await f.quote(draft,{},index).catch(error=>{error.message='Purchase '+(index+1)+': '+error.message;throw error;}),key='pilot-payment-'+index,payload={nonce:uuid()};
  assert.equal(quote.plan,'PASSES');assert.equal(quote.requiredUnits,fullPasses);
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
 const slots=(await f.db.query('SELECT * FROM ads_reservations WHERE order_id=$1 ORDER BY starts_at',[quote.orderId])).rows;
 assert.equal(slots.length,fullPasses);
 const publisher=createPublisher({db:f.db,config:f.config,now:f.now});
 async function frame(slot,offset){
  f.clock.value=+new Date(slot.starts_at)+offset;await publisher.lease();await publisher.schedule();
  const playlist=await f.service.playlist('main_stage_screen',{publisher:true});assert(playlist.active);
  const active=playlist.active,ack={placementId:'main_stage_screen',version:playlist.version,revisionId:active.revisionId,manifestHash:active.manifestHash,imageHash:active.imageHash,frameAt:f.now()};
  assert.equal(await publisher.acknowledge(ack),true);assert.equal(await publisher.acknowledge(ack),false,'duplicate frames cannot add a pass');
 }
 async function complete(slot){
  for(let offset=0;offset<=passDuration;offset+=10000)await frame(slot,offset);
 }
 return {slots,publisher,frame,complete};
}

test('five full minutes require five unique complete 60-second pass IDs; settlement and generation deliver zero',async t=>{
 const f=await setup(t),quote=await f.quote(await f.campaign()),{slots,complete,publisher}=await startPublisher(f,quote);
 assert.equal((await f.service.getOrder(quote.orderId,ownerId)).placements[0].delivered,0);
 for(let index=0;index<slots.length;index++){
  await complete(slots[index]);
  assert.equal((await f.service.getOrder(quote.orderId,ownerId)).placements[0].delivered,index+1);
  if(index<slots.length-1){await publisher.schedule();assert.equal((await f.service.playlist('main_stage_screen',{publisher:true})).active,null,'a completed entitlement is removed from active publication');}
 }
 const state=await f.service.getOrder(quote.orderId,ownerId);
 assert.equal(state.status,'COMPLETED');assert.equal(state.placements[0].delivered,fullPasses);assert.equal(state.placements[0].deficit,0);
 const evidence=(await f.db.query('SELECT * FROM ads_delivery WHERE order_id=$1',[quote.orderId])).rows;
 assert.equal(evidence.length,fullPasses);assert.equal(new Set(evidence.map(row=>row.pass_id)).size,fullPasses);
 assert.deepEqual(evidence.map(row=>row.pass_id).sort(),slots.map(slot=>slot.pass_id).sort());
 for(const row of evidence){
  assert.equal(Number(row.units),1);assert.equal(+new Date(row.ends_at)-+new Date(row.starts_at),passDuration);
  assert(verifyEvidence(row.evidence,row.signature,f.config.publisherPublicKey));
 }
 assert.equal((await f.service.playlist('main_stage_screen')).active,null);
});

test('an interrupted minute restarts from zero and leaves one owed pass after expiry without an automatic refund',async t=>{
 const f=await setup(t),quote=await f.quote(await f.campaign()),{slots,frame,complete,publisher}=await startPublisher(f,quote);
 await frame(slots[0],0);await frame(slots[0],10000);await frame(slots[0],20000);
 // A 30000 ms gap exceeds heartbeat continuity; the live lease is still valid.
 await frame(slots[0],50000);
 const ack=(await f.db.query("SELECT * FROM ads_publisher_acks WHERE placement_id='main_stage_screen'")).rows[0];
 assert.equal(+new Date(ack.pass_started_at),+new Date(slots[0].starts_at)+50000);
 await frame(slots[0],60000);
 assert.equal((await f.db.query('SELECT * FROM ads_delivery WHERE order_id=$1',[quote.orderId])).rows.length,0,'the old 20 seconds cannot combine with the restarted 10 seconds');
 for(const slot of slots.slice(1))await complete(slot);
 let state=await f.service.getOrder(quote.orderId,ownerId);
 assert.equal(state.placements[0].delivered,4);assert.equal(state.placements[0].required,5);assert.equal(state.placements[0].deficit,1);assert.notEqual(state.status,'COMPLETED');
 f.clock.value=Date.parse(quote.endsAt);await publisher.lease();await publisher.schedule();
 assert.equal((await f.service.playlist('main_stage_screen')).active,null);
 state=await f.service.getOrder(quote.orderId,ownerId);
 assert.equal(state.status,'RECONCILIATION_REQUIRED');assert.equal(state.placements[0].status,'PARTIAL');
 assert.equal(state.placements[0].delivered,4);assert.equal(state.placements[0].deficit,1);
 assert.equal(state.quote.terms.refundPolicy,'FULFILL_REMAINING');assert.equal(state.payment.status,'SETTLED');
 assert.equal(Number((await f.db.query('SELECT count(*) AS count FROM ads_refunds WHERE order_id=$1',[quote.orderId])).rows[0].count),0);
 assert.equal((await f.db.query('SELECT * FROM ads_delivery WHERE pass_id=$1',[slots[0].pass_id])).rows.length,0);
 assert.equal(f.settlements,1,'an outstanding pass never causes another charge');
});

const passSchedulerConfig={rotationMs:passDuration,timeUnitMs:fiveMinutes,passMs:passDuration,renderLeadMs:500,maxUnits:fullPasses,maxWindowMs:3600000,maxCampaignSharePercent:100};
const passOrder=(id,index,extra={})=>({id,campaignId:'same-pilot-campaign',committedAt:index,plan:'PASSES',units:fullPasses,startsAt:index*600000,endsAt:(index+1)*600000,...extra});

test('campaign share counts planned minute passes only inside the relevant window and still caps overlapping demand',()=>{
 const slots=planRotations(Array.from({length:20},(_,index)=>passOrder('pilot-'+String(index).padStart(2,'0'),index)),[],passSchedulerConfig);
 assert.equal(slots.length,20*fullPasses);assert.equal(slots.reduce((sum,slot)=>sum+slot.deliveryUnits,0),20*fullPasses);
 const shared=[passOrder('a',0,{endsAt:1000000}),passOrder('b',1,{startsAt:0,endsAt:1000000})];
 assert.throws(()=>planRotations(shared,[],{...passSchedulerConfig,maxCampaignSharePercent:50}),/capacity/i);
});

test('same-campaign pass scheduling preserves millisecond commitment order read from PostgreSQL dates',()=>{
 const orders=['z','y','x'].map((id,index)=>passOrder(id,index,{committedAt:new Date(1000+index*10)}));
 const slots=planRotations(orders,[],passSchedulerConfig);
 assert.deepEqual(slots.map(slot=>slot.orderId),['z','y','x'].flatMap(id=>Array(fullPasses).fill(id)));
});

test('compatible campaigns rotate one complete minute per round; multiple orders cannot buy extra turns for one campaign',()=>{
 const orders=[passOrder('a-first',0,{campaignId:'campaign-a',endsAt:2000000}),
  passOrder('a-second',1,{campaignId:'campaign-a',startsAt:0,endsAt:2000000}),
  passOrder('b',2,{campaignId:'campaign-b',startsAt:0,endsAt:2000000})];
 const slots=planRotations(orders,[],passSchedulerConfig);
 assert.deepEqual(slots.slice(0,10).map(slot=>slot.orderId),Array.from({length:5},()=>['a-first','b']).flat());
 assert.deepEqual(slots.slice(10).map(slot=>slot.orderId),Array(fullPasses).fill('a-second'));
 for(const slot of slots){assert.equal(slot.deliveryUnits,1);assert.equal(slot.end-slot.start,passDuration+passSchedulerConfig.renderLeadMs);}
});


test('interrupted pilot pass is automatically recovered inside its window without charging or duplicating rights',async t=>{
 const f=await setup(t),quote=await f.quote(await f.campaign()),{slots,frame,complete}=await startPublisher(f,quote);
 await frame(slots[0],0);await frame(slots[0],10000);await frame(slots[0],20000);await frame(slots[0],50000);await frame(slots[0],60000);
 for(const slot of slots.slice(1))await complete(slot);
 const retry=(await f.db.query("SELECT * FROM ads_reservations WHERE order_id=$1 AND unit_number=1 AND id<>$2 AND state='COMMITTED' ORDER BY starts_at LIMIT 1",[quote.orderId,slots[0].id])).rows[0];
 assert(retry,'lost minute gets a new complete slot');assert.notEqual(retry.pass_id,slots[0].pass_id);assert.equal(retry.batch_id,quote.orderId);
 await complete(retry);
 const state=await f.service.getOrder(quote.orderId,ownerId);assert.equal(state.status,'COMPLETED');assert.equal(state.fulfillment.units.filter(u=>u.status==='COMPLETED').length,5);assert.equal(f.settlements,1);
 const rows=(await f.db.query('SELECT unit_number FROM ads_delivery WHERE order_id=$1 ORDER BY unit_number',[quote.orderId])).rows;
 assert.deepEqual(rows.map(r=>r.unit_number),[1,2,3,4,5]);assert.equal(Number((await f.db.query('SELECT count(*) AS n FROM ads_orders')).rows[0].n),1);
});

test('consented partial recovery keeps the original paid order and completes only the missing pass with sales closed',async t=>{
 const f=await setup(t),quote=await f.quote(await f.campaign()),{slots,frame,complete,publisher}=await startPublisher(f,quote);
 await frame(slots[0],0);await frame(slots[0],10000);await frame(slots[0],20000);await frame(slots[0],50000);await frame(slots[0],60000);
 for(const slot of slots.slice(1))await complete(slot);
 f.clock.value=Date.parse(quote.endsAt);await publisher.lease();await publisher.schedule();
 const owed=await f.service.getOrder(quote.orderId,ownerId);assert.equal(owed.fulfillment.units.filter(u=>u.status==='DEBT').length,1);assert.equal(owed.placements[0].delivered,4);
 const original=(await f.db.query('SELECT quote,terms_hash,amount FROM ads_orders WHERE id=$1',[quote.orderId])).rows[0];
 await f.db.query("INSERT INTO ads_registry_jobs(id,order_id,batch_id,operation,payload,payload_hash) VALUES($1,$2,$2,'commit',$3,$4)",[uuid(),quote.orderId,{original:'immutable-fixture'},sha256('pilot-child-original')]);
 f.config.enabled=false;f.config.operationalReady=true;
 const proposal={startsAt:new Date(f.now()+5000).toISOString(),endsAt:new Date(f.now()+605000).toISOString(),fulfillmentVersion:owed.fulfillment.version,accept:true};
 const first=await f.service.reprogram(ownerId,quote.orderId,proposal,'pilot-consented-child'),repeat=await f.service.reprogram(ownerId,quote.orderId,proposal,'pilot-consented-child');assert.deepEqual(repeat,first);assert.equal(first.additionalCharge,false);
 const replacement=(await f.db.query("SELECT * FROM ads_reservations WHERE order_id=$1 AND state='COMMITTED'",[quote.orderId])).rows;assert.equal(replacement.length,1);assert.equal(replacement[0].unit_number,1);assert.notEqual(replacement[0].batch_id,quote.orderId);
 await complete(replacement[0]);
 const done=await f.service.getOrder(quote.orderId,ownerId);assert.equal(done.status,'COMPLETED');assert.equal(done.placements[0].delivered,5);assert.equal(f.settlements,1);
 assert.deepEqual((await f.db.query('SELECT quote,terms_hash,amount FROM ads_orders WHERE id=$1',[quote.orderId])).rows[0],original);
 const batches=(await f.db.query('SELECT state,required_units,delivered_units FROM ads_fulfillment_batches WHERE order_id=$1 ORDER BY sequence',[quote.orderId])).rows;
 assert.deepEqual(batches,[{state:'CLOSED',required_units:5,delivered_units:4},{state:'COMPLETED',required_units:1,delivered_units:1}]);
 assert.equal(Number((await f.db.query('SELECT count(*) AS n FROM ads_orders')).rows[0].n),1);assert.equal(Number((await f.db.query('SELECT count(*) AS n FROM ads_payment_attempts')).rows[0].n),1);
});

test('availability survives fifteen seconds of review before quote admission',async t=>{
 const f=await setup(t),draft=await f.campaign();f.config.maxWindowMs=86400000;
 const suggestion=await f.service.availability(ownerId,draft.id,{});assert.equal(Date.parse(suggestion.window.startsAt)%60000,0);assert(Date.parse(suggestion.window.startsAt)>=f.now()+f.config.processingMs+120000);
 f.clock.value+=15000;
 const quote=await f.service.quote(ownerId,{campaignId:draft.id,offerId:PILOT_PROFILE,...suggestion.window},'pilot-suggested-window-review');assert.equal(quote.requiredUnits,5);assert.equal(quote.startsAt,suggestion.window.startsAt);
});
