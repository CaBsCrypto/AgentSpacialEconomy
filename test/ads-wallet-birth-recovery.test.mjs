import test from 'node:test';
import assert from 'node:assert/strict';
import { Networks, StrKey } from '@stellar/stellar-sdk';
import { createAdsWallet, ADS_USDC } from '../dist/ads-wallet.mjs';
const address=StrKey.encodeContract(Buffer.alloc(32,7)),other=StrKey.encodeContract(Buffer.alloc(32,9)),credentialId=Buffer.from('existing-passkey').toString('base64url');
const publicKey=Uint8Array.from(Buffer.from('046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5','hex'));
const config={networkPassphrase:Networks.TESTNET,tokenContract:ADS_USDC,origin:'https://venue.example',rpId:'venue.example',rpcUrl:'https://soroban-testnet.stellar.org',accountWasmHash:'a'.repeat(64),webauthnVerifierAddress:other};
const browser={isSecureContext:true,navigator:{credentials:{}},PublicKeyCredential:function(){},location:{origin:config.origin}};
function fixture({original=null,receiptPatch={},recheckError=null,connectError=null}={}){
 const calls=[],rows=new Map(original?[[credentialId,original]]:[]);let activeKit,proofResponse;
 class Storage{async get(id){return rows.get(id)||null;}async save(value){calls.push(['save',structuredClone(value)]);rows.set(value.credentialId,structuredClone(value));}async delete(id){calls.push(['delete',id]);rows.delete(id);}}
 class Kit{
  constructor(options){this.options=options;activeKit=this;}
  async connectWallet(options){
   calls.push(['connect',options]);
   if(options.fresh){proofResponse=await this.options.webAuthn.startAuthentication({optionsJSON:{challenge:'unique-random-sdk-challenge',rpId:config.rpId,userVerification:'required'}});if(connectError)throw connectError;throw Object.assign(new Error('The indexer did not return one complete schema-2 birth claim.'),{name:'WalletProvenanceError',code:2005,context:{contractId:address}});}
   const id=options.credentialId,target=options.contractId;calls.push(['recheck',id,target]);assert.equal(id,credentialId);assert.equal(target,address);const candidate=rows.get(id);assert.equal(candidate.contractId,address);assert.equal(candidate.birthConstructorArgsHash,undefined);assert.equal(candidate.associationVerified,undefined);assert.equal(candidate.deploymentStatus,'pending');
   const fresh=await this.options.webAuthn.startAuthentication({optionsJSON:{challenge:'SECOND-new-ownership-challenge',rpId:config.rpId,userVerification:'required',allowCredentials:[{id}]}});assert.notEqual(fresh,proofResponse);if(recheckError)throw recheckError;this.contractId=address;this.credentialId=credentialId;rows.set(id,{...candidate,birthConstructorArgsHash:'derived-only-after-real-sdk-proof',deploymentStatus:'deployed'});return {contractId:address,credentialId};
  }
 }
 const sdk={SmartAccountKit:Kit,IndexedDBStorage:Storage,StrKey,rpc:{Server:class{}},startAuthentication:async options=>{calls.push(['passkey',options]);return{id:credentialId,type:'public-key',response:{signature:'fresh-assertion'}};}};
 const fetchImpl=async(path,options)=>{calls.push(['fetch',path,options]);return Response.json({address,credentialId,publicKeyBase64Url:Buffer.from(publicKey).toString('base64url'),birthWasmHash:config.accountWasmHash,creationTransactionHash:'b'.repeat(64),creationLedger:42,network:'testnet',...receiptPatch});};
 return{calls,rows,options:{browser,loadSdk:async()=>sdk,fetchImpl},get kit(){return activeKit;}};
}
test('incomplete indexer recovery uses the public SDK connection with a NEW ownership assertion and no local approval',async()=>{
 const f=fixture(),wallet=await createAdsWallet(config,f.options),result=await wallet.connect();assert.equal(result.address,address);assert.equal(result.credentialId,credentialId);assert.equal(f.calls.filter(c=>c[0]==='passkey').length,2);assert.notEqual(f.calls.filter(c=>c[0]==='passkey')[0][1].optionsJSON.challenge,f.calls.filter(c=>c[0]==='passkey')[1][1].optionsJSON.challenge);assert.deepEqual(f.calls.find(c=>c[0]==='connect')[1],{fresh:true});const request=f.calls.find(c=>c[0]==='fetch');assert.equal(request[1],'/api/wallet/birth-receipt');assert.equal(request[2].method,'POST');assert.deepEqual(JSON.parse(request[2].body),{address,credentialId});assert(request[2].signal);assert.equal(f.calls.filter(c=>c[0]==='recheck').length,1);assert.equal(f.calls.some(c=>/fund|faucet|create|signPayment/.test(c[1]||'')),false);
});
test('server cannot supply approval hashes, another wallet, another credential or another birth code',async()=>{
 for(const receiptPatch of [{birthConstructorArgsHash:'untrusted'},{constructorArgsHash:'untrusted'},{address:other},{credentialId:'another'},{birthWasmHash:'c'.repeat(64)},{network:'mainnet'},{publicKeyBase64Url:'bad'}]){const f=fixture({receiptPatch}),wallet=await createAdsWallet(config,f.options);await assert.rejects(wallet.connect());assert.equal(f.calls.some(c=>c[0]==='save'||c[0]==='recheck'),false);assert.equal(wallet.address,undefined);}
});
test('failed SDK birth or ownership proof restores prior mappings and does not connect',async()=>{
 const original={credentialId,contractId:address,publicKey,createdAt:5,nickname:'Existing wallet'};
 for(const stored of [null,original]){const failure=Object.assign(new Error('Fresh WebAuthn ownership verification failed'),{code:2006}),f=fixture({original:stored,recheckError:failure}),wallet=await createAdsWallet(config,f.options);await assert.rejects(wallet.connect(),error=>error===failure);assert.equal(wallet.address,undefined);if(stored)assert.deepEqual(f.rows.get(credentialId),stored);else assert.equal(f.rows.has(credentialId),false);assert.equal(f.calls.filter(c=>c[0]==='passkey').length,2);}
});
test('code, constructor and ownership failures never enter the receipt fallback',async()=>{
 for(const connectError of [Object.assign(new Error('wrong wallet code'),{name:'WalletCodeNotAcceptedError',code:2003,context:{contractId:address}}),Object.assign(new Error('Birth verification failed: constructor mismatch'),{name:'WalletProvenanceError',code:2005,context:{contractId:address}}),Object.assign(new Error('bad signer'),{name:'WalletOwnershipError',code:2006,context:{contractId:address}})]){const f=fixture({connectError}),wallet=await createAdsWallet(config,f.options);await assert.rejects(wallet.connect(),error=>error===connectError);assert.equal(f.calls.some(c=>c[0]==='fetch'||c[0]==='save'),false);}
});
test('conflicting primary mapping cannot be replaced with recovered metadata',async()=>{
 for(const original of [{credentialId,contractId:other,publicKey},{credentialId,contractId:address,publicKey,birthConstructorArgsHash:'previous-approved-hash'},{credentialId,contractId:address,publicKey,isPrimary:false},{credentialId,contractId:address,publicKey:new Uint8Array(65)}]){const f=fixture({original}),wallet=await createAdsWallet(config,f.options);await assert.rejects(wallet.connect());assert.equal(f.calls.some(c=>c[0]==='save'||c[0]==='recheck'),false);assert.deepEqual(f.rows.get(credentialId),original);}
});
