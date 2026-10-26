import test from "node:test";
import assert from "node:assert/strict";
import { Account, Address, BASE_FEE, Contract, Networks, TransactionBuilder, nativeToScVal } from "@stellar/stellar-sdk";
import { AD_SLOT, AD_SECTION_SLOT } from "../catalog.mjs";
import { adCommitment, adTerms, readBack } from "../lib/ads.mjs";
import { verifyScreenPayment, verifyScreenRun } from "../lib/screen-payments.mjs";
import { REGISTRY_WASM_HASH } from "../registry.mjs";
import { networkConfig } from "../config/networks.mjs";
const PAYER = "GCK6CKDDDRVGZNHE2LMJSF6YQKJDQVGPCE7TXOWNNGWUSHTRYXPK6BF6";
const TREASURY = "GDNNKSLTL43WDLRXLRU6HWW6Q6GGL4BWU45WZF5AG3ME4WHPTK6JWCZK";
const net = networkConfig("stellar:testnet");
const now = () => new Date("2026-10-26T10:00:00Z");
function fixture({ payer=PAYER, payTo=TREASURY, asset=net.usdc.sac, amount=50000000n, seq=1, passphrase=Networks.TESTNET, method="transfer" }={}) {
 const tx = new TransactionBuilder(new Account(PAYER,String(seq)),{fee:BASE_FEE,networkPassphrase:passphrase})
 .addOperation(new Contract(asset).call(method,new Address(payer).toScVal(),new Address(payTo).toScVal(),nativeToScVal(amount,{type:"i128"}))).setTimeout(60).build();
 const hash=tx.hash().toString("hex");
 return { order:{id:"run#"+seq,account:PAYER,priceUsdc:"5.00",tx:hash}, data:{successful:true,hash,ledger:123,created_at:"2026-10-26T09:59:00Z",envelope_xdr:tx.toXDR()} };
}
const fetchFor = data => async () => ({ok:true,json:async()=>data});
test("section offer is separate; legacy whole-screen offer is unchanged", () => {
 assert.equal(AD_SLOT.id,"ad-slot"); assert.equal(AD_SLOT.path,"/ad-slot");
 assert.equal(AD_SLOT.offerId,"main-stage-test-5m"); assert.equal(AD_SLOT.sections,undefined);
 assert.equal(AD_SECTION_SLOT.path,"/ad-section"); assert.equal(AD_SECTION_SLOT.offerId,"main-stage-section-test-5m");
 assert.deepEqual(AD_SECTION_SLOT.sections,["A","B","C","D"]);
});
test("payment verifier checks successful testnet transfer XDR and returns exact units",async()=>{
 const {order,data}=fixture();
 const p=await verifyScreenPayment(order,{treasury:TREASURY,fetchImpl:fetchFor(data),now});
 assert.equal(p.verified,true); assert.equal(p.amountUnits,"50000000"); assert.equal(p.payer,PAYER);
 assert.equal(p.payTo,TREASURY); assert.equal(p.asset,net.usdc.sac); assert.equal(p.source,"horizon-xdr");
});
test("wrong payer, destination, asset, amount, network, method or receipt cannot count",async()=>{
 const mutations=[{payer:TREASURY},{payTo:PAYER},{asset:"CA77KJNQHENANFHA44W4SQRELNN7GQ2BP7CXTM2PZHUGHHGYCSDJDLDW"},{amount:1n},{method:"approve"},{passphrase:Networks.PUBLIC}];
 for(const m of mutations){const {order,data}=fixture(m); await assert.rejects(verifyScreenPayment(order,{treasury:TREASURY,fetchImpl:fetchFor(data),now}));}
 const {order,data}=fixture();
 for(const d of [{...data,successful:false},{...data,hash:"a".repeat(64)},{...data,envelope_xdr:"bad"},{...data,ledger:0}]){
  await assert.rejects(verifyScreenPayment(order,{treasury:TREASURY,fetchImpl:fetchFor(d),now}));
 }
 await assert.rejects(verifyScreenPayment(order,{treasury:TREASURY,network:"stellar:pubnet",fetchImpl:fetchFor(data)}));
 await assert.rejects(verifyScreenPayment({...order,priceUsdc:"0.01"},{treasury:TREASURY,fetchImpl:fetchFor(data)}));
});
test("RPC envelope can independently verify payment when explicitly supplied",async()=>{
 const {order,data}=fixture();
 const p=await verifyScreenPayment(order,{treasury:TREASURY,rpc:{getTransaction:async()=>({status:"SUCCESS",txHash:data.hash,ledger:data.ledger,envelopeXdr:data.envelope_xdr})},now});
 assert.equal(p.source,"rpc-xdr");
});
test("six unique verified payments reconcile exact balance; partial, duplicate, stale and bad registry runs fail",async()=>{
 const fixtures=Array.from({length:6},(_,i)=>fixture({seq:i+1}));
 const records=new Map(fixtures.map(f=>[f.order.tx,f.data]));
 const fetchImpl=async url=>({ok:true,json:async()=>records.get(url.split("/").at(-1))});
 const state={runId:"run",sourceCommit:"a".repeat(40),network:"stellar:testnet",treasury:{account:TREASURY,usdcBefore:"0",usdcAfter:"30"},registry:{wasmVerified:true,wasmHash:REGISTRY_WASM_HASH,deployTx:"f".repeat(64)},
 orders:fixtures.map((f,i)=>({...f.order,quadrant:["A","B","C","D","A","C"][i],paidAt:1793000000000,start:1793000000000+(i>3?300000:0),end:1793000300000+(i>3?300000:0),commitTx:String(i+1).repeat(64),readBack:{verified:true,state:"Queued",deliveredMs:"0",requiredMs:"300000"}}))};
 const options={runId:"run",sourceCommit:state.sourceCommit,fetchImpl,now};
 const report=await verifyScreenRun(state,options); assert.equal(report.totalUnits,"300000000"); assert.equal(report.totalUsdc,"30");
 for(const bad of [
  {...state,orders:state.orders.slice(0,5)},
  {...state,orders:[state.orders[0],state.orders[0],...state.orders.slice(2)]},
  {...state,runId:"old"},
  {...state,sourceCommit:"b".repeat(40)},
  {...state,treasury:{...state.treasury,usdcAfter:"29.9999999"}},
  {...state,registry:{...state.registry,wasmVerified:false}},
  {...state,registry:{...state.registry,wasmHash:"0".repeat(64)}},
  {...state,orders:state.orders.map((o,i)=>i===1?{...o,commitTx:state.orders[0].commitTx}:o)},
  {...state,orders:state.orders.map((o,i)=>i===4?{...o,start:state.orders[0].start,end:state.orders[0].end}:o)},
  {...state,orders:state.orders.map((o,i)=>i===0?{...o,readBack:{...o.readBack,verified:false}}:o)}
 ]) await assert.rejects(verifyScreenRun(bad,options));
});
test("readBack compares every commitment field and every delivered slot",()=>{
 const c=adCommitment({runId:"test",creative:{advertiser:"A"},terms:adTerms({slot:AD_SECTION_SLOT,payTo:TREASURY,network:net.id,section:"A"}),paymentTx:"a".repeat(64),claimant:PAYER,startMs:1793000000000,durationMs:300000});
 const good={state:["Queued"],delivered:[0n],commitment:{...c,placements:c.placements.map(p=>({...p,plan:[p.plan],units:BigInt(p.units),start:BigInt(p.start),end:BigInt(p.end)}))}};
 assert.equal(readBack(good,c).verified,true);
 for(const key of ["order","payment","revision","terms","manifest"]) assert.equal(readBack({...good,commitment:{...good.commitment,[key]:"b".repeat(64)}},c).verified,false,key);
 for(const override of [{claimant:TREASURY},{deadline:c.deadline+1},{placements:[{...c.placements[0],units:1}]},{placements:[]}]){
  assert.equal(readBack({...good,commitment:{...good.commitment,...override}},c).verified,false);
 }
 assert.equal(readBack({...good,delivered:[0n,0n]},c).verified,false);
 assert.equal(readBack({...good,delivered:["invalid"]},c).verified,false);
});
