import test from 'node:test';
import assert from 'node:assert/strict';
import * as sdk from '@stellar/stellar-sdk';
import {createAdsWallet,ADS_USDC} from '../dist/ads-wallet.mjs';
import {createWalletProvider} from '../dist/wallet-provider.mjs';
const address=sdk.StrKey.encodeContract(Buffer.alloc(32,7)),payTo=sdk.Keypair.random().publicKey();
const config={networkPassphrase:sdk.Networks.TESTNET,tokenContract:ADS_USDC,rpcUrl:'https://soroban-testnet.stellar.org',origin:'https://venue.example',rpId:'venue.example',accountWasmHash:'a'.repeat(64),webauthnVerifierAddress:sdk.StrKey.encodeContract(Buffer.alloc(32,8))};
const browser={isSecureContext:true,navigator:{credentials:{}},PublicKeyCredential:function(){},location:{origin:'https://venue.example',hostname:'venue.example'}};
function fixture({evil=false}={}){
 const calls=[];
 class Kit{credentialId='credential';contractId=address;rules={list:async()=>[{id:17,context_type:{tag:'Default'},signers:[{tag:'External',values:[config.webauthnVerifierAddress,new Uint8Array(66)]}],policies:[]}]};connectWallet=async options=>{calls.push(['connect',options]);return {contractId:address};};signAuthEntry=async(entry,options)=>{calls.push(['sign',entry,options]);const signed=sdk.xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());signed.credentials().address().signatureExpirationLedger(options.expiration);signed.credentials().address().signature(sdk.xdr.ScVal.scvBytes(Buffer.from('offline-fixture-signature')));return signed;};}
 class Server{getLatestLedger=async()=>({sequence:1000});simulateTransaction=async (transaction,_resources,authMode)=>{
 calls.push(['simulate',transaction,authMode]);const fn=transaction.operations[0].func.invokeContract();
 const root=new sdk.xdr.SorobanAuthorizedInvocation({function:sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new sdk.xdr.InvokeContractArgs({contractAddress:fn.contractAddress(),functionName:'transfer',args:evil?[new sdk.Address(address).toScVal(),new sdk.Address(payTo).toScVal(),sdk.nativeToScVal(999n,{type:'i128'})]:fn.args()})),subInvocations:[]});
 const entry=new sdk.xdr.SorobanAuthorizationEntry({credentials:sdk.xdr.SorobanCredentials.sorobanCredentialsAddress(new sdk.xdr.SorobanAddressCredentials({address:new sdk.Address(address).toScAddress(),nonce:sdk.xdr.Int64.fromString('55'),signatureExpirationLedger:0,signature:sdk.nativeToScVal([])})),rootInvocation:root});
 return {_parsed:true,id:'offline-fixture',latestLedger:1000,events:[],minResourceFee:'5000',transactionData:new sdk.SorobanDataBuilder().setResourceFee('5000'),result:{auth:[entry],retval:sdk.xdr.ScVal.scvVoid()}};
 };}
 const fakeSdk={...sdk,SmartAccountKit:Kit,IndexedDBStorage:class{async get(id){calls.push(['credential',id]);const publicKey=new Uint8Array(65);publicKey[0]=4;return{credentialId:id,contractId:address,publicKey};}},getCredentialIdFromSigner:value=>value?.tag==='External'?'credential':value,rpc:{...sdk.rpc,Server},startAuthentication:async({optionsJSON})=>{calls.push(['authentication',optionsJSON]);return{id:'credential',type:'public-key',response:{clientDataJSON:'json'}};}};
 const fetchImpl=async(path,options)=>{calls.push(['fetch',path,JSON.parse(options.body)]);return path.endsWith('challenge')?Response.json({challengeId:'challenge',options:{challenge:'server-generated',rpId:'venue.example',userVerification:'required',allowCredentials:[{id:'credential'}]}}):Response.json({authenticated:true});};
 return{calls,options:{browser,loadSdk:async()=>fakeSdk,fetchImpl}};
}
const challenge={x402Version:2,resource:{url:'https://venue.example/api/ads/orders/order/pay'},accepts:[{scheme:'exact',network:'stellar:testnet',asset:ADS_USDC,amount:'1234567',payTo,maxTimeoutSeconds:60,extra:{areFeesSponsored:true}}]};
const expected={amountUnits:'1234567',payTo,asset:ADS_USDC,network:'stellar:testnet',resourceUrl:'/api/ads/orders/order/pay'};
test('wallet login proves a server challenge and does not mistake a client connect for a session',async()=>{
 const f=fixture(),wallet=await createAdsWallet(config,f.options);await wallet.connect();assert.equal(f.calls.some(call=>call[0]==='authentication'),false);await wallet.authenticate();
 assert.deepEqual(f.calls.find(call=>call[0]==='connect')[1],{fresh:true});assert.equal(f.calls.find(call=>call[0]==='authentication')[1].challenge,'server-generated');
 const post=f.calls.find(call=>call[0]==='fetch'&&call[1].endsWith('verify'));assert.equal(post[2].challengeId,'challenge');assert.equal(f.calls.some(call=>call[0]==='sign'),false);
});
test('x402 client signs exactly the transfer entry with caller-selected context rule then returns unsubmitted XDR',async()=>{
 const f=fixture(),wallet=await createAdsWallet(config,f.options);await wallet.connect();const payload=await wallet.signPayment({challenge,expected});
 const signed=f.calls.find(call=>call[0]==='sign');assert.deepEqual(signed[2].contextRuleIds,[17]);assert.equal(signed[2].expiration,1012);assert.equal(f.calls.filter(call=>call[0]==='fetch').length,0,'signing never sends a payment');
 const transaction=sdk.TransactionBuilder.fromXDR(payload.payload.transaction,sdk.Networks.TESTNET);assert.equal(transaction.operations.length,1);const fn=transaction.operations[0].func.invokeContract();assert.equal(fn.functionName().toString(),'transfer');assert.equal(sdk.scValToNative(fn.args()[0]),address);assert.equal(sdk.scValToNative(fn.args()[1]),payTo);assert.equal(sdk.scValToNative(fn.args()[2]),1234567n);assert.equal(transaction.operations[0].auth.length,1);
});
test('a manipulated simulation invocation never reaches the passkey prompt',async()=>{
 const f=fixture({evil:true}),wallet=await createAdsWallet(config,f.options);await wallet.connect();await assert.rejects(wallet.signPayment({challenge,expected}),/transferencia autorizada/);assert.equal(f.calls.some(call=>call[0]==='sign'),false);
});

test('browser bundle exports signing and challenge APIs without depending on a global Buffer',async()=>{
 const original=globalThis.Buffer;
 try{globalThis.Buffer=undefined;const bundled=await import('../dist/vendor/ads-wallet/kit.mjs?qa-no-buffer');assert.equal(typeof bundled.SmartAccountKit,'function');assert.equal(typeof bundled.startAuthentication,'function');assert.equal(typeof bundled.getCredentialIdFromSigner,'function');assert.equal(bundled.scValToNative(bundled.nativeToScVal(1234567n,{type:'i128'})),1234567n);}finally{globalThis.Buffer=original;}
});


test('map and advertiser connect the same existing passkey wallet without creating or funding an account',async()=>{
 const f=fixture(),provider=await createWalletProvider(config,{browser,loadKit:f.options.loadSdk});
 const mapped=await provider.connect(),advertiser=await createAdsWallet(config,f.options),connected=await advertiser.connect();
 assert.equal(connected.address,mapped.address);assert.equal(advertiser.address,mapped.address);assert.equal(connected.credentialId,'credential');assert.equal(connected.credentialId,mapped.credentialId);assert.equal(f.calls.find(call=>call[0]==='credential')[1],connected.credentialId);
 assert.equal(f.calls.filter(call=>call[0]==='connect').length,2);
 await advertiser.authenticate();
 assert.deepEqual(f.calls.filter(call=>call[0]==='fetch').map(call=>call[1]),['/api/ads/auth/challenge','/api/ads/auth/verify']);
 assert.equal(f.calls.some(call=>call[0]==='sign'),false);
});

test('published map and advertiser bundles use the same default IndexedDB database for credential mappings',async()=>{
 const map=await import('../dist/vendor/wallet/kit.mjs'),ads=await import('../dist/vendor/ads-wallet/kit.mjs');
 const mapStorage=new map.IndexedDBStorage(),adsStorage=new ads.IndexedDBStorage();
 assert.equal(mapStorage.dbName,'smart-account-kit');assert.equal(adsStorage.dbName,mapStorage.dbName);
});
