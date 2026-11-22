import { canonical,exactKeys,fail,sha256,uuid } from '../identity/common.mjs';
import { requireCapability } from './config.mjs';
import { lock } from './db.mjs';
import { createIntakeService } from './intake.mjs';
const MAX_BYTES=64*1024*1024;
const COLUMNS={
  reservation_intake:['project_id','paused','revision','updated_at'],
  identity_identities:['owner_id','address','credential_id','authority_hash','sign_count','updated_at'],
  identity_challenges:['id','address','credential_id','challenge_hash','authority_hash','expires_at','consumed_at'],
  identity_sessions:['token_hash','owner_id','authority_hash','expires_at','revoked_at'],
  reservation_projects:['id','owner_address','revision','data','approved_snapshot_id','updated_at'],
  reservation_media:['id','project_id','owner_address','storage_key','content_hash','byte_size','state','width','height','created_at'],
  reservation_snapshots:['id','project_id','revision','data','content_hash','approved_at'],
  reservation_offers:['id','project_id','snapshot_id','state','holder','published_at','publish_hash'],
  reservation_attempts:['id','offer_id','actor_address','operation','state','preparation','signed_payload','tx_hash','receipt','expires_at','created_at','updated_at'],
  reservation_messages:['id','project_id','role','content','created_at'],
  resource_limits:['key','used'],
  gateway_budget_reservations:['id','consumer','owner_id','day','reserved_microusd','state','usage','created_at'],
  reservation_operations:['id','project_id','kind','status','manifest_hash','details','created_at'],
};
const normalize=value=>JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item));
function paused(config){if(config.enabled!==false||config.intakeEnabled!==false)fail(409,'BACKUP_REQUIRES_PAUSE','Pause new operations on every instance before backup or restoration.');}
export function createBackupService({db,config,storage,resources,now=Date.now,intake=createIntakeService({db,config,now})}) {
  async function exportBackup({includeMedia=true}={}) {
    paused(config);requireCapability(config,'reading',now());
    const tables=await db.transaction(async tx=>{
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await intake.requirePaused(tx);
      await lock(tx,'project:'+config.projectId);
      const project=(await tx.query('SELECT * FROM reservation_projects WHERE id=$1',[config.projectId])).rows[0];
      if(!project||project.owner_address!==config.hostAddress)fail(404,'PROJECT_NOT_FOUND','The configured host project was not found.');
      const result={reservation_projects:[project],reservation_intake:(await tx.query('SELECT * FROM reservation_intake WHERE project_id=$1',[config.projectId])).rows};
      for(const table of ['reservation_media','reservation_snapshots','reservation_offers','reservation_messages','reservation_operations'])result[table]=(await tx.query(`SELECT * FROM ${table} WHERE project_id=$1`,[config.projectId])).rows;
      result.reservation_attempts=(await tx.query('SELECT a.* FROM reservation_attempts a JOIN reservation_offers o ON o.id=a.offer_id WHERE o.project_id=$1',[config.projectId])).rows;
      const addresses=[...new Set([config.hostAddress,...result.reservation_attempts.map(row=>row.actor_address)])];
      result.identity_identities=(await tx.query('SELECT * FROM identity_identities WHERE address=ANY($1::text[])',[addresses])).rows;
      result.identity_challenges=(await tx.query('SELECT * FROM identity_challenges WHERE address=ANY($1::text[])',[addresses])).rows;
      result.identity_sessions=(await tx.query('SELECT s.* FROM identity_sessions s JOIN identity_identities i ON i.owner_id=s.owner_id WHERE i.address=ANY($1::text[])',[addresses])).rows;
      for(const table of ['resource_limits','gateway_budget_reservations'])result[table]=(await tx.query(`SELECT * FROM ${table}`)).rows;
      return normalize(result);
    });
    const blobs=[];let size=Buffer.byteLength(JSON.stringify(tables));
    if(size>MAX_BYTES||Object.values(tables).some(rows=>rows.length>10000))fail(413,'BACKUP_LIMIT','Use the reviewed native PostgreSQL backup procedure for this data volume.');
    if(includeMedia){requireCapability(config,'mediaRead',now());
      for(const media of tables.reservation_media.filter(row=>row.state==='READY')){
        if(size+media.byte_size*1.4>MAX_BYTES)fail(413,'BACKUP_LIMIT','The bounded backup would exceed 64 MiB.');
        await resources.reserve([{resource:'blobReadBytes',amount:media.byte_size},{resource:'transferBytes',amount:media.byte_size}]);
        const bytes=Buffer.from(await storage.get(media.storage_key,media.byte_size));
        if(bytes.length!==media.byte_size||sha256(bytes)!==media.content_hash)fail(503,'BACKUP_MEDIA_INTEGRITY','A private image could not be verified for backup.');
        const item={id:media.id,key:media.storage_key,hash:media.content_hash,bytes:bytes.toString('base64')};blobs.push(item);size+=Buffer.byteLength(JSON.stringify(item));
      }
      // Include the conservative cost of making this backup, rather than restoring
      // counters from before these private Blob reads.
      tables.resource_limits=normalize((await db.query('SELECT * FROM resource_limits')).rows);
    }
    const payload={formatVersion:2,createdAt:new Date(now()).toISOString(),network:config.network,projectId:config.projectId,hostAddress:config.hostAddress,contractId:config.contractId,contractWasmHash:config.contractWasmHash,requiresFreshCoverage:true,mediaIncluded:includeMedia,tables,blobs};
    const result={payload,checksum:sha256(canonical(payload))};validate(result);return result;
  }
  function validate(bundle){
    exactKeys(bundle,['payload','checksum']);const payload=bundle.payload;
    if(Buffer.byteLength(JSON.stringify(bundle))>MAX_BYTES)fail(413,'BACKUP_LIMIT','The backup exceeds the bounded import size.');
    if(!payload||![1,2].includes(payload.formatVersion)||payload.network!=='stellar:testnet'||payload.projectId!==config.projectId||payload.hostAddress!==config.hostAddress||payload.contractId!==config.contractId||payload.contractWasmHash!==config.contractWasmHash||sha256(canonical(payload))!==bundle.checksum)fail(422,'BACKUP_MISMATCH','The backup integrity or configured project binding does not match.');
    exactKeys(payload.tables,Object.keys(COLUMNS).filter(table=>payload.formatVersion===2||table!=='reservation_intake'));
    for(const [table,columns] of Object.entries(COLUMNS)){
      if(table==='reservation_intake'&&payload.formatVersion===1)continue;
      const rows=payload.tables[table];if(!Array.isArray(rows)||rows.length>10000)fail(422,'BACKUP_TABLE','The backup table is invalid or too large.');
      for(const row of rows){exactKeys(row,columns);if('project_id'in row&&row.project_id!==config.projectId)fail(422,'BACKUP_PROJECT','The backup contains another project.');}
    }
    if(payload.tables.reservation_intake?.length>1||payload.tables.reservation_intake?.some(row=>typeof row.paused!=='boolean'||!Number.isSafeInteger(Number(row.revision))||Number(row.revision)<1||!Number.isSafeInteger(Number(row.revision)+1)))fail(422,'BACKUP_INTAKE','The admission record is invalid.');
    if(payload.tables.reservation_projects.length!==1||payload.tables.reservation_projects[0].id!==config.projectId||payload.tables.reservation_projects[0].owner_address!==config.hostAddress)fail(422,'BACKUP_PROJECT','The backup project does not match.');
    const media=new Map(payload.tables.reservation_media.map(row=>[row.id,row])),seen=new Set();
    if(!Array.isArray(payload.blobs))fail(422,'BACKUP_MEDIA','The backup media manifest is invalid.');
    for(const blob of payload.blobs){exactKeys(blob,['id','key','hash','bytes']);const row=media.get(blob.id),bytes=Buffer.from(blob.bytes,'base64');
      if(!row||seen.has(blob.id)||row.state!=='READY'||blob.key!==row.storage_key||blob.key!=='reservations/'+row.id+'.png'||blob.hash!==row.content_hash||sha256(bytes)!==blob.hash||bytes.length!==row.byte_size||bytes.toString('base64')!==blob.bytes)fail(422,'BACKUP_MEDIA','The backup contains an invalid image or storage key.');seen.add(blob.id);
    }
    if(payload.mediaIncluded&&payload.tables.reservation_media.some(row=>row.state==='READY'&&!seen.has(row.id)))fail(422,'BACKUP_MEDIA_MISSING','A ready image is missing from the complete backup.');
    return payload;
  }
  async function restore(bundle,{dryRun=true}={}) {
    paused(config);requireCapability(config,'reading',now());const payload=validate(bundle);
    // V1 archives predate shared admission. Both versions always restore CLOSED;
    // preserved budgets and attempts never authorize reopening by themselves.
    const tables={...payload.tables,reservation_intake:[{project_id:config.projectId,paused:true,revision:Number(payload.tables.reservation_intake?.[0]?.revision??0)+1,updated_at:new Date(now()).toISOString()}]};
    const counts=Object.fromEntries(Object.entries(tables).map(([table,rows])=>[table,rows.length]));
    if(dryRun)return{dryRun:true,projectId:config.projectId,counts,mediaCount:payload.blobs.length,requiresFreshCoverage:true};
    const operationId=uuid();
    await db.transaction(async tx=>{
      await lock(tx,'reservation-restore');
      await intake.requirePaused(tx);
      for(const table of Object.keys(COLUMNS))if(Number((await tx.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count)!==0)fail(409,'RESTORE_TARGET_NOT_EMPTY','Restore only into an empty migrated schema; never merge or overwrite live state.');
      for(const [table,columns] of Object.entries(COLUMNS))for(const original of tables[table]){
        const row={...original};
        if(table==='identity_sessions')row.revoked_at=new Date(now()).toISOString();
        if(table==='identity_challenges')row.consumed_at=row.consumed_at||new Date(now()).toISOString();
        if(table==='reservation_media'&&row.state==='READY')row.state='STAGED';
        if(table==='reservation_attempts'&&row.state==='PREPARED')row.state='NEEDS_RECONCILIATION';
        if(table==='gateway_budget_reservations'&&['RESERVED','SENT'].includes(row.state))row.state='UNKNOWN';
        const values=columns.map(column=>['data','content','preparation','signed_payload','receipt','usage','details'].includes(column)&&row[column]!==null?JSON.stringify(row[column]):row[column]);
        await tx.query(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map((_value,index)=>'$'+(index+1)).join(',')})`,values);
      }
      await tx.query("INSERT INTO reservation_operations(id,project_id,kind,status,manifest_hash,details) VALUES($1,$2,'RESTORE','RUNNING',$3,$4)",[operationId,config.projectId,bundle.checksum,{counts,mediaVerified:false,requiresFreshCoverage:true}]);
    });
    return {dryRun:false,operationId,status:'RUNNING',counts,mediaVerified:false,requiresFreshCoverage:true};
  }
  async function verifyRestoredMedia(bundle,operationId,{dryRun=true}={}) {
    paused(config);const payload=validate(bundle);requireCapability(config,dryRun?'reading':'mediaRead',now());
    await intake.requirePaused();
    const operation=(await db.query("SELECT * FROM reservation_operations WHERE id=$1 AND project_id=$2 AND kind='RESTORE' AND manifest_hash=$3",[operationId,config.projectId,bundle.checksum])).rows[0];
    if(!operation)fail(404,'RESTORE_OPERATION_NOT_FOUND','The matching restore operation was not found.');
    if(dryRun)return{dryRun:true,operationId,mediaCount:payload.blobs.length};
    if(!payload.mediaIncluded)fail(409,'BACKUP_MEDIA_MISSING','A metadata-only backup needs the separately verified private image archive.');
    const results=[];
    for(const blob of payload.blobs){
      const original=payload.tables.reservation_media.find(row=>row.id===blob.id);
      try{
        await resources.reserve([{resource:'blobReadBytes',amount:original.byte_size},{resource:'transferBytes',amount:original.byte_size}]);
        let existing;
        try{existing=await storage.get(blob.key,original.byte_size);}catch(error){if(error.status!==404)throw error;}
        if(existing){if(sha256(existing)!==blob.hash)fail(503,'RESTORE_MEDIA_CONFLICT','An existing private image has different bytes.');}
        else{await resources.reserve([{resource:'blobWriteBytes',amount:original.byte_size},{resource:'transferBytes',amount:original.byte_size}]);await storage.put(Buffer.from(blob.bytes,'base64'),blob.id);}
        await db.query("UPDATE reservation_media SET state='READY' WHERE id=$1 AND project_id=$2 AND state='STAGED'",[blob.id,config.projectId]);results.push({id:blob.id,state:'READY'});
      }catch(error){results.push({id:blob.id,state:'STAGED',code:error.code||'RESTORE_MEDIA_UNCERTAIN'});}
    }
    const mediaVerified=results.every(row=>row.state==='READY'),status=mediaVerified?'COMPLETED':'NEEDS_RECONCILIATION';
    await db.query('UPDATE reservation_operations SET status=$2,details=$3 WHERE id=$1',[operationId,status,{results,mediaVerified,requiresFreshCoverage:true}]);
    return{dryRun:false,operationId,status,mediaVerified,requiresFreshCoverage:true,results};
  }
  return{exportBackup,validate,restore,verifyRestoredMedia};
}
