// Read-only payment attribution. Never signs, submits or retries a payment.
// Source: https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/xdr
// Successful direct transfer + canonical envelope hash binds payer/token/destination/amount to testnet.
import { networkConfig } from "../config/networks.mjs";
import { AD_SECTION_SLOT } from "../catalog.mjs";
import { REGISTRY_WASM_HASH } from "../registry.mjs";
import { toUnits, fromUnits } from "./money.mjs";
const HASH = /^[a-f0-9]{64}$/i;
const assert = (ok,message) => { if(!ok) throw new Error(message); };
const iso = now => new Date(typeof now === "function" ? now() : Date.now()).toISOString();
const b64 = xdr => typeof xdr === "string" ? xdr : xdr?.toXDR("base64");
async function receipt(hash,net,{fetchImpl,rpc,sdk}) {
 if(rpc) {
  const r=await rpc.getTransaction(hash);
  assert(r?.status==="SUCCESS","Payment transaction is not confirmed successful.");
  return {hash:r.txHash??hash,ledger:r.ledger,envelope:r.envelopeXdr,source:"rpc-xdr"};
 }
 let res;
 try { res=await fetchImpl(net.horizonUrl+"/transactions/"+hash,{signal:AbortSignal.timeout(20000)}); }
 catch { /* bounded RPC fallback is read-only */ }
 if(!res?.ok) {
  const server=new sdk.rpc.Server(net.rpcUrl,{timeout:20});
  return receipt(hash,net,{rpc:server,sdk,fetchImpl});
 }
 const r=await res.json();
 assert(r?.successful===true,"Payment transaction failed or lacks a successful receipt.");
 return {hash:r.hash,ledger:r.ledger,envelope:r.envelope_xdr,source:"horizon-xdr"};
}
export async function verifyScreenPayment(order,{network="stellar:testnet",treasury,fetchImpl=fetch,rpc,now}={}) {
 const net=networkConfig(network);
 assert(net.id==="stellar:testnet","Only Stellar testnet is supported.");
 assert(HASH.test(order?.tx??""),"Payment requires a transaction hash.");
 assert(order?.account&&treasury,"Payment requires payer and treasury.");
 assert(toUnits(order.priceUsdc)===toUnits(AD_SECTION_SLOT.priceUsdc),"Section payment price must be exactly 5 testnet USDC.");
 const sdk=await import("@stellar/stellar-sdk");
 const r=await receipt(order.tx,net,{fetchImpl,rpc,sdk});
 assert(String(r.hash).toLowerCase()===order.tx.toLowerCase(),"Receipt hash differs from the payment.");
 assert(Number.isSafeInteger(Number(r.ledger))&&Number(r.ledger)>0,"Payment receipt has no valid ledger.");
 let envelope;
 try { envelope=sdk.TransactionBuilder.fromXDR(b64(r.envelope),net.passphrase); }
 catch { throw new Error("Payment envelope cannot be decoded."); }
 assert(envelope.hash().toString("hex")===order.tx.toLowerCase(),"Payment envelope hash or network differs.");
 const tx=envelope.innerTransaction??envelope;
 assert(tx.operations.length===1,"Payment must contain exactly one token transfer.");
 const op=tx.operations[0];
 assert(op.type==="invokeHostFunction"&&op.func.switch().name==="hostFunctionTypeInvokeContract","Payment must directly call the USDC contract.");
 const fn=op.func.invokeContract();
 const asset=sdk.Address.fromScAddress(fn.contractAddress()).toString();
 assert(asset===net.usdc.sac&&fn.functionName().toString()==="transfer"&&fn.args().length===3,"Payment asset or transfer function differs.");
 const [payer,payTo,amount]=fn.args().map(v=>sdk.scValToNative(v));
 assert(payer===order.account,"Payment payer differs.");
 assert(payTo===treasury,"Payment treasury differs.");
 assert(typeof amount==="bigint"&&amount===toUnits(AD_SECTION_SLOT.priceUsdc),"Payment amount differs.");
 return {verified:true,network:net.id,tx:order.tx.toLowerCase(),payer,payTo,asset,amountUnits:String(amount),ledger:Number(r.ledger),checkedAt:iso(now),source:r.source};
}
export async function verifyScreenRun(state,{runId,sourceCommit,expectedOrders=6,fetchImpl=fetch,rpc,now}={}) {
 assert(expectedOrders===6,"The screen evidence run requires exactly six orders.");
 assert(runId&&state?.runId===runId,"Screen evidence belongs to another run.");
 assert(/^[a-f0-9]{40}$/i.test(sourceCommit??"")&&state.sourceCommit===sourceCommit,"Screen evidence must identify this source commit.");
 assert(state.network==="stellar:testnet","Screen evidence is not on testnet.");
 assert(Array.isArray(state.orders)&&state.orders.length===expectedOrders,"Screen evidence requires all six paid orders.");
 assert(new Set(state.orders.map(o=>String(o.tx).toLowerCase())).size===expectedOrders,"A payment transaction cannot fund multiple orders.");
 assert(new Set(state.orders.map(o=>o.id)).size===expectedOrders&&state.orders.every(o=>typeof o.id==="string"&&o.id),"Order ids must be unique.");
 assert(state.registry?.wasmVerified===true&&state.registry.wasmHash===REGISTRY_WASM_HASH,"Registry WASM is not verified.");
 const registryHashes=[state.registry.deployTx,...state.orders.map(o=>o.commitTx)];
 assert(registryHashes.every(tx=>HASH.test(tx??""))&&new Set(registryHashes.map(tx=>tx.toLowerCase())).size===7,"Registry requires a unique deployment and six distinct commitment transactions.");
 assert(new Set([...registryHashes,...state.orders.map(o=>o.tx)].map(tx=>tx.toLowerCase())).size===13,"Payment and registry receipts cannot be reused.");
 const quadrants=["A","B","C","D","A","C"];
 for(const [i,o] of state.orders.entries()){
  assert(o.quadrant===quadrants[i],"Screen orders must follow A, B, C, D, A, C.");
  assert(Number.isSafeInteger(o.start)&&Number.isSafeInteger(o.end)&&Number.isSafeInteger(o.paidAt)&&o.start>=o.paidAt&&o.end-o.start===300000,"Screen order timing is invalid.");
  const prior=state.orders.slice(0,i).filter(p=>p.quadrant===o.quadrant);
  assert(prior.every(p=>p.end<=o.start),"Screen orders overlap in the same section.");
 }
 assert(state.orders.every(o=>o.readBack?.verified===true&&o.readBack.state==="Queued"&&o.readBack.deliveredMs==="0"&&o.readBack.requiredMs===String(AD_SECTION_SLOT.durationMs)),"Every commitment must be verified, queued and undelivered.");
 const payments=await Promise.all(state.orders.map(order=>verifyScreenPayment(order,{network:state.network,treasury:state.treasury?.account,fetchImpl,rpc,now})));
 const total=payments.reduce((sum,p)=>sum+BigInt(p.amountUnits),0n);
 assert(total===toUnits("30"),"Screen run must receive exactly 30 testnet USDC.");
 const received=toUnits(state.treasury.usdcAfter)-toUnits(state.treasury.usdcBefore);
 assert(received===total,"Treasury balance change does not reconcile with verified payments.");
 if(state.treasury.receivedUsdc!==undefined&&state.treasury.receivedUsdc!==null)assert(toUnits(state.treasury.receivedUsdc)===total,"Recorded treasury income differs from verified payments.");
 return {verified:true,runId,sourceCommit,checkedAt:iso(now),expectedOrders,verifiedOrders:payments.length,totalUnits:String(total),totalUsdc:fromUnits(total),payments};
}
