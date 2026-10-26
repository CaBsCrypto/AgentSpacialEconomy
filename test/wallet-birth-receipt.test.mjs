import test from 'node:test';
import assert from 'node:assert/strict';
import { Account, Address, Operation, StrKey, TransactionBuilder, hash, xdr } from '@stellar/stellar-sdk';
import { ACCOUNT_WASM, DEFAULT_ORIGIN, SHARED_DEPLOYER, TESTNET, WEBAUTHN_VERIFIER } from '../server/wallet/config.mjs';
import { createBirthReceiptHandler, resolveBirthReceipt, verifyBirthReceipt } from '../server/wallet/birth-receipt.mjs';
const key = Buffer.from('046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5','hex');
const config = { enabled:true, origin:DEFAULT_ORIGIN, accountWasmHash:ACCOUNT_WASM, networkPassphrase:TESTNET, webauthnVerifierAddress:WEBAUTHN_VERIFIER };
function fixture({ duplicate=false, publicKey=key, policies=xdr.ScVal.scvMap([]), deployer=SHARED_DEPLOYER }={}) {
 const credential=Buffer.from('existing-primary-passkey'),credentialId=credential.toString('base64url');
 const preimage=xdr.ContractIdPreimage.contractIdPreimageFromAddress(new xdr.ContractIdPreimageFromAddress({address:Address.fromString(deployer).toScAddress(),salt:hash(credential)}));
 const create=new xdr.CreateContractArgsV2({contractIdPreimage:preimage,executable:xdr.ContractExecutable.contractExecutableWasm(Buffer.from(ACCOUNT_WASM,'hex')),constructorArgs:[xdr.ScVal.scvVec([xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('External'),new Address(WEBAUTHN_VERIFIER).toScVal(),xdr.ScVal.scvBytes(Buffer.concat([publicKey,credential]))])]),policies]});
 const address=StrKey.encodeContract(hash(xdr.HashIdPreimage.envelopeTypeContractId(new xdr.HashIdPreimageContractId({networkId:hash(Buffer.from(TESTNET)),contractIdPreimage:preimage})).toXDR()));
 const builder=new TransactionBuilder(new Account(SHARED_DEPLOYER,'0'),{fee:'100',networkPassphrase:TESTNET});
 const operation=()=>Operation.invokeHostFunction({func:xdr.HostFunction.hostFunctionTypeCreateContractV2(create),auth:[]});builder.addOperation(operation());if(duplicate)builder.addOperation(operation());const tx=builder.setTimeout(0).build();
 return { input:{address,credentialId},record:{hash:tx.hash().toString('hex'),envelope_xdr:tx.toXDR(),ledger:42,successful:true} };
}
const request=(body,options={})=>new Request(DEFAULT_ORIGIN+'/api/wallet/birth-receipt',{method:options.method||'POST',headers:{'Content-Type':'application/json',Origin:options.origin||DEFAULT_ORIGIN,...options.headers},...(options.method==='GET'?{}:{body:JSON.stringify(body)})});
test('birth receipt binds successful Testnet envelope, derived C, salt, deployer, code and one exact P-256 primary signer',()=>{
 const f=fixture(),receipt=verifyBirthReceipt(f.record,f.input,config);assert.equal(receipt.address,f.input.address);assert.equal(receipt.credentialId,f.input.credentialId);assert.equal(receipt.publicKeyBase64Url,key.toString('base64url'));assert.equal(receipt.creationTransactionHash,f.record.hash);assert.equal(receipt.creationLedger,42);assert.equal(receipt.network,'testnet');assert(!Object.hasOwn(receipt,'birthConstructorArgsHash'));assert(!Object.hasOwn(receipt,'constructorArgsHash'));assert(!Object.hasOwn(receipt,'envelope_xdr'));
});
test('failed or tampered historical transaction, wrong network and another passkey cannot recover',()=>{
 const f=fixture();for(const record of [{...f.record,successful:false},{...f.record,hash:'0'.repeat(64)},{...f.record,ledger:0},{...f.record,envelope_xdr:'invalid'}])assert.throws(()=>verifyBirthReceipt(record,f.input,config));
 assert.throws(()=>verifyBirthReceipt(f.record,f.input,{...config,networkPassphrase:'Public Global Stellar Network ; September 2015'}));assert.throws(()=>verifyBirthReceipt(f.record,{...f.input,credentialId:Buffer.from('foreign-passkey').toString('base64url')},config));assert.throws(()=>verifyBirthReceipt(f.record,f.input,{...config,accountWasmHash:'a'.repeat(64)}));assert.throws(()=>verifyBirthReceipt(f.record,f.input,{...config,webauthnVerifierAddress:StrKey.encodeContract(Buffer.alloc(32,5))}));
});
test('ambiguous creation, another deployer, additional policies and invalid P-256 points fail closed',()=>{
 for(const f of [fixture({duplicate:true}),fixture({deployer:StrKey.encodeEd25519PublicKey(Buffer.alloc(32,9))}),fixture({policies:xdr.ScVal.scvMap([new xdr.ScMapEntry({key:new Address(WEBAUTHN_VERIFIER).toScVal(),val:xdr.ScVal.scvVoid()})])}),fixture({publicKey:Buffer.concat([Buffer.from([4]),Buffer.alloc(64)])})])assert.throws(()=>verifyBirthReceipt(f.record,f.input,config));
});
test('history search uses only fixed Testnet providers and one bounded ledger; hint is never evidence',async()=>{
 const f=fixture(),calls=[];const fetchImpl=async(url,options)=>{calls.push({url,options});return Response.json(calls.length===1?{contractId:f.input.address,summary:{contract_id:f.input.address,first_seen_ledger:42},url:'http://internal.invalid'}:{_embedded:{records:[f.record]},_links:{next:{href:'http://internal.invalid'}}});};
 const receipt=await resolveBirthReceipt(f.input,{config,fetchImpl});assert.equal(receipt.creationTransactionHash,f.record.hash);assert.equal(calls.length,2);assert.equal(calls[0].url,'https://testnet.mercurydata.app/rest/smart-account-indexer/api/contract/'+f.input.address);assert.equal(calls[1].url,'https://horizon-testnet.stellar.org/ledgers/42/transactions?include_failed=false&limit=200');assert(calls.every(call=>call.options.redirect==='error'&&call.options.method==='GET'&&call.options.signal));
 const empty=async url=>Response.json(url.includes('mercury')?{contractId:f.input.address,summary:{contract_id:f.input.address,first_seen_ledger:42}}:{_embedded:{records:[]}});await assert.rejects(resolveBirthReceipt(f.input,{config,fetchImpl:empty}),error=>error.reason==='birth_creation_ambiguous');
});
test('preauth receipt route enforces exact Origin, JSON4KB, method and three requests per public address per minute',async()=>{
 const f=fixture(),calls=[];let count=0;const handler=createBirthReceiptHandler({config,redis:{eval:async(_script,keys,args)=>{calls.push({keys,args});return keys[0].endsWith(':global')?1:++count;}},resolve:async body=>verifyBirthReceipt(f.record,body,config)});
 assert.equal((await handler(request(f.input,{origin:'https://foreign.example'}))).status,403);assert.equal((await handler(request(f.input,{method:'GET'}))).status,405);assert.equal((await handler(request({...f.input,pad:'a'.repeat(4200)}))).status,413);assert.equal(calls.length,0);
 for(let i=0;i<3;i++){const response=await handler(request(f.input));assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store, max-age=0');const receipt=await response.json();assert.equal(receipt.credentialId,f.input.credentialId);assert(!Object.hasOwn(receipt,'birthConstructorArgsHash'));}
 assert.equal((await handler(request(f.input))).status,429);assert(calls.every(call=>call.args[0]===60&&!call.keys[0].includes(f.input.address)&&!call.keys[0].includes(f.input.credentialId)));
});

test('a sponsored fee-bump receipt binds the outer hash while verifying the inner direct creation',()=>{
 const f=fixture(),inner=TransactionBuilder.fromXDR(f.record.envelope_xdr,TESTNET),outer=TransactionBuilder.buildFeeBumpTransaction(SHARED_DEPLOYER,'100',inner,TESTNET);
 const record={...f.record,hash:outer.hash().toString('hex'),envelope_xdr:outer.toXDR()};assert.equal(verifyBirthReceipt(record,f.input,config).creationTransactionHash,record.hash);assert.throws(()=>verifyBirthReceipt({...record,hash:f.record.hash},f.input,config));
});
test('a full 200-record ledger page, inconsistent ledger and oversized history stay unresolved',async()=>{
 const f=fixture();for(const records of [Array.from({length:200},()=>f.record),[{...f.record,ledger:43}]]){let n=0;const fetchImpl=async()=>Response.json(++n===1?{contractId:f.input.address,summary:{contract_id:f.input.address,first_seen_ledger:42}}:{_embedded:{records}});await assert.rejects(resolveBirthReceipt(f.input,{config,fetchImpl}),error=>error.reason==='birth_history_unavailable');}
 await assert.rejects(resolveBirthReceipt(f.input,{config,fetchImpl:async()=>new Response('x',{headers:{'content-length':'2000001'}})}),error=>error.reason==='birth_history_unavailable');
});
