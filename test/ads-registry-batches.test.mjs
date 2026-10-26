import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import * as sdk from '@stellar/stellar-sdk';
import {createTestDatabase} from './helpers/ads-db.mjs';
import {createRegistryService,registryEvidenceDigest} from '../server/ads/registry.mjs';
import {canonical,sha256,uuid} from '../server/ads/common.mjs';

const keys=generateKeyPairSync('ed25519');
const payer=sdk.StrKey.encodeContract(Buffer.alloc(32,41)),issuer=sdk.Keypair.random().publicKey(),payTo=sdk.Keypair.random().publicKey();
const config={network:'stellar:testnet',registryContract:sdk.StrKey.encodeContract(Buffer.alloc(32,42)),registryIssuer:issuer,operators:[issuer],registryEvidenceGraceMs:60000,passMs:60000,publisherKey:keys.privateKey.export({format:'pem',type:'pkcs8'})};
async function seed(db,{base=Date.now()}={}){
 const id=uuid(),campaign=uuid(),upload=uuid(),revision=uuid(),quoteId=uuid(),owner='stellar:testnet:'+payer;
 const starts=base+60000,ends=base+660000,manifestHash=sha256('manifest:'+id),termsHash=sha256('frozen-terms:'+id),paymentHash=sha256('explicit-local-payment-fixture:'+id);
 const quote={offerId:'main-stage-test-5m',offerVersion:2,placements:['main_stage_screen'],plan:'PASSES',units:5,requiredUnits:5,passMs:60000,renderLeadMs:10000,startsAt:new Date(starts).toISOString(),endsAt:new Date(ends).toISOString()};
 await db.query('INSERT INTO ads_campaigns(id,owner_id,brief) VALUES($1,$2,$3)',[campaign,owner,{}]);
 await db.query("INSERT INTO ads_uploads(id,owner_id,storage_key,hash,mime,width,height,size) VALUES($1,$2,$3,$4,'image/png',1,1,1)",[upload,owner,'explicit-logo:'+id,sha256('logo:'+id)]);
 await db.query("INSERT INTO ads_revisions(id,campaign_id,brief,logo_id,content_hash,state,manifest_hash) VALUES($1,$2,$3,$4,$5,'AUDITED',$6)",[revision,campaign,{},upload,sha256('content:'+id),manifestHash]);
 await db.query('INSERT INTO ads_quotes(id,owner_id,campaign_id,revision_id,snapshot,terms_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[quoteId,owner,campaign,revision,quote,termsHash,new Date(ends)]);
 await db.query("INSERT INTO ads_orders(id,owner_id,quote_id,revision_id,state,queue_state,amount,pay_to,payer,terms_hash,quote) VALUES($1,$2,$3,$4,'QUEUED','SCHEDULED',50000000,$5,$6,$7,$8)",[id,owner,quoteId,revision,payTo,payer,termsHash,quote]);
 await db.query("INSERT INTO ads_placements(order_id,placement_id,required_units,delivered_units,unit,state) VALUES($1,'main_stage_screen',5,0,'PASSES','SCHEDULED')",[id]);
 await db.query("INSERT INTO ads_payment_attempts(id,order_id,idempotency_key,payload_hash,signed_payload,network,payer,auth_nonce,auth_hash,expires_ledger,start_ledger,state,settlement_tx) VALUES($1,$2,$3,$4,$5,'stellar:testnet',$6,$7,$8,1000,900,'SETTLED',$9)",[uuid(),id,'payment:'+id,sha256('payload:'+id),{},payer,id,sha256('auth:'+id),paymentHash]);
 await db.query("INSERT INTO ads_fulfillment_batches(id,order_id,sequence,starts_at,ends_at,required_units,state,terms_hash,terms,created_at) VALUES($1,$1,0,$2,$3,5,'OPEN',$4,$5,$6)",[id,new Date(starts),new Date(ends),termsHash,quote,new Date(base)]);
 await db.query("INSERT INTO ads_fulfillment_units(order_id,placement_id,number,assigned_batch_id) SELECT $1,'main_stage_screen',n,$1 FROM generate_series(1,5)n ON CONFLICT DO NOTHING",[id]);
 return {id,owner,revision,quote,starts,ends,manifestHash,termsHash,paymentHash,base};
}
async function delivery(db,f,{batchId=f.id,number,start}){
 const id=uuid(),passId=uuid();
 await db.query("INSERT INTO ads_delivery(id,order_id,placement_id,revision_id,manifest_hash,playlist_version,fence,starts_at,ends_at,units,pass_id,signature,publisher_key,evidence,batch_id,unit_number) VALUES($1,$2,'main_stage_screen',$3,$4,1,1,$5,$6,1,$7,'explicit-offchain-fixture','explicit-publisher-fixture',$8,$9,$10)",[id,f.id,f.revision,f.manifestHash,new Date(start),new Date(start+60000),passId,{},batchId,number]);
 await db.query("UPDATE ads_fulfillment_units SET assigned_batch_id=$4,completed_delivery_id=$5,completed_at=$6 WHERE order_id=$1 AND placement_id=$2 AND number=$3",[f.id,'main_stage_screen',number,batchId,id,new Date(start+60000)]);
 return id;
}
async function localDatabase(t){const db=await createTestDatabase();t.after(()=>db.close());return db;}
const jobs=(db,id)=>db.query('SELECT * FROM ads_registry_jobs WHERE order_id=$1 ORDER BY sequence',[id]).then(result=>result.rows);

test('initial pilot batch keeps the original contract key and frozen terms',async t=>{
 const db=await localDatabase(t),f=await seed(db),service=createRegistryService({db,config,now:()=>f.base});
 await service.syncOrder(f.id);const rows=await jobs(db,f.id),commit=rows.find(row=>row.operation==='commit');
 assert(commit);assert.equal(commit.batch_id,f.id);assert.equal(commit.payload.order,sha256(f.id));assert.equal(commit.payload.terms,f.termsHash);assert.equal(commit.payload.payment,f.paymentHash);assert.equal(commit.payload.placements[0].units,'5');assert.equal(commit.payload.placements[0].pass_ms,60000);
 await service.syncOrder(f.id);assert.equal((await jobs(db,f.id)).length,rows.length);
});

test('partial parent plus completed child records separate immutable commitments and batch-local nonces',async t=>{
 const db=await localDatabase(t),f=await seed(db);let clock=f.base;const service=createRegistryService({db,config,now:()=>clock});
 await service.syncOrder(f.id);const originalCommit=(await jobs(db,f.id)).find(row=>row.operation==='commit').payload;
 for(let number=1;number<=4;number++)await delivery(db,f,{number,start:f.starts+(number-1)*70000});
 await db.query("UPDATE ads_fulfillment_batches SET delivered_units=4,state='CLOSED',closed_at=$2 WHERE id=$1",[f.id,new Date(f.ends)]);
 const child=uuid(),consent=uuid(),start=f.ends+120000,end=start+180000;
 const terms={version:'fulfillment-v1',orderId:f.id,originalTermsHash:f.termsHash,paymentReference:f.paymentHash,parentBatchId:f.id,parentTermsHash:f.termsHash,units:[5],window:{startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString()},consentId:consent,additionalCharge:'0'};
 const childTermsHash=sha256(terms);
 await db.query('INSERT INTO ads_consents(id,order_id,owner_id,proposal) VALUES($1,$2,$3,$4)',[consent,f.id,f.owner,terms]);
 await db.query("INSERT INTO ads_fulfillment_batches(id,order_id,sequence,parent_batch_id,starts_at,ends_at,required_units,delivered_units,state,terms_hash,terms,consent_id) VALUES($1,$2,1,$2,$3,$4,1,1,'COMPLETED',$5,$6,$7)",[child,f.id,new Date(start),new Date(end),childTermsHash,terms,consent]);
 await delivery(db,f,{batchId:child,number:5,start});
 await db.query("UPDATE ads_placements SET delivered_units=5,state='FULFILLED' WHERE order_id=$1",[f.id]);await db.query("UPDATE ads_orders SET state='COMPLETED' WHERE id=$1",[f.id]);clock=start+61000;
 await service.syncOrder(f.id);const first=await jobs(db,f.id);await service.syncOrder(f.id);const second=await jobs(db,f.id);assert.equal(second.length,first.length);
 const commits=second.filter(row=>row.operation==='commit');assert.equal(commits.length,2);assert.equal(canonical(commits.find(row=>row.batch_id===f.id).payload),canonical(originalCommit));
 const childCommit=commits.find(row=>row.batch_id===child);assert(childCommit);assert.equal(childCommit.payload.order,sha256(child));assert.equal(childCommit.payload.payment,f.paymentHash);assert.equal(childCommit.payload.terms,childTermsHash);assert.equal(childCommit.payload.placements[0].units,'1');assert.equal(childCommit.payload.placements[0].start,start);assert.equal(childCommit.payload.placements[0].end,end);
 const completions=second.filter(row=>row.operation==='complete');assert.equal(completions.length,1);assert.equal(completions[0].batch_id,child);assert.equal(completions[0].payload.order,sha256(child));assert(!second.some(row=>row.operation==='complete'&&row.batch_id===f.id));
 const attestations=second.filter(row=>row.operation==='record_delivery');assert.equal(attestations.length,5);
 assert.deepEqual(attestations.filter(row=>row.batch_id===f.id).map(row=>String(row.payload.nonce)),['0','1','2','3']);assert.deepEqual(attestations.filter(row=>row.batch_id===child).map(row=>String(row.payload.nonce)),['0']);
 for(const row of attestations){assert.equal(row.payload.order,sha256(row.batch_id));assert(verify(null,registryEvidenceDigest(config,row.payload,sdk),keys.publicKey,Buffer.from(row.payload.signature,'hex')));}
 const order=(await db.query('SELECT * FROM ads_orders WHERE id=$1',[f.id])).rows[0];assert.equal(order.state,'COMPLETED');assert.equal(order.amount,'50000000');assert.deepEqual(order.quote,f.quote);assert.equal(order.terms_hash,f.termsHash);assert.equal(Number((await db.query('SELECT delivered_units FROM ads_placements WHERE order_id=$1',[f.id])).rows[0].delivered_units),5);
 assert.equal(Number((await db.query('SELECT count(*) AS n FROM ads_orders')).rows[0].n),1);assert.equal(Number((await db.query('SELECT count(*) AS n FROM ads_payment_attempts')).rows[0].n),1);
});

test('two registry services serialize one issuer across different orders while submit is outside the transaction',async t=>{
 const db=await localDatabase(t),a=await seed(db),b=await seed(db);let prepares=0,submits=0,entered,release;
 const started=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});
 const runtime={prepare:async job=>{prepares++;return {txHash:sha256(job.id),signedXdr:'private-local-fixture:'+job.id};},submit:async()=>{submits++;if(submits===1){entered();await held;}},confirm:async job=>({state:'CONFIRMED',txHash:job.transaction_hash})};
 const first=createRegistryService({db,config,runtime,owner:'issuer-a'}),second=createRegistryService({db,config,runtime,owner:'issuer-b'});await first.syncOrder(a.id);await second.syncOrder(b.id);
 const running=first.flush({limit:1});await started;
 try{const busy=await second.flush({limit:1});assert.equal(busy.state,'BUSY');assert.equal(prepares,1);assert.equal(submits,1);}
 finally{release();await running;}
 assert.equal((await second.flush({limit:1})).processed,1);assert.equal(prepares,2);assert.equal(submits,2);
});

test('ambiguous submitted registry hash blocks new signatures even after a lease expires',async t=>{
 const db=await localDatabase(t),a=await seed(db),b=await seed(db);let clock=a.base,prepares=0,submits=0,confirmed=false;const seen=[];
 const runtime={prepare:async job=>{prepares++;return {txHash:sha256(job.id),signedXdr:'private-local-fixture:'+job.id};},submit:async()=>{submits++;if(submits===1)throw Error('simulated lost submission response');},confirm:async job=>{seen.push(job.transaction_hash);return confirmed?{state:'CONFIRMED',txHash:job.transaction_hash}:{state:'UNKNOWN'};}};
 const first=createRegistryService({db,config,runtime,now:()=>clock,owner:'issuer-a'}),second=createRegistryService({db,config,runtime,now:()=>clock,owner:'issuer-b'});await first.syncOrder(a.id);await second.syncOrder(b.id);await first.flush({limit:1});
 const original=(await db.query("SELECT * FROM ads_registry_jobs WHERE transaction_hash IS NOT NULL")).rows[0];assert(original);assert.equal(original.state,'RECONCILIATION_REQUIRED');const originalHash=original.transaction_hash;clock+=120000;
 await second.flush({limit:1});assert.equal(prepares,1);assert.equal(submits,1);assert(seen.every(hash=>hash===originalHash));
 confirmed=true;await first.reconcile(original.id);assert.equal((await db.query('SELECT transaction_hash,state FROM ads_registry_jobs WHERE id=$1',[original.id])).rows[0].transaction_hash,originalHash);
 assert.equal((await second.flush({limit:1})).processed,1);assert.equal(prepares,2);assert.equal(submits,2);
});

test('disabled registry does not initialize or query durable state',async()=>{
 let touched=0;const db={query(){touched++;throw Error('Disabled registry cannot query');},transaction(){touched++;throw Error('Disabled registry cannot open a transaction');}};
 const service=createRegistryService({db,config:{...config,registryContract:''},runtime:{prepare(){throw Error('No signer');},submit(){throw Error('No network');},confirm(){throw Error('No network');}}});
 assert.equal((await service.syncOrder(uuid())).state,'DISABLED');assert.equal((await service.record({orderId:uuid(),operation:'commit',payload:{}})).state,'DISABLED');assert.equal((await service.flush()).state,'DISABLED');assert.equal(touched,0);
});
