import test from 'node:test';
import assert from 'node:assert/strict';
import * as sdk from '@stellar/stellar-sdk';
import {createTestDatabase} from './helpers/ads-db.mjs';
import {createCompatibilityService,COMPATIBILITY_TTL_MS,safeVerificationReason} from '../server/ads/compatibility.mjs';
import {createAdsHandler} from '../server/ads/http.mjs';
import {createAdsRuntime} from '../server/ads/runtime.mjs';
import {inspectStellarPayment} from '../server/ads/stellar-payments.mjs';
import {ASSET,ISSUER} from '../server/ads/config.mjs';
import {AdsError,sha256} from '../server/ads/common.mjs';

const payer=sdk.StrKey.encodeContract(Buffer.alloc(32,71)),other=sdk.StrKey.encodeContract(Buffer.alloc(32,72));
const identity={ownerId:'stellar:testnet:'+payer,address:payer,role:'advertiser'};
const otherIdentity={ownerId:'stellar:testnet:'+other,address:other,role:'advertiser'};
let nextNonce=1000;

// Real XDR parsing with an explicit dummy signature and injected facilitator.
// This fixture never signs, broadcasts, settles or proves human passkey compatibility.
function authorization(challenge,{nonce=String(nextNonce++),from=payer,to=challenge.expected.payTo,amount='50000000',asset=ASSET,expiresLedger=112}={}){
 const fn=new sdk.xdr.InvokeContractArgs({contractAddress:new sdk.Address(asset).toScAddress(),functionName:'transfer',args:[sdk.nativeToScVal(from,{type:'address'}),sdk.nativeToScVal(to,{type:'address'}),sdk.nativeToScVal(BigInt(amount),{type:'i128'})]});
 const entry=new sdk.xdr.SorobanAuthorizationEntry({credentials:sdk.xdr.SorobanCredentials.sorobanCredentialsAddress(new sdk.xdr.SorobanAddressCredentials({address:new sdk.Address(from).toScAddress(),nonce:sdk.xdr.Int64.fromString(nonce),signatureExpirationLedger:expiresLedger,signature:sdk.nativeToScVal(Buffer.alloc(64,4),{type:'bytes'})})),rootInvocation:new sdk.xdr.SorobanAuthorizedInvocation({function:sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(fn),subInvocations:[]})});
 const tx=new sdk.TransactionBuilder(new sdk.Account(sdk.Keypair.random().publicKey(),'1'),{networkPassphrase:sdk.Networks.TESTNET,fee:'100'}).addOperation(sdk.Operation.invokeHostFunction({func:sdk.xdr.HostFunction.hostFunctionTypeInvokeContract(fn),auth:[entry]})).setTimeout(60).build();
 return {x402Version:2,resource:challenge.challenge.resource,accepted:challenge.challenge.accepts[0],payload:{transaction:tx.toXDR()}};
}
async function fixture(t,{verifyMode='allow',timeoutMs=20000}={}){
 const db=await createTestDatabase({env:{}});t.after(()=>db.close());
 const clock={value:Date.now()+60000};
 const config={enabled:false,walletCompatibilityVerified:false,origin:'https://compatibility.example',network:'stellar:testnet',asset:ASSET,issuer:ISSUER,payTo:sdk.Keypair.random().publicKey(),facilitatorUrl:'https://facilitator.example',paymentRequestTimeoutMs:timeoutMs,limits:{},publisherToken:''};
 const calls={decode:0,ledger:0,verify:0,settle:0,pay:0};
 let mode=verifyMode;
 const runtime={
  decodePayment:async(payload,expected)=>{calls.decode++;return inspectStellarPayment(payload,expected,sdk);},
  latestLedger:async()=>{calls.ledger++;return 100;},
  verify:async(payload,requirements)=>{
   calls.verify++;
   const row=(await db.query('SELECT * FROM ads_compatibility WHERE payload_hash=$1',[sha256(payload)])).rows[0];
   assert(row);assert.equal(row.state,'VERIFYING');assert.equal(sha256(row.signed_payload),sha256(payload));
   assert.equal(row.start_ledger,100);assert.equal(row.expires_ledger,112);assert(row.auth_nonce);assert.match(row.auth_hash,/^[a-f0-9]{64}$/);
   assert(+new Date(row.verification_deadline)>clock.value);assert.equal(requirements.amount,'50000000');
   if(typeof mode==='function')return mode();
   if(mode==='throw')throw Error('explicit local facilitator timeout');
   if(mode==='hang')return new Promise(()=>{});
   if(mode==='reject')return {isValid:false,payer,invalidReason:'fixture_rejected',doNotEcho:payload};
   if(mode==='other')return {isValid:true,payer:other};
   if(mode==='malformed')return {isValid:'true',payer};
   return {isValid:true,payer};
  },
  settle:async()=>{calls.settle++;throw Error('Settlement must never be called by compatibility.');},
  pay:async()=>{calls.pay++;throw Error('Payment must never be called by compatibility.');}
 };
 const service=createCompatibilityService({db,config,runtime,now:()=>clock.value});
 const challenge=(key='compatibility-challenge-test',who=identity)=>service.challenge(who,{},key);
 async function assertNoFinancialWork(){
  for(const table of ['ads_orders','ads_payment_attempts','ads_outbox','ads_delivery','ads_refunds','ads_registry_jobs'])assert.equal(Number((await db.query('SELECT count(*) AS count FROM '+table)).rows[0].count),0,table);
  assert.equal(calls.settle,0);assert.equal(calls.pay,0);
 }
 return {db,config,clock,calls,runtime,service,challenge,assertNoFinancialWork,setMode:value=>{mode=value;}};
}

test('explicit local verify-only proof persists intent before facilitator verify and never settles, enqueues or enables checkout',async t=>{
 const f=await fixture(t),challenge=await f.challenge();
 assert.equal(challenge.expected.payer,payer);assert.equal(challenge.expected.amountUnits,'50000000');
 assert.equal(challenge.expected.payTo,f.config.payTo);assert.equal(challenge.expected.network,'stellar:testnet');assert.equal(challenge.expected.asset,ASSET);
 assert.equal(Date.parse(challenge.expiresAt)-f.clock.value,COMPATIBILITY_TTL_MS);
 assert.equal(challenge.expected.resourceUrl,f.config.origin+'/api/ads/compatibility/'+challenge.id+'/verify');
 assert.equal(challenge.challenge.accepts.length,1);assert.equal(challenge.challenge.accepts[0].maxTimeoutSeconds,60);assert.equal(challenge.challenge.accepts[0].extra.areFeesSponsored,true);
 assert.deepEqual(await f.challenge(),challenge);assert.equal(Number((await f.db.query('SELECT count(*) AS count FROM ads_compatibility')).rows[0].count),1);
 const payload=authorization(challenge),key='compatibility-verify-test';
 const result=await f.service.verify(identity,challenge.id,{payload},key);
 assert.equal(result.status,'VERIFIED');assert.equal(result.isValid,true);assert.equal(result.payer,payer);assert.equal(result.gateChanged,false);
 for(const key of ['payloadHash','authHash','requirementsHash','verificationHash'])assert.match(result.evidence[key],/^[a-f0-9]{64}$/);
 assert.equal(Object.hasOwn(result.evidence,'nonce'),false);
 assert.equal(JSON.stringify(result).includes(payload.payload.transaction),false);
 assert.doesNotMatch(JSON.stringify(result),/"(?:payload|signed_payload|transaction|nonce)"/);
 assert.deepEqual(await f.service.verify(identity,challenge.id,{payload},key),result);assert.equal(f.calls.verify,1);
 await assert.rejects(f.service.verify(identity,challenge.id,{payload},'new-verification-key'),error=>error.code==='compatibility_replay_conflict');
 await assert.rejects(f.service.verify(identity,challenge.id,{payload:authorization(challenge)},key),error=>error.code==='idempotency_conflict');
 assert.equal(f.config.walletCompatibilityVerified,false);assert.equal(f.config.enabled,false);await f.assertNoFinancialWork();
});

test('server challenge requirements are immutable and unsigned requests reuse one active draft',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.service.challenge(identity,{amountUnits:'1'},'tampered-challenge-key'),error=>error.code==='compatibility_request_invalid');
 await assert.rejects(f.service.challenge({ownerId:f.config.payTo,address:f.config.payTo,role:'operator'},{},'invalid-g-login-key'),error=>error.code==='compatibility_identity_required');
 const first=await f.challenge('quota-challenge-0001');const second=await f.challenge('quota-challenge-0002');assert.equal(first.id,second.id);assert.deepEqual(await f.challenge('quota-challenge-0001'),first);
 assert.equal(Number((await f.db.query('SELECT count(*) AS count FROM ads_compatibility')).rows[0].count),1);assert.equal((await f.service.status(identity)).quota.used,0);
 f.clock.value=Date.parse(first.expiresAt)+1;const third=await f.challenge('quota-challenge-0003');assert.notEqual(third.id,first.id);assert.equal((await f.service.status(identity)).quota.used,0);assert.equal(f.calls.verify,0);await f.assertNoFinancialWork();
});

test('another owner, stale challenge or changed receiver cannot reach decoding or external verification',async t=>{
 const f=await fixture(t),challenge=await f.challenge(),payload=authorization(challenge);
 await assert.rejects(f.service.verify(otherIdentity,challenge.id,{payload},'other-owner-key'),error=>error.code==='compatibility_unavailable');
 f.clock.value=Date.parse(challenge.expiresAt);
 await assert.rejects(f.service.verify(identity,challenge.id,{payload},'expired-proof-key'),error=>error.code==='compatibility_expired');
 assert.equal(f.calls.decode,0);assert.equal(f.calls.ledger,0);assert.equal(f.calls.verify,0);
 const second=await f.challenge('receiver-change-challenge');const secondPayload=authorization(second);
 f.config.payTo=sdk.Keypair.random().publicKey();
 await assert.rejects(f.service.verify(identity,second.id,{payload:secondPayload},'receiver-change-verify'),error=>error.code==='compatibility_configuration_changed');
 assert.equal(f.calls.verify,0);await f.assertNoFinancialWork();
});

test('resource, requirements and actual XDR tampering fail before any ledger or facilitator call',async t=>{
 const f=await fixture(t),challenge=await f.challenge(),base=authorization(challenge);
 const mutations=[
  payload=>{payload.accepted.amount='1';},payload=>{payload.accepted.payTo=sdk.Keypair.random().publicKey();},
  payload=>{payload.accepted.network='stellar:pubnet';},payload=>{payload.accepted.asset=other;},
  payload=>{payload.accepted.maxTimeoutSeconds=61;},payload=>{payload.accepted.extra.areFeesSponsored=false;},
  payload=>{payload.resource.url='https://foreign.example/verify';},payload=>{payload.resource.url=f.config.origin+'/api/ads/compatibility/other/verify';},
  payload=>{payload.payload.extra='untrusted instruction';},payload=>{payload.extra='untrusted instruction';},
  payload=>{payload.payload.transaction=authorization(challenge,{amount:'1'}).payload.transaction;},
  payload=>{payload.payload.transaction=authorization(challenge,{from:other}).payload.transaction;},
  payload=>{payload.payload.transaction=authorization(challenge,{asset:other}).payload.transaction;}
 ];
 for(let index=0;index<mutations.length;index++){
  const payload=structuredClone(base);mutations[index](payload);
  await assert.rejects(f.service.verify(identity,challenge.id,{payload},'tamper-verify-'+index),error=>error.status===422);
 }
 assert.equal(f.calls.ledger,0);assert.equal(f.calls.verify,0);
 assert.equal((await f.db.query('SELECT * FROM ads_compatibility')).rows[0].signed_payload,null);await f.assertNoFinancialWork();
});

test('authorization ledger expiry cannot exceed the declared sixty-second window or predate the current ledger',async t=>{
 const f=await fixture(t),challenge=await f.challenge();
 for(const expiresLedger of [99,113])await assert.rejects(f.service.verify(identity,challenge.id,{payload:authorization(challenge,{expiresLedger})},'ledger-bound-'+expiresLedger),error=>error.code==='compatibility_authorization_expired'&&error.details.verificationStarted===false);
 assert.equal(f.calls.verify,0);await f.assertNoFinancialWork();
});

test('facilitator rejection, wrong payer and malformed success cannot produce a verified proof',async t=>{
 const f=await fixture(t);
 for(const [index,mode,status,isValid] of [[1,'reject','REJECTED',false],[2,'other','REJECTED',false],[3,'malformed','RECONCILIATION_REQUIRED',null]]){
  f.setMode(mode);const challenge=await f.challenge('response-challenge-'+index);
  const result=await f.service.verify(identity,challenge.id,{payload:authorization(challenge)},'response-verify-'+index);
  assert.equal(result.status,status);assert.equal(result.isValid,isValid);assert.equal(result.gateChanged,false);
  assert.doesNotMatch(JSON.stringify(result),/"(?:payload|signed_payload|doNotEcho)"/);
 }
 assert.equal(f.calls.verify,3);await f.assertNoFinancialWork();
});

test('bounded facilitator timeout is durable and repeated or restarted requests never call it again',async t=>{
 const f=await fixture(t,{verifyMode:'hang',timeoutMs:5}),challenge=await f.challenge(),payload=authorization(challenge),key='timeout-verify-key';
 const result=await f.service.verify(identity,challenge.id,{payload},key);
 assert.equal(result.status,'RECONCILIATION_REQUIRED');assert.equal(result.isValid,null);assert.equal(f.calls.verify,1);
 f.clock.value=Date.parse(challenge.expiresAt)+1;
 const restarted=createCompatibilityService({db:f.db,config:f.config,runtime:f.runtime,now:()=>f.clock.value});
 assert.equal((await restarted.verify(identity,challenge.id,{payload},key)).status,'RECONCILIATION_REQUIRED');assert.equal(f.calls.verify,1);
 await f.assertNoFinancialWork();
});

test('two service instances return pending while one verifies and retain its successful proof without a duplicate external call',async t=>{
 const f=await fixture(t),challenge=await f.challenge(),payload=authorization(challenge),key='concurrent-verify-key';
 let release;const response=new Promise(resolve=>{release=resolve;});f.setMode(()=>response);
 const pending=f.service.verify(identity,challenge.id,{payload},key);
 while(f.calls.verify===0)await new Promise(resolve=>setImmediate(resolve));
 const otherInstance=createCompatibilityService({db:f.db,config:f.config,runtime:f.runtime,now:()=>f.clock.value});
 const duplicate=await otherInstance.verify(identity,challenge.id,{payload},key);
 assert.equal(duplicate.status,'VERIFYING');assert.equal(duplicate.isValid,null);assert.equal(f.calls.verify,1);
 release({isValid:true,payer});const verified=await pending;assert.equal(verified.status,'VERIFIED');
 assert.equal((await otherInstance.verify(identity,challenge.id,{payload},key)).status,'VERIFIED');assert.equal(f.calls.verify,1);
 await f.assertNoFinancialWork();
});

test('a recovered interrupted intent remains pending until its durable verification deadline and then fails closed',async t=>{
 const f=await fixture(t,{verifyMode:'throw'}),challenge=await f.challenge(),payload=authorization(challenge),key='interrupted-verify-key';
 await f.service.verify(identity,challenge.id,{payload},key);
 // Explicit crash fixture: the signed intent committed, but no verdict was saved.
 await f.db.query("UPDATE ads_compatibility SET state='VERIFYING',error_code=NULL WHERE id=$1",[challenge.id]);
 const row=(await f.db.query('SELECT * FROM ads_compatibility WHERE id=$1',[challenge.id])).rows[0];
 const restarted=createCompatibilityService({db:f.db,config:f.config,runtime:f.runtime,now:()=>f.clock.value});
 assert.equal((await restarted.verify(identity,challenge.id,{payload},key)).status,'VERIFYING');
 f.clock.value=+new Date(row.verification_deadline);
 assert.equal((await restarted.verify(identity,challenge.id,{payload},key)).status,'RECONCILIATION_REQUIRED');assert.equal(f.calls.verify,1);
 await f.assertNoFinancialWork();
});

test('one authorization nonce and hash cannot verify two independently issued challenges',async t=>{
 const f=await fixture(t),first=await f.challenge('first-nonce-challenge');
 await f.service.verify(identity,first.id,{payload:authorization(first,{nonce:'777'})},'first-nonce-verify');const second=await f.challenge('second-nonce-challenge');
 await assert.rejects(f.service.verify(identity,second.id,{payload:authorization(second,{nonce:'777'})},'second-nonce-verify'),error=>error.code==='compatibility_authorization_reused');
 assert.equal(f.calls.verify,1);await f.assertNoFinancialWork();
});

test('HTTP compatibility requires same origin, session and idempotency while ignoring client identity overrides',async t=>{
 const f=await fixture(t);let authenticated=0;
 const auth={authenticate:async()=>{authenticated++;return identity;}};
 const handler=createAdsHandler({config:f.config,db:f.db,auth,service:{},compatibility:f.service});
 const request=(path,{body={},key='http-compatibility-key',origin=f.config.origin}={})=>new Request(f.config.origin+'/api/ads'+path,{method:'POST',headers:{origin,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)});
 assert.equal((await handler(request('/compatibility/challenge',{origin:'https://foreign.example'}))).status,403);assert.equal(authenticated,0);
 assert.equal((await handler(request('/compatibility/challenge',{key:null}))).status,400);
 const challengeResponse=await handler(request('/compatibility/challenge'));assert.equal(challengeResponse.status,201);const challenge=await challengeResponse.json();
 const payload=authorization(challenge),path='/compatibility/'+challenge.id+'/verify';
 const spoofed=await handler(request(path,{key:'http-spoofed-identity',body:{payload,identity:otherIdentity}}));assert.equal(spoofed.status,400);assert.equal(f.calls.verify,0);
 const response=await handler(request(path,{key:'http-verify-original',body:{payload}}));assert.equal(response.status,200);assert.equal((await response.json()).status,'VERIFIED');
 assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.headers.get('payment-response'),null);assert.equal(response.headers.get('payment-required'),null);
 const unavailable=createAdsHandler({config:f.config,db:f.db,auth:{authenticate:async()=>{throw new AdsError(401,'authentication_required','Unauthenticated');}},service:{},compatibility:f.service});
 assert.equal((await unavailable(request('/compatibility/challenge'))).status,401);
 await f.assertNoFinancialWork();
});

test('runtime wiring shares the injected payment adapter with the isolated verification-only service',async t=>{
 const f=await fixture(t),auth={authenticate:async()=>identity};f.clock.value=Date.now();
 const application=createAdsRuntime({config:f.config,db:f.db,auth,storage:{},creative:{},paymentRuntime:f.runtime,refundRuntime:{},registryRuntime:{}});
 const request=(path,body,key)=>new Request(f.config.origin+'/api/ads'+path,{method:'POST',headers:{origin:f.config.origin,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});
 const issued=await application.handler(request('/compatibility/challenge',{},'runtime-challenge-key'));assert.equal(issued.status,201);
 const challenge=await issued.json(),payload=authorization(challenge);
 const response=await application.handler(request('/compatibility/'+challenge.id+'/verify',{payload},'runtime-verification-key'));
 assert.equal(response.status,200);assert.equal((await response.json()).status,'VERIFIED');assert.equal(f.calls.verify,1);
 await f.assertNoFinancialWork();
});


test('facilitator diagnostics accept only fixed tokens, never messages or filtered payload fragments',()=>{
 const known='invalid_exact_stellar_payload_unexpected_pending_signatures';
 assert.equal(safeVerificationReason(known),known);assert.equal(('facilitator_rejected:'+known).length,80);
 for(const value of [null,undefined,42,{},'unknown_reason','invalid_exact_stellar_payload_fee_exceeds_maximum\nPRIVATE_PAYLOAD','https://private.invalid','Bearer private-token','PRIVATE_XDR_FIXTURE','S'+'A'.repeat(55),'invalid_exact_stellar_payload_fee_exceeds_maximum '+('a'.repeat(100))])assert.equal(safeVerificationReason(value),null);
});

test('safe rejection reason is durable and private while generic code and idempotent verify remain stable',async t=>{
 const reason='invalid_exact_stellar_payload_fee_exceeds_maximum',f=await fixture(t,{verifyMode:()=>({isValid:false,payer,invalidReason:reason,invalidMessage:'PRIVATE_SIMULATION_DIAGNOSTIC',extra:{payload:'PRIVATE_XDR_FIXTURE'}})}),challenge=await f.challenge(),payload=authorization(challenge),key='safe-diagnostic-verify';
 const result=await f.service.verify(identity,challenge.id,{payload},key);assert.equal(result.errorCode,'facilitator_rejected');assert.equal(result.verificationReason,reason);assert.equal(result.status,'REJECTED');
 const row=(await f.db.query('SELECT error_code,verification_hash FROM ads_compatibility WHERE id=$1',[challenge.id])).rows[0];assert.equal(row.error_code,'facilitator_rejected:'+reason);assert.match(row.verification_hash,/^[0-9a-f]{64}$/);
 assert.deepEqual(await f.service.verify(identity,challenge.id,{payload},key),result);assert.equal(f.calls.verify,1);
 for(const value of [result,row])assert.doesNotMatch(JSON.stringify(value),/PRIVATE_SIMULATION_DIAGNOSTIC|PRIVATE_XDR_FIXTURE|invalidMessage|extra/);
 assert.equal(f.config.enabled,false);await f.assertNoFinancialWork();
});

test('unknown or payload-bearing reason cannot enter durable or private diagnostic output',async t=>{
 const f=await fixture(t,{verifyMode:()=>({isValid:false,payer,invalidReason:'invalid_exact_stellar_payload_fee_exceeds_maximum\nPRIVATE_XDR_FIXTURE',invalidMessage:'PRIVATE_DETAIL'})}),challenge=await f.challenge(),payload=authorization(challenge);
 const result=await f.service.verify(identity,challenge.id,{payload},'unsafe-diagnostic-verify'),row=(await f.db.query('SELECT error_code FROM ads_compatibility WHERE id=$1',[challenge.id])).rows[0];
 assert.equal(result.errorCode,'facilitator_rejected');assert(!Object.hasOwn(result,'verificationReason'));assert.equal(row.error_code,'facilitator_rejected');assert.doesNotMatch(JSON.stringify({result,row}),/PRIVATE_XDR_FIXTURE|PRIVATE_DETAIL/);await f.assertNoFinancialWork();
});


test('status restores one reusable unsigned challenge across keys and derives expiry without changing history',async t=>{
 const f=await fixture(t),empty=await f.service.status(identity);assert.equal(empty.quota.used,0);assert.equal(empty.attempt,null);assert.equal(empty.challenge,null);
 const [a,b]=await Promise.all([f.challenge('reusable-draft-key-1'),f.challenge('reusable-draft-key-2')]);assert.equal(a.id,b.id);assert.equal(a.verificationStarted,false);
 const active=await f.service.status(identity,{attemptId:a.id});assert.equal(active.attempt.verificationStarted,false);assert.equal(active.challenge.id,a.id);assert.equal(active.quota.remaining,3);
 f.clock.value=Date.parse(a.expiresAt)+1;const before=(await f.db.query('SELECT * FROM ads_compatibility ORDER BY id')).rows;
 const expired=await f.service.status(identity,{attemptId:a.id});assert.equal(expired.attempt.status,'EXPIRED');assert.equal(expired.challenge,null);assert.equal(expired.quota.used,0);assert.deepEqual((await f.db.query('SELECT * FROM ads_compatibility ORDER BY id')).rows,before);
 const replacement=await f.challenge('replacement-draft-key');assert.notEqual(replacement.id,a.id);assert.equal((await f.service.status(identity)).quota.used,0);
 await assert.rejects(f.service.status(otherIdentity,{attemptId:a.id}),error=>error.code==='compatibility_unavailable');assert.equal(f.calls.verify,0);assert.equal(f.calls.ledger,0);await f.assertNoFinancialWork();
});

test('four concurrent signed admissions share three hourly slots atomically across configurations',async t=>{
 const f=await fixture(t),issued=[];
 for(let index=0;index<4;index++){issued.push(await f.challenge('legacy-independent-draft-'+index));f.clock.value+=60001;}
 // Explicit local fixture for independent old-tab drafts: all are still admissible together.
 await f.db.query('UPDATE ads_compatibility SET expires_at=$1',[new Date(f.clock.value+60000)]);
 const outcomes=await Promise.allSettled(issued.map((c,index)=>f.service.verify(identity,c.id,{payload:authorization(c)},'concurrent-admission-'+index)));
 assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,3);const denied=outcomes.find(result=>result.status==='rejected').reason;assert.equal(denied.code,'compatibility_quota');assert.equal(denied.details.verificationStarted,false);assert.equal(denied.details.quota.used,3);assert.equal(denied.details.quota.remaining,0);assert.equal(denied.details.retryAt,new Date(f.clock.value+3600000).toISOString());assert.equal(f.calls.verify,3);
 f.config.facilitatorUrl='https://channels.openzeppelin.com/x402/testnet';const status=await f.service.status(identity);assert.equal(status.quota.used,3);assert.equal(status.quota.remaining,0);assert.equal(status.attempt.configurationMatches,false);assert.equal(status.challenge,null);await f.assertNoFinancialWork();
});

test('an admitted verdict after draft expiry stays definitive until its separate verification deadline',async t=>{
 const f=await fixture(t),challenge=await f.challenge();f.clock.value=Date.parse(challenge.expiresAt)-5;
 f.setMode(()=>{f.clock.value+=10;return{isValid:false,payer,invalidReason:'invalid_exact_stellar_payload_fee_below_minimum'};});
 const result=await f.service.verify(identity,challenge.id,{payload:authorization(challenge)},'late-admitted-verdict');assert.equal(result.status,'REJECTED');assert.equal(result.verificationStarted,true);assert.equal(result.verificationReason,'invalid_exact_stellar_payload_fee_below_minimum');assert.equal((await f.service.status(identity)).quota.used,1);await f.assertNoFinancialWork();
});

test('a lost verify response is recoverable by private read without another authorization or facilitator call',async t=>{
 const f=await fixture(t),challenge=await f.challenge(),payload=authorization(challenge);let release;const held=new Promise(resolve=>{release=resolve;});f.setMode(()=>held);
 const running=f.service.verify(identity,challenge.id,{payload},'lost-response-original');while(f.calls.verify===0)await new Promise(resolve=>setImmediate(resolve));
 const restarted=createCompatibilityService({db:f.db,config:f.config,runtime:f.runtime,now:()=>f.clock.value});
 try{const status=await restarted.status(identity,{attemptId:challenge.id});assert.equal(status.attempt.status,'VERIFYING');assert.equal(status.attempt.verificationStarted,true);assert.equal(status.quota.used,1);assert.equal(status.challenge,null);assert.doesNotMatch(JSON.stringify(status),/signed_payload|transaction|auth_nonce|verify_key|nonce/);assert(!JSON.stringify(status).includes(payload.payload.transaction));assert.equal(f.calls.verify,1);}
 finally{release({isValid:true,payer});await running;}
 f.config.facilitatorUrl='https://channels.openzeppelin.com/x402/testnet';const status=await restarted.status(identity,{attemptId:challenge.id});assert.equal(status.attempt.status,'VERIFIED');assert.equal(status.attempt.configurationMatches,false);assert.equal(f.calls.verify,1);await f.assertNoFinancialWork();
});


test('rejected and uncertain admissions retain their hourly slots measured from admission rather than draft creation',async t=>{
 const f=await fixture(t),firstStarted=f.clock.value;
 for(const [index,mode] of ['reject','throw','allow'].entries()){
  f.setMode(mode);const challenge=await f.challenge('mixed-admission-challenge-'+index);
  if(index===0)await f.db.query('UPDATE ads_compatibility SET created_at=$2 WHERE id=$1',[challenge.id,new Date(f.clock.value-7200000)]);
  const result=await f.service.verify(identity,challenge.id,{payload:authorization(challenge)},'mixed-admission-verify-'+index);assert.equal(result.verificationStarted,true);f.clock.value+=1000;
 }
 const status=await f.service.status(identity);assert.equal(status.quota.used,3);assert.equal(status.quota.remaining,0);assert.equal(status.quota.retryAt,new Date(firstStarted+3600000).toISOString());
 await assert.rejects(f.challenge('mixed-admission-limit'),error=>error.code==='compatibility_quota'&&error.details.verificationStarted===false&&error.details.quota.used===3);assert.equal(f.calls.verify,3);
 f.clock.value=firstStarted+3600000;assert.equal((await f.service.status(identity)).quota.used,2);assert.equal((await f.service.status(identity)).quota.remaining,1);await f.assertNoFinancialWork();
});
