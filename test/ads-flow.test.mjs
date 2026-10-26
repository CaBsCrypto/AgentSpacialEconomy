import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {Keypair,StrKey} from '@stellar/stellar-sdk';
import sharp from 'sharp';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTestDatabase} from './helpers/ads-db.mjs';
import {createStorage} from '../server/ads/storage.mjs';
import {createCreativeService} from '../server/ads/creative.mjs';
import {createAdsService,confirmPaidOrder} from '../server/ads/service.mjs';
import {createPaymentService} from '../server/ads/payments.mjs';
import {createJobRunner} from '../server/ads/jobs.mjs';
import {createPublisher,verifyEvidence} from '../server/ads/publisher.mjs';
import {createCorrectionService} from '../server/ads/corrections.mjs';
import {createAdsHandler} from '../server/ads/http.mjs';
import {readAdsConfig,ASSET,ISSUER} from '../server/ads/config.mjs';
import {sha256,uuid} from '../server/ads/common.mjs';
const payer=StrKey.encodeContract(Buffer.alloc(32,42)),ownerId='stellar:testnet:'+payer;
async function setup(t,{denied=false}={}){
 const db=await createTestDatabase();t.after(()=>db.close());const clock={value:Date.now()+60000};const now=()=>clock.value;
 const keys=generateKeyPairSync('ed25519');
 const config={enabled:true,missing:[],origin:'https://ads.example',network:'stellar:testnet',asset:ASSET,issuer:ISSUER,payTo:Keypair.random().publicKey(),operators:['operator'],termsVersion:'synthetic-test-terms',policyVersion:'ads-content-v1',refundPolicy:'PRO_RATA',refundDesign:'IF_UNDELIVERED',refundDeadlineMs:60000,disputeAuthority:'operator',privacyNotice:'synthetic test',retentionMs:3600000,timeUnitMs:1000,rotationMs:1000,passMs:1000,exclusiveUnitMs:1000,renderLeadMs:500,reservationMs:60000,processingMs:1000,maxUnits:100,maxWindowMs:120000,maxCampaignSharePercent:100,includedRevisions:1,hostWindows:[],allowedDomains:['x.com','example.com'],limits:{uploadBytes:100000,imagePixels:4000000,imageWidth:1920,imageHeight:1080,nameChars:100,descriptionChars:1000,textBytes:4096},model:{id:'explicit/test-injection',maxCalls:3,maxTokens:200,timeoutMs:5000,maxInputTokens:3000000,maxCostMicrousd:100,inputMicrousdPerMillion:'1',outputMicrousdPerMillion:'1',previewPerHour:10,preauditPerHour:100},pricing:Object.fromEntries(['main_stage_screen','venue_center_banner'].map(p=>[p,Object.fromEntries(['TIME','PASSES','EXCLUSIVE'].map(plan=>[plan,{unitAmount:'10',designAmount:'5'}]))])),publisherKey:keys.privateKey.export({type:'pkcs8',format:'pem'}),publisherPublicKey:keys.publicKey.export({type:'spki',format:'pem'}),heartbeatMs:1000,manifestMs:2000,publisherLeaseMs:5000,databaseUrl:'',registryContract:''};
 const storage=createStorage({config:{storage:{root:await mkdtemp(join(tmpdir(),'ads-flow-'))}}});
 let modelCalls=0,settlements=0;
 const policyCreative=createCreativeService({config,storage,urlInspector:async url=>({url}),model:{compose:async()=>{modelCalls++;return{headline:'Play Aster',tagline:'An accessible puzzle game.',alt:'Aster puzzle game.'};},audit:async input=>{modelCalls++;return {decision:denied&&input.phase==='FINAL'?'UNCERTAIN':'ALLOW',reasons:[],reviewedHash:input.manifestHash};}}});
 const creative={...policyCreative,async generate({revisionId,placements}){
  modelCalls+=2;
  if(denied)return {verdict:{allowed:false,state:'QUARANTINED',reasons:[{message:'Explicit local test auditor uncertainty'}]}};
  const artifacts=[];
  for(const placement of placements){
   const width=placement==='main_stage_screen'?1280:1600,height=placement==='main_stage_screen'?720:400;
   const raster=await sharp({create:{width,height,channels:3,background:'#17485b'}}).png().toBuffer();
   artifacts.push({placement,...await storage.put(raster,{mime:'image/png'}),width,height,alt:'Explicit local pipeline test raster'});
  }
  const manifest={revisionId,artifacts,cta:[{url:'https://example.com/play',domain:'example.com',kind:'website'}]},manifestHash=sha256(manifest);
  return {artifacts,manifest,manifestHash,verdict:{allowed:true,state:'PREAUDITED',reviewedHash:manifestHash}};
 }};
 const runtime={latestLedger:async()=>100,decodePayment:async(p,e)=>{assert.equal(e.payer,payer);return {payer,nonce:p.nonce,expiresLedger:200,authHash:sha256(p)};},verify:async()=>({isValid:true,payer}),settle:async p=>{settlements++;return {success:true,transaction:sha256(p),payer};},confirm:async a=>({state:'CONFIRMED',txHash:a.settlement_tx,payer,ledger:101})};
 const payments=createPaymentService({db,config,runtime,now,onSettled:(tx,o,r)=>confirmPaidOrder(tx,o,r,{config,now})});
 const registry={syncOrder:async()=>({state:'DISABLED'})};
 const service=createAdsService({db,config,storage,creative,payments,registry,now});
 const runner=createJobRunner({db,config,creative,payments,registry,now});
 const image=await sharp({create:{width:64,height:64,channels:3,background:'#72e3df'}}).png().toBuffer();
 const logo=await service.upload(ownerId,image,'image/png','upload-synthetic-logo');
 async function campaign(key='one'){
  const draft=await service.campaign(ownerId,{brief:{name:'Aster',description:'An accessible puzzle game.',xUrl:'https://x.com/aster',websiteUrl:'https://example.com/play',rightsAccepted:true},logoId:logo.id},'campaign-synthetic-'+key);
  const audit=await service.preaudit(ownerId,draft.id,'audit-'+draft.revisionId);assert.equal(audit.allowed,true,JSON.stringify(audit));return draft;
 }
 async function quote(c,extra={}){
  return service.quote(ownerId,{campaignId:c.id,placements:['main_stage_screen'],plan:'TIME',units:2,startsAt:new Date(now()+5000).toISOString(),endsAt:new Date(now()+60000).toISOString(),...extra},'quote-synthetic-'+uuid());
 }
 return {db,config,clock,now,storage,service,creative,payments,runner,registry,campaign,quote,logo,setDenied(value){denied=value;},get settlements(){return settlements;},get modelCalls(){return modelCalls;}};
}
test('local PostgreSQL pipeline with explicit creative/payment adapters: confirmed payment to queued audit, canonical frames and separate delivery',async t=>{
 const f=await setup(t),c=await f.campaign(),q=await f.quote(c);
 const order=await f.service.order(ownerId,q.id);assert.equal(order.status,'RESERVED');
 const payload={nonce:uuid()},key='authorized-payment-local';
 const receipt=await f.service.pay(ownerId,order.id,key,payload);assert.equal(receipt.paymentState,'SETTLED');assert.equal(receipt.orderState,'QUEUED');
 await f.service.pay(ownerId,order.id,key,payload);assert.equal(f.settlements,1);
 assert.equal(Number((await f.db.query("SELECT count(*) FROM ads_outbox WHERE topic='creative'")).rows[0].count),1);
 assert.equal(await f.runner.runOnce(),true);
 let state=await f.service.getOrder(order.id,ownerId);assert.equal(state.queue.state,'SCHEDULED',JSON.stringify({status:state.status,reason:state.reason}));assert.equal(state.placements[0].delivered,0);
 const slots=(await f.db.query("SELECT * FROM ads_reservations WHERE order_id=$1 ORDER BY starts_at",[order.id])).rows;
 const pub=createPublisher({db:f.db,config:f.config,now:f.now});
 f.clock.value=+new Date(slots[0].starts_at);await pub.lease();await pub.schedule();
 assert.equal((await f.service.playlist('main_stage_screen')).active,null,'public delivery waits for canonical application');
 for(const slot of slots){
  f.clock.value=+new Date(slot.starts_at);
  for(let step=0;step<=4;step++){
   f.clock.value=+new Date(slot.starts_at)+step*250;await pub.lease();await pub.schedule();
   const playlist=await f.service.playlist('main_stage_screen',{publisher:true});assert(playlist.active);
   const active=playlist.active,ack={placementId:'main_stage_screen',version:playlist.version,revisionId:active.revisionId,manifestHash:active.manifestHash,imageHash:active.imageHash,frameAt:f.now()};
   if(step===0){assert.equal(await pub.acknowledge({...ack,manifestHash:'0'.repeat(64)}),false);assert.equal(await pub.acknowledge({...ack,frameAt:f.now()-3000}),false);}
   assert.equal(await pub.acknowledge(ack),true);assert.equal(await pub.acknowledge(ack),false,'duplicate frame never counts');
  }
 }
 state=await f.service.getOrder(order.id,ownerId);assert.equal(state.status,'COMPLETED');assert.equal(state.placements[0].delivered,2000);
 assert.equal((await f.service.playlist('main_stage_screen')).active,null);
 const evidence=(await f.db.query('SELECT * FROM ads_delivery')).rows;
 assert.equal(evidence.reduce((n,e)=>n+Number(e.units),0),2000);
 assert.equal((await f.service.evidence(ownerId,order.id)).evidence.length,evidence.length);
 await assert.rejects(f.service.evidence('another-wallet',order.id),/unavailable/);
 for(const e of evidence)assert(verifyEvidence(e.evidence,e.signature,f.config.publisherPublicKey));
});
test('atomic reservation refuses competing last capacity and rolls back a two-placement conflict',async t=>{
 const f=await setup(t),a=await f.campaign('a'),b=await f.campaign('b');
 const start=new Date(f.now()+5000).toISOString(),end=new Date(f.now()+15000).toISOString();
 const racing=await Promise.allSettled([f.quote(a,{plan:'EXCLUSIVE',units:10,startsAt:start,endsAt:end}),f.quote(b,{plan:'EXCLUSIVE',units:10,startsAt:start,endsAt:end})]);
 assert.equal(racing.filter(r=>r.status==='fulfilled').length,1);assert.equal(racing.filter(r=>r.status==='rejected').length,1);
 const first=racing.find(r=>r.status==='fulfilled').value,third=await f.campaign('third');
 await assert.rejects(f.quote(third,{plan:'EXCLUSIVE',units:10,placements:['main_stage_screen','venue_center_banner'],startsAt:start,endsAt:end}),/capacity/i);
 assert.equal(Number((await f.db.query('SELECT count(*) FROM ads_orders')).rows[0].count),1);
 assert.equal(Number((await f.db.query("SELECT count(*) FROM ads_reservations WHERE placement_id='venue_center_banner'")).rows[0].count),0);
 await assert.rejects(f.service.getOrder(first.orderId,'another-wallet'),/unavailable/);
});
test('final uncertainty quarantines the paid order and never fabricates delivery',async t=>{
 const f=await setup(t,{denied:true}),c=await f.campaign(),q=await f.quote(c);
 await f.service.pay(ownerId,q.orderId,'paid-quarantine-local',{nonce:uuid()});await f.runner.runOnce();
 const state=await f.service.getOrder(q.orderId,ownerId);assert.equal(state.status,'QUARANTINED');assert.equal(state.payment.status,'SETTLED');assert.equal(state.placements[0].delivered,0);
 const calls=f.modelCalls;await f.runner.runOnce();assert.equal(f.modelCalls,calls,'job replay does not spend another generation budget');
});
test('HTTP keeps disabled checkout explicit, blocks CSRF before auth, and does not expose session tokens',async()=>{
 const config=readAdsConfig({}),calls={challenge:0};
 const handler=createAdsHandler({config,db:{},auth:{challenge:async()=>{calls.challenge++;return {};},verify:async()=>({identity:{ownerId:'wallet'},token:'never-in-json',cookie:'session-cookie'})},service:{playlist:async()=>({active:null})},refunds:{}});
 assert.equal((await (await handler(new Request('https://local/api/ads/config'))).json()).enabled,false);
 const rejected=await handler(new Request('https://local/api/ads/auth/challenge',{method:'POST',headers:{origin:'https://evil.example'},body:'{}'}));assert.equal(rejected.status,403);assert.equal(calls.challenge,0);
 const verified=await handler(new Request('https://local/api/ads/auth/verify',{method:'POST',headers:{origin:config.origin},body:'{}'}));assert.equal(verified.headers.get('set-cookie'),'session-cookie');assert(!JSON.stringify(await verified.json()).includes('never-in-json'));
});


test('included correction preserves payment and cannot bypass an operator hold',async t=>{
 const f=await setup(t,{denied:true}),campaign=await f.campaign(),q=await f.quote(campaign);
 await f.service.pay(ownerId,q.orderId,'correction-paid-local',{nonce:uuid()});await f.runner.runOnce();
 const corrected=await f.service.revision(ownerId,campaign.id,{brief:{name:'Aster',description:'Corrected accessible game.',xUrl:'https://x.com/aster',websiteUrl:'https://example.com/play',rightsAccepted:true},logoId:f.logo.id},'new-revision-local');
 assert.equal((await f.service.preaudit(ownerId,campaign.id,'correction-audit-'+corrected.revisionId)).allowed,true);
 const corrections=createCorrectionService({db:f.db,config:f.config,now:f.now});
 const identity={address:'operator',ownerId:'operator',role:'operator'};
 await f.service.suspend(identity,q.orderId,'Investigating safety');
 const payload={ownerId,orderId:q.orderId,revisionId:corrected.revisionId,idempotencyKey:'apply-correction-local'};
 await assert.rejects(corrections.apply(payload),/hold/);
 const released=await corrections.release({identity,orderId:q.orderId,reason:'Safe to submit a corrected creative'});assert.equal(released.publicationAuthorized,false);
 const accepted=await corrections.apply(payload);assert.equal(accepted.additionalCharge,false);assert.equal(accepted.remainingCorrections,0);assert.notEqual(accepted.revisionId,corrected.revisionId);assert.equal(accepted.sourceRevisionId,corrected.revisionId);
 await corrections.apply(payload);assert.equal(f.settlements,1);assert.equal(Number((await f.db.query('SELECT count(*) FROM ads_order_corrections')).rows[0].count),1);
 f.setDenied(false);await f.runner.runOnce();const order=await f.service.getOrder(q.orderId,ownerId);
 assert.equal(order.queue.state,'SCHEDULED');assert.equal(order.revisionId,accepted.revisionId);assert.equal(order.amountUnits,q.amountUnits);
});
test('x402 standard headers preserve the signed payload and only SETTLED returns a payment response',async()=>{
 const config={...readAdsConfig({}),origin:'https://ads.example'},payload={x402Version:2,payload:{transaction:'explicit-fixture'}},id=uuid();let received,calls=0;
 const handler=createAdsHandler({config,db:{query:async()=>({rows:[{count:1}]})},auth:{authenticate:async()=>({ownerId})},service:{pay:async(_owner,_id,_key,p)=>{received=p;calls++;return{paymentState:'SETTLED',transaction:'a'.repeat(64),payer};}},refunds:{}});
 const headers={origin:config.origin,'payment-signature':Buffer.from(JSON.stringify(payload)).toString('base64'),'idempotency-key':'standard-header-local'};
 const response=await handler(new Request(config.origin+'/api/ads/orders/'+id+'/pay',{method:'POST',headers,body:'{}'}));
 assert.equal(response.status,200);assert.deepEqual(received,payload);assert.equal(JSON.parse(Buffer.from(response.headers.get('payment-response'),'base64').toString()).transaction,'a'.repeat(64));
 const conflict=await handler(new Request(config.origin+'/api/ads/orders/'+id+'/pay',{method:'POST',headers,body:JSON.stringify({paymentPayload:{other:true}})}));assert.equal(conflict.status,409);assert.equal(calls,1);
 for(const query of ['?placement=unknown','?placement=main_stage_screen&placement=venue_center_banner'])assert.equal((await handler(new Request(config.origin+'/api/ads/config'+query))).status,400);
 const valid=await handler(new Request(config.origin+'/api/ads/config?placement=venue%5Fcenter%5Fbanner'));assert.equal((await valid.json()).selectedPlacement,'venue_center_banner');
});


test('operator dispute HTTP cannot replace the authenticated identity or route dispute ID with body fields',async()=>{
 const config={...readAdsConfig({}),origin:'https://ads.example'},identity={ownerId:'trusted-operator',address:'actual-operator',role:'operator'},id=uuid();let received;
 const handler=createAdsHandler({config,db:{query:async()=>({rows:[{count:1}]})},auth:{authenticate:async()=>identity},service:{},refunds:{},corrections:{resolve:async value=>{received=value;return {status:'RESOLVED'};}}});
 const response=await handler(new Request(config.origin+'/api/ads/operator/disputes/'+id+'/resolve',{method:'POST',headers:{origin:config.origin,'idempotency-key':'operator-resolution-test'},body:JSON.stringify({outcome:'REJECTED',reason:'Operator explanation',identity:{ownerId:'spoofed',address:'contracted-authority',role:'operator'},disputeId:uuid()})}));
 assert.equal(response.status,200);assert.deepEqual(received.identity,identity);assert.equal(received.disputeId,id);assert.equal(received.outcome,'REJECTED');
});

test('the same preaudited correction draft creates separate immutable generation revisions for two paid orders',async t=>{
 const f=await setup(t,{denied:true}),campaign=await f.campaign(),stage=await f.quote(campaign),banner=await f.quote(campaign,{placements:['venue_center_banner']});
 await f.service.pay(ownerId,stage.orderId,'shared-correction-stage',{nonce:uuid()});await f.service.pay(ownerId,banner.orderId,'shared-correction-banner',{nonce:uuid()});await f.runner.runOnce();await f.runner.runOnce();
 for(const q of [stage,banner])await f.db.query("INSERT INTO ads_outbox(id,topic,aggregate_id,payload,dedupe_key,status) VALUES($1,'registry',$2,$3,$4,'DONE')",[uuid(),q.orderId,{operation:'commit'},'registry:commit:'+q.orderId]);
 const draft=await f.service.revision(ownerId,campaign.id,{brief:{name:'Aster',description:'Corrected accessible game.',xUrl:'https://x.com/aster',websiteUrl:'https://example.com/play',rightsAccepted:true},logoId:f.logo.id},'shared-correction-draft');
 await f.service.preaudit(ownerId,campaign.id,'shared-correction-preaudit');const corrections=createCorrectionService({db:f.db,config:f.config,now:f.now});
 const a=await corrections.apply({ownerId,orderId:stage.orderId,revisionId:draft.revisionId,idempotencyKey:'correction-clone-stage'}),b=await corrections.apply({ownerId,orderId:banner.orderId,revisionId:draft.revisionId,idempotencyKey:'correction-clone-banner'});
 assert.notEqual(a.revisionId,b.revisionId);assert.notEqual(a.revisionId,draft.revisionId);assert.notEqual(b.revisionId,draft.revisionId);
 f.setDenied(false);for(let i=0;i<4;i++)await f.runner.runOnce();
 for(const [accepted,placement] of [[a,'main_stage_screen'],[b,'venue_center_banner']]){const row=(await f.db.query('SELECT * FROM ads_revisions WHERE id=$1',[accepted.revisionId])).rows[0];assert.equal(row.manifest.revisionId,accepted.revisionId);assert.deepEqual(row.manifest.artifacts.map(a=>a.placement),[placement]);assert.equal((await f.service.getOrder(accepted.orderId,ownerId)).queue.state,'SCHEDULED');}
 const intake=(await f.db.query('SELECT * FROM ads_revisions WHERE id=$1',[draft.revisionId])).rows[0];assert.equal(intake.state,'PREAUDITED');assert.equal(intake.manifest,null);assert.equal(f.settlements,2);
 for(const applied of [a,b])assert.equal((await f.db.query("SELECT id FROM ads_outbox WHERE topic='registry' AND aggregate_id=$1 AND dedupe_key=$2",[applied.orderId,'registry:commit:'+applied.orderId+':'+applied.revisionId])).rowCount,1,'a consumed previous registry job must not suppress the corrected revision');
});

test('stored manifest reuse rejects a missing placement or a different revision before fulfilling design',async t=>{
 const f=await setup(t),campaign=await f.campaign(),q=await f.quote(campaign,{placements:['main_stage_screen','venue_center_banner']});await f.service.pay(ownerId,q.orderId,'stored-manifest-paid',{nonce:uuid()});
 const cases=[{revisionId:q.revisionId,artifacts:[{placement:'main_stage_screen'}]},{revisionId:uuid(),artifacts:[{placement:'main_stage_screen'},{placement:'venue_center_banner'}]}];
 for(const manifest of cases){const hash=sha256(manifest);await f.db.query("UPDATE ads_revisions SET state='AUDITED',manifest=$2,manifest_hash=$3,verdict=$4 WHERE id=$1",[q.revisionId,manifest,hash,{allowed:true,reviewedHash:hash}]);await f.db.query("UPDATE ads_outbox SET status='READY',available_at=$2 WHERE aggregate_id=$1 AND topic='creative'",[q.orderId,new Date(f.now()-1)]);const calls=f.modelCalls;await f.runner.runOnce();const state=await f.service.getOrder(q.orderId,ownerId);assert.notEqual(state.queue.state,'SCHEDULED');assert.equal(state.design.status,'PENDING');assert.equal(f.modelCalls,calls);}
});
