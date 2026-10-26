// Read-only audit: queries historical receipts, contract code and get(order); never signs or submits.
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";
import * as sdk from "@stellar/stellar-sdk";
import {AD_SLOT,AD_SECTION_SLOT} from "./catalog.mjs";
import {networkConfig} from "./config/networks.mjs";
import {adTerms,adCommitment,readBack,registryCommitArgs} from "./lib/ads.mjs";
import {verifyScreenRun} from "./lib/screen-payments.mjs";
import {createRegistry,REGISTRY_WASM_HASH} from "./registry.mjs";
const requireThat=(ok,message)=>{if(!ok)throw Error(message);};
const xdrString=value=>typeof value==="string"?value:value?.toXDR("base64");
const cleanError=e=>String(e?.message??e).replace(/\bS[A-Z2-7]{55}\b/g,"[REDACTED]").slice(0,600);
export function inspectRegistryReceipt(receipt,{txHash,treasury,contractId,commitment,network="stellar:testnet"}) {
 const net=networkConfig(network);
 requireThat(receipt?.successful===true||receipt?.status==="SUCCESS","Registry transaction is not confirmed successful.");
 requireThat((receipt.hash??receipt.txHash??txHash).toLowerCase()===txHash.toLowerCase(),"Registry receipt hash differs.");
 const envelope=sdk.TransactionBuilder.fromXDR(xdrString(receipt.envelope_xdr??receipt.envelopeXdr),net.passphrase);
 requireThat(envelope.hash().toString("hex")===txHash.toLowerCase(),"Registry envelope hash or network differs.");
 const tx=envelope.innerTransaction??envelope;
 requireThat(tx.source===treasury&&tx.operations.length===1,"Registry transaction must be issued by this treasury with one operation.");
 const op=tx.operations[0];
 requireThat(op.type==="invokeHostFunction","Registry receipt is not a contract operation.");
 if(commitment){
  requireThat(op.func.switch().name==="hostFunctionTypeInvokeContract","Registry receipt is not a commit call.");
  const call=op.func.invokeContract();
  requireThat(sdk.Address.fromScAddress(call.contractAddress()).toString()===contractId&&call.functionName().toString()==="commit","Commit receipt targets another contract or method.");
  const expected=registryCommitArgs(commitment,sdk);
  requireThat(call.args().length===expected.length&&call.args().every((a,i)=>a.toXDR("base64")===expected[i].toXDR("base64")),"Commit transaction contains different commitment arguments.");
 }else{
  requireThat(op.func.switch().name==="hostFunctionTypeCreateContractV2","Deployment receipt is not a contract creation.");
  const create=op.func.createContractV2();
  requireThat(create.executable().wasmHash().toString("hex")===REGISTRY_WASM_HASH,"Deployment WASM differs.");
  requireThat(sdk.scValToNative(create.constructorArgs()[0])===treasury,"Deployment issuer differs.");
  const preimage=sdk.xdr.HashIdPreimage.envelopeTypeContractId(new sdk.xdr.HashIdPreimageContractId({networkId:sdk.hash(Buffer.from(net.passphrase)),contractIdPreimage:create.contractIdPreimage()}));
  requireThat(sdk.StrKey.encodeContract(sdk.hash(preimage.toXDR()))===contractId,"Deployment creates another contract.");
 }
 const ledger=Number(receipt.ledger);
 requireThat(Number.isSafeInteger(ledger)&&ledger>0,"Registry receipt has no valid ledger.");
 return {verified:true,tx:txHash,ledger,kind:commitment?"commit":"deploy"};
}
async function transactionReceipt(hash,net,{fetchImpl,rpc}) {
 if(rpc)return rpc.getTransaction(hash);
 let response;
 try{response=await fetchImpl(net.horizonUrl+"/transactions/"+hash,{signal:AbortSignal.timeout(20000)});}catch{}
 if(response?.ok)return response.json();
 return new sdk.rpc.Server(net.rpcUrl,{timeout:20}).getTransaction(hash);
}
export async function auditScreenEvidence(input,{sourceCommit,legacyOffer=false,fetchImpl=fetch,rpc,registry,now}={}) {
 const state=structuredClone(input);state.verification=null;
 requireThat(state.network==="stellar:testnet","Only testnet evidence can be audited.");
 if(sourceCommit&&state.sourceCommit)requireThat(sourceCommit===state.sourceCommit,"Explicit source commit differs from the recorded source.");
 if(!state.sourceCommit){requireThat(sourceCommit,"Historical evidence requires an explicit source commit.");state.sourceCommit=sourceCommit;}
 const slot=legacyOffer?AD_SLOT:AD_SECTION_SLOT;
 requireThat(legacyOffer?(!state.screen?.offerId||state.screen.offerId===AD_SLOT.offerId):state.screen?.offerId===AD_SECTION_SLOT.offerId,"Offer provenance differs; historical whole-screen terms require --legacy-offer.");
 requireThat(state.orders?.length===6&&state.registry?.contractId&&state.treasury?.account,"Incomplete screen evidence.");
 const net=networkConfig(state.network),reader=registry??createRegistry(net);
 state.registry.wasmVerified=(await reader.wasmHashOf(state.registry.contractId))===REGISTRY_WASM_HASH;
 requireThat(state.registry.wasmVerified,"Live registry WASM differs from the expected build.");
 requireThat(state.registry.wasmHash===REGISTRY_WASM_HASH,"Recorded registry WASM differs.");
 const refs=[];
 const deploy=await transactionReceipt(state.registry.deployTx,net,{fetchImpl,rpc});
 refs.push(inspectRegistryReceipt(deploy,{txHash:state.registry.deployTx,treasury:state.treasury.account,contractId:state.registry.contractId}));
 for(const order of state.orders){
  const terms=adTerms({slot,payTo:state.treasury.account,network:state.network,section:order.quadrant});
  const commitment=adCommitment({runId:order.id,creative:{advertiser:order.advertiser,headline:order.headline},terms,paymentTx:order.tx,claimant:order.account,startMs:order.start,durationMs:slot.durationMs});
  requireThat(order.order===commitment.order,"Recorded order id differs from reconstructed commitment.");
  const receipt=await transactionReceipt(order.commitTx,net,{fetchImpl,rpc});
  refs.push(inspectRegistryReceipt(receipt,{txHash:order.commitTx,treasury:state.treasury.account,contractId:state.registry.contractId,commitment}));
  order.commitment=commitment;
  order.readBack=readBack(await reader.get(state.registry.contractId,commitment.order,state.treasury.account),commitment);
  requireThat(order.readBack.verified,"Live complete commitment differs for "+order.id);
 }
 state.verification=await verifyScreenRun(state,{runId:state.runId,sourceCommit:state.sourceCommit,expectedOrders:6,fetchImpl,rpc,now});
 state.verification.registryTransactions=refs;
 state.verification.offerId=slot.offerId;
 state.status="VERIFIED";
 return state;
}
export async function writeAuditFile(inputPath,outputPath,options={}) {
 const inputFile=resolve(inputPath),outputFile=resolve(outputPath);
 requireThat(inputFile.toLowerCase()!==outputFile.toLowerCase(),"Audit output must not overwrite input.");
 const input=JSON.parse(await readFile(inputFile,"utf8"));
 await mkdir(dirname(outputFile),{recursive:true});
 try{
  const audited=await auditScreenEvidence(input,options);
  await writeFile(outputFile,JSON.stringify(audited,null,2)+"\n",{flag:"wx"});
  return audited;
 }catch(e){
  // Failed rechecks cannot inherit a previous green verification.
  const diagnostic={runId:input.runId,sourceCommit:options.sourceCommit??input.sourceCommit,network:input.network,status:"FAILED",verification:null,error:cleanError(e),checkedAt:new Date().toISOString()};
  await writeFile(outputFile,JSON.stringify(diagnostic,null,2)+"\n",{flag:"wx"}).catch(()=>{});
  throw e;
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {values}=parseArgs({options:{input:{type:"string"},out:{type:"string"},"source-commit":{type:"string"},"legacy-offer":{type:"boolean",default:false}}});
 if(!values.input||!values.out){console.error("Required: --input source.json --out new-audit.json [--source-commit SHA] [--legacy-offer]");process.exitCode=1;}
 else writeAuditFile(values.input,values.out,{sourceCommit:values["source-commit"],legacyOffer:values["legacy-offer"]}).then(state=>{
  console.log("VERIFIED: "+state.verification.verifiedOrders+" exact payments, "+state.verification.totalUsdc+" testnet USDC, 7 registry transactions; Queued, no delivery claimed.");
 }).catch(e=>{console.error(cleanError(e));process.exitCode=1;});
}
