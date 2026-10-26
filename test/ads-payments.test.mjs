import test from 'node:test';
import assert from 'node:assert/strict';
import * as s from '@stellar/stellar-sdk';
import { createPaymentService } from '../server/ads/payments.mjs';
import { inspectStellarPayment, createStellarPaymentRuntime, TESTNET_USDC, TESTNET_ISSUER } from '../server/ads/stellar-payments.mjs';
import { canonical,sha256 } from '../server/ads/common.mjs';

const payer=s.StrKey.encodeContract(Buffer.alloc(32,9)),payTo=s.Keypair.random().publicKey();
const config={network:'stellar:testnet',asset:TESTNET_USDC,issuer:TESTNET_ISSUER,payTo,origin:'https://ads.example'};
const requirements={scheme:'exact',network:config.network,asset:config.asset,amount:'500000',payTo,maxTimeoutSeconds:60,extra:{areFeesSponsored:true}};
function signedPayment({nonce='123',amount='500000',to=payTo,from=payer,source=s.Keypair.random().publicKey()}={}){
 const fn=new s.xdr.InvokeContractArgs({contractAddress:new s.Address(TESTNET_USDC).toScAddress(),functionName:'transfer',args:[s.nativeToScVal(from,{type:'address'}),s.nativeToScVal(to,{type:'address'}),s.nativeToScVal(BigInt(amount),{type:'i128'})]});
 const entry=new s.xdr.SorobanAuthorizationEntry({credentials:s.xdr.SorobanCredentials.sorobanCredentialsAddress(new s.xdr.SorobanAddressCredentials({address:new s.Address(from).toScAddress(),nonce:s.xdr.Int64.fromString(nonce),signatureExpirationLedger:200,signature:s.nativeToScVal(Buffer.alloc(64,4),{type:'bytes'})})),rootInvocation:new s.xdr.SorobanAuthorizedInvocation({function:s.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(fn),subInvocations:[]})});
 const op=s.Operation.invokeHostFunction({func:s.xdr.HostFunction.hostFunctionTypeInvokeContract(fn),auth:[entry]});
 const tx=new s.TransactionBuilder(new s.Account(source,'1'),{networkPassphrase:s.Networks.TESTNET,fee:'100'}).addOperation(op).setTimeout(60).build();
 return {x402Version:2,accepted:requirements,payload:{transaction:tx.toXDR()}};
}
function memoryDb(){
 const state={order:{id:'order-1',owner_id:payer,pay_to:payTo,amount:'500000',state:'RESERVED',queue_state:null,quote:{placements:['main_stage_screen'],requiredUnits:1}},attempts:[],events:[],held:true};
 const db={state,async query(sql,p=[]){
  const rows=value=>({rows:value});
  if(sql.startsWith('SELECT * FROM ads_orders'))return rows(p[0]===state.order.id?[structuredClone(state.order)]:[]);
  if(sql.startsWith('SELECT id FROM ads_inventory'))return rows([{id:p[0]}]);
  if(sql.startsWith('SELECT * FROM ads_reservations'))return rows(state.held?[{id:'reservation',state:'HELD',placement_id:'main_stage_screen',delivery_units:1}]:[]);
  if(sql.startsWith('SELECT * FROM ads_payment_attempts')){
   let a=state.attempts.filter(r=>sql.includes('WHERE id=$1')?r.id===p[0]:r.order_id===p[0]);
   if(sql.includes('idempotency_key=$2'))a=a.filter(r=>r.idempotency_key===p[1]);
   if(sql.includes("state='SETTLED'"))a=a.filter(r=>r.state==='SETTLED');
   if(sql.includes("state<>'FAILED'"))a=a.filter(r=>r.state!=='FAILED');return rows(structuredClone(a));
  }
  if(sql.startsWith('INSERT INTO ads_payment_attempts')){
   const keys=['id','order_id','idempotency_key','payload_hash','signed_payload','network','payer','auth_nonce','auth_hash','expires_ledger','start_ledger'];
   const r=Object.fromEntries(keys.map((k,i)=>[k,k==='signed_payload'?JSON.parse(p[i]):p[i]]));r.state='VERIFYING';
   if(state.attempts.some(a=>a.auth_hash===r.auth_hash)){const error=new Error('duplicate');error.code='23505';throw error;}state.attempts.push(r);return rows([]);
  }
  if(sql.startsWith('UPDATE ads_payment_attempts')){
   const a=state.attempts.find(r=>r.id===p[0]),status=sql.match(/state='([A-Z_]+)'/);if(status)a.state=status[1];
   if(sql.includes('settlement=$2')){a.settlement=JSON.parse(p[1]);a.settlement_tx=p[2];}
   if(sql.includes('verification=$2'))a.verification=JSON.parse(p[1]);
   if(sql.includes("state='SETTLED'")){a.settlement_tx=p[1];a.evidence=JSON.parse(p[2]);}return rows([]);
  }
  if(sql.startsWith('UPDATE ads_orders')){const status=sql.match(/state='([A-Z_]+)'/);if(status)state.order.state=status[1];if(sql.includes('payer=$2'))state.order.payer=p[1];return rows([]);}
  if(sql.startsWith('INSERT INTO ads_outbox'))return rows([]);
  if(sql.startsWith('INSERT INTO ads_events')){state.events.push(p);return rows([]);}
  throw new Error('Unexpected SQL: '+sql);
 }};
 let tail=Promise.resolve();
 db.transaction=async work=>{let release;const previous=tail;tail=new Promise(r=>release=r);await previous;const backup=structuredClone(state);try{return await work(db);}catch(e){Object.assign(state,backup);throw e;}finally{release();}};return db;
}
function setup(overrides={}){
 const db=memoryDb();let settlements=0,queue=0;
 const runtime={latestLedger:async()=>100,decodePayment:async p=>({payer,nonce:p.nonce??'123',expiresLedger:200,authHash:sha256(canonical(p))}),verify:async()=>({isValid:true,payer}),settle:async()=>{settlements++;assert.equal(db.state.attempts[0].state,'SETTLING');return {success:true,transaction:'a'.repeat(64),payer};},confirm:async a=>({state:'CONFIRMED',txHash:a.settlement_tx??'a'.repeat(64),payer,ledger:101}),...overrides};
 const service=createPaymentService({db,config,runtime,onSettled:async(tx,order)=>{queue++;tx.state.order.state='QUEUED';}});
 return {db,service,get settlements(){return settlements;},get queue(){return queue;}};
}
const request={orderId:'order-1',ownerId:payer,idempotencyKey:'request-1234',payload:{nonce:'123'}};
test('settlement starts only after durable SETTLING and queues once across retries',async()=>{const t=setup();const a=await t.service.pay(request),b=await t.service.pay(request);assert.equal(a.paymentState,'SETTLED');assert.equal(b.transaction,a.transaction);assert.equal(t.settlements,1);assert.equal(t.queue,1);});
test('same key with changed payload conflicts even after confirmed payment',async()=>{const t=setup();await t.service.pay(request);await assert.rejects(t.service.pay({...request,payload:{nonce:'456'}}),e=>e.code==='idempotency_conflict');});
test('timeout preserves attempt and prevents a fresh charge or challenge',async()=>{let settleCalls=0;const t=setup({settle:async()=>{settleCalls++;throw new Error('timeout');},confirm:async()=>({state:'UNKNOWN'})});const a=await t.service.pay(request);assert.equal(a.paymentState,'RECONCILIATION_REQUIRED');const b=await t.service.pay({...request,payload:undefined});assert.equal(b.status,202);await assert.rejects(t.service.pay({...request,idempotencyKey:'different-key',payload:{nonce:'789'}}),e=>e.code==='payment_already_pending');assert.equal(settleCalls,1);assert.equal(t.queue,0);});
test('settlement with no transaction or no proof cannot enqueue',async()=>{const t=setup({settle:async()=>({success:true}),confirm:async()=>({state:'UNKNOWN'})});const a=await t.service.pay(request);assert.equal(a.paymentState,'RECONCILIATION_REQUIRED');assert.equal(t.queue,0);});
test('authoritative recovery without new settlement queues the original attempt',async()=>{let visible=false,settle=0;const t=setup({settle:async()=>{settle++;throw Error('lost response');},confirm:async()=>visible?{state:'CONFIRMED',txHash:'b'.repeat(64),payer,ledger:104}:{state:'UNKNOWN'}});const a=await t.service.pay(request);visible=true;const b=await t.service.reconcile(a.attemptId);assert.equal(b.paymentState,'SETTLED');assert.equal(settle,1);assert.equal(t.queue,1);});
test('expired reservation, wrong owner and failed verification never settle',async()=>{const t=setup();t.db.state.held=false;await assert.rejects(t.service.pay(request),e=>e.code==='reservation_expired');await assert.rejects(t.service.pay({...request,ownerId:'someone'}),e=>e.code==='order_not_found');const v=setup({verify:async()=>({isValid:false,payer})});await assert.rejects(v.service.pay(request),e=>e.code==='payment_verification_rejected');assert.equal(v.settlements,0);});
test('XDR parser binds exact payer, asset, recipient, amount and auth nonce',()=>{const payload=signedPayment();const p=inspectStellarPayment(payload,{...requirements,payer},s);assert.equal(p.nonce,'123');assert.equal(p.expiresLedger,200);assert.throws(()=>inspectStellarPayment(signedPayment({amount:'1'}),{...requirements,payer},s));assert.throws(()=>inspectStellarPayment(payload,{...requirements,payer:s.Keypair.random().publicKey()},s));});
test('event amount match with a different nonce never proves an order; altered envelope source is allowed',async()=>{
 const original=signedPayment(),decoded=inspectStellarPayment(original,{...requirements,payer},s),actual=signedPayment({source:s.Keypair.random().publicKey()});
 // Preserve the ORIGINAL signed auth: the facilitator may only rebuild envelope fields.
 const origTx=s.TransactionBuilder.fromXDR(original.payload.transaction,s.Networks.TESTNET),actualTx=new s.TransactionBuilder(new s.Account(s.Keypair.random().publicKey(),'12'),{networkPassphrase:s.Networks.TESTNET,fee:'200'}).addOperation(s.Operation.invokeHostFunction(origTx.operations[0])).setTimeout(60).build();
 const event={type:'contract',id:'event-1',txHash:'c'.repeat(64),ledger:101,operationIndex:0,contractId:config.asset,topic:[s.nativeToScVal('transfer',{type:'symbol'}),s.nativeToScVal(payer,{type:'address'}),s.nativeToScVal(payTo,{type:'address'})],value:s.nativeToScVal(500000n,{type:'i128'})};
 let envelope=actualTx.toXDR();const rpc={getHealth:async()=>({oldestLedger:90}),getLatestLedger:async()=>({sequence:110}),getEvents:async()=>({events:[event],cursor:'end'}),getTransaction:async()=>({status:'SUCCESS',ledger:101,envelopeXdr:envelope})};
 const runtime=createStellarPaymentRuntime({config,rpc,loadSdk:async()=>s}),attempt={signed_payload:original,payer,auth_nonce:decoded.nonce,auth_hash:decoded.authHash,expires_ledger:200,start_ledger:100,requirements};
 assert.equal((await runtime.confirm(attempt)).state,'CONFIRMED');envelope=signedPayment({nonce:'124'}).payload.transaction;assert.equal((await runtime.confirm(attempt)).state,'UNKNOWN');
});
test('missing historical coverage fails closed instead of interpreting zero events as no payment',async()=>{const runtime=createStellarPaymentRuntime({config,rpc:{getHealth:async()=>({oldestLedger:101})},loadSdk:async()=>s});assert.equal((await runtime.confirm({start_ledger:100,requirements,payer})).reason,'history_gap');});
