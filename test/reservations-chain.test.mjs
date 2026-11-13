import test from 'node:test';
import assert from 'node:assert/strict';
import { Account,Address,Operation,TransactionBuilder,SorobanDataBuilder,nativeToScVal,xdr } from '@stellar/stellar-sdk';
import { expectedFunction,validateSignedPayload,createChainAdapter,transactionMatches,normalizeOffer } from '../server/reservations/chain.mjs';
import { SHARED_DEPLOYER } from '../server/wallet/config.mjs';
import { testConfig,address } from './reservations-support.test.mjs';
function payload(config,changes={}) {
  const intent={operation:'reserve',offerId:'b'.repeat(64),spaceId:'c'.repeat(64),actorAddress:address(3),...changes};
  const func=expectedFunction(config,intent);
  const entry=new xdr.SorobanAuthorizationEntry({credentials:xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({address:new Address(intent.actorAddress).toScAddress(),nonce:xdr.Int64.fromString('123'),signatureExpirationLedger:37,signature:xdr.ScVal.scvVoid()})),rootInvocation:new xdr.SorobanAuthorizedInvocation({function:xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(func.invokeContract()),subInvocations:[]})});
  const preparation={func:func.toXDR('base64'),auth:[entry.toXDR('base64')],startLedger:1,expirationLedger:37};
  entry.credentials().address().signature(nativeToScVal({context_rule_ids:[0],signatures:[]}));
  const body={func:preparation.func,auth:[entry.toXDR('base64')]};
  const tx=new TransactionBuilder(new Account(SHARED_DEPLOYER,'0'),{fee:'100',networkPassphrase:config.networkPassphrase}).addOperation(Operation.invokeHostFunction({func,auth:[entry]})).setTimeout(30).build();
  return{intent,func,entry,preparation,body,tx,hash:tx.hash().toString('hex')};
}
function rpcStub(config,data) {
  const offer={offer:Buffer.from(data.intent.offerId,'hex'),project:Buffer.from(config.projectId,'hex'),space:Buffer.from(data.intent.spaceId,'hex'),host:config.hostAddress,state:['Reserved'],holder:data.intent.actorAddress,published_at:100n,reserved_at:101n};
  return{enforce:false,events:[],transaction:{status:'NOT_FOUND'},offer,
    async getNetwork(){return{passphrase:config.networkPassphrase};},async getLatestLedger(){return{sequence:1};},
    async getLedgerEntries(){return{entries:[{val:{contractData:()=>({val:()=>({instance:()=>({executable:()=>({wasmHash:()=>Buffer.from(config.contractWasmHash,'hex')})})})})}}]};},
    async simulateTransaction(tx,_resources,mode){if(mode==='enforce'){this.enforce=true;return{error:'invalid test signature'};}const method=tx.operations[0].func.invokeContract().functionName().toString();const value=method==='project'?Buffer.from(config.projectId,'hex'):method==='host'?config.hostAddress:offer;return{result:{retval:nativeToScVal(value)}};},
    async getEvents(){return{events:this.events};},async getTransaction(){return this.transaction;}};
}
test('restricted XDR accepts only exact operation, actor, contract, arguments, nonce, expiry and rule 0',()=>{
  const config=testConfig(),data=payload(config);assert.equal(validateSignedPayload(data.body,data.preparation,config,data.intent).auth.length,1);
  for(const change of [entry=>entry.credentials().address().nonce(xdr.Int64.fromString('124')),entry=>entry.credentials().address().signatureExpirationLedger(38),entry=>entry.credentials().address().address(new Address(address(4)).toScAddress()),entry=>entry.rootInvocation().subInvocations([entry.rootInvocation()]),entry=>entry.credentials().address().signature(nativeToScVal({context_rule_ids:[1],signatures:[]}))]){
    const entry=xdr.SorobanAuthorizationEntry.fromXDR(data.body.auth[0],'base64');change(entry);assert.throws(()=>validateSignedPayload({...data.body,auth:[entry.toXDR('base64')]},data.preparation,config,data.intent));
  }
  assert.throws(()=>validateSignedPayload({...data.body,extra:'transfer'},data.preparation,config,data.intent));
  assert.throws(()=>validateSignedPayload(payload(config,{offerId:'d'.repeat(64)}).body,data.preparation,config,data.intent));
  assert.throws(()=>validateSignedPayload({...data.body,auth:[...data.body.auth,...data.body.auth]},data.preparation,config,data.intent));
});
test('transaction attribution compares actual envelope/hash and the complete signed authorization',()=>{
  const config=testConfig(),data=payload(config);
  assert.equal(transactionMatches({envelopeXdr:data.tx.toEnvelope()},data.hash,data.preparation,data.body,config,data.intent),true);
  assert.equal(transactionMatches({envelopeXdr:data.tx.toEnvelope()},'f'.repeat(64),data.preparation,data.body,config,data.intent),false);
  const other=payload(config,{offerId:'d'.repeat(64)});
  assert.equal(transactionMatches({envelopeXdr:other.tx.toEnvelope()},other.hash,data.preparation,data.body,config,data.intent),false);
});
test('invalid signed authorization is simulated in enforce mode before any relay',async()=>{
  const config=testConfig(),data=payload(config),server=rpcStub(config,data);let sends=0;
  const chain=createChainAdapter({config,server,fetchImpl:async()=>{sends++;throw Error('must not send');}});
  await assert.rejects(chain.preflight(data.body,data.preparation,data.intent),error=>error.code==='SIGNATURE_OR_STATE_REJECTED');assert.equal(server.enforce,true);assert.equal(sends,0);
});
test('unrelated FAILED transaction cannot release an intent; attributable failure can',async()=>{
  const config=testConfig(),data=payload(config),server=rpcStub(config,data),other=payload(config,{offerId:'d'.repeat(64)}),chain=createChainAdapter({config,server});
  server.transaction={status:'FAILED',envelopeXdr:other.tx.toEnvelope()};
  assert.equal((await chain.reconcile(data.intent,data.preparation,other.hash,data.body)).state,'NEEDS_RECONCILIATION');
  server.transaction={status:'FAILED',envelopeXdr:data.tx.toEnvelope()};
  const result=await chain.reconcile(data.intent,data.preparation,data.hash,data.body);assert.equal(result.state,'REJECTED');assert.equal(result.definitive,true);
});
test('SUCCESS and same holder without attributable event is insufficient; exact event plus read confirms',async()=>{
  const config=testConfig(),data=payload(config),server=rpcStub(config,data),chain=createChainAdapter({config,server});
  server.transaction={status:'SUCCESS',ledger:2,envelopeXdr:data.tx.toEnvelope()};
  assert.equal((await chain.reconcile(data.intent,data.preparation,data.hash,data.body)).state,'NEEDS_RECONCILIATION');
  const event={contractId:config.contractId,topic:[xdr.ScVal.scvSymbol('reserved'),xdr.ScVal.scvBytes(Buffer.from(data.intent.offerId,'hex'))],value:nativeToScVal({holder:data.intent.actorAddress}),txHash:data.hash,ledger:2,inSuccessfulContractCall:true};
  server.events=[event];assert.equal((await chain.reconcile(data.intent,data.preparation,null,data.body)).state,'CONFIRMED');
  server.events=[{...event,contractId:address(6)}];assert.equal((await chain.reconcile(data.intent,data.preparation,data.hash,data.body)).state,'NEEDS_RECONCILIATION');
  server.events=[{...event,txHash:'f'.repeat(64)}];assert.equal((await chain.reconcile(data.intent,data.preparation,data.hash,data.body)).state,'NEEDS_RECONCILIATION');
  const normalized=normalizeOffer(server.offer);assert.equal(normalized.publishedAt,100);assert.equal(normalized.publishedLedger,undefined);
});
test('automatic restoration metadata blocks an Available retval even without restorePreamble',async()=>{
  const config=testConfig(),data=payload(config),server=rpcStub(config,data),chain=createChainAdapter({config,server});
  server.offer.state=['Available'];server.offer.holder=null;
  const resources=new SorobanDataBuilder().build();resources.ext(new xdr.SorobanTransactionDataExt(1,new xdr.SorobanResourcesExtV0({archivedSorobanEntries:[0]})));
  const normal=server.simulateTransaction.bind(server);
  server.simulateTransaction=async(tx,...args)=>{const result=await normal(tx,...args);if(tx.operations[0].func.invokeContract().functionName().toString()==='get')result.transactionData={build:()=>resources};return result;};
  await assert.rejects(chain.getOffer(data.intent.offerId),error=>error.code==='CHAIN_UNAVAILABLE');
});
