import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntakeService } from '../server/reservations/intake.mjs';
import { createTransactionService } from '../server/reservations/transactions.mjs';
import { createApi } from '../server/reservations/http.mjs';
import { createBackupService } from '../server/reservations/backup.mjs';
import { createProjectService } from '../server/reservations/project.mjs';
import { runIntake } from '../server/reservations/intake-cli.mjs';
import { canonical, sha256 } from '../server/identity/common.mjs';
import { fixture, approved, testConfig, testDatabase } from './reservations-support.test.mjs';
const check=code=>error=>error.code===code;
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};

test('missing admission is closed; pause/resume is durable, revision checked and bounded by environment',async t=>{
  const db=await testDatabase();t.after(()=>db.close());const config=testConfig(),first=createIntakeService({db,config}),second=createIntakeService({db,config:structuredClone(config)});
  await assert.rejects(first.requireOpen(),check('INTAKE_PAUSED'));
  assert.equal((await first.change(true)).dryRun,true);assert.equal((await second.status()).state,'MISSING');
  const paused=await first.change(true,{dryRun:false});assert.equal(paused.revision,1);
  await assert.rejects(first.change(false,{dryRun:false,expectedRevision:0}),check('INTAKE_REVISION_CONFLICT'));
  await first.change(false,{dryRun:false,expectedRevision:1});await second.requireOpen();
  await second.change(true,{dryRun:false});await assert.rejects(first.requireOpen(),check('INTAKE_PAUSED'));
  config.intakeEnabled=false;await assert.rejects(first.change(false,{dryRun:false,expectedRevision:3}),check('DISABLED'));
  const broken=createIntakeService({db:{async query(){throw Error('offline');}},config:testConfig()});await assert.rejects(broken.requireOpen(),check('INTAKE_UNAVAILABLE'));
});

test('two warm API instances report effective admission immediately without mutating environment pins',async t=>{
  const f=await fixture();t.after(()=>f.db.close());const first=createApi({...f,auth:{}}),otherConfig=structuredClone(f.config),other=await fixture({db:f.db,config:otherConfig}),second=createApi({...other,auth:{}});
  const config=async api=>(await api(new Request(f.config.origin+'/api/reservations/config'))).json();
  const before=await config(first);assert.equal(before.intakeEnabled,true);
  await other.intake.change(true,{dryRun:false});
  for(const api of [first,second]){const value=await config(api);assert.equal(value.intakeEnabled,false);assert.equal(value.admission.state,'PAUSED');assert.equal(value.capabilities.publication,false);assert.equal(value.capabilities.recovery,true);assert.equal(value.contractId,before.contractId);assert.equal(value.rpId,before.rpId);}
  assert.equal(f.config.intakeEnabled,true);assert.equal(otherConfig.intakeEnabled,true);
  const revision=(await f.intake.status()).revision;await f.intake.change(false,{dryRun:false,expectedRevision:revision});assert.equal((await config(second)).intakeEnabled,true);
});

test('config skips DB without coverage and preserves recovery when ordinary public-poll allowance is exhausted',async t=>{
  const config=testConfig();config.enabled=false;let queries=0,reservations=0;
  const disabled=createApi({config,db:{async query(){queries++;throw Error('must not connect');}},resources:{async reserve(){reservations++;throw Error('must not reserve');}},auth:{}});
  let response=await disabled(new Request(config.origin+'/api/reservations/config'));assert.equal(response.status,200);assert.equal(queries,0);assert.equal(reservations,0);
  config.enabled=true;config.coverage={};response=await disabled(new Request(config.origin+'/api/reservations/config'));assert.equal(response.status,200);assert.equal(queries,0);assert.equal(reservations,0);
  const f=await fixture();t.after(()=>f.db.close());let gateReads=0;const api=createApi({...f,auth:{},intake:{...f.intake,async status(){gateReads++;return f.intake.status();}}});f.config.coverage.quotas.functionRequests=1;
  assert.equal((await api(new Request(f.config.origin+'/api/reservations/config'))).status,200);assert.equal(gateReads,1);
  response=await api(new Request(f.config.origin+'/api/reservations/config'));const body=await response.json();assert.equal(response.status,200);assert.equal(body.intakeEnabled,false);assert.equal(body.admission.state,'UNAVAILABLE');assert.equal(body.capabilities.recovery,true);assert.equal(gateReads,1);
});

test('reading an absent or existing project during pause never inserts or rewrites a draft',async t=>{
  const f=await fixture({admit:false});t.after(()=>f.db.close());let writes=0;
  const db={...f.db,async query(sql,args){if(/^\s*(INSERT|UPDATE|DELETE)/i.test(sql))writes++;return f.db.query(sql,args);}},projects=createProjectService({...f,db});
  assert.equal((await projects.get(f.host)).revision,0);assert.equal(writes,0);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM reservation_projects')).rows[0].n,0);
  const closed=await f.intake.change(true,{dryRun:false});await f.intake.change(false,{dryRun:false,expectedRevision:closed.revision});
  await projects.update(f.host,{expectedRevision:0,title:'Persisted only after admission',context:'',spaces:[],map:null});await f.intake.change(true,{dryRun:false});
  assert.equal((await projects.get(f.host)).revision,1);assert.equal(writes,0);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM reservation_projects')).rows[0].n,1);
});

test('a failed durable submit commit cannot reach the sender',async t=>{
  const f=await fixture();t.after(()=>f.db.close());const snapshot=await approved(f),prepared=await f.transactions.prepare(f.host,{operation:'publish',snapshotId:snapshot.id}),entered=deferred(),release=deferred();
  const db={...f.db,transaction:work=>f.db.transaction(async tx=>{let claim=false;const result=await work({...tx,async query(sql,args){if(sql.includes("SET state='SUBMITTING'"))claim=true;return tx.query(sql,args);}});if(claim){entered.resolve();await release.promise;throw Error('commit unavailable');}return result;})};
  const transactions=createTransactionService({...f,db}),sending=transactions.submit(f.host,prepared.attempt.id,{func:prepared.signing.func,auth:prepared.signing.auth});await entered.promise;assert.equal(f.chain.sends,0);release.resolve();await assert.rejects(sending,/commit unavailable/);assert.equal(f.chain.sends,0);
  assert.equal((await f.db.query('SELECT state FROM reservation_attempts WHERE id=$1',[prepared.attempt.id])).rows[0].state,'PREPARED');
});

test('pause wins after image decoding and before inference admission, without either provider call',async t=>{
  const f=await fixture();t.after(()=>f.db.close());const entered=deferred(),release=deferred();let puts=0;
  const projects=createProjectService({...f,storage:{...f.storage,async put(){puts++;throw Error('not admitted');}},decode:async()=>{entered.resolve();await release.promise;return{bytes:Buffer.from('normalized'),width:1,height:1};}});
  const uploading=projects.upload(f.host,Buffer.from('input'),'image/png');await entered.promise;const paused=await f.intake.change(true,{dryRun:false});release.resolve();await assert.rejects(uploading,check('INTAKE_PAUSED'));assert.equal(puts,0);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM reservation_media')).rows[0].n,0);
  await f.intake.change(false,{dryRun:false,expectedRevision:paused.revision});const inspecting=deferred(),inspected=deferred(),inspect=f.model.inspect.bind(f.model);f.model.inspect=async()=>{inspecting.resolve();await inspected.promise;return inspect();};
  const proposing=f.conversation.propose(f.host,{message:'Suggest a title',expectedRevision:0});await inspecting.promise;await f.intake.change(true,{dryRun:false});inspected.resolve();await assert.rejects(proposing,check('INTAKE_PAUSED'));assert.equal(f.model.calls,0);assert.equal((await f.db.query('SELECT state FROM gateway_budget_reservations')).rows[0].state,'RELEASED');
});

test('internal CLI defaults dry-run, validates revision and never resets persisted counters',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  const env={RESERVATIONS_PROJECT_ID:f.config.projectId,RESERVATIONS_HOST_ADDRESS:f.config.hostAddress,RESERVATIONS_DATABASE_URL:'test-adapter',RESERVATIONS_ENABLED:'true',RESERVATIONS_INTAKE_ENABLED:'true',RESERVATIONS_MODE:'CONTROLLED',RESERVATIONS_RESOURCE_COVERAGE:JSON.stringify(f.config.coverage)};
  const options={database:()=>({...f.db,async close(){}})};
  await f.resources.reserve([{resource:'functionRequests'}]);const counters=(await f.db.query('SELECT * FROM resource_limits ORDER BY key')).rows;
  assert.equal((await runIntake(['pause'],env,options)).dryRun,true);assert.equal((await f.intake.status()).paused,false);
  const closed=await runIntake(['pause','--apply'],env,options);assert.equal(closed.paused,true);
  await assert.rejects(runIntake(['resume','--apply'],env,options),check('INTAKE_REVISION_CONFLICT'));
  const reopened=await runIntake(['resume','--expected-revision',String(closed.revision),'--apply'],env,options);assert.equal(reopened.paused,false);
  await assert.rejects(runIntake(['reset','--apply'],env,options));assert.deepEqual((await f.db.query('SELECT * FROM resource_limits ORDER BY key')).rows,counters);
});

test('both backup formats restore paused and retain receipts, relationships and counter holds',async t=>{
  const f=await fixture();t.after(()=>f.db.close());const snapshot=await approved(f),prepared=await f.transactions.prepare(f.host,{operation:'publish',snapshotId:snapshot.id});
  const confirmed=await f.transactions.submit(f.host,prepared.attempt.id,{func:prepared.signing.func,auth:prepared.signing.auth});
  f.config.enabled=false;f.config.intakeEnabled=false;const exporter=createBackupService(f);
  await assert.rejects(exporter.exportBackup(),check('BACKUP_REQUIRES_PAUSE'));await f.intake.change(true,{dryRun:false});
  const bundle=await exporter.exportBackup();assert.equal(bundle.payload.formatVersion,2);
  for(const version of [1,2]){
    const archive=structuredClone(bundle);archive.payload.formatVersion=version;
    if(version===1)delete archive.payload.tables.reservation_intake;
    archive.checksum=sha256(canonical(archive.payload));
    const db=await testDatabase();t.after(()=>db.close());const target=await fixture({db,config:structuredClone(f.config)}),importer=createBackupService(target);
    await importer.restore(archive,{dryRun:false});assert.equal((await target.intake.status()).state,'PAUSED');
    assert.deepEqual((await target.transactions.reconcile(target.host,prepared.attempt.id)).receipt,confirmed.receipt);
    for(const original of archive.payload.tables.resource_limits){assert.equal(Number((await db.query('SELECT used FROM resource_limits WHERE key=$1',[original.key])).rows[0].used),Number(original.used));}
    target.config.enabled=true;target.config.intakeEnabled=true;await assert.rejects(target.intake.requireOpen(),check('INTAKE_PAUSED'));
  }
});

test('pause before the durable submit claim denies transmission in an already warm service',async t=>{
  const f=await fixture();t.after(()=>f.db.close());const snapshot=await approved(f),prepared=await f.transactions.prepare(f.host,{operation:'publish',snapshotId:snapshot.id});
  const entered=deferred(),release=deferred();f.chain.preflight=async()=>{entered.resolve();await release.promise;};
  const sending=f.transactions.submit(f.host,prepared.attempt.id,{func:prepared.signing.func,auth:prepared.signing.auth});await entered.promise;
  const other=createIntakeService({db:f.db,config:structuredClone(f.config)});await other.change(true,{dryRun:false});release.resolve();
  await assert.rejects(sending,check('INTAKE_PAUSED'));assert.equal(f.chain.sends,0);
  const row=(await f.db.query('SELECT state,signed_payload FROM reservation_attempts WHERE id=$1',[prepared.attempt.id])).rows[0];assert.equal(row.state,'PREPARED');assert.equal(row.signed_payload,null);
  await assert.rejects(f.projects.update(f.host,{expectedRevision:0}),check('INTAKE_PAUSED'));
});

test('pause after committed claim preserves unknown intent, receipt recovery and one sender',async t=>{
  const f=await fixture();t.after(()=>f.db.close());const snapshot=await approved(f),prepared=await f.transactions.prepare(f.host,{operation:'publish',snapshotId:snapshot.id});
  const entered=deferred(),release=deferred(),send=f.chain.submit.bind(f.chain);f.chain.submit=async body=>{assert.equal((await f.db.query('SELECT state FROM reservation_attempts WHERE id=$1',[prepared.attempt.id])).rows[0].state,'SUBMITTING');entered.resolve();await release.promise;return send(body);};
  f.chain.unknown=true;const body={func:prepared.signing.func,auth:prepared.signing.auth},sending=f.transactions.submit(f.host,prepared.attempt.id,body);await entered.promise;
  await f.intake.change(true,{dryRun:false});release.resolve();assert.equal((await sending).attempt.state,'NEEDS_RECONCILIATION');
  const restarted=createTransactionService({...f,config:structuredClone(f.config)});await Promise.all(Array.from({length:10},()=>restarted.submit(f.host,prepared.attempt.id,body)));assert.equal(f.chain.sends,1);
  f.chain.unknown=false;const recovered=await restarted.reconcile(f.host,prepared.attempt.id);assert.equal(recovered.attempt.state,'CONFIRMED');assert.ok(recovered.receipt.txHash);
  f.chain.reconcile=async()=>{throw Error('must use saved receipt');};assert.deepEqual((await restarted.reconcile(f.host,prepared.attempt.id)).receipt,recovered.receipt);assert.equal(f.chain.sends,1);
});
