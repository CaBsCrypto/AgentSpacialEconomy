import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaintenanceService } from '../server/reservations/maintenance.mjs';
import { createBackupService } from '../server/reservations/backup.mjs';
import { createRuntime } from '../server/reservations/runtime.mjs';
import { createPrivateStorage } from '../server/reservations/storage.mjs';
import { fixture,approved,publish,actor,testDatabase } from './reservations-support.test.mjs';
import { sha256,canonical,uuid } from '../server/identity/common.mjs';
const OLD='2026-01-01T00:00:00Z',NOW=Date.parse('2026-11-13T12:00:00Z');
async function setup(t){const f=await fixture({now:()=>NOW});t.after(()=>f.db.close());return f;}
async function image(f){const sharp=(await import('sharp')).default,bytes=await sharp({create:{width:8,height:8,channels:3,background:'white'}}).png().toBuffer();return f.projects.upload(f.host,bytes,'image/png');}
test('cleanup dry-run makes no mutation/provider call and preserves all snapshot references across projects',async t=>{
  const f=await setup(t),snapshot=await approved(f),orphan=await image(f),other=await fixture({db:f.db,now:()=>NOW}),otherImage=await image(other);
  await f.db.query('UPDATE reservation_media SET created_at=$1',[OLD]);
  let deletes=0;const maintenance=createMaintenanceService({...f,now:()=>NOW,storage:{...f.storage,async remove(key){deletes++;await f.storage.remove(key);}}});
  const dry=await maintenance.cleanup();assert.equal(dry.dryRun,true);assert.deepEqual(dry.media.map(row=>row.id),[orphan.id]);assert.equal(deletes,0);assert.equal(dry.expireDraft,false);
  assert.equal((await f.db.query('SELECT state FROM reservation_media WHERE id=$1',[orphan.id])).rows[0].state,'READY');
  const applied=await maintenance.cleanup({dryRun:false});assert.equal(applied.status,'COMPLETED');assert.equal(deletes,1);
  assert.equal((await f.db.query('SELECT state FROM reservation_media WHERE id=$1',[snapshot.map.mediaId])).rows[0].state,'READY');
  assert.equal((await f.db.query('SELECT state FROM reservation_media WHERE id=$1',[otherImage.id])).rows[0].state,'READY');
  assert.equal((await f.projects.get(f.host)).approvedSnapshotId,snapshot.id);
});
test('cleanup expires only inactive unpublished draft data; retained historical rows are unchanged',async t=>{
  const f=await setup(t),media=await image(f);let project=await f.projects.get(f.host);
  project=await f.projects.update(f.host,{expectedRevision:project.revision,title:'Inactive draft',context:'Private draft',spaces:[{name:'Space',purpose:''}],map:null});
  project=await f.projects.update(f.host,{expectedRevision:project.revision,title:project.title,context:project.context,spaces:project.spaces,map:{mediaId:media.id,points:[{spaceId:project.spaces[0].id,x:0.2,y:0.4}]}});
  await f.db.query('UPDATE reservation_projects SET updated_at=$2 WHERE id=$1',[f.config.projectId,OLD]);await f.db.query('UPDATE reservation_media SET created_at=$2 WHERE id=$1',[media.id,OLD]);
  await f.db.query("INSERT INTO reservation_messages(id,project_id,role,content,created_at) VALUES($1,$2,'user',$3,$4)",[uuid(),f.config.projectId,JSON.stringify('Private old message'),OLD]);
  const maintenance=createMaintenanceService({...f,now:()=>NOW});const dry=await maintenance.cleanup();assert.equal(dry.expireDraft,true);assert.equal(dry.media.length,1);
  const result=await maintenance.cleanup({dryRun:false});assert.equal(result.expiredDraft,true);const current=await f.projects.get(f.host);assert.equal(current.title,'');assert.equal(current.map,null);assert.equal(current.revision,project.revision+1);assert.equal(current.conversation.length,0);
  assert.equal((await f.db.query('SELECT count(*)::int AS count FROM reservation_projects')).rows[0].count,1);assert.equal((await f.db.query('SELECT state FROM reservation_media WHERE id=$1',[media.id])).rows[0].state,'DELETED');
});
test('a newer inactive draft expires while its earlier published snapshot, offer, receipt and media remain intact',async t=>{
  const f=await setup(t),{prepared,snapshot,result}=await publish(f),newMedia=await image(f),old=await f.projects.get(f.host);
  await f.projects.update(f.host,{expectedRevision:old.revision,title:'New unpublished draft',context:'Private later context',spaces:old.spaces,map:{mediaId:newMedia.id,points:[{spaceId:old.spaces[0].id,x:0.1,y:0.2}]}});
  await f.db.query('UPDATE reservation_projects SET updated_at=$2 WHERE id=$1',[f.config.projectId,OLD]);await f.db.query('UPDATE reservation_media SET created_at=$1',[OLD]);
  const service=createMaintenanceService({...f,now:()=>NOW}),plan=await service.cleanup();assert.equal(plan.expireDraft,true);assert.deepEqual(plan.media.map(row=>row.id),[newMedia.id]);
  await service.cleanup({dryRun:false});assert.equal((await f.projects.get(f.host)).title,'');
  const card=await f.offers.get(prepared.attempt.offerId);assert.deepEqual(card.snapshot,snapshot);assert.equal(card.state,'AVAILABLE');assert.ok((await f.offers.media(card.id)).length>0);
  assert.deepEqual((await f.transactions.reconcile(f.host,prepared.attempt.id)).receipt,result.receipt);
});
test('cleanup claims DELETING before provider, denies new references, meters deletes and retains uncertain outcomes',async t=>{
  const f=await setup(t),media=await image(f);await f.db.query('UPDATE reservation_media SET created_at=$2 WHERE id=$1',[media.id,OLD]);
  let calls=0;const maintenance=createMaintenanceService({...f,now:()=>NOW,storage:{async remove(){calls++;assert.equal((await f.db.query('SELECT state FROM reservation_media WHERE id=$1',[media.id])).rows[0].state,'DELETING');const project=await f.projects.get(f.host);await assert.rejects(f.projects.update(f.host,{expectedRevision:project.revision,title:'Try to attach',context:'',spaces:[],map:{mediaId:media.id,points:[]}}),error=>error.code==='MEDIA_NOT_FOUND');throw Error('lost delete result');}}});
  let result=await maintenance.cleanup({dryRun:false});assert.equal(result.status,'NEEDS_RECONCILIATION');assert.equal(calls,1);assert.equal((await maintenance.cleanup()).media.length,0);
  const held=Number((await f.db.query('SELECT used FROM resource_limits WHERE key=$1',['coverage:'+f.config.coverage.id+':blobDeleteCalls'])).rows[0].used);assert.equal(held,1);
  f.config.coverage.quotas.blobDeleteCalls=1;result=await maintenance.cleanup({dryRun:false,resume:true});assert.equal(result.status,'NEEDS_RECONCILIATION');assert.equal(calls,1);
});
test('logical export/import preserves IDs, relationships, counters and private Blob keys; sessions revoke and uncertain state holds',async t=>{
  const f=await setup(t),{prepared,snapshot}=await publish(f),brand2=actor(f.config,4);
  const pending=await f.transactions.prepare(f.brand,{operation:'reserve',offerId:prepared.attempt.offerId}),unsigned=await f.transactions.prepare(brand2,{operation:'reserve',offerId:prepared.attempt.offerId});
  f.chain.unknown=true;await f.transactions.submit(f.brand,pending.attempt.id,{func:pending.signing.func,auth:pending.signing.auth});
  const project=await f.projects.get(f.host);await f.conversation.propose(f.host,{message:'Suggest',expectedRevision:project.revision});
  for(const identity of [f.host,f.brand])await f.db.query('INSERT INTO identity_identities(owner_id,address,credential_id,authority_hash,sign_count) VALUES($1,$2,$3,$4,5)',[identity.ownerId,identity.address,'YQ','a'.repeat(64)]);
  await f.db.query('INSERT INTO identity_sessions(token_hash,owner_id,authority_hash,expires_at) VALUES($1,$2,$3,$4)',['a'.repeat(64),f.host.ownerId,'a'.repeat(64),'2099-01-01']);
  const exporter=createBackupService({...f,now:()=>NOW});await assert.rejects(exporter.exportBackup(),error=>error.code==='BACKUP_REQUIRES_PAUSE');
  await f.intake.change(true,{dryRun:false});f.config.enabled=false;f.config.intakeEnabled=false;const bundle=await exporter.exportBackup();assert.equal(bundle.payload.blobs.length,1);assert.equal(bundle.payload.tables.reservation_projects[0].id,f.config.projectId);
  const targetDb=await testDatabase();t.after(()=>targetDb.close());const restored=await fixture({db:targetDb,config:structuredClone(f.config),now:()=>NOW}),importer=createBackupService({...restored,now:()=>NOW});
  assert.equal((await importer.restore(bundle)).dryRun,true);assert.equal((await targetDb.query('SELECT count(*)::int AS count FROM reservation_projects')).rows[0].count,0);
  const applied=await importer.restore(bundle,{dryRun:false});assert.equal(applied.mediaVerified,false);
  const importedProject=await restored.projects.get(restored.host);assert.equal(importedProject.id,project.id);assert.equal(importedProject.approvedSnapshotId,snapshot.id);assert.equal(importedProject.revision,project.revision);assert.equal(importedProject.conversation.length,2);
  assert.deepEqual((await targetDb.query('SELECT data FROM reservation_snapshots WHERE id=$1',[snapshot.id])).rows[0].data,snapshot);
  assert.equal((await targetDb.query('SELECT state FROM reservation_attempts WHERE id=$1',[unsigned.attempt.id])).rows[0].state,'NEEDS_RECONCILIATION');
  assert.equal((await targetDb.query('SELECT state FROM reservation_attempts WHERE id=$1',[pending.attempt.id])).rows[0].state,'NEEDS_RECONCILIATION');
  assert.equal((await targetDb.query('SELECT state FROM reservation_attempts WHERE id=$1',[prepared.attempt.id])).rows[0].state,'CONFIRMED');
  assert.ok((await targetDb.query('SELECT revoked_at FROM identity_sessions')).rows[0].revoked_at);assert.equal(Number((await targetDb.query('SELECT sign_count FROM identity_identities LIMIT 1')).rows[0].sign_count),5);
  assert.equal((await targetDb.query('SELECT storage_key FROM reservation_media WHERE id=$1',[snapshot.map.mediaId])).rows[0].storage_key,bundle.payload.blobs[0].key);
  const verified=await importer.verifyRestoredMedia(bundle,applied.operationId,{dryRun:false});assert.equal(verified.mediaVerified,true);assert.equal(verified.requiresFreshCoverage,true);
  assert.equal(sha256(await restored.projects.readMedia(restored.host,snapshot.map.mediaId)),bundle.payload.blobs[0].hash);
  assert.ok((await targetDb.query('SELECT * FROM resource_limits')).rows.length>=bundle.payload.tables.resource_limits.length);
  await restored.transactions.submit(restored.brand,pending.attempt.id,{func:pending.signing.func,auth:pending.signing.auth});assert.equal(restored.chain.sends,0);
  await assert.rejects(importer.restore(bundle,{dryRun:false}),error=>error.code==='RESTORE_TARGET_NOT_EMPTY');
});
test('backup rejects corruption and cross-project rows before import; malformed source never reports a successful restore',async t=>{
  const f=await setup(t);await approved(f);await f.intake.change(true,{dryRun:false});f.config.enabled=false;f.config.intakeEnabled=false;const service=createBackupService({...f,now:()=>NOW}),bundle=await service.exportBackup();
  const changed=structuredClone(bundle);changed.payload.tables.reservation_projects[0].data.title='tampered';assert.throws(()=>service.validate(changed),error=>error.code==='BACKUP_MISMATCH');
  const crossed=structuredClone(bundle);crossed.payload.tables.reservation_media[0].project_id='f'.repeat(64);crossed.checksum=sha256(canonical(crossed.payload));assert.throws(()=>service.validate(crossed),error=>error.code==='BACKUP_PROJECT');
  assert.equal(typeof createRuntime({}).storage.remove,'function');
});
test('private storage distinguishes definite absence from failed reads and aborts over-size streams',async()=>{
  const key='reservations/'+'a'.repeat(64)+'.png';
  const missing=createPrivateStorage({token:'test',sdk:{async get(){return null;}}});await assert.rejects(missing.get(key),error=>error.status===404);
  const uncertain=createPrivateStorage({token:'test',sdk:{async get(){return{statusCode:403};}}});await assert.rejects(uncertain.get(key),error=>error.status===503);
  let canceled=false;const large=createPrivateStorage({token:'test',sdk:{async get(){return{statusCode:200,stream:new ReadableStream({start(controller){controller.enqueue(new Uint8Array(100));},cancel(){canceled=true;}})};}}});
  await assert.rejects(large.get(key,10),error=>error.code==='MEDIA_SIZE_MISMATCH');assert.equal(canceled,true);
});
test('restore media reserves transfer and Blob read atomically before GET; exhausted transfer leaves STAGED',async t=>{
  const source=await setup(t);await approved(source);await source.intake.change(true,{dryRun:false});source.config.enabled=false;source.config.intakeEnabled=false;
  const bundle=await createBackupService({...source,now:()=>NOW}).exportBackup();
  const targetDb=await testDatabase();t.after(()=>targetDb.close());const target=await fixture({db:targetDb,config:structuredClone(source.config),now:()=>NOW});
  let gets=0;const importer=createBackupService({...target,now:()=>NOW,storage:{...target.storage,async get(){gets++;return Buffer.from(bundle.payload.blobs[0].bytes,'base64');}}});
  const restored=await importer.restore(bundle,{dryRun:false});
  const used=async resource=>Number((await targetDb.query('SELECT used FROM resource_limits WHERE key=$1',['coverage:'+target.config.coverage.id+':'+resource])).rows[0]?.used??0);
  const beforeRead=await used('blobReadBytes'),beforeTransfer=await used('transferBytes');assert.ok(beforeTransfer>0);
  target.config.coverage.quotas.transferBytes=beforeTransfer;
  const result=await importer.verifyRestoredMedia(bundle,restored.operationId,{dryRun:false});
  assert.equal(gets,0);assert.equal(result.status,'NEEDS_RECONCILIATION');assert.equal(result.mediaVerified,false);assert.equal(result.results[0].state,'STAGED');assert.equal(result.results[0].code,'RATE_LIMIT');
  assert.equal(await used('blobReadBytes'),beforeRead,'The failed transfer reservation must also roll back the Blob allowance.');assert.equal(await used('transferBytes'),beforeTransfer);
  assert.equal((await targetDb.query('SELECT state FROM reservation_media WHERE id=$1',[bundle.payload.blobs[0].id])).rows[0].state,'STAGED');
});
