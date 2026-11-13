import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync,createHash,sign } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createAuthService,IDENTITY_SESSION_COOKIE } from '../server/identity/auth.mjs';
import { validateAuthority } from '../server/identity/wallet-authority.mjs';
import { createResourceBudget } from '../server/reservations/resources.mjs';
import { createApi } from '../server/reservations/http.mjs';
import { testDatabase,testConfig,address } from './reservations-support.test.mjs';
import { ServiceError } from '../server/identity/common.mjs';
async function setup(t) {
  const db=await testDatabase();t.after(()=>db.close());const config=testConfig();let time=Date.now(),calls=0,counter=1;
  const jwk=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({format:'jwk'}),publicKey=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('base64url');
  const snapshot={publicKey,authorityHash:'a'.repeat(64),ruleId:0};
  const authority={async read(){calls++;return {...snapshot};}};
  const resources=createResourceBudget({db,config,now:()=>time});
  const verifier={async generateAuthenticationOptions(value){return{...value,challenge:Buffer.from(value.challenge).toString('base64url')};},async verifyAuthenticationResponse(value){assert.equal(value.expectedOrigin,config.origin);assert.equal(value.expectedRPID,config.rpId);assert.equal(value.requireUserVerification,true);return{verified:true,authenticationInfo:{userVerified:true,newCounter:counter}};}};
  const auth=createAuthService({db,config,authority,verifier,now:()=>time,beforeAuthority:context=>resources.auth(context)});
  return{db,config,auth,snapshot,resources,get calls(){return calls;},tick(ms){time+=ms;},counter(value){counter=value;}};
}
test('authentication limits reserve 10/IP and 60 global before any authority RPC',async t=>{
  const f=await setup(t);
  for(let i=0;i<10;i++)await f.auth.challenge({address:address(i+1),credentialId:'YQ'},{ip:'ip-1'});
  assert.equal(f.calls,10);await assert.rejects(f.auth.challenge({address:address(25),credentialId:'YQ'},{ip:'ip-1'}),error=>error.code==='RATE_LIMIT');assert.equal(f.calls,10);
  for(let group=2;group<=6;group++)for(let i=0;i<10;i++)await f.auth.challenge({address:address(group*10+i),credentialId:'YQ'},{ip:'ip-'+group});
  assert.equal(f.calls,60);await assert.rejects(f.auth.challenge({address:address(100),credentialId:'YQ'},{ip:'fresh-ip'}),error=>error.code==='RATE_LIMIT');assert.equal(f.calls,60);
});
test('one-use 120s challenge and 30min cookie, role derived from configured wallet',async t=>{
  const f=await setup(t),challenge=await f.auth.challenge({address:f.config.hostAddress,credentialId:'YQ'},{ip:'one'});
  assert.equal(challenge.options.timeout,120000);
  const result=await f.auth.verify({challengeId:challenge.challengeId,response:{id:'YQ',type:'public-key'}},{ip:'one'});
  assert.equal(result.identity.role,'host');assert.match(result.cookie,/Max-Age=1800/);assert.match(result.cookie,/HttpOnly; Secure; SameSite=Strict/);
  const request=new Request(f.config.origin+'/api/reservations/project',{headers:{Cookie:IDENTITY_SESSION_COOKIE+'='+result.token}});
  assert.equal((await f.auth.authenticate(request,{ip:'one'})).role,'host');
  await assert.rejects(f.auth.verify({challengeId:challenge.challengeId,response:{id:'YQ',type:'public-key'}},{ip:'one'}),error=>error.code==='AUTH_CHALLENGE_EXPIRED');
  const expiring=await f.auth.challenge({address:address(5),credentialId:'YQ'},{ip:'two'});f.tick(120001);
  await assert.rejects(f.auth.verify({challengeId:expiring.challengeId,response:{id:'YQ',type:'public-key'}},{ip:'two'}),error=>error.code==='AUTH_CHALLENGE_EXPIRED');
  f.tick(1800001);await assert.rejects(f.auth.authenticate(request,{ip:'one'}),error=>error.code==='SESSION_EXPIRED');
});
test('changed authority consumes challenge and invalidates old sessions; wrong origin is rejected',async t=>{
  const f=await setup(t),challenge=await f.auth.challenge({address:address(4),credentialId:'YQ'},{ip:'one'});
  const result=await f.auth.verify({challengeId:challenge.challengeId,response:{id:'YQ',type:'public-key'}},{ip:'one'});assert.equal(result.identity.role,'brand');
  const request=new Request(f.config.origin+'/api/reservations/project',{method:'PUT',headers:{Origin:'https://other.invalid',Cookie:IDENTITY_SESSION_COOKIE+'='+result.token}});
  const before=f.calls;await assert.rejects(f.auth.authenticate(request,{ip:'one'}),error=>error.code==='ORIGIN_REJECTED');assert.equal(f.calls,before);
  const pending=await f.auth.challenge({address:address(4),credentialId:'YQ'},{ip:'one'});f.snapshot.authorityHash='b'.repeat(64);
  await assert.rejects(f.auth.verify({challengeId:pending.challengeId,response:{id:'YQ',type:'public-key'}},{ip:'one'}),error=>error.code==='WALLET_AUTHORITY_CHANGED');
  await assert.rejects(f.auth.verify({challengeId:pending.challengeId,response:{id:'YQ',type:'public-key'}},{ip:'one'}),error=>error.code==='AUTH_CHALLENGE_EXPIRED');
  await assert.rejects(f.auth.authenticate(new Request(f.config.origin,{headers:{Cookie:IDENTITY_SESSION_COOKIE+'='+result.token}}),{ip:'one'}),error=>error.code==='WALLET_AUTHORITY_CHANGED');
  assert.ok((await f.db.query('SELECT revoked_at FROM identity_sessions')).rows[0].revoked_at);
});
test('wallet authority requires actual original rule 0 and exact on-chain credential',async t=>{
  const f=await setup(t),raw=Buffer.from(f.snapshot.publicKey,'base64url');
  const rule={id:0,context_type:{tag:'Default'},signers:[{tag:'External',values:[f.config.webauthnVerifier,Buffer.concat([raw,Buffer.from('a')])]}],policies:[]};
  const input={address:address(4),credentialId:'YQ',codeHash:f.config.accountWasmHash,rules:[rule],ledger:100};
  assert.equal(validateAuthority(input,f.config).ruleId,0);
  assert.throws(()=>validateAuthority({...input,rules:[{...rule,id:7}]},f.config),error=>error.code==='WALLET_AUTHORITY_UNSUPPORTED');
  assert.throws(()=>validateAuthority({...input,credentialId:'Yg'},f.config),error=>error.code==='WALLET_CREDENTIAL_MISMATCH');
  assert.throws(()=>validateAuthority({...input,rules:[rule,rule]},f.config),error=>error.code==='WALLET_AUTHORITY_UNSUPPORTED');
});
test('logout revokes an expired session without authority RPC; DB failure still clears the browser cookie',async t=>{
  const f=await setup(t),challenge=await f.auth.challenge({address:address(4),credentialId:'YQ'},{ip:'one'}),result=await f.auth.verify({challengeId:challenge.challengeId,response:{id:'YQ',type:'public-key'}},{ip:'one'});
  f.tick(1800001);const before=f.calls,handler=createApi(f);
  const request=()=>new Request(f.config.origin+'/api/reservations/auth/logout',{method:'POST',headers:{Origin:f.config.origin,Cookie:IDENTITY_SESSION_COOKIE+'='+result.token}});
  let response=await handler(request(),{ip:'one'});assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/Max-Age=0/);assert.equal(f.calls,before);assert.ok((await f.db.query('SELECT revoked_at FROM identity_sessions')).rows[0].revoked_at);
  const broken=createApi({...f,auth:{async logout(){throw Error('DB unavailable');}}});response=await broken(request(),{ip:'one'});assert.equal(response.status,503);assert.match(response.headers.get('set-cookie'),/Max-Age=0/);assert.equal((await response.json()).ok,undefined);
});
test('normal authenticated flow and recovery do not consume login limits; session revalidation is independently bounded',async t=>{
  const f=await setup(t),challenge=await f.auth.challenge({address:f.config.hostAddress,credentialId:'YQ'},{ip:'one'}),result=await f.auth.verify({challengeId:challenge.challengeId,response:{id:'YQ',type:'public-key'}},{ip:'one'});
  const request=new Request(f.config.origin+'/api/reservations/auth/session',{headers:{Cookie:IDENTITY_SESSION_COOKIE+'='+result.token}});
  for(let i=0;i<60;i++)assert.equal((await f.auth.authenticate(request,{ip:'one'})).address,f.config.hostAddress);
  const calls=f.calls;await assert.rejects(f.auth.authenticate(request,{ip:'one'}),error=>error.code==='RATE_LIMIT');assert.equal(f.calls,calls);
  // Login still has the untouched remaining eight slots for this IP/minute.
  for(let i=0;i<8;i++)await f.auth.challenge({address:address(i+10),credentialId:'YQ'},{ip:'one'});
  const after=f.calls;await assert.rejects(f.auth.challenge({address:address(50),credentialId:'YQ'},{ip:'one'}),error=>error.code==='RATE_LIMIT');assert.equal(f.calls,after);
});

async function quotaBackedAuth(t) {
  const original=await testDatabase();t.after(()=>original.close());const scope=new AsyncLocalStorage(),config=testConfig();
  let providerInsideTransaction=0,failAuthority=false,failSessionInsert=false,authorityCalls=0,verificationBarrier=null;
  const db={...original,transaction:work=>original.transaction(tx=>scope.run(true,()=>work({query(sql,args){if(failSessionInsert&&sql.startsWith('INSERT INTO identity_sessions'))throw Error('Simulated session persistence failure');return tx.query(sql,args);}})))};
  const resources=createResourceBudget({db,config}),pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=pair.publicKey.export({format:'jwk'});
  const publicKey=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('base64url');
  const sdk=await import('@simplewebauthn/server');
  const authority={async read(){authorityCalls++;if(scope.getStore()){providerInsideTransaction++;throw new ServiceError(503,'PROVIDER_TRANSACTION_NESTING','Authority must not hold a database transaction while acquiring quota.');}await resources.reserve([{resource:'rpcAuthCalls'}]);if(failAuthority)throw Error('Simulated RPC outage');return{publicKey,authorityHash:'a'.repeat(64),ruleId:0};}};
  const verifier={generateAuthenticationOptions:sdk.generateAuthenticationOptions,async verifyAuthenticationResponse(options){assert.equal(scope.getStore(),undefined,'Local signature verification must also run outside the owner transaction');const result=await sdk.verifyAuthenticationResponse(options);if(verificationBarrier)await verificationBarrier();return result;}};
  const auth=createAuthService({db,config,authority,verifier,beforeAuthority:context=>resources.auth(context)});
  function assertion(challenge,counter=1){
    const clientDataJSON=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:challenge.options.challenge,origin:config.origin,crossOrigin:false}));
    const authData=Buffer.alloc(37);createHash('sha256').update(config.rpId).digest().copy(authData);authData[32]=0x05;authData.writeUInt32BE(counter,33);
    const signature=sign('sha256',Buffer.concat([authData,createHash('sha256').update(clientDataJSON).digest()]),pair.privateKey);
    return{id:'YQ',rawId:'YQ',type:'public-key',clientExtensionResults:{},response:{clientDataJSON:clientDataJSON.toString('base64url'),authenticatorData:authData.toString('base64url'),signature:signature.toString('base64url'),userHandle:null}};
  }
  return{db,config,auth,resources,assertion,get nested(){return providerInsideTransaction;},get authorityCalls(){return authorityCalls;},failAuthority(value){failAuthority=value;},failSessionInsert(value){failSessionInsert=value;},setBarrier(value){verificationBarrier=value;}};
}

test('eight concurrent verifications acquire authority quota on the same DB outside challenge/session transactions',async t=>{
  const f=await quotaBackedAuth(t),challenges=[];
  for(let i=0;i<8;i++)challenges.push(await f.auth.challenge({address:address(i+1),credentialId:'YQ'},{ip:'wallet-'+i}));
  const results=await Promise.allSettled(challenges.map((challenge,i)=>f.auth.verify({challengeId:challenge.challengeId,response:f.assertion(challenge)},{ip:'wallet-'+i})));
  assert.equal(f.nested,0,'A transaction held during authority.read would deadlock its nested PGlite quota transaction or exhaust the native PG pool.');
  assert.deepEqual(results.map(result=>result.status),Array(8).fill('fulfilled'));
  assert.equal((await f.db.query('SELECT count(*)::int AS count FROM identity_sessions')).rows[0].count,8);
  assert.equal((await f.db.query('SELECT count(*)::int AS count FROM identity_challenges WHERE consumed_at IS NOT NULL')).rows[0].count,8);
  assert.equal(Number((await f.db.query('SELECT used FROM resource_limits WHERE key=$1',['coverage:'+f.config.coverage.id+':rpcAuthCalls'])).rows[0].used),16);
});
test('concurrent real WebAuthn assertions recheck the latest sign counter under the final owner lock',async t=>{
  const f=await quotaBackedAuth(t),first=await f.auth.challenge({address:f.config.hostAddress,credentialId:'YQ'},{ip:'one'});
  await f.auth.verify({challengeId:first.challengeId,response:f.assertion(first,1)},{ip:'one'});
  const challenges=[];for(let i=0;i<4;i++)challenges.push(await f.auth.challenge({address:f.config.hostAddress,credentialId:'YQ'},{ip:'one'}));
  let arrived=0,releasedAt=0,release;const barrier=new Promise(resolve=>{release=()=>{releasedAt=arrived;resolve();};});
  const timer=setTimeout(()=>release(),5000);t.after(()=>clearTimeout(timer));
  f.setBarrier(async()=>{arrived++;if(arrived===4){clearTimeout(timer);release();}await barrier;});
  const results=await Promise.allSettled(challenges.map(challenge=>f.auth.verify({challengeId:challenge.challengeId,response:f.assertion(challenge,2)},{ip:'one'})));
  assert.equal(releasedAt,4,'All crypto validations can complete before the short final database transaction.');
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.ok(results.filter(result=>result.status==='rejected').every(result=>result.reason.code==='AUTH_COUNTER_REPLAY'));
  assert.equal(Number((await f.db.query('SELECT sign_count FROM identity_identities WHERE owner_id=$1',['stellar:testnet:'+f.config.hostAddress])).rows[0].sign_count),2);
  assert.equal((await f.db.query('SELECT count(*)::int AS count FROM identity_sessions')).rows[0].count,2);
});
test('provider and session-store failures leave the challenge consumed and session/counter writes atomic',async t=>{
  const f=await quotaBackedAuth(t),first=await f.auth.challenge({address:f.config.hostAddress,credentialId:'YQ'},{ip:'one'});
  await f.auth.verify({challengeId:first.challengeId,response:f.assertion(first,1)},{ip:'one'});
  const outage=await f.auth.challenge({address:f.config.hostAddress,credentialId:'YQ'},{ip:'one'});f.failAuthority(true);
  await assert.rejects(f.auth.verify({challengeId:outage.challengeId,response:f.assertion(outage,2)},{ip:'one'}));
  const calls=f.authorityCalls;f.failAuthority(false);
  await assert.rejects(f.auth.verify({challengeId:outage.challengeId,response:f.assertion(outage,2)},{ip:'one'}),error=>error.code==='AUTH_CHALLENGE_EXPIRED');assert.equal(f.authorityCalls,calls);
  const failedStore=await f.auth.challenge({address:f.config.hostAddress,credentialId:'YQ'},{ip:'one'});f.failSessionInsert(true);
  await assert.rejects(f.auth.verify({challengeId:failedStore.challengeId,response:f.assertion(failedStore,2)},{ip:'one'}));f.failSessionInsert(false);
  assert.ok((await f.db.query('SELECT consumed_at FROM identity_challenges WHERE id=$1',[failedStore.challengeId])).rows[0].consumed_at);
  assert.equal(Number((await f.db.query('SELECT sign_count FROM identity_identities')).rows[0].sign_count),1);
  assert.equal((await f.db.query('SELECT count(*)::int AS count FROM identity_sessions')).rows[0].count,1);
});
