import test from 'node:test';
import assert from 'node:assert/strict';
import { ADS_USDC } from '../dist/ads-wallet.mjs';
import { COMPATIBILITY_AMOUNT, validateCompatibilityConfig, validateCompatibilityChallenge, compatibilityVerdict, createCompatibilityApi, createCompatibilityController } from '../dist/ads-compatibility.mjs';
const origin='https://venue.example',address='C'+'A'.repeat(55),payTo='G'+'B'.repeat(55),id='11111111-1111-4111-8111-111111111111';
const hashA='a'.repeat(64),hashB='b'.repeat(64),resourceUrl=origin+'/api/ads/compatibility/'+id+'/verify';
const config={enabled:false,network:'stellar:testnet',asset:ADS_USDC,payTo,offers:[{id:'main-stage-test-5m',amountUnits:COMPATIBILITY_AMOUNT}]};
const expected={amountUnits:COMPATIBILITY_AMOUNT,payTo,asset:ADS_USDC,network:'stellar:testnet',payer:address,resourceUrl};
const challenge={x402Version:2,resource:{url:resourceUrl},accepts:[{scheme:'exact',network:'stellar:testnet',asset:ADS_USDC,amount:COMPATIBILITY_AMOUNT,payTo,maxTimeoutSeconds:60,extra:{areFeesSponsored:true}}]};
const diagnostic={id,challenge,expected,expiresAt:new Date(120000).toISOString()};
const verified={id,status:'VERIFIED',isValid:true,gateChanged:false,payer:address,evidence:{authHash:hashA,payloadHash:hashB,nonce:'must-stay-private',signedPayload:'MUST_NOT_APPEAR'}};
function fixture({diagnosticValue=diagnostic,verifyResult=verified,failedVerify=0,cancel=false}={}){
 const requests=[],events=[],views=[],payload={payload:{transaction:'PRIVATE_XDR_FIXTURE'}},clock={value:1000};let keys=0,verificationCalls=0,signs=0;
 const api=async(path,options={})=>{
  requests.push({path,...options});
  if(path==='/api/ads/config')return structuredClone(config);
  if(path==='/api/wallet/config')return {test:'public-wallet-config'};
  if(path==='/api/ads/compatibility/challenge')return structuredClone(diagnosticValue);
  if(path.endsWith('/verify')){verificationCalls++;if(verificationCalls<=failedVerify)throw Error('Network unavailable.');return structuredClone(verifyResult);}
  throw Error('Unexpected API: '+path);
 };
 const wallet={address,connect:async()=>{events.push('connect');return{address,credentialId:'existing-credential'};},authenticate:async()=>{events.push('authenticate');return{identity:{address,role:'advertiser'}};},signPayment:async value=>{signs++;events.push(['sign',value]);if(cancel)throw Object.assign(Error('cancelled'),{name:'NotAllowedError'});return payload;}};
 const controller=createCompatibilityController({api,walletFactory:async()=>wallet,origin,now:()=>clock.value,newKey:()=>`diagnostic-key-${++keys}`,onState:value=>views.push(value)});
 return {controller,requests,events,views,payload,clock,get signs(){return signs;},get verificationCalls(){return verificationCalls;}};
}

test('a disabled checkout still admits a pinned five-USDC Testnet diagnostic configuration',()=>{
 assert.equal(validateCompatibilityConfig(config).checkoutEnabled,false);
 for(const change of [{network:'stellar:pubnet'},{asset:'other'},{payTo:address},{offers:[{id:'main-stage-test-5m',amountUnits:'1'}]}])assert.throws(()=>validateCompatibilityConfig({...config,...change}),/diagnóstico/);
});

test('page load performs only configuration GET and human connect reuses one C wallet without funding or signing',async()=>{
 const f=fixture();await f.controller.load();assert.deepEqual(f.requests.map(item=>item.path),['/api/ads/config']);assert.deepEqual(f.events,[]);assert.equal(f.signs,0);
 await f.controller.connect();assert.deepEqual(f.events,['connect','authenticate']);assert.equal(f.controller.state.address,address);assert.equal(f.controller.state.connected,true);assert.equal(f.signs,0);
 assert.equal(f.requests.some(item=>item.path.includes('faucet')||item.path.includes('/pay')||item.method==='POST'),false);
});

test('the explicit verification action pins backend challenge and calls only verify, exposing hashes without signed data',async()=>{
 const f=fixture();await f.controller.load();await f.controller.connect();await f.controller.verify();
 assert.equal(f.signs,1);assert.equal(f.verificationCalls,1);assert.equal(f.controller.state.isValid,true);assert.equal(f.controller.state.phase,'verified');
 assert.deepEqual(f.events.find(item=>Array.isArray(item)),['sign',{challenge,expected}]);
 const posts=f.requests.filter(item=>item.method==='POST');assert.deepEqual(posts.map(item=>item.path),['/api/ads/compatibility/challenge','/api/ads/compatibility/'+id+'/verify']);assert.deepEqual(posts[0].body,{});assert.deepEqual(posts[1].body,{payload:f.payload});assert.notEqual(posts[0].key,posts[1].key);
 assert.deepEqual(f.controller.state.evidence,{authHash:hashA,payloadHash:hashB});
 const publicViews=JSON.stringify(f.views);for(const secret of ['PRIVATE_XDR_FIXTURE','must-stay-private','MUST_NOT_APPEAR'])assert.equal(publicViews.includes(secret),false);
 assert.equal(f.requests.some(item=>item.path.includes('/pay')||item.path.includes('settle')||item.path.includes('faucet')),false);
 assert.equal(config.enabled,false,'the diagnostic never changes checkout configuration');
});

test('changed recipient, amount, payer, network, resource or expiry is refused before the passkey signature',async()=>{
 const candidates=[{...diagnostic,expected:{...expected,payTo:'G'+'C'.repeat(55)}},{...diagnostic,expected:{...expected,amountUnits:'1'}},{...diagnostic,expected:{...expected,payer:'C'+'B'.repeat(55)}},{...diagnostic,expected:{...expected,network:'stellar:pubnet'}},{...diagnostic,expected:{...expected,resourceUrl:'https://evil.example/verify'}},{...diagnostic,challenge:{...challenge,accepts:[{...challenge.accepts[0],amount:'50000001'}]}},{...diagnostic,expiresAt:new Date(1000).toISOString()}];
 for(const diagnosticValue of candidates){const f=fixture({diagnosticValue});await f.controller.connect();await f.controller.verify();assert.equal(f.controller.state.phase,'error');assert.equal(f.signs,0);assert.equal(f.verificationCalls,0);}
 assert.equal(validateCompatibilityChallenge(diagnostic,validateCompatibilityConfig(config),address,origin,1000),diagnostic);
});

test('a lost verify response reuses the same payload and key without another signature or challenge',async()=>{
 const f=fixture({failedVerify:1});await f.controller.connect();await f.controller.verify();assert.equal(f.controller.state.retry,true);assert.equal(f.controller.state.phase,'error');
 await f.controller.verify();assert.equal(f.signs,1);assert.equal(f.verificationCalls,2);assert.equal(f.requests.filter(item=>item.path.endsWith('/challenge')).length,1);
 const verifies=f.requests.filter(item=>item.path.endsWith('/verify'));assert.equal(verifies[0].body.payload,verifies[1].body.payload);assert.equal(verifies[0].key,verifies[1].key);assert.equal(f.controller.state.phase,'verified');
});

test('cancelled passkey and an unauthenticated action never send a signed payload for verification',async()=>{
 const unauthenticated=fixture();await unauthenticated.controller.verify();assert.equal(unauthenticated.requests.length,0);assert.equal(unauthenticated.signs,0);
 const f=fixture({cancel:true});await f.controller.connect();await f.controller.verify();assert.equal(f.signs,1);assert.equal(f.verificationCalls,0);assert.match(f.controller.state.message,/canceló/);assert.equal(f.controller.state.isValid,null);
});

test('a valid verdict requires the same challenge, payer and both evidence hashes; rejection remains distinct',()=>{
 assert.deepEqual(compatibilityVerdict(verified,id,address),{isValid:true,waiting:false,evidence:{authHash:hashA,payloadHash:hashB}});
 for(const change of [{id:'other'},{payer:payTo},{isValid:'true'},{status:'unknown'},{gateChanged:true},{evidence:{authHash:hashA}}])assert.throws(()=>compatibilityVerdict({...verified,...change},id,address),/respuesta/);
 assert.deepEqual(compatibilityVerdict({id,status:'REJECTED',isValid:false,gateChanged:false,evidence:{payloadHash:hashB}},id,address),{isValid:false,waiting:false,evidence:{payloadHash:hashB}});
});

test('API keeps a diagnostic same-origin and no-store, and never reflects raw backend error payloads',async()=>{
 const calls=[],api=createCompatibilityApi({fetchImpl:async(path,options)=>{calls.push({path,options});return Response.json({error:{code:'verification_rejected',message:'PRIVATE_XDR_BACKEND'}},{status:422});}});
 await assert.rejects(api('/api/ads/compatibility/'+id+'/verify',{method:'POST',body:{payload:'private'},key:'same-key'}),error=>error.code==='verification_rejected'&&!error.message.includes('PRIVATE_XDR_BACKEND'));
 assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.headers['Idempotency-Key'],'same-key');
});


test('an uncertain 202 remains pending after expiry and never requests another signature',async()=>{
 const result={id,status:'RECONCILIATION_REQUIRED',isValid:null,gateChanged:false,payer:address,evidence:{payloadHash:hashB,authHash:hashA}},f=fixture({verifyResult:result});
 await f.controller.connect();await f.controller.verify();assert.equal(f.controller.state.phase,'pending');assert.equal(f.controller.state.isValid,null);assert.equal(f.controller.state.retry,true);
 f.clock.value=130000;await f.controller.verify();assert.equal(f.controller.state.phase,'pending');assert.equal(f.signs,1);assert.equal(f.requests.filter(item=>item.path.endsWith('/challenge')).length,1);
 const requests=f.requests.filter(item=>item.path.endsWith('/verify'));assert.equal(requests[0].key,requests[1].key);assert.equal(requests[0].body.payload,requests[1].body.payload);
 assert.equal(JSON.stringify(f.controller.state).includes('PRIVATE_XDR_FIXTURE'),false);
});


test('private rejection detail uses only constant user messages for recognized tokens',async()=>{
 const reason='invalid_exact_stellar_payload_fee_exceeds_maximum',base={id,status:'REJECTED',isValid:false,gateChanged:false,errorCode:'facilitator_rejected',evidence:{payloadHash:hashB}},f=fixture({verifyResult:{...base,verificationReason:reason,invalidMessage:'PRIVATE_RAW_FEE_MESSAGE'}});
 await f.controller.connect();await f.controller.verify();assert.equal(f.controller.state.phase,'rejected');assert.match(f.controller.state.message,/comisión estimada supera el límite del facilitador/);assert.equal(f.signs,1);assert.equal(f.verificationCalls,1);assert.doesNotMatch(JSON.stringify(f.views),/PRIVATE_RAW_FEE_MESSAGE/);
 for(const detail of [{verificationReason:reason+' PRIVATE_XDR_FIXTURE'},{verificationReason:'toString'},{verificationReason:reason,errorCode:'other'}]){
  const value={...base,...detail};assert(!Object.hasOwn(compatibilityVerdict(value,id,address),'verificationReason'));const unsafe=fixture({verifyResult:value});await unsafe.controller.connect();await unsafe.controller.verify();assert.doesNotMatch(JSON.stringify(unsafe.views),/PRIVATE_XDR_FIXTURE|comisión estimada/);
 }
 assert(!Object.hasOwn(compatibilityVerdict({...verified,verificationReason:reason,errorCode:'facilitator_rejected'},id,address),'verificationReason'));
});
