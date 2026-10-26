import test from 'node:test';
import assert from 'node:assert/strict';
import * as sdk from '@stellar/stellar-sdk';
import {createStellarPaymentRuntime,TESTNET_USDC,TESTNET_ISSUER} from '../server/ads/stellar-payments.mjs';
const address=sdk.StrKey.encodeContract(Buffer.alloc(32,51));
const config={network:'stellar:testnet',asset:TESTNET_USDC,issuer:TESTNET_ISSUER};

test('the payment balance reader uses only a Testnet USDC balance simulation for the authenticated wallet',async()=>{
 let calls=0;
 const runtime=createStellarPaymentRuntime({config,rpc:{simulateTransaction:async tx=>{
  calls++;assert.equal(tx.operations.length,1);const args=tx.operations[0].func.invokeContract();
  assert.equal(sdk.Address.fromScAddress(args.contractAddress()).toString(),TESTNET_USDC);
  assert.equal(args.functionName().toString(),'balance');assert.equal(sdk.scValToNative(args.args()[0]),address);
  assert.equal(tx.signatures.length,0);return {transactionData:{},result:{retval:sdk.nativeToScVal(950000000n,{type:'i128'})}};
 }}});
 assert.equal(await runtime.balance(address),950000000n);assert.equal(calls,1);
});

test('failed, missing, restored or negative balance reads cannot be used as spendable funds',async()=>{
 for(const response of [{error:'RPC simulation failed'},{transactionData:{}},{transactionData:{},result:{retval:sdk.nativeToScVal(-1n,{type:'i128'})}},{transactionData:{},restorePreamble:{transactionData:{}},result:{retval:sdk.nativeToScVal(1000000000n,{type:'i128'})}}]){
  const runtime=createStellarPaymentRuntime({config,rpc:{simulateTransaction:async()=>response}});
  await assert.rejects(runtime.balance(address));
 }
});
