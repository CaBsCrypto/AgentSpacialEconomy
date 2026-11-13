import { fail,uuid } from '../identity/common.mjs';
import { requireCapability } from './config.mjs';
import { lock } from './db.mjs';
export const RETENTION_MS=30*24*60*60*1000;
export function createMaintenanceService({db,config,storage,resources,now=Date.now}) {
  function cutoff(){return new Date(now()-RETENTION_MS);}
  async function inspect(tx,limit,resume=false) {
    const project=(await tx.query('SELECT * FROM reservation_projects WHERE id=$1',[config.projectId])).rows[0];
    if (!project) return {projectId:config.projectId,cutoff:cutoff().toISOString(),expireDraft:false,media:[]};
    if (project.owner_address!==config.hostAddress) fail(503,'PROJECT_OWNER_MISMATCH','The configured host does not own this project.');
    // Historical snapshots remain immutable, but they do not keep a later,
    // unpublished draft alive forever. An offer tied to the current revision
    // (including any unresolved attempt) protects that exact current revision.
    const linked=Number((await tx.query('SELECT count(*)::int AS count FROM reservation_offers o JOIN reservation_snapshots s ON s.id=o.snapshot_id WHERE o.project_id=$1 AND s.revision=$2',[config.projectId,project.revision])).rows[0].count);
    const old=new Date(project.updated_at).getTime()<cutoff().getTime();
    const expireDraft=old&&linked===0;
    const states=resume?['READY','STAGED','DELETING']:['READY','STAGED'];
    const media=(await tx.query("SELECT m.id,m.storage_key,m.byte_size,m.state FROM reservation_media m WHERE m.project_id=$1 AND m.created_at<$2 AND m.state=ANY($3::text[]) AND NOT EXISTS(SELECT 1 FROM reservation_snapshots s WHERE s.data#>>'{map,mediaId}'=m.id) AND NOT EXISTS(SELECT 1 FROM reservation_projects p WHERE p.data#>>'{map,mediaId}'=m.id AND (p.id<>$1 OR NOT $4)) ORDER BY m.created_at,m.id LIMIT $5",[config.projectId,cutoff(),states,expireDraft,limit])).rows;
    return {projectId:config.projectId,cutoff:cutoff().toISOString(),expireDraft,media};
  }
  async function cleanup({dryRun=true,limit=100,resume=false}={}) {
    if (!Number.isSafeInteger(limit)||limit<1||limit>100) fail(422,'MAINTENANCE_LIMIT','Inspect at most one hundred media records per run.');
    requireCapability(config,dryRun?'reading':'maintenance',now());
    if (dryRun) return {dryRun:true,...await inspect(db,limit,resume)};
    // Expiration is maintenance, never a side effect of loading a page.
    const id=uuid();
    const plan=await db.transaction(async tx=>{
      await lock(tx,'project:'+config.projectId);const current=await inspect(tx,limit,resume);
      if (current.expireDraft) {
        await tx.query("UPDATE reservation_projects SET data=$2,revision=revision+1,approved_snapshot_id=NULL,updated_at=$3 WHERE id=$1",[config.projectId,{title:'',context:'',spaces:[],map:null},new Date(now())]);
        await tx.query('DELETE FROM reservation_messages WHERE project_id=$1 AND created_at<$2',[config.projectId,cutoff()]);
      }
      if (!current.media.length&&!current.expireDraft) return current;
      await tx.query("INSERT INTO reservation_operations(id,project_id,kind,status,details) VALUES($1,$2,'CLEANUP','RUNNING',$3)",[id,config.projectId,current]);
      for(const media of current.media) await tx.query("UPDATE reservation_media SET state='DELETING' WHERE id=$1 AND project_id=$2",[media.id,config.projectId]);
      return current;
    });
    const results=[];
    for(const media of plan.media) {
      try {
        await resources.reserve([{resource:'blobDeleteCalls'},{resource:'transferBytes',amount:1024}]);
        await storage.remove(media.storage_key);
        await db.query("UPDATE reservation_media SET state='DELETED' WHERE id=$1 AND project_id=$2 AND state='DELETING'",[media.id,config.projectId]);
        results.push({id:media.id,state:'DELETED'});
      } catch(error) { results.push({id:media.id,state:'DELETING',code:error.code||'DELETE_UNCERTAIN'}); }
    }
    const status=results.some(value=>value.state==='DELETING')?'NEEDS_RECONCILIATION':'COMPLETED';
    if (plan.media.length||plan.expireDraft) await db.query('UPDATE reservation_operations SET status=$2,details=$3 WHERE id=$1',[id,status,{...plan,results}]);
    return {dryRun:false,operationId:plan.media.length||plan.expireDraft?id:null,status,expiredDraft:plan.expireDraft,results};
  }
  return {cleanup};
}
