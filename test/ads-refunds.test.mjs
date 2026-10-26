import test from 'node:test';
import assert from 'node:assert/strict';
import {createRefundService,createStellarRefundRuntime,calculateSettlementRemedy} from '../server/ads/refunds.mjs';
import {TESTNET_USDC,TESTNET_ISSUER} from '../server/ads/stellar-payments.mjs';
import {createRegistryService,registryArguments,registryEvidenceDigest} from '../server/ads/registry.mjs';
const config={network:'stellar:testnet',asset:TESTNET_USDC,issuer:TESTNET_ISSUER,payTo:'operator-wallet',operators:['operator']};
function dbDouble(){const state={order:{id:'order',owner_id:'owner',payer:'wallet',amount:'500',pay_to:'operator-wallet',quote:{placements:['main_stage_screen']}},refunds:[],events:[]};let tail=Promise.resolve();const db={state,async query(sql,p=[]){const rows=a=>({rows:structuredClone(a)});
 if(sql.startsWith('SELECT * FROM ads_orders'))return rows(p[0]==='order'?[state.order]:[]);
 if(sql.startsWith('SELECT id FROM ads_inventory'))return rows([{id:p[0]}]);
 if(sql.startsWith('SELECT * FROM ads_payment_attempts'))return rows([{state:'SETTLED',settlement_tx:'paid'}]);
 if(sql.startsWith('SELECT COALESCE(SUM(amount)'))return rows([{total:state.refunds.filter(r=>r.state!=='REJECTED').reduce((n,r)=>n+BigInt(r.amount),0n).toString()}]);
 if(sql.startsWith('SELECT * FROM ads_refunds'))return rows(state.refunds.filter(r=>sql.includes('order_id=$1')?r.order_id===p[0]&&r.idempotency_key===p[1]:r.id===p[0]));
 if(sql.startsWith('INSERT INTO ads_refunds')){state.refunds.push({id:p[0],order_id:p[1],idempotency_key:p[2],requested_by:p[3],amount:p[4],reason:p[5],state:'REQUESTED'});return rows([]);}
 if(sql.startsWith('UPDATE ads_refunds')){const r=state.refunds.find(r=>r.id===p[0]);if(sql.includes("state='APPROVED'")){r.state='APPROVED';r.approved_by=p[1];}else if(sql.includes("state='SUBMITTED'")){r.state='SUBMITTED';r.transaction_hash=p[1];r.signed_xdr=p[2];}else{r.state=p[1];r.evidence=JSON.parse(p[2]);}return rows([]);}
 if(sql.startsWith('INSERT INTO ads_events')){state.events.push(p);return rows([]);}if(/^(UPDATE ads_(orders|placements|reservations|playlist)|DELETE FROM ads_publisher_acks)/.test(sql))return rows([]);throw Error('Unexpected SQL '+sql);
 },async transaction(work){let done;const prev=tail;tail=new Promise(r=>done=r);await prev;const backup=structuredClone(state);try{return await work(db);}catch(e){Object.assign(state,backup);throw e;}finally{done();}}};return db;}
const requested={orderId:'order',ownerId:'owner',amount:'200',reason:'Entrega parcial',idempotencyKey:'refund-request-1'};
test('a refund requires configured operator authority and confirmed transfer evidence',async()=>{const db=dbDouble();let submissions=0,proved=false;
 const runtime={prepare:async()=>({txHash:'tx-refund',signedXdr:'fixed-envelope'}),submit:async()=>{submissions++;assert.equal(db.state.refunds[0].state,'SUBMITTED');assert.equal(db.state.refunds[0].signed_xdr,'fixed-envelope');},confirm:async()=>proved?{state:'CONFIRMED',txHash:'tx-refund'}:{state:'UNKNOWN'}};
 const service=createRefundService({db,config,runtime}),r=await service.request(requested);await assert.rejects(service.approve({refundId:r.id,operatorId:'owner'}),e=>e.code==='refund_operator_required');await service.approve({refundId:r.id,operatorId:'operator'});
 const submitted=await service.submit({refundId:r.id,operatorId:'operator'});assert.equal(submitted.state,'RECONCILIATION_REQUIRED');await service.submit({refundId:r.id,operatorId:'operator'});assert.equal(submissions,1);proved=true;assert.equal((await service.reconcile(r.id)).state,'CONFIRMED');});
test('refunds cannot exceed settled amount, cross owners or silently change idempotent requests',async()=>{const service=createRefundService({db:dbDouble(),config,runtime:{}});await assert.rejects(service.request({...requested,ownerId:'other'}),e=>e.code==='order_not_found');await service.request(requested);await assert.rejects(service.request({...requested,amount:'201'}),e=>e.code==='idempotency_conflict');await assert.rejects(service.request({...requested,amount:'400',idempotencyKey:'another-request'}),e=>e.code==='refund_exceeds_payment');});
test('without a separately configured operator signer no refund can be signed',async()=>{const runtime=createStellarRefundRuntime({config});await assert.rejects(runtime.prepare({refund:{id:'r',amount:'1'},order:{}}),e=>e.code==='refund_signer_unavailable');});
test('registry without deployed contract remains explicitly disabled',async()=>{const registry=createRegistryService({db:{query:()=>{throw Error('no database call expected');}},config});assert.deepEqual(await registry.record({orderId:'o',operation:'complete',payload:{order:'1'.repeat(64)}}),{state:'DISABLED',reason:'registry_not_deployed'});assert.deepEqual(await registry.keeper(),{state:'DISABLED',processed:0});await assert.rejects(registry.record({orderId:'o',operation:'release_funds',payload:{}}),e=>e.code==='registry_operation_invalid');});

test('proportional remedies separate audited design, conserve integer remainder and reject missing terms',()=>{
 const order={amount:'101',quote:{terms:{refundPolicy:'PRO_RATA',refundDesign:'IF_UNDELIVERED'},lines:[{placementId:'main_stage_screen',deliveryAmount:'100',designAmount:'1'}]}};
 const placements=[{placement_id:'main_stage_screen',required_units:'3',delivered_units:'2',state:'PARTIAL'}];
 const audited={state:'AUDITED',manifest:{artifacts:[{placement:'main_stage_screen'}]}};
 const r=calculateSettlementRemedy(order,placements,audited);assert.equal(r.amount,'33');assert.equal(r.lines[0].roundingRemainder,'1');assert.equal(r.lines[0].roundingDenominator,'3');assert.equal(r.lines[0].designAmount,'0');
 assert.equal(calculateSettlementRemedy(order,placements,{state:'QUARANTINED'}).amount,'34');
 assert.throws(()=>calculateSettlementRemedy({...order,quote:{...order.quote,terms:{refundPolicy:'PRO_RATA'}}},placements,audited),e=>e.code==='refund_policy_missing');
 assert.throws(()=>calculateSettlementRemedy(order,[{...placements[0],delivered_units:'3'}],audited),e=>e.code==='refund_not_due');
});
test('FULL refunds affect the deficient placement and preserve fulfilled placement obligations',()=>{
 const order={amount:'220',quote:{terms:{refundPolicy:'FULL',refundDesign:'ALWAYS'},lines:[{placementId:'main_stage_screen',deliveryAmount:'100',designAmount:'10'},{placementId:'venue_center_banner',deliveryAmount:'100',designAmount:'10'}]}};
 const placements=[{placement_id:'main_stage_screen',required_units:'1000',delivered_units:'1000',state:'FULFILLED'},{placement_id:'venue_center_banner',required_units:'1000',delivered_units:'1',state:'PARTIAL'}];
 const r=calculateSettlementRemedy(order,placements,{});assert.equal(r.amount,'110');assert.deepEqual(r.lines.map(l=>l.placementId),['venue_center_banner']);
});

test('restricted refund runtime validates amount and destination before requesting a signature',async()=>{
 const s=await import('@stellar/stellar-sdk'),recipient=s.StrKey.encodeContract(Buffer.alloc(32,4)),operator=s.Keypair.random().publicKey();let signatures=0;
 const cfg={...config,payTo:operator},runtime=createStellarRefundRuntime({config:cfg,signer:{address:operator,signTransaction:async xdr=>{signatures++;return {signedTxXdr:xdr};}},rpc:{getAccount:async()=>new s.Account(operator,'1'),prepareTransaction:async tx=>tx}});
 const base={refund:{id:'refund',state:'APPROVED',amount:'100'},order:{pay_to:operator,payer:recipient,amount:'50'}};
 await assert.rejects(runtime.prepare(base),e=>e.code==='refund_transfer_invalid');assert.equal(signatures,0);
 await assert.rejects(runtime.prepare({...base,refund:{...base.refund,amount:'1'},order:{...base.order,pay_to:'other'}}),e=>e.code==='refund_transfer_invalid');assert.equal(signatures,0);
});
