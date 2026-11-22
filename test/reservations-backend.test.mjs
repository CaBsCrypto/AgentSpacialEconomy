import test from 'node:test';
import assert from 'node:assert/strict';
import { publicConfig,readConfig } from '../server/reservations/config.mjs';
import { createApi } from '../server/reservations/http.mjs';
import { createTransactionService } from '../server/reservations/transactions.mjs';
import { createProjectService,decodeImage } from '../server/reservations/project.mjs';
import { createPrivateStorage } from '../server/reservations/storage.mjs';
import { buildPrompt,createGatewayModel } from '../server/reservations/conversation.mjs';
import { fixture,approved,publish,actor,testDatabase,testConfig,fakeChain,validateTestDatabaseUrl,proposal } from './reservations-support.test.mjs';
const check=code=>error=>error.code===code;
async function setup(t,options){const f=await fixture(options);if(!options?.db)t.after(()=>f.db.close());return f;}

test('runtime defaults disabled, quantitative coverage is required, no provider call',async t=>{
  const config=readConfig({});assert.equal(publicConfig(config).capabilities.authentication,false);
  const f=await setup(t);f.config.coverage={zeroAdditionalSpend:true,verifiedUntil:'2099-01-01T00:00:00Z'};
  assert.equal(publicConfig(f.config).capabilities.media,false);
  await assert.rejects(f.conversation.propose(f.host,{message:'Help',expectedRevision:0}),check('COVERAGE_UNVERIFIED'));
  assert.equal(f.model.inspections,0);assert.equal(f.model.calls,0);
});
test('central budget rejects invalid coverage dates; Blob automatic retries disable media',async t=>{
  const f=await setup(t);f.config.coverage.verifiedUntil='not a date';
  await assert.rejects(f.resources.reserve([{resource:'blobWriteBytes',amount:1}]),check('COVERAGE_UNVERIFIED'));
  assert.equal((await f.db.query('SELECT * FROM resource_limits')).rows.length,0);
  f.config.coverage.verifiedUntil='2099-01-01T00:00:00Z';f.config.blobRetriesDisabled=false;assert.equal(publicConfig(f.config).capabilities.media,false);
});
test('Gateway adapter uses the pinned model, one provider, no retry/tools and bounded output',async()=>{
  const config=testConfig();let options,reads=0,reserved=0;
  const provider={languageModel:id=>{assert.equal(id,'google/gemini-2.5-flash-lite');return{id};},async getCredits(){reads++;return{balance:'5'};},async getAvailableModels(){reads++;return{models:[{id:config.model.id,pricing:{input:'0.0000001',output:'0.0000004'}}]};}};
  const model=createGatewayModel({config,credential:async()=>'test-adapter',resources:{async reserve(items){reserved+=items[0].amount;}},loadAI:async()=>({createGateway:()=>provider,jsonSchema:value=>value,Output:{object:value=>value},generateText:async value=>{options=value;return{output:proposal,usage:{inputTokens:1,outputTokens:1}};}})});
  await model.inspect();assert.equal(reads,2);assert.equal(reserved,2);await model.generate({system:'test',prompt:'test'});
  assert.equal(options.maxOutputTokens,1024);assert.equal(options.maxRetries,0);assert.deepEqual(options.providerOptions.gateway.only,['google']);assert.equal(options.tools,undefined);assert.equal(options.providerOptions.gateway.serviceTier,undefined);
});
test('test DB guard refuses production and advertising DB URLs',()=>{
  for(const url of ['postgres://test@localhost/production','postgres://test@localhost/ads_test','postgres://test@localhost/reservations_test?options=anything'])assert.throws(()=>validateTestDatabaseUrl(url,{NODE_ENV:'test'}));
  assert.throws(()=>validateTestDatabaseUrl('postgres://test@localhost/reservations_test',{NODE_ENV:'production'}));
  assert.equal(validateTestDatabaseUrl('postgres://test@localhost/reservations_test',{NODE_ENV:'test'}),'postgres://test@localhost/reservations_test');
});
test('two accounts: private project, direct media ID and attempts stay private',async t=>{
  const f=await setup(t),snapshot=await approved(f);
  await assert.rejects(f.projects.get(f.brand),check('HOST_REQUIRED'));
  await assert.rejects(f.projects.readMedia(f.brand,snapshot.map.mediaId),check('HOST_REQUIRED'));
  assert.equal((await f.offers.list()).length,0);
  const prepared=await f.transactions.prepare(f.host,{operation:'publish',snapshotId:snapshot.id});
  await assert.rejects(f.transactions.reconcile(f.brand,prepared.attempt.id),check('ATTEMPT_NOT_FOUND'));
  await assert.rejects(f.offers.media(prepared.attempt.offerId),check('MEDIA_NOT_FOUND'));
  assert.equal((await f.transactions.pending(f.host)).id,prepared.attempt.id);
  assert.equal(await f.transactions.pending(f.brand),null);
});
test('revision conflict, server space IDs, immutable approval and restored review',async t=>{
  const f=await setup(t),snapshot=await approved(f),before=await f.projects.get(f.host);
  assert.deepEqual(before.approvedSnapshot,snapshot);
  await assert.rejects(f.projects.update(f.host,{expectedRevision:0,title:'stale',context:'',spaces:[],map:null}),check('REVISION_CONFLICT'));
  await assert.rejects(f.projects.update(f.host,{expectedRevision:before.revision,title:'invalid',context:'',spaces:[{id:'e'.repeat(64),name:'Other',purpose:''}],map:null}),check('UNKNOWN_SPACE'));
  const after=await f.projects.update(f.host,{expectedRevision:before.revision,title:'Changed title',context:before.context,spaces:before.spaces,map:before.map});
  assert.equal(after.approvedSnapshotId,null);assert.equal(after.revision,before.revision+1);
  assert.deepEqual((await f.db.query('SELECT data FROM reservation_snapshots WHERE id=$1',[snapshot.id])).rows[0].data,snapshot);
  await assert.rejects(f.transactions.prepare(f.host,{operation:'publish',snapshotId:snapshot.id}),check('APPROVAL_STALE'));
});
test('decoded media strips metadata, accepts reservation 2048, rejects overflow, malformed and mismatch',async t=>{
  const f=await setup(t),sharp=(await import('sharp')).default;
  const large=await sharp({create:{width:2048,height:2048,channels:3,background:'white'}}).jpeg().toBuffer();
  const decoded=await decodeImage(large,'image/jpeg',f.config.limits);assert.equal(decoded.width,2048);assert.equal(decoded.height,2048);
  const tooLarge=await sharp({create:{width:2049,height:1,channels:3,background:'white'}}).png().toBuffer();
  await assert.rejects(decodeImage(tooLarge,'image/png',f.config.limits));
  await assert.rejects(decodeImage(large,'image/png',f.config.limits));
  await assert.rejects(decodeImage(Buffer.from('not an image'),'image/png',f.config.limits));
  await assert.rejects(f.projects.upload(f.host,Buffer.alloc(2097153),'image/png'),check('UPLOAD_SIZE'));
});
test('storage quota before Blob; uncertain uploads are durable STAGED, not readable',async t=>{
  const f=await setup(t),sharp=(await import('sharp')).default,bytes=await sharp({create:{width:2,height:2,channels:3,background:'white'}}).png().toBuffer();
  let puts=0;const projects=createProjectService({...f,storage:{async put(){puts++;throw Error('lost upload response');},async get(){throw Error('must not read STAGED');}}});
  await assert.rejects(projects.upload(f.host,bytes,'image/png'));
  const media=(await f.db.query('SELECT * FROM reservation_media')).rows[0];assert.equal(media.state,'STAGED');assert.equal(puts,1);
  await assert.rejects(projects.readMedia(f.host,media.id),check('MEDIA_NOT_FOUND'));
  f.config.coverage.quotas.blobWriteBytes=bytes.length;
  await assert.rejects(projects.upload(f.host,bytes,'image/png'),check('RATE_LIMIT'));assert.equal(puts,1);
});
test('private Blob PUT uncertainty performs no hidden provider GET',async()=>{
  let gets=0;const storage=createPrivateStorage({token:'test-adapter',sdk:{async put(){throw Error('ambiguous PUT');},async get(){gets++;throw Error('must not read');}}});
  await assert.rejects(storage.put(Buffer.from('test'), 'a'.repeat(64)));assert.equal(gets,0);
});
test('published card and image are snapshot-only; archived/unknown never becomes AVAILABLE',async t=>{
  const f=await setup(t),{snapshot,prepared}=await publish(f);
  let card=await f.offers.get(prepared.attempt.offerId);assert.equal(card.state,'AVAILABLE');assert.deepEqual(card.snapshot,snapshot);
  assert.ok((await f.offers.media(card.id)).length>0);
  const project=await f.projects.get(f.host);await f.projects.update(f.host,{expectedRevision:project.revision,title:'Private newer title',context:project.context,spaces:project.spaces,map:project.map});
  assert.equal((await f.offers.get(card.id)).snapshot.title,snapshot.title);
  f.chain.states.delete(card.id);assert.equal((await f.offers.get(card.id)).state,'UNAVAILABLE');
  f.chain.getOffer=async()=>{throw Error('archived');};assert.equal((await f.offers.get(card.id)).state,'UNCERTAIN');
});
test('timeout after settlement survives restart, concurrent retry never sends twice',async t=>{
  const f=await setup(t),snapshot=await approved(f),prepared=await f.transactions.prepare(f.host,{operation:'publish',snapshotId:snapshot.id});
  const body={func:prepared.signing.func,auth:prepared.signing.auth};f.chain.unknown=true;
  const first=await f.transactions.submit(f.host,prepared.attempt.id,body);assert.equal(first.attempt.state,'NEEDS_RECONCILIATION');assert.equal(f.chain.sends,1);
  const restarted=createTransactionService(f);
  const retries=await Promise.all(Array.from({length:20},()=>restarted.submit(f.host,prepared.attempt.id,body)));
  assert.equal(f.chain.sends,1);assert.ok(retries.every(result=>result.receipt===null));
  await assert.rejects(restarted.submit(f.host,prepared.attempt.id,{...body,auth:['different']}),check('SIGNED_PAYLOAD_CONFLICT'));
  f.chain.unknown=false;const recovered=await restarted.reconcile(f.host,prepared.attempt.id);assert.equal(recovered.attempt.state,'CONFIRMED');assert.equal(f.chain.sends,1);
});
test('edit after preparation invalidates publication before a relay send',async t=>{
  const f=await setup(t),snapshot=await approved(f),prepared=await f.transactions.prepare(f.host,{operation:'publish',snapshotId:snapshot.id}),project=await f.projects.get(f.host);
  await f.projects.update(f.host,{expectedRevision:project.revision,title:'Changed',context:'',spaces:project.spaces,map:project.map});
  await assert.rejects(f.transactions.submit(f.host,prepared.attempt.id,{func:prepared.signing.func,auth:prepared.signing.auth}),check('APPROVAL_STALE'));assert.equal(f.chain.sends,0);
});
test('expired unsigned preparation can reject; uncertain signed intent never expires into retry',async t=>{
  let time=Date.now();const f=await setup(t,{now:()=>time}),snapshot=await approved(f),prepared=await f.transactions.prepare(f.host,{operation:'publish',snapshotId:snapshot.id});
  time+=120001;assert.equal((await f.transactions.reconcile(f.host,prepared.attempt.id)).attempt.state,'REJECTED');
  const next=await f.transactions.prepare(f.host,{operation:'publish',snapshotId:snapshot.id});f.chain.unknown=true;
  await f.transactions.submit(f.host,next.attempt.id,{func:next.signing.func,auth:next.signing.auth});time+=86400000;
  const again=await f.transactions.prepare(f.host,{operation:'publish',snapshotId:snapshot.id});assert.equal(again.attempt.id,next.attempt.id);assert.equal(again.signing,null);assert.equal(f.chain.sends,1);
});
test('AI proposals do not change project/approval; daily request N+1 stops before provider',async t=>{
  const f=await setup(t),snapshot=await approved(f),project=await f.projects.get(f.host);
  for(let i=0;i<30;i++){const result=await f.conversation.propose(f.host,{message:'Suggest a concise offer',expectedRevision:project.revision});assert.deepEqual(result.proposal,proposal);}
  assert.equal(f.model.calls,30);assert.equal(f.model.inspections,30);
  await assert.rejects(f.conversation.propose(f.host,{message:'31',expectedRevision:project.revision}),check('CONVERSATION_DAILY_LIMIT'));
  assert.equal(f.model.inspections,30);assert.equal(f.model.calls,30);const restored=await f.projects.get(f.host);assert.equal(restored.revision,project.revision);assert.equal(restored.approvedSnapshotId,snapshot.id);assert.equal(restored.conversation.length,60);
});
test('AI credit/pricing fail closed; unknown inference retains maximum cost; input uses bytes',async t=>{
  const f=await setup(t);await f.projects.get(f.host);
  f.model.inspect=async()=>({balance:'0',pricing:{input:'0.0000001',output:'0.0000004'}});
  await assert.rejects(f.conversation.propose(f.host,{message:'Help',expectedRevision:0}),check('GATEWAY_CREDITS_INSUFFICIENT'));assert.equal(f.model.calls,0);
  f.model.inspect=async()=>({balance:'5',pricing:{input:'0.1',output:'0.0000004'}});
  await assert.rejects(f.conversation.propose(f.host,{message:'Help',expectedRevision:0}),check('MODEL_PRICE_CHANGED'));
  f.model.inspect=async()=>({balance:'5',pricing:{input:'0.0000001',output:'0.0000004'}});f.model.generate=async()=>{throw Error('timeout');};
  await assert.rejects(f.conversation.propose(f.host,{message:'Help',expectedRevision:0}),check('MODEL_RESULT_UNCERTAIN'));
  const hold=(await f.db.query("SELECT * FROM gateway_budget_reservations WHERE state='UNKNOWN'")).rows[0];assert.equal(Number(hold.reserved_microusd),1210);
  assert.throws(()=>buildPrompt({title:'a',context:'',spaces:[],conversation:[]},'😀'.repeat(2000)),check('MODEL_INPUT_LIMIT'));
});
test('global Gateway allowance is atomic across simultaneous requests and future consumers',async t=>{
  const f=await setup(t);await f.projects.get(f.host);f.config.coverage.gatewayBudgetMicrousd=1210;
  const values=await Promise.allSettled(Array.from({length:20},()=>f.conversation.propose(f.host,{message:'Help',expectedRevision:0})));
  assert.equal(values.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.model.calls,1);assert.equal(f.model.inspections,1);
  assert.equal(Number((await f.db.query("SELECT sum(reserved_microusd) AS used FROM gateway_budget_reservations WHERE state<>'RELEASED'")).rows[0].used),1210);
});
test('HTTP origin, cookie-only auth, direct URL privacy, JSON errors and disabled configuration',async t=>{
  const f=await setup(t),snapshot=await approved(f);let current=f.host;
  const auth={async authenticate(){return current;},async verify(){return{identity:f.host,token:'must-not-appear',expiresAt:'2099-01-01',cookie:'__Host-reservations_session=test; Path=/; HttpOnly; Secure; SameSite=Strict'};}};
  const handle=createApi({...f,auth});
  let response=await handle(new Request(f.config.origin+'/api/reservations/auth/verify',{method:'POST',headers:{Origin:'https://other.invalid','Content-Type':'application/json'},body:'{}'}));assert.equal(response.status,403);
  response=await handle(new Request(f.config.origin+'/api/reservations/auth/verify',{method:'POST',headers:{Origin:f.config.origin,'Content-Type':'application/json'},body:JSON.stringify({challengeId:'a',response:{}})}));assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/HttpOnly/);assert.equal((await response.json()).token,undefined);
  current=f.brand;response=await handle(new Request(f.config.origin+'/api/reservations/media/'+snapshot.map.mediaId));assert.equal(response.status,403);assert.match(response.headers.get('cache-control'),/no-store/);
  f.config.enabled=false;response=await handle(new Request(f.config.origin+'/api/reservations/config'));assert.equal(response.status,200);assert.equal((await response.json()).capabilities.project,false);
  response=await handle(new Request(f.config.origin+'/api/reservations/project'));assert.equal(response.status,403);
  current=f.host;response=await handle(new Request(f.config.origin+'/api/reservations/project'));assert.equal(response.status,200);
});
test('pausing intake preserves pending reconciliation and confirmed receipts without new chain calls',async t=>{
  const f=await setup(t),snapshot=await approved(f),prepared=await f.transactions.prepare(f.host,{operation:'publish',snapshotId:snapshot.id});
  f.chain.unknown=true;await f.transactions.submit(f.host,prepared.attempt.id,{func:prepared.signing.func,auth:prepared.signing.auth});
  f.config.intakeEnabled=false;f.config.enabled=false;
  await assert.rejects(f.transactions.prepare(f.host,{operation:'publish',snapshotId:snapshot.id}),check('DISABLED'));
  f.chain.unknown=false;assert.equal((await f.transactions.reconcile(f.host,prepared.attempt.id)).attempt.state,'CONFIRMED');
  f.chain.reconcile=async()=>{throw Error('confirmed must be local');};f.config.coverage={};
  assert.equal((await f.transactions.reconcile(f.host,prepared.attempt.id)).attempt.state,'CONFIRMED');assert.equal(f.chain.sends,1);
});
test('public reads survive intake pause and a stale RPC cannot undo a final reservation',async t=>{
  const f=await setup(t),{prepared}=await publish(f),reservation=await f.transactions.prepare(f.brand,{operation:'reserve',offerId:prepared.attempt.offerId});
  await f.transactions.submit(f.brand,reservation.attempt.id,{func:reservation.signing.func,auth:reservation.signing.auth});
  const original=f.chain.states.get(prepared.attempt.offerId);f.config.intakeEnabled=false;
  assert.equal((await f.offers.get(original.id)).state,'RESERVED');
  f.chain.states.set(original.id,{...original,state:'AVAILABLE',holder:null});
  assert.equal((await f.offers.get(original.id)).state,'UNCERTAIN');
  const stored=(await f.db.query('SELECT state,holder FROM reservation_offers WHERE id=$1',[original.id])).rows[0];assert.equal(stored.state,'RESERVED');assert.equal(stored.holder,f.brand.address);
  assert.ok((await f.offers.media(original.id)).length>0);
});
test('late publication reconciliation cannot overwrite an observed final holder',async t=>{
  const f=await setup(t),snapshot=await approved(f),prepared=await f.transactions.prepare(f.host,{operation:'publish',snapshotId:snapshot.id});
  f.chain.unknown=true;await f.transactions.submit(f.host,prepared.attempt.id,{func:prepared.signing.func,auth:prepared.signing.auth});
  await f.db.query("UPDATE reservation_offers SET state='RESERVED',holder=$2 WHERE id=$1",[prepared.attempt.offerId,f.brand.address]);
  f.chain.unknown=false;const result=await f.transactions.reconcile(f.host,prepared.attempt.id);assert.equal(result.attempt.state,'NEEDS_RECONCILIATION');assert.equal(result.receipt,null);
  const row=(await f.db.query('SELECT state,holder FROM reservation_offers WHERE id=$1',[prepared.attempt.offerId])).rows[0];assert.equal(row.state,'RESERVED');assert.equal(row.holder,f.brand.address);
});
test('same wallet in a different configured project cannot discover or submit attempts',async t=>{
  const f=await setup(t),snapshot=await approved(f),prepared=await f.transactions.prepare(f.host,{operation:'publish',snapshotId:snapshot.id}),other=await fixture({db:f.db});
  assert.equal(await other.transactions.pending(other.host),null);
  await assert.rejects(other.transactions.reconcile(other.host,prepared.attempt.id),check('ATTEMPT_NOT_FOUND'));
  await assert.rejects(other.transactions.submit(other.host,prepared.attempt.id,{func:prepared.signing.func,auth:prepared.signing.auth}),check('ATTEMPT_NOT_FOUND'));
});
test('CONTROLLED admission is server-only, checked before chain; removal preserves pending recovery',async t=>{
  const f=await setup(t),{prepared}=await publish(f);f.config.mode='CONTROLLED';f.config.allowedBrands=[];
  const before=f.chain.prepared;await assert.rejects(f.transactions.prepare(f.brand,{operation:'reserve',offerId:prepared.attempt.offerId}),check('BRAND_NOT_ADMITTED'));assert.equal(f.chain.prepared,before);assert.equal(publicConfig(f.config).allowedBrands,undefined);
  f.config.allowedBrands=[f.brand.address];const attempt=await f.transactions.prepare(f.brand,{operation:'reserve',offerId:prepared.attempt.offerId});
  f.config.allowedBrands=[];await assert.rejects(f.transactions.submit(f.brand,attempt.attempt.id,{func:attempt.signing.func,auth:attempt.signing.auth}),check('BRAND_NOT_ADMITTED'));assert.equal(f.chain.sends,1);
  f.config.allowedBrands=[f.brand.address];f.chain.unknown=true;await f.transactions.submit(f.brand,attempt.attempt.id,{func:attempt.signing.func,auth:attempt.signing.auth});
  f.config.allowedBrands=[];f.chain.unknown=false;assert.equal((await f.transactions.reconcile(f.brand,attempt.attempt.id)).attempt.state,'CONFIRMED');assert.equal(f.chain.sends,2);
});
test('100 rounds × 20 SQL/application contenders: one offer, one sender per intent, one final holder',async t=>{
  const db=await testDatabase();t.after(()=>db.close());t.diagnostic('Database backend: '+db.testBackend+'; 2,000 application contenders plus parallel publication and send claims.');
  for(let round=0;round<100;round++){
    const config=testConfig(),chain=fakeChain(config),f=await fixture({db,config,chain}),snapshot=await approved(f);
    const prepared=await Promise.all(Array.from({length:20},()=>f.transactions.prepare(f.host,{operation:'publish',snapshotId:snapshot.id})));
    assert.equal(new Set(prepared.map(x=>x.attempt.id)).size,1);assert.equal(chain.prepared,1);
    const signing=prepared.find(x=>x.signing)?.signing;assert.ok(signing);
    await Promise.all(Array.from({length:20},()=>f.transactions.submit(f.host,prepared[0].attempt.id,{func:signing.func,auth:signing.auth})));
    assert.equal(chain.sends,1);assert.equal(Number((await db.query("SELECT count(*)::int AS count FROM reservation_offers WHERE project_id=$1 AND state='AVAILABLE'",[config.projectId])).rows[0].count),1);
    const contenders=await Promise.all(Array.from({length:20},async(_,i)=>{const brand=actor(config,i+3),attempt=await f.transactions.prepare(brand,{operation:'reserve',offerId:prepared[0].attempt.offerId});return{brand,attempt};}));
    const results=await Promise.all(contenders.map(({brand,attempt})=>f.transactions.submit(brand,attempt.attempt.id,{func:attempt.signing.func,auth:attempt.signing.auth})));
    assert.equal(results.filter(x=>x.attempt.state==='CONFIRMED').length,1);assert.equal(chain.sends,21);
    assert.equal((await db.query('SELECT state FROM reservation_offers WHERE id=$1',[prepared[0].attempt.offerId])).rows[0].state,'RESERVED');
  }
});
