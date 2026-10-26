import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as sdk from '@stellar/stellar-sdk';
import {createOperatorRegistrySigner,createSorobanRegistryRuntime} from '../server/ads/registry.mjs';
import {ASSET,ISSUER,readAdsConfig,publicAdsConfig,validateAdsConfig} from '../server/ads/config.mjs';

// Ephemeral local keys and injected RPC only. No submit or external request exists.
const issuer=sdk.Keypair.random(),other=sdk.Keypair.random(),contract=sdk.StrKey.encodeContract(Buffer.alloc(32,74)),otherContract=sdk.StrKey.encodeContract(Buffer.alloc(32,75));
const config={network:'stellar:testnet',registryContract:contract,registryIssuer:issuer.publicKey(),operators:[issuer.publicKey()]};
const job={operation:'complete',payload:{order:'a'.repeat(64)}};
function harness(change=tx=>tx){
 const counts={loads:0,parses:0,signatures:0,accounts:0,prepares:0};
 const localSdk={...sdk,Keypair:{fromSecret(value){
  counts.parses++;const key=sdk.Keypair.fromSecret(value),sign=key.sign.bind(key);
  key.sign=(...args)=>{counts.signatures++;return sign(...args);};return key;
 }}};
 const loadSdk=async()=>{counts.loads++;return localSdk;};
 const rpc={getAccount:async address=>{assert.equal(address,issuer.publicKey());counts.accounts++;return new sdk.Account(address,'7');},prepareTransaction:async tx=>{counts.prepares++;return change(tx);}};
 return {counts,loadSdk,rpc};
}
function mutated(tx,{source=tx.source,to=contract,operation='complete',order='a'.repeat(64),operationSource}={}){
 const op=new sdk.Contract(to).call(operation,sdk.nativeToScVal(Buffer.from(order,'hex'),{type:'bytes'}));
 if(operationSource)op.sourceAccount(sdk.xdr.MuxedAccount.keyTypeEd25519(sdk.StrKey.decodeEd25519PublicKey(operationSource)));
 return new sdk.TransactionBuilder(new sdk.Account(source,'7'),{networkPassphrase:sdk.Networks.TESTNET,fee:sdk.BASE_FEE}).addOperation(op).setTimeout(60).build();
}
test('environment-backed registry signer signs exactly its issuer,contract,operation and arguments',async()=>{
 const h=harness(),runtime=createSorobanRegistryRuntime({config:{...config,registrySignerSecret:issuer.secret()},rpc:h.rpc,loadSdk:h.loadSdk});
 const prepared=await runtime.prepare(job),tx=sdk.TransactionBuilder.fromXDR(prepared.signedXdr,sdk.Networks.TESTNET),fn=tx.operations[0].func.invokeContract();
 assert.equal(tx.source,issuer.publicKey());assert.equal(sdk.Address.fromScAddress(fn.contractAddress()).toString(),contract);assert.equal(fn.functionName().toString(),'complete');
 assert.equal(sdk.scValToNative(fn.args()[0]).toString('hex'),job.payload.order);
 assert.equal(prepared.txHash,tx.hash().toString('hex'));assert.equal(tx.signatures.length,1);
 assert(issuer.verify(tx.hash(),tx.signatures[0].signature()));assert.equal(h.counts.signatures,1);
});
test('wrong key,Mainnet,non-allowlisted issuer and unknown operation fail before signing or RPC',async()=>{
 for(const [cfg,input,secret,code,loads] of [
  [config,job,other.secret(),'registry_signer_mismatch',true],
  [{...config,network:'stellar:pubnet'},job,issuer.secret(),'registry_testnet_only',false],
  [{...config,operators:[other.publicKey()]},job,issuer.secret(),'registry_signer_unavailable',false],
  [config,{...job,operation:'release_funds'},issuer.secret(),'registry_signer_unavailable',false],
 ]){
  const h=harness(),signer=createOperatorRegistrySigner({secret,config:cfg,rpc:h.rpc,loadSdk:h.loadSdk});
  await assert.rejects(signer.prepare(input),error=>error.code===code);
  assert.equal(h.counts.signatures,0);assert.equal(h.counts.accounts,0);if(!loads)assert.equal(h.counts.loads,0);
 }
 const h=harness(),signer=createOperatorRegistrySigner({secret:issuer.secret(),config,rpc:h.rpc,loadSdk:h.loadSdk});
 await assert.rejects(signer.prepare({operation:'complete',payload:{order:'invalid'}}),error=>error.code==='registry_hash_invalid');
 assert.equal(h.counts.parses,0);assert.equal(h.counts.signatures,0);
});
test('RPC changes to contract,operation,arguments or issuer are rejected before the private key signs',async()=>{
 for(const change of [{to:otherContract},{operation:'expire'},{order:'b'.repeat(64)},{source:other.publicKey()},{operationSource:other.publicKey()}]){
  const h=harness(tx=>mutated(tx,change)),signer=createOperatorRegistrySigner({secret:issuer.secret(),config,rpc:h.rpc,loadSdk:h.loadSdk});
  await assert.rejects(signer.prepare(job),error=>error.code==='registry_transaction_invalid');
  assert.equal(h.counts.signatures,0);assert.equal(h.counts.prepares,1);
 }
});
test('private file remains a fallback; an explicit memory key takes priority',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'ads-registry-key-')),file=join(directory,'ephemeral-test.key');
 await writeFile(file,issuer.secret(),{mode:0o600});t.after(async()=>{await unlink(file);await rmdir(directory);});
 const h=harness(),signer=createOperatorRegistrySigner({secretFile:file,config,rpc:h.rpc,loadSdk:h.loadSdk});
 assert((await signer.prepare(job)).signedXdr);assert.equal(h.counts.signatures,1);
 const second=harness(),memory=createOperatorRegistrySigner({secret:other.secret(),secretFile:file,config,rpc:second.rpc,loadSdk:second.loadSdk});
 await assert.rejects(memory.prepare(job),error=>error.code==='registry_signer_mismatch');assert.equal(second.counts.signatures,0);
});
function operationalSource({authority=issuer.publicKey(),operators=[authority]}={}){
 return {network:'stellar:testnet',asset:ASSET,issuer:ISSUER,payTo:issuer.publicKey(),registryIssuer:issuer.publicKey(),operators,disputeAuthority:authority,
 termsVersion:'local-signer-test',policyVersion:'ads-content-v1',privacyNotice:'Local test only',interruptions:'Unconfirmed intervals never count',refundDeadlineMs:null,
 timeUnitMs:300000,passMs:60000,rotationMs:60000,reservationMs:60000,processingMs:1000,retentionMs:3600000,maxUnits:5,maxWindowMs:3600000,maxCampaignSharePercent:100,includedRevisions:0,
 hostWindows:[],allowedDomains:['x.com','example.com'],registryEvidenceGraceMs:60000,
 placements:{main_stage_screen:{position:[0,1,2],width:16,height:9}},
 limits:{uploadBytes:100000,imagePixels:4000000,imageWidth:1920,imageHeight:1080,nameChars:100,descriptionChars:1000,textBytes:4096},
 model:{id:'local/test-model',maxCalls:2,maxTokens:100,timeoutMs:1000,previewPerHour:1,maxCostMicrousd:100,maxInputTokens:1000000,preauditPerHour:1,inputMicrousdPerMillion:'1',outputMicrousdPerMillion:'1'},
 accountWasmHash:'f'.repeat(64),webauthnVerifier:contract,walletCompatibilityVerified:true};
}
function read(source=operationalSource(),overrides={}){
 return readAdsConfig({ADS_CONFIG_JSON:JSON.stringify(source),ADS_CHECKOUT_ENABLED:'true',ADS_DATABASE_URL:'postgres://unused-local-test/ads',AI_GATEWAY_API_KEY:'explicit-test-only-placeholder',
 ADS_PUBLISHER_PRIVATE_KEY:'explicit-test-only-placeholder',ADS_PUBLISHER_PUBLIC_KEY:'explicit-test-only-placeholder',ADS_PUBLISHER_TOKEN:'explicit-test-only-placeholder',
 ADS_REGISTRY_CONTRACT:contract,ADS_REGISTRY_SIGNER_KEY:issuer.secret(),...overrides});
}
test('configuration accepts a public offlineG or passkeyC authority without changing advertiser authentication',()=>{
 const offline=read();assert(offline.enabled);assert.deepEqual(offline.missing,[]);
 const passkey=read(operationalSource({authority:otherContract,operators:[otherContract,issuer.publicKey()]}));assert(passkey.enabled);assert.deepEqual(passkey.missing,[]);
});
test('configuration rejects secret material and authorities absent from the public allowlist',()=>{
 for(const source of [
  operationalSource({operators:[issuer.publicKey(),issuer.secret()]}),
  operationalSource({authority:issuer.secret(),operators:[issuer.secret(),issuer.publicKey()]}),
  operationalSource({authority:otherContract,operators:[issuer.publicKey()]}),
 ]){
  const c=read(source);assert(!c.enabled);assert(c.missing.includes('operators')||c.missing.includes('disputeAuthority'));
  assert(!JSON.stringify(publicAdsConfig(c)).includes(issuer.secret()));
 }
});
test('registry private environment key is omitted from public config and missing credentials disable configured registry',()=>{
 const c=read();assert(c.registrySignerSecret===issuer.secret());
 const publicValue=JSON.stringify(publicAdsConfig(c));assert(!publicValue.includes(issuer.secret()));assert(!publicValue.includes('registrySignerSecret'));
 const missing=read(operationalSource(),{ADS_REGISTRY_SIGNER_KEY:''});assert(!missing.enabled);assert(missing.missing.includes('ADS_REGISTRY_SIGNER_KEY'));
 const file=read(operationalSource(),{ADS_REGISTRY_SIGNER_KEY:'',ADS_REGISTRY_SIGNER_KEY_FILE:'/not-read-until-authorized-prepare'});assert(file.enabled);
 const badIssuer=read({...operationalSource(),registryIssuer:other.publicKey()});assert(!badIssuer.enabled);assert(badIssuer.missing.includes('registryIssuer'));
});
test('FULFILL_REMAINING needs no invented refund deadline while legacy monetary policies still require it',()=>{
 const c=read();assert.equal(c.refundPolicy,'FULFILL_REMAINING');assert.equal(c.refundDeadlineMs,null);assert(!c.missing.includes('refundDeadlineMs'));
 for(const refundPolicy of ['FULL','PRO_RATA']){
  const legacy={...c,profile:undefined,refundPolicy,refundDesign:'NEVER',refundDeadlineMs:null};
  assert(validateAdsConfig(legacy).includes('refundDeadlineMs'));
  assert(!validateAdsConfig({...legacy,refundDeadlineMs:60000}).includes('refundDeadlineMs'));
 }
});

test('allowlisting an offlineG operator does not enable advertiserG authentication',async()=>{
 const {createWalletAuthority}=await import('../server/ads/wallet-authority.mjs');let reads=0;
 const authority=createWalletAuthority({config:read(),rpc:{getNetwork:async()=>{reads++;throw Error('No chain read for G advertiser');}}});
 await assert.rejects(authority.read({address:issuer.publicKey(),credentialId:'test'}),error=>error.code==='WALLET_NETWORK');assert.equal(reads,0);
});
