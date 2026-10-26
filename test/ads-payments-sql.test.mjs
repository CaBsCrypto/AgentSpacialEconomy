import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import * as sdk from '@stellar/stellar-sdk';
import {createTestDatabase} from './helpers/ads-db.mjs';
import {createPaymentService} from '../server/ads/payments.mjs';
import {createRefundService} from '../server/ads/refunds.mjs';
import {createRegistryService,registryEvidenceDigest} from '../server/ads/registry.mjs';
import {sha256,uuid} from '../server/ads/common.mjs';
import {TESTNET_USDC,TESTNET_ISSUER} from '../server/ads/stellar-payments.mjs';
const address=sdk.StrKey.encodeContract(Buffer.alloc(32,8)),owner='stellar:testnet:'+address,payTo=sdk.Keypair.random().publicKey();
const keys=generateKeyPairSync('ed25519'),config={network:'stellar:testnet',asset:TESTNET_USDC,issuer:TESTNET_ISSUER,payTo,origin:'https://ads.example',operators:['operator'],registryEvidenceGraceMs:60000,passMs:1000,publisherKey:keys.privateKey.export({format:'pem',type:'pkcs8'})};
async function fixture(db){
 const campaign=uuid(),upload=uuid(),revision=uuid(),quote=uuid(),id=uuid(),t=Date.now();
 const snapshot={placements:['main_stage_screen'],plan:'TIME',units:1,requiredUnits:1000,startsAt:new Date(t+5000).toISOString(),endsAt:new Date(t+60000).toISOString()};
 await db.query('INSERT INTO ads_campaigns(id,owner_id,brief) VALUES($1,$2,$3)',[campaign,owner,{}]);
 await db.query('INSERT INTO ads_uploads(id,owner_id,storage_key,hash,mime,width,height,size) VALUES($1,$2,$3,$4,$5,1,1,1)',[upload,owner,'logo','a'.repeat(64),'image/png']);
 await db.query("INSERT INTO ads_revisions(id,campaign_id,brief,logo_id,content_hash,state,manifest_hash) VALUES($1,$2,$3,$4,$5,'AUDITED',$6)",[revision,campaign,{},upload,'b'.repeat(64),'c'.repeat(64)]);
 await db.query('INSERT INTO ads_quotes(id,owner_id,campaign_id,revision_id,snapshot,terms_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[quote,owner,campaign,revision,snapshot,'d'.repeat(64),new Date(t+60000)]);
 await db.query('INSERT INTO ads_orders(id,owner_id,quote_id,revision_id,amount,pay_to,terms_hash,quote) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,owner,quote,revision,'500000',payTo,'d'.repeat(64),snapshot]);
 await db.query("INSERT INTO ads_reservations(id,order_id,placement_id,starts_at,ends_at,expires_at,state,delivery_units) VALUES($1,$2,'main_stage_screen',$3,$4,$5,'HELD',1000)",[uuid(),id,new Date(t+5000),new Date(t+60000),new Date(t+60000)]);
 await db.query("INSERT INTO ads_placements(order_id,placement_id,required_units,unit) VALUES($1,'main_stage_screen',1000,'MILLISECONDS')",[id]);
 return {id,revision,request:{orderId:id,ownerId:owner,idempotencyKey:'payment-test-key',payload:{nonce:uuid()}}};
}
const runtimeFor=()=>{let count=0;return {latestLedger:async()=>100,decodePayment:async(payload,expected)=>{assert.equal(expected.payer,address);return {payer:address,nonce:payload.nonce,expiresLedger:200,authHash:sha256(payload)};},verify:async()=>({isValid:true,payer:address}),settle:async()=>{count++;return {success:true,transaction:'e'.repeat(64),payer:address};},confirm:async a=>a.settlement_tx?{state:'CONFIRMED',txHash:a.settlement_tx,payer:address,ledger:102}:{state:'UNKNOWN'},get count(){return count;}};};
const queue=async(tx,order)=>{await tx.query("UPDATE ads_orders SET state='QUEUED' WHERE id=$1",[order.id]);await tx.query("INSERT INTO ads_outbox(id,topic,aggregate_id,dedupe_key,payload) VALUES($1,'creative',$2,$3,$4) ON CONFLICT(dedupe_key) DO NOTHING",[uuid(),order.id,'paid:'+order.id,{}]);};
test('PostgreSQL settlement rollback recovers original payment and creates exactly one durable job',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const f=await fixture(db),runtime=runtimeFor();let crash=true;
 const service=createPaymentService({db,config,runtime,onSettled:async(tx,o)=>{await queue(tx,o);if(crash){crash=false;throw Error('process died after settlement');}}});
 await assert.rejects(service.pay(f.request),/process died/);
 assert.equal((await db.query('SELECT state FROM ads_payment_attempts')).rows[0].state,'SETTLING');assert.equal((await db.query("SELECT * FROM ads_outbox WHERE topic='creative'")).rows.length,0);
 const recovered=await service.pay(f.request);assert.equal(recovered.paymentState,'SETTLED');assert.equal(runtime.count,1);assert.equal((await db.query("SELECT * FROM ads_outbox WHERE topic='creative'")).rows.length,1);
 await service.pay(f.request);assert.equal(runtime.count,1);assert.equal((await db.query("SELECT * FROM ads_outbox WHERE topic='creative'")).rows.length,1);
});
test('PostgreSQL rejects reused authorization nonce across independent orders',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const first=await fixture(db),runtime=runtimeFor(),service=createPaymentService({db,config,runtime,onSettled:queue});await service.pay(first.request);
 await db.query("UPDATE ads_reservations SET state='RELEASED' WHERE order_id=$1",[first.id]);const second=await fixture(db);
 await assert.rejects(service.pay({...second.request,payload:first.request.payload}),e=>e.code==='authorization_reused');assert.equal(runtime.count,1);
});
test('PostgreSQL refund receipt stays unresolved until an exact confirmed transfer, without a second submission',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const f=await fixture(db),payments=createPaymentService({db,config,runtime:runtimeFor(),onSettled:queue});await payments.pay(f.request);
 let confirmed=false,submits=0;const refunds=createRefundService({db,config,runtime:{prepare:async()=>({txHash:'f'.repeat(64),signedXdr:'immutable-signed-envelope'}),submit:async()=>{submits++;throw Error('lost reply');},confirm:async()=>confirmed?{state:'CONFIRMED',txHash:'f'.repeat(64)}:{state:'UNKNOWN'}}});
 const requested=await refunds.request({orderId:f.id,ownerId:owner,amount:'200000',reason:'Partial delivery',idempotencyKey:'refund-test-key'});await refunds.approve({refundId:requested.id,operatorId:'operator'});
 assert.equal((await refunds.submit({refundId:requested.id,operatorId:'operator'})).state,'RECONCILIATION_REQUIRED');await refunds.submit({refundId:requested.id,operatorId:'operator'});assert.equal(submits,1);confirmed=true;assert.equal((await refunds.reconcile(requested.id)).state,'CONFIRMED');
 await assert.rejects(refunds.request({orderId:f.id,ownerId:owner,amount:'400000',reason:'Again',idempotencyKey:'refund-over-limit'}),e=>e.code==='refund_exceeds_payment');
});
test('registry synchronization signs XDR evidence once and preserves commit/evidence/complete ordering in PostgreSQL',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const f=await fixture(db);await createPaymentService({db,config,runtime:runtimeFor(),onSettled:queue}).pay(f.request);
 const order=(await db.query('SELECT * FROM ads_orders WHERE id=$1',[f.id])).rows[0],start=Date.parse(order.quote.startsAt),deliveryId=uuid();
 await db.query('INSERT INTO ads_delivery(id,order_id,placement_id,revision_id,manifest_hash,playlist_version,fence,starts_at,ends_at,units,signature,publisher_key,evidence) VALUES($1,$2,$3,$4,$5,1,1,$6,$7,1000,$8,$9,$10)',[deliveryId,f.id,'main_stage_screen',f.revision,'c'.repeat(64),new Date(start),new Date(start+1000),'offchain-signature','offchain-publisher',{}]);
 await db.query('UPDATE ads_placements SET delivered_units=1000 WHERE order_id=$1',[f.id]);const registryConfig={...config,registryContract:sdk.StrKey.encodeContract(Buffer.alloc(32,7))};
 let sent=0;const runtime={prepare:async j=>({txHash:sha256(j.id),signedXdr:'fixed-envelope'}),submit:async()=>{sent++;},confirm:async j=>({state:'CONFIRMED',txHash:j.transaction_hash,ledger:1})};
 const registry=createRegistryService({db,config:registryConfig,runtime});await registry.syncOrder(f.id);await registry.syncOrder(f.id);
 const jobs=(await db.query('SELECT * FROM ads_registry_jobs ORDER BY sequence')).rows;assert.deepEqual(jobs.map(j=>j.operation),['commit','record_delivery','complete']);assert.equal(jobs[1].payload.nonce,'0');
 assert(verify(null,registryEvidenceDigest(registryConfig,jobs[1].payload,sdk),keys.publicKey,Buffer.from(jobs[1].payload.signature,'hex')));
 assert.equal((await registry.flush()).processed,1);assert.equal(sent,1);assert.equal((await registry.flush()).processed,1);assert.equal((await registry.flush()).processed,1);assert.equal(sent,3);
 const disputeId=uuid();await db.query("INSERT INTO ads_disputes(id,order_id,owner_id,reason) VALUES($1,$2,$3,$4)",[disputeId,f.id,owner,'Contested evidence']);
 await registry.syncOrder(f.id);await registry.flush();
 await db.query("UPDATE ads_disputes SET state='RESOLVED',resolved_at=now() WHERE id=$1",[disputeId]);await registry.syncOrder(f.id);
 const resolved=(await db.query('SELECT * FROM ads_registry_jobs ORDER BY sequence')).rows;assert.deepEqual(resolved.slice(-2).map(j=>j.operation),['resolve_dispute','complete']);assert.match(resolved.at(-2).payload.remedy_hash,/^[0-9a-f]{64}$/);
 await registry.flush();await registry.flush();assert.equal(sent,6);
});

test('quoted settlement remedy computes exact deficit, pauses publication on approval and closes only after confirmed refund',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const f=await fixture(db);await createPaymentService({db,config,runtime:runtimeFor(),onSettled:queue}).pay(f.request);
 const order=(await db.query('SELECT * FROM ads_orders WHERE id=$1',[f.id])).rows[0];order.quote.terms={refundPolicy:'PRO_RATA',refundDesign:'IF_UNDELIVERED',refundDeadlineMs:60000};order.quote.lines=[{placementId:'main_stage_screen',deliveryAmount:'400000',designAmount:'100000'}];
 await db.query('UPDATE ads_orders SET quote=$2 WHERE id=$1',[f.id,order.quote]);await db.query("UPDATE ads_placements SET delivered_units=400,state='PARTIAL' WHERE order_id=$1",[f.id]);await db.query('UPDATE ads_revisions SET manifest=$2 WHERE id=$1',[f.revision,{artifacts:[{placement:'main_stage_screen'}]}]);
 let proved=false;const refunds=createRefundService({db,config,runtime:{prepare:async()=>({txHash:'a'.repeat(64),signedXdr:'approved-refund-envelope'}),submit:async()=>{},confirm:async()=>proved?{state:'CONFIRMED',txHash:'a'.repeat(64)}:{state:'UNKNOWN'}}});
 const request=await refunds.requestSettlementRemedy({orderId:f.id,ownerId:owner,reason:'Partial delivery',idempotencyKey:'quoted-remedy-test'});assert.equal(request.amount,'240000');assert.equal(request.remedy.lines[0].designAmount,'0');
 await refunds.approve({refundId:request.id,operatorId:'operator'});assert.equal((await db.query('SELECT suspended FROM ads_orders WHERE id=$1',[f.id])).rows[0].suspended,true);assert.equal((await db.query('SELECT state FROM ads_reservations WHERE order_id=$1',[f.id])).rows[0].state,'RELEASED');
 await refunds.submit({refundId:request.id,operatorId:'operator'});assert.notEqual((await db.query('SELECT state FROM ads_placements WHERE order_id=$1',[f.id])).rows[0].state,'CLOSED_WITH_REMEDY');proved=true;await refunds.reconcile(request.id);
 const placement=(await db.query('SELECT * FROM ads_placements WHERE order_id=$1',[f.id])).rows[0];assert.equal(placement.state,'CLOSED_WITH_REMEDY');assert.equal(String(placement.delivered_units),'400');assert.equal(String(placement.required_units),'1000');assert.equal((await db.query('SELECT state FROM ads_orders WHERE id=$1',[f.id])).rows[0].state,'COMPLETED');
});

test('a missing independent placement reservation refuses payment before transmission',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const f=await fixture(db),runtime=runtimeFor();const order=(await db.query('SELECT * FROM ads_orders WHERE id=$1',[f.id])).rows[0];order.quote.placements.push('venue_center_banner');await db.query('UPDATE ads_orders SET quote=$2 WHERE id=$1',[f.id,order.quote]);
 await assert.rejects(createPaymentService({db,config,runtime,onSettled:queue}).pay(f.request),e=>e.code==='reservation_incomplete');assert.equal(runtime.count,0);assert.equal((await db.query('SELECT * FROM ads_payment_attempts')).rows.length,0);
});


test('checkout closing during verification prevents the first settlement while preserving the durable attempt',async t=>{
 const db=await createTestDatabase({env:{}});t.after(()=>db.close());const f=await fixture(db),base=Date.now();let clock=base;
 const runtime=runtimeFor();runtime.verify=async()=>{clock=base+1000;return{isValid:true,payer:address};};
 const service=createPaymentService({db,config:{...config,checkoutUntil:new Date(base+500).toISOString()},runtime,onSettled:queue,now:()=>clock});
 await assert.rejects(service.pay(f.request),error=>error.status===503&&error.code==='checkout_window_closed');assert.equal(runtime.count,0);
 const attempt=(await db.query('SELECT * FROM ads_payment_attempts WHERE order_id=$1',[f.id])).rows[0];assert.equal(attempt.state,'FAILED');assert.equal(attempt.error_code,'checkout_window_closed');assert.equal(attempt.settlement_tx,null);assert.equal(sha256(attempt.signed_payload),sha256(f.request.payload));
 assert.equal((await db.query("SELECT * FROM ads_outbox WHERE topic='creative'")).rowCount,0);assert.notEqual((await db.query('SELECT state FROM ads_orders WHERE id=$1',[f.id])).rows[0].state,'QUEUED');
 const event=(await db.query("SELECT * FROM ads_events WHERE aggregate_id=$1 AND event='payment_not_submitted_checkout_closed'",[f.id])).rows[0];assert(event);assert.equal(event.data.submitted,false);assert.equal((await service.reconcile(attempt.id)).paymentState,'FAILED');assert.equal(runtime.count,0);
});

test('a payment already submitted before cutoff still reconciles and queues after cutoff without a second charge',async t=>{
 const db=await createTestDatabase({env:{}});t.after(()=>db.close());const f=await fixture(db),base=Date.now();let clock=base,proved=false;
 const runtime=runtimeFor();runtime.confirm=async a=>proved?{state:'CONFIRMED',txHash:a.settlement_tx,payer:address,ledger:102}:{state:'UNKNOWN'};
 const service=createPaymentService({db,config:{...config,checkoutUntil:new Date(base+500).toISOString()},runtime,onSettled:queue,now:()=>clock});
 const pending=await service.pay(f.request);assert.equal(pending.paymentState,'RECONCILIATION_REQUIRED');assert.equal(runtime.count,1);clock=base+1000;proved=true;
 const settled=await service.reconcile(pending.attemptId);assert.equal(settled.paymentState,'SETTLED');assert.equal(runtime.count,1);assert.equal((await db.query("SELECT * FROM ads_outbox WHERE topic='creative'")).rowCount,1);
});
