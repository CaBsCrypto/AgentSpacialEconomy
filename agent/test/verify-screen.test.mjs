import test from "node:test";
import assert from "node:assert/strict";
import * as sdk from "@stellar/stellar-sdk";
import {inspectRegistryReceipt,auditScreenEvidence,writeAuditFile} from "../verify-screen.mjs";
import {adCommitment,adTerms,registryCommitArgs} from "../lib/ads.mjs";
import {AD_SLOT,AD_SECTION_SLOT} from "../catalog.mjs";
import {REGISTRY_WASM_HASH} from "../registry.mjs";
const TREASURY="GDNNKSLTL43WDLRXLRU6HWW6Q6GGL4BWU45WZF5AG3ME4WHPTK6JWCZK";
const PAYER="GCK6CKDDDRVGZNHE2LMJSF6YQKJDQVGPCE7TXOWNNGWUSHTRYXPK6BF6";
const CONTRACT="CA77KJNQHENANFHA44W4SQRELNN7GQ2BP7CXTM2PZHUGHHGYCSDJDLDW";
const build=op=>new sdk.TransactionBuilder(new sdk.Account(TREASURY,"1"),{fee:sdk.BASE_FEE,networkPassphrase:sdk.Networks.TESTNET}).addOperation(op).setTimeout(60).build();
const receipt=tx=>({successful:true,hash:tx.hash().toString("hex"),ledger:123,envelope_xdr:tx.toXDR()});
const commitment=slot=>adCommitment({runId:"run#1",creative:{advertiser:"A",headline:"Hello"},terms:adTerms({slot,payTo:TREASURY,network:"stellar:testnet",section:"A"}),paymentTx:"a".repeat(64),claimant:PAYER,startMs:1793000000000,durationMs:300000});
test("registry receipt binds success, hash, issuer, contract and exact commitment XDR",()=>{
 const c=commitment(AD_SECTION_SLOT),tx=build(new sdk.Contract(CONTRACT).call("commit",...registryCommitArgs(c,sdk))),r=receipt(tx);
 const options={txHash:r.hash,treasury:TREASURY,contractId:CONTRACT,commitment:c};
 assert.equal(inspectRegistryReceipt(r,options).verified,true);
 assert.throws(()=>inspectRegistryReceipt({...r,successful:false},options),/successful/);
 assert.throws(()=>inspectRegistryReceipt(r,{...options,txHash:"b".repeat(64)}),/hash/);
 assert.throws(()=>inspectRegistryReceipt(r,{...options,treasury:PAYER}),/treasury/);
 assert.throws(()=>inspectRegistryReceipt(r,{...options,contractId:"CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"}),/another/);
 assert.throws(()=>inspectRegistryReceipt(r,{...options,commitment:{...c,terms:"b".repeat(64)}}),/different commitment/);
});
test("historical offer cannot be silently reinterpreted as the new section offer",()=>{
 const legacy=commitment(AD_SLOT),modern=commitment(AD_SECTION_SLOT);
 const r=receipt(build(new sdk.Contract(CONTRACT).call("commit",...registryCommitArgs(legacy,sdk))));
 assert.equal(inspectRegistryReceipt(r,{txHash:r.hash,treasury:TREASURY,contractId:CONTRACT,commitment:legacy}).verified,true);
 assert.throws(()=>inspectRegistryReceipt(r,{txHash:r.hash,treasury:TREASURY,contractId:CONTRACT,commitment:modern}),/different commitment/);
});
test("deployment receipt derives the contract address and checks WASM plus constructor issuer",()=>{
 const op=sdk.Operation.createCustomContract({address:new sdk.Address(TREASURY),wasmHash:Buffer.from(REGISTRY_WASM_HASH,"hex"),salt:Buffer.alloc(32,1),constructorArgs:[new sdk.Address(TREASURY).toScVal(),sdk.nativeToScVal(Buffer.alloc(32,2),{type:"bytes"})]});
 const tx=build(op),create=tx.operations[0].func.createContractV2();
 const preimage=sdk.xdr.HashIdPreimage.envelopeTypeContractId(new sdk.xdr.HashIdPreimageContractId({networkId:sdk.hash(Buffer.from(sdk.Networks.TESTNET)),contractIdPreimage:create.contractIdPreimage()}));
 const contractId=sdk.StrKey.encodeContract(sdk.hash(preimage.toXDR())),r=receipt(tx);
 assert.equal(inspectRegistryReceipt(r,{txHash:r.hash,treasury:TREASURY,contractId}).kind,"deploy");
 assert.throws(()=>inspectRegistryReceipt(r,{txHash:r.hash,treasury:TREASURY,contractId:CONTRACT}),/another contract/);
});
test("read-only audit rejects provenance mistakes before any chain work",async()=>{
 const base={network:"stellar:testnet",runId:"run",sourceCommit:"a".repeat(40),screen:{offerId:AD_SECTION_SLOT.offerId}};
 await assert.rejects(auditScreenEvidence(base,{sourceCommit:"b".repeat(40)}),/source commit differs/);
 await assert.rejects(auditScreenEvidence({...base,sourceCommit:undefined}),/explicit source/);
 await assert.rejects(auditScreenEvidence({...base,screen:{}},{sourceCommit:base.sourceCommit}),/legacy-offer/);
 await assert.rejects(writeAuditFile("same.json","same.json"),/overwrite input/);
});
