import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDatabase} from './helpers/ads-db.mjs';
import {uuid,sha256} from '../server/ads/common.mjs';
import {ensureFulfillment,recoverFulfillment,fulfillmentStatus,reprogramFulfillment,playbackStatus} from '../server/ads/fulfillment.mjs';
const owner='stellar:testnet:C'+'A'.repeat(55);
async function fixture(t){const db=await createTestDatabase();t.after(()=>db.close());const clock={value:Date.UTC(2026,9,26,10)},now=()=>clock.value;const config={passMs:60000,renderLeadMs:10000,heartbeatMs:1000,manifestMs:2000,processingMs:1000,maxWindowMs:86400000,hostWindows:[],registryContract:'',maxUnits:5,rotationMs:60000,maxCampaignSharePercent:100};
 const campaign=uuid(),upload=uuid(),revision=uuid(),quoteId=uuid(),id=uuid(),start=now()+1000,end=now()+600000;
 await db.query('INSERT INTO ads_uploads(id,owner_id,storage_key,hash,mime,width,height,size) VALUES($1,$2,$3,$4,$5,1,1,1)',[upload,owner,'logo.png','a'.repeat(64),'image/png']);
 await db.query('INSERT INTO ads_campaigns(id,owner_id,brief,current_revision) VALUES($1,$2,$3,$4)',[campaign,owner,{},revision]);
 await db.query("INSERT INTO ads_revisions(id,campaign_id,brief,logo_id,content_hash,state,manifest,manifest_hash) VALUES($1,$2,$3,$4,$5,'AUDITED',$6,$7)",[revision,campaign,{},upload,'a'.repeat(64),{artifacts:[]},'b'.repeat(64)]);
 const quote={offerId:'main-stage-test-5m',offerVersion:2,plan:'PASSES',placements:['main_stage_screen'],requiredUnits:5,passMs:60000,renderLeadMs:10000,units:5,campaignId:campaign,startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString(),expiresAt:new Date(end).toISOString(),terms:{refundPolicy:'FULFILL_REMAINING'}};
 await db.query('INSERT INTO ads_quotes(id,owner_id,campaign_id,revision_id,snapshot,terms_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[quoteId,owner,campaign,revision,quote,sha256(quote),new Date(end)]);
 await db.query("INSERT INTO ads_orders(id,owner_id,quote_id,revision_id,amount,pay_to,terms_hash,quote,state,queue_state) VALUES($1,$2,$3,$4,50000000,$5,$6,$7,'QUEUED','SCHEDULED')",[id,owner,quoteId,revision,'G'+'A'.repeat(55),sha256(quote),quote]);
 await db.query("INSERT INTO ads_placements(order_id,placement_id,required_units,unit,state) VALUES($1,'main_stage_screen',5,'PASSES','SCHEDULED')",[id]);
 await db.query("INSERT INTO ads_payment_attempts(id,order_id,idempotency_key,payload_hash,signed_payload,network,payer,auth_nonce,auth_hash,expires_ledger,start_ledger,state,settlement_tx) VALUES($1,$2,'fixture-paid',$3,$4,'stellar:testnet',$5,$6,$7,100,1,'SETTLED',$8)",[uuid(),id,sha256(id),{},'C'+'A'.repeat(55),uuid(),sha256('auth'+id),sha256('settled'+id)]);
 const order=(await db.query('SELECT * FROM ads_orders WHERE id=$1',[id])).rows[0];await db.transaction(tx=>ensureFulfillment(tx,order,now()));
 return{db,clock,now,config,order,start,end};}
test('pilot entitlements remain five across repeated initialization and recovery',async t=>{const f=await fixture(t);await f.db.transaction(tx=>ensureFulfillment(tx,f.order,f.now()));await f.db.transaction(tx=>recoverFulfillment(tx,{config:f.config,now:f.now()}));const state=await fulfillmentStatus(f.db,f.order,{config:f.config,now:f.now()});assert.equal(state.units.length,5);assert.deepEqual(state.units.map(u=>u.number),[1,2,3,4,5]);const before=(await f.db.query("SELECT id FROM ads_reservations WHERE order_id=$1 AND state='COMMITTED'",[f.order.id])).rows;assert.equal(before.length,5);await f.db.transaction(tx=>recoverFulfillment(tx,{config:f.config,now:f.now()}));assert.deepEqual((await f.db.query("SELECT id FROM ads_reservations WHERE order_id=$1 AND state='COMMITTED' ORDER BY id",[f.order.id])).rows.map(r=>r.id).sort(),before.map(r=>r.id).sort());});
test('recovery cannot consume another committed reservation',async t=>{const f=await fixture(t);f.config.hostWindows=[{placementId:'main_stage_screen',startsAt:new Date(f.start).toISOString(),endsAt:new Date(f.start+140000).toISOString()}];await f.db.transaction(tx=>recoverFulfillment(tx,{config:f.config,now:f.now()}));const slots=(await f.db.query('SELECT * FROM ads_reservations WHERE order_id=$1 ORDER BY starts_at',[f.order.id])).rows;assert.equal(slots.length,5);assert(+new Date(slots[0].starts_at)>=f.start+140000);});
test('public playback is derived from confirmed ACKs, not the seventy-second reservation',()=>{const now=100000,p={active:{plan:'PASSES',passMs:60000},version:4,valid_until:new Date(now+2000)},ack={version:4,ack_at:new Date(now),pass_started_at:new Date(now-20000),pass_id:uuid(),fence:8};const value=playbackStatus({playlist:p,ack,lease:{fence:8,expires_at:new Date(now+5000)},now,config:{manifestMs:2000,heartbeatMs:1000}});assert.equal(value.phase,'PLAYING');assert.equal(value.remainingMs,40000);assert.equal(value.durationMs,60000);assert.equal(playbackStatus({playlist:p,ack,lease:{fence:9,expires_at:new Date(now+5000)},now,config:{manifestMs:2000,heartbeatMs:1000}}).phase,'PAUSED');});

test('expired partial delivery creates a consented deficit batch with one order and one frozen payment',async t=>{
 const f=await fixture(t),revision=f.order.revision_id;
 for(let number=1;number<=3;number++){const id=uuid(),start=f.start+(number-1)*70000;await f.db.query("INSERT INTO ads_delivery(id,order_id,placement_id,revision_id,manifest_hash,playlist_version,fence,starts_at,ends_at,units,pass_id,signature,publisher_key,evidence,batch_id,unit_number) VALUES($1,$2,'main_stage_screen',$3,$4,1,1,$5,$6,1,$7,'local-fixture','local-fixture',$8,$2,$9)",[id,f.order.id,revision,'b'.repeat(64),new Date(start),new Date(start+60000),uuid(),{},number]);await f.db.query('UPDATE ads_fulfillment_units SET completed_delivery_id=$3,completed_at=$4 WHERE order_id=$1 AND number=$2',[f.order.id,number,id,new Date(start+60000)]);}
 await f.db.query('UPDATE ads_placements SET delivered_units=3 WHERE order_id=$1',[f.order.id]);await f.db.query('UPDATE ads_fulfillment_batches SET delivered_units=3 WHERE id=$1',[f.order.id]);
 await f.db.query("INSERT INTO ads_registry_jobs(id,order_id,operation,payload,payload_hash,batch_id) VALUES($1,$2,'commit',$3,$4,$2)",[uuid(),f.order.id,{immutable:'local-first-commit'},sha256('original-commit')]);
 f.clock.value=f.end+1;await f.db.transaction(tx=>recoverFulfillment(tx,{config:f.config,now:f.now()}));
 const before=(await f.db.query('SELECT * FROM ads_orders WHERE id=$1',[f.order.id])).rows[0];
 const proposal={startsAt:new Date(f.now()+1000).toISOString(),endsAt:new Date(f.now()+601000).toISOString(),fulfillmentVersion:Number(before.fulfillment_version),accept:true};
 const result=await f.db.transaction(tx=>reprogramFulfillment(tx,before,proposal,f.config,f.now()));assert.equal(result.additionalCharge,false);
 const batches=(await f.db.query('SELECT * FROM ads_fulfillment_batches WHERE order_id=$1 ORDER BY sequence',[f.order.id])).rows;
 assert.equal(batches.length,2);assert.equal(batches[0].state,'CLOSED');assert.equal(batches[0].delivered_units,3);assert.equal(batches[1].required_units,2);assert.deepEqual(batches[1].terms.units,[4,5]);assert.equal(batches[1].terms.additionalCharge,'0');assert.equal(batches[1].parent_batch_id,batches[0].id);
 const after=(await f.db.query('SELECT * FROM ads_orders WHERE id=$1',[f.order.id])).rows[0];assert.deepEqual(after.quote,before.quote);assert.equal(after.terms_hash,before.terms_hash);assert.equal(String(after.amount),'50000000');
 assert.equal(Number((await f.db.query('SELECT count(*) AS n FROM ads_orders')).rows[0].n),1);assert.equal(Number((await f.db.query('SELECT count(*) AS n FROM ads_payment_attempts')).rows[0].n),1);
 const reservations=(await f.db.query("SELECT * FROM ads_reservations WHERE order_id=$1 AND state='COMMITTED' ORDER BY unit_number",[f.order.id])).rows;assert.deepEqual(reservations.map(s=>s.unit_number),[4,5]);assert(reservations.every(s=>s.batch_id===batches[1].id));
 await assert.rejects(f.db.transaction(tx=>reprogramFulfillment(tx,after,proposal,f.config,f.now())),e=>e.code==='fulfillment_version_conflict');
});

test('availability suggests five estimated passes and a one-hour window without taking a reservation',async t=>{
 const f=await fixture(t);const {createAdsService}=await import('../server/ads/service.mjs');const service=createAdsService({db:f.db,config:f.config,now:f.now});
 const before=Number((await f.db.query('SELECT count(*) AS n FROM ads_reservations')).rows[0].n);
 const value=await service.availability(owner,f.order.quote.campaignId,{});assert.equal(value.estimated,true);assert.equal(value.estimatedPasses.length,5);assert.equal(Date.parse(value.window.endsAt)-Date.parse(value.window.startsAt),3600000);
 assert.equal(Number((await f.db.query('SELECT count(*) AS n FROM ads_reservations')).rows[0].n),before);
 await assert.rejects(service.availability('foreign-wallet',f.order.quote.campaignId,{}),e=>e.status===404);
});

test('stale, expired and cross-attempt playback cannot show a running paid minute',()=>{
 const now=100000,id=uuid(),p={active:{plan:'PASSES',passMs:60000,passId:id},version:2,valid_until:new Date(now+2000)},ack={version:2,ack_at:new Date(now),pass_started_at:new Date(now-1000),pass_id:id,fence:3},lease={fence:3,expires_at:new Date(now+5000)},config={manifestMs:2000,heartbeatMs:1000};
 for(const change of [{ack:{...ack,pass_id:uuid()}},{ack:{...ack,ack_at:new Date(now-3000)}},{lease:{...lease,expires_at:new Date(now)}}]){const value=playbackStatus({playlist:p,ack,lease,now,config,...change});assert.equal(value.phase,'PAUSED');assert.equal(value.remainingMs,null);}
 assert.equal(playbackStatus({playlist:p,ack,lease,now,config,completed:true}).phase,'IDLE');
});

test('an unpaid expired quote never becomes a purchased delivery debt',async t=>{
 const f=await fixture(t);await f.db.query('DELETE FROM ads_payment_attempts WHERE order_id=$1',[f.order.id]);f.clock.value=f.end+1;
 await f.db.transaction(tx=>recoverFulfillment(tx,{config:f.config,now:f.now()}));const value=await fulfillmentStatus(f.db,f.order,{config:f.config,now:f.now()});assert(value.units.every(u=>u.status==='PENDING'));assert.equal((await f.db.query('SELECT state FROM ads_orders WHERE id=$1',[f.order.id])).rows[0].state,'QUEUED');assert.equal((await f.db.query("SELECT count(*)::int AS n FROM ads_outbox WHERE topic='registry'")).rows[0].n,0);
});
