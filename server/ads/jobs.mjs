import {inspectUrl} from './urls.mjs';
import {uuid,event,sha256,enqueue} from './common.mjs';
export async function claimJob(db,owner,now=Date.now()){
 return db.transaction(async tx=>(await tx.query(`WITH candidate AS (SELECT id FROM ads_outbox WHERE available_at<=$1 AND (status='READY' OR (status='RUNNING' AND lease_until<=$1)) ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE ads_outbox o SET status='RUNNING',attempts=o.attempts+1,lease_owner=$2,lease_until=$3,lease_version=o.lease_version+1 FROM candidate c WHERE o.id=c.id RETURNING o.*`,[new Date(now),owner,new Date(now+30000)])).rows[0]||null);
}
export function createJobRunner({db,config,creative,payments,registry,now=Date.now,owner=uuid()}){
 async function generate(job){
  const context=await db.transaction(async tx=>{
   const {rows:[order]}=await tx.query('SELECT o.*,r.brief,r.logo_id,r.manifest,r.manifest_hash,r.verdict,r.state AS revision_state,u.storage_key,u.hash AS logo_hash,u.mime,u.width,u.height FROM ads_orders o JOIN ads_revisions r ON r.id=o.revision_id JOIN ads_uploads u ON u.id=r.logo_id WHERE o.id=$1 FOR UPDATE OF o',[job.aggregate_id]);
   if(!order||order.suspended||!['QUEUED','LIVE'].includes(order.state))return null;
   if(job.payload.revisionId&&job.payload.revisionId!==order.revision_id)return null;
   if(order.manifest){
    if(order.revision_state!=='AUDITED'||!order.verdict?.allowed||order.verdict.reviewedHash!==order.manifest_hash||sha256(order.manifest)!==order.manifest_hash||order.manifest.revisionId!==order.revision_id||!Array.isArray(order.manifest.artifacts)||!order.quote.placements.every(p=>order.manifest.artifacts.some(a=>(a.placement||a.placementId)===p)))throw Error('Stored manifest is not auditable.');
    await tx.query("UPDATE ads_orders SET queue_state='SCHEDULED',design_fulfilled=true,updated_at=now() WHERE id=$1",[order.id]);
    await tx.query("UPDATE ads_placements SET state='SCHEDULED' WHERE order_id=$1 AND delivered_units<required_units",[order.id]);
    await enqueue(tx,'registry',order.id,'registry:commit:'+order.id+':'+order.revision_id,{operation:'commit'});return {already:true};
   }
   const inserted=await tx.query("INSERT INTO ads_generation_attempts(order_id,state,job_id,revision_id) VALUES($1,'RUNNING',$2,$3) ON CONFLICT(order_id,revision_id) DO NOTHING RETURNING order_id",[order.id,job.id,order.revision_id]);
   if(!inserted.rowCount){
    await tx.query("UPDATE ads_orders SET state='QUARANTINED',queue_state=NULL,reason='Interrupted generation requires review; it will not spend another model budget automatically' WHERE id=$1",[order.id]);
    await event(tx,order.id,'worker','GENERATION_INTERRUPTED');return null;
   }
   await tx.query("UPDATE ads_orders SET queue_state='PROCESSING',updated_at=now() WHERE id=$1",[order.id]);return order;
  });
  if(!context||context.already)return;
  let output;
  try{output=await creative.generate({brief:context.brief,logo:{id:context.logo_id,key:context.storage_key,hash:context.logo_hash,mime:context.mime,width:context.width,height:context.height},revisionId:context.revision_id,placements:context.quote.placements});}
  catch{output={verdict:{allowed:false,state:'QUARANTINED',reasons:[{code:'GENERATION_FAILED',message:'Creative generation failed; the paid obligation remains unresolved.'}]}};}
  await db.transaction(async tx=>{
   const {rows:[active]}=await tx.query("SELECT id FROM ads_outbox WHERE id=$1 AND lease_owner=$2 AND lease_version=$3 AND status='RUNNING' AND lease_until>$4 FOR UPDATE",[job.id,owner,job.lease_version,new Date(now())]);
   if(!active)throw Error('Worker lease lost; result cannot be published.');
   const {rows:[order]}=await tx.query('SELECT * FROM ads_orders WHERE id=$1 FOR UPDATE',[context.id]);if(order.suspended||order.revision_id!==context.revision_id)return;
   await tx.query("UPDATE ads_orders SET queue_state='AUDITING' WHERE id=$1",[order.id]);
   const allowed=output.verdict?.allowed&&output.verdict.reviewedHash===output.manifestHash&&output.manifest?.revisionId===order.revision_id&&sha256(output.manifest)===output.manifestHash&&context.quote.placements.every(p=>output.artifacts?.some(a=>(a.placement||a.placementId)===p));
   if(!allowed){
    const state=output.verdict?.state==='BLOCKED'?'BLOCKED':'QUARANTINED';
    await tx.query('UPDATE ads_orders SET state=$2,queue_state=NULL,reason=$3 WHERE id=$1',[order.id,state,output.verdict?.reasons?.map(r=>r.message).join('; ')||'Final audit failed']);
    await tx.query('UPDATE ads_revisions SET state=$2,verdict=$3 WHERE id=$1',[order.revision_id,state,output.verdict||{}]);
    await tx.query("UPDATE ads_generation_attempts SET state='QUARANTINED' WHERE order_id=$1 AND revision_id=$2",[order.id,order.revision_id]);await event(tx,order.id,'auditor',state,{verdict:output.verdict});return;
   }
   await tx.query("UPDATE ads_revisions SET state='AUDITED',manifest=$2,manifest_hash=$3,verdict=$4 WHERE id=$1 AND manifest IS NULL",[order.revision_id,output.manifest,output.manifestHash,output.verdict]);
   const activeBatch=(await tx.query("SELECT ends_at FROM ads_fulfillment_batches WHERE order_id=$1 AND state='OPEN'",[order.id])).rows[0];
   const missed=+(new Date(activeBatch?.ends_at||order.quote.endsAt))<=now();
   await tx.query("UPDATE ads_orders SET queue_state=$2,reason=$3,design_fulfilled=true,state=CASE WHEN $2::text IS NULL THEN 'RECONCILIATION_REQUIRED' ELSE state END,updated_at=now() WHERE id=$1",[order.id,missed?null:'SCHEDULED',missed?'Generation completed after the delivery window; remedy required':null]);
   await tx.query("UPDATE ads_placements SET state=$2 WHERE order_id=$1",[order.id,missed?'FAILED':'SCHEDULED']);
   await tx.query("UPDATE ads_generation_attempts SET state='COMPLETED' WHERE order_id=$1 AND revision_id=$2",[order.id,order.revision_id]);await enqueue(tx,'registry',order.id,'registry:commit:'+order.id+':'+order.revision_id,{operation:'commit'});await event(tx,order.id,'auditor','AUDIT_PASSED',{manifestHash:output.manifestHash,missed});
  });
 }
 async function runOnce(){
  const job=await claimJob(db,owner,now());if(!job)return false;
  const heartbeat=setInterval(()=>db.query("UPDATE ads_outbox SET lease_until=$4 WHERE id=$1 AND lease_owner=$2 AND lease_version=$3 AND status='RUNNING'",[job.id,owner,job.lease_version,new Date(now()+30000)]).catch(()=>{}),10000);
  heartbeat.unref?.();
  try{
   if(job.topic==='creative')await generate(job);
   else if(job.topic==='payment-reconcile'){const result=await payments.reconcile(job.payload.attemptId);if(!['SETTLED','FAILED'].includes(result.paymentState))throw Error('Payment remains ambiguous; retain reconciliation job.');}
   else if(job.topic==='cta-check'){
    const order=(await db.query('SELECT o.*,r.manifest FROM ads_orders o JOIN ads_revisions r ON r.id=o.revision_id WHERE o.id=$1',[job.aggregate_id])).rows[0];
    if(order&&!order.suspended&&['QUEUED','LIVE'].includes(order.state)){
     try{for(const cta of order.manifest?.cta||[]){const checked=await inspectUrl(cta.url,{allowedDomains:config.allowedDomains});if(checked.url!==cta.url)throw Error('Destination changed');}}
     catch{await db.transaction(async tx=>{
      await tx.query("UPDATE ads_orders SET suspended=true,state='QUARANTINED',reason='Destination changed or cannot be safely verified',queue_state=NULL WHERE id=$1",[order.id]);
      await tx.query("UPDATE ads_placements SET state='PAUSED' WHERE order_id=$1",[order.id]);await tx.query('UPDATE ads_playlist SET active=NULL,valid_until=now() WHERE order_id=$1',[order.id]);await tx.query('DELETE FROM ads_publisher_acks WHERE order_id=$1',[order.id]);await event(tx,order.id,'destination-monitor','DESTINATION_QUARANTINE');
     });}
    }
   }
   else if(job.topic==='registry'&&registry){
    // Registry preparation is deliberately independent of payment. Never imply a deployed contract.
    await registry.syncOrder(job.aggregate_id);
   }else if(job.topic!=='registry')throw Error('Unknown durable job type');
   await db.query("UPDATE ads_outbox SET status='DONE',lease_until=NULL WHERE id=$1 AND lease_owner=$2 AND lease_version=$3 AND lease_until>$4",[job.id,owner,job.lease_version,new Date(now())]);return true;
  }catch(error){
   const code=/^[A-Za-z0-9_.-]{1,80}$/.test(error?.code||'')?error.code:'worker_step_failed';
   await event(db,job.aggregate_id,'worker','JOB_RETRY',{jobId:job.id,topic:job.topic,attempt:job.attempts,code});
   await db.query("UPDATE ads_outbox SET status=CASE WHEN attempts>=8 THEN 'FAILED' ELSE 'READY' END,last_error=$4,available_at=$5,lease_until=NULL WHERE id=$1 AND lease_owner=$2 AND lease_version=$3",[job.id,owner,job.lease_version,code,new Date(now()+Math.min(300000,1000*2**job.attempts))]);return true;
  }finally{clearInterval(heartbeat);}
 }
 return {runOnce,owner};
}
