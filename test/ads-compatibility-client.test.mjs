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
  if(path==='/api/ads/auth/me')throw Object.assign(Error('No session'),{status:401});
  if(path.startsWith('/api/ads/compatibility/status'))return {serverTime:new Date(clock.value).toISOString(),quota:{limit:3,used:verificationCalls?1:0,remaining:verificationCalls?2:3,retryAt:null},attempt:verificationCalls?{...structuredClone(verifyResult),verificationStarted:true}:null,challenge:null};
  if(path==='/api/ads/compatibility/challenge')return structuredClone(diagnosticValue);
  if(path.endsWith('/verify')){verificationCalls++;if(verificationCalls<=failedVerify)throw Error('Network unavailable.');return structuredClone(verifyResult);}
  throw Error('Unexpected API: '+path);
 };
 const wallet={address,connect:async()=>{events.push('connect');return{address,credentialId:'existing-credential'};},authenticate:async()=>{events.push('authenticate');return{identity:{address,role:'advertiser'}};},preparePayment:async value=>{events.push(['prepare',value]);return Object.freeze({});},signPayment:async value=>{signs++;events.push(['sign',value]);if(cancel)throw Object.assign(Error('cancelled'),{name:'NotAllowedError'});return payload;}};
 const controller=createCompatibilityController({api,walletFactory:async()=>wallet,origin,now:()=>clock.value,newKey:()=>`diagnostic-key-${++keys}`,onState:value=>views.push(value)});
 return {controller,requests,events,views,payload,clock,get signs(){return signs;},get verificationCalls(){return verificationCalls;}};
}

test('a disabled checkout still admits a pinned five-USDC Testnet diagnostic configuration',()=>{
 assert.equal(validateCompatibilityConfig(config).checkoutEnabled,false);
 for(const change of [{network:'stellar:pubnet'},{asset:'other'},{payTo:address},{offers:[{id:'main-stage-test-5m',amountUnits:'1'}]}])assert.throws(()=>validateCompatibilityConfig({...config,...change}),/diagnóstico/);
});

test('page load checks config and session by GET; explicit connect reuses one C wallet without funding',async()=>{
 const f=fixture();await f.controller.load();assert.deepEqual(f.requests.map(item=>item.path),['/api/ads/config','/api/ads/auth/me']);assert.deepEqual(f.events,[]);assert.equal(f.signs,0);
 await f.controller.connect();assert.deepEqual(f.events,['connect','authenticate']);assert.equal(f.controller.state.address,address);assert.equal(f.controller.state.connected,true);assert.equal(f.signs,0);
 assert.equal(f.requests.some(item=>item.path.includes('faucet')||item.path.includes('/pay')||item.method==='POST'),false);
});

test('the explicit verification action pins backend challenge and calls only verify, exposing hashes without signed data',async()=>{
 const f=fixture();await f.controller.load();await f.controller.connect();await f.controller.verify();
 assert.equal(f.signs,1);assert.equal(f.verificationCalls,1);assert.equal(f.controller.state.isValid,true);assert.equal(f.controller.state.phase,'verified');
 const signed=f.events.find(item=>Array.isArray(item)&&item[0]==='sign');assert.deepEqual(signed[1].challenge,challenge);assert.deepEqual(signed[1].expected,expected);assert(signed[1].prepared);assert(f.events.findIndex(item=>Array.isArray(item)&&item[0]==='prepare')<f.events.findIndex(item=>Array.isArray(item)&&item[0]==='sign'));
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

test('a lost verify response recovers with GET without another payload POST, signature or challenge',async()=>{
 const f=fixture({failedVerify:1});await f.controller.connect();await f.controller.verify();assert.equal(f.controller.state.retry,true);assert.equal(f.controller.state.phase,'error');
 await f.controller.verify();assert.equal(f.signs,1);assert.equal(f.verificationCalls,1);assert.equal(f.requests.filter(item=>item.path.endsWith('/challenge')).length,1);
 const verifies=f.requests.filter(item=>item.path.endsWith('/verify'));assert.equal(verifies.length,1);assert(f.requests.some(item=>item.path.includes('/status?attemptId=')));assert.equal(f.controller.state.phase,'verified');
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
 const requests=f.requests.filter(item=>item.path.endsWith('/verify'));assert.equal(requests.length,1);assert(f.requests.some(item=>item.path.includes('/status?attemptId=')));
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

test('restored pending session is read only and refresh recovery never signs or posts',async()=>{
 const paths=[];let factories=0;const response={serverTime:new Date(1000).toISOString(),quota:{limit:3,used:0,remaining:3,retryAt:null},attempt:{id,status:'VERIFYING',isValid:null,gateChanged:false,payer:address,verificationStarted:true,evidence:{}},challenge:null};
 const api=async(path,options={})=>{paths.push([path,options.method||'GET']);if(path==='/api/ads/config')return config;if(path==='/api/ads/auth/me')return{identity:{address}};if(path.startsWith('/api/ads/compatibility/status'))return response;throw Error('Unexpected request');};
 const c=createCompatibilityController({api,walletFactory:async()=>{factories++;throw Error('must stay read only');},origin,now:()=>1000});await c.load();assert.equal(c.state.connected,true);assert.equal(c.state.walletReady,false);assert.equal(c.state.retry,true);await c.verify();assert.equal(factories,0);assert(paths.every(([,method])=>method==='GET'));assert.equal(paths.filter(([path])=>path.includes('/status')).length,2);
});
test('quota errors carry a sane Retry-After clock without raw backend messages',async()=>{
 const retryAt='2026-10-26T10:00:00.000Z',serverTime='2026-10-26T09:30:00.000Z',api=createCompatibilityApi({fetchImpl:async()=>Response.json({error:{code:'compatibility_quota',message:'PRIVATE_PAYLOAD',details:{serverTime,quota:{limit:3,used:3,remaining:0,retryAt},retryAt,verificationStarted:false}}},{status:429,headers:{'Retry-After':'1800'}})});
 await assert.rejects(api('/api/ads/compatibility/challenge',{method:'POST',body:{},key:'fixture-key'}),error=>error.status===429&&error.retryAt===retryAt&&error.retryAfterSeconds===1800&&!error.message.includes('PRIVATE_PAYLOAD'));
});

function timedFixture({prepareDelay=0,cancelCount=0,lostChallenge=false,verifyError=null}={}){
 const base=Date.parse('2026-10-26T09:00:00Z'),time={local:900000},initial=time.local,events=[],requests=[],opaque=Object.freeze({});let issued=null,attempt=null,number=0,signs=0,failIssue=lostChallenge;
 const serverNow=()=>base+time.local-initial;
 const status=()=>({serverTime:new Date(serverNow()).toISOString(),quota:{limit:3,used:attempt?.verificationStarted?1:0,remaining:attempt?.verificationStarted?2:3,retryAt:null},attempt:attempt?{...attempt,status:attempt.status==='PENDING'&&Date.parse(issued.expiresAt)<=serverNow()?'EXPIRED':attempt.status}:null,challenge:attempt?.status==='PENDING'&&Date.parse(issued.expiresAt)>serverNow()?issued:null});
 const wallet={address,connect:async()=>({address}),authenticate:async()=>({identity:{address}}),preparePayment:async()=>{events.push('prepare');time.local+=prepareDelay;return opaque;},signPayment:async input=>{events.push('sign');signs++;assert.equal(input.prepared,opaque);if(signs<=cancelCount)throw Object.assign(Error('cancelled'),{name:'NotAllowedError'});return{payload:{transaction:'PRIVATE_TIMED_XDR'}};}};
 const api=async(path,options={})=>{requests.push({path,...options});if(path==='/api/ads/config')return config;if(path==='/api/wallet/config')return{};if(path==='/api/ads/auth/me')throw Object.assign(Error('no session'),{status:401});if(path.startsWith('/api/ads/compatibility/status'))return status();if(path.endsWith('/challenge')){events.push('challenge');number++;const nextId='11111111-1111-4111-8111-'+String(number).padStart(12,'0'),url=origin+'/api/ads/compatibility/'+nextId+'/verify';issued={id:nextId,serverTime:new Date(serverNow()).toISOString(),expiresAt:new Date(serverNow()+60000).toISOString(),expected:{...expected,resourceUrl:url},challenge:{...challenge,resource:{url}}};attempt={id:nextId,status:'PENDING',payer:address,verificationStarted:false,configurationMatches:true};if(failIssue){failIssue=false;throw Error('lost challenge response');}return issued;}if(path.endsWith('/verify')){if(verifyError)throw verifyError;attempt={...verified,id:issued.id,verificationStarted:true};return attempt;}throw Error('Unexpected request');};
 const c=createCompatibilityController({api,walletFactory:async()=>wallet,origin,now:()=>time.local,newKey:(()=>{let n=0;return()=>('timed-key-'+(++n));})()});return{c,time,events,requests,get issued(){return issued;},get signs(){return signs;}};
}
test('preparation precedes the sixty-second challenge and server time ignores the local clock epoch',async()=>{
 const f=timedFixture({prepareDelay:35000});await f.c.connect();await f.c.verify();assert.deepEqual(f.events,['prepare','challenge','sign']);assert.equal(Date.parse(f.issued.expiresAt)-Date.parse(f.issued.serverTime),60000);assert.equal(f.c.state.phase,'verified');assert.equal(f.signs,1);
});
test('cancelled ceremonies reuse the unsubmitted challenge and show a server-anchored countdown',async()=>{
 const f=timedFixture({cancelCount:2});await f.c.connect();await f.c.verify();assert.equal(f.c.state.remainingMs,60000);f.time.local+=1000;f.c.tick();assert.equal(f.c.state.remainingMs,59000);await f.c.verify();assert.equal(f.requests.filter(r=>r.path.endsWith('/challenge')).length,1);assert.equal(f.requests.filter(r=>r.path.endsWith('/verify')).length,0);assert.equal(f.c.state.quota.used,0);assert.equal(f.signs,2);
});
test('lost challenge response followed by expiry retires the old key and recovers on an explicit action',async()=>{
 const f=timedFixture({lostChallenge:true});await f.c.connect();await f.c.verify();assert.equal(f.signs,0);f.time.local+=61000;await f.c.verify();const issues=f.requests.filter(r=>r.path.endsWith('/challenge'));assert.equal(issues.length,2);assert.notEqual(issues[0].key,issues[1].key);assert.equal(f.signs,1);assert.equal(f.c.state.phase,'verified');
});
test('definite pre-dispatch expiry clears the payload while a 401 requires reconnecting',async()=>{
 const expired=timedFixture({verifyError:Object.assign(Error('expired'),{status:422,verificationStarted:false})});await expired.c.connect();await expired.c.verify();assert.equal(expired.c.state.retry,false);assert.equal(expired.c.state.isValid,null);
 const unauth=timedFixture({verifyError:Object.assign(Error('session expired'),{status:401})});await unauth.c.connect();await unauth.c.verify();assert.equal(unauth.c.state.connected,false);assert.equal(unauth.c.state.walletReady,false);assert.equal(unauth.c.state.retry,true);assert.equal(unauth.requests.filter(r=>r.path.endsWith('/verify')).length,1);
});
test('fee below minimum is a fixed private diagnostic message',()=>{
 const result=compatibilityVerdict({id,status:'REJECTED',isValid:false,gateChanged:false,errorCode:'facilitator_rejected',verificationReason:'invalid_exact_stellar_payload_fee_below_minimum',invalidMessage:'PRIVATE_RAW'},id,address);assert.equal(result.verificationReason,'invalid_exact_stellar_payload_fee_below_minimum');assert(!JSON.stringify(result).includes('PRIVATE_RAW'));
});

test('a nearly expired reusable challenge waits for its clock instead of asking for a doomed signature',async()=>{
 const f=timedFixture({cancelCount:1});await f.c.connect();await f.c.verify();f.time.local+=40000;await f.c.verify();assert.equal(f.signs,1);assert.equal(f.c.state.remainingMs,20000);assert.match(f.c.state.message,/Espera/);assert.equal(f.requests.filter(r=>r.path.endsWith('/challenge')).length,1);
});
