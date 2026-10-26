import {assert,uuid,sha256,event,enqueue} from './common.mjs';
import {lockInventory,assignFulfillmentReservations,reserveSchedule} from './scheduler.mjs';
const iso=v=>new Date(v).toISOString();
export const isPilotFulfillment=order=>order?.quote?.offerId==='main-stage-test-5m'&&order.quote.offerVersion===2&&order.quote.plan==='PASSES'&&Number(order.quote.requiredUnits)===5;
export async function ensureFulfillment(tx,order,now=Date.now()){
 if(!isPilotFulfillment(order))return null;
 const q=order.quote;
 await tx.query("INSERT INTO ads_fulfillment_batches(id,order_id,sequence,starts_at,ends_at,required_units,state,terms_hash,terms,created_at) VALUES($1,$1,0,$2,$3,5,'OPEN',$4,$5,$6) ON CONFLICT(id) DO NOTHING",[order.id,new Date(q.startsAt),new Date(q.endsAt),order.terms_hash,q,order.created_at||new Date(now)]);
 await tx.query("INSERT INTO ads_fulfillment_units(order_id,placement_id,number,assigned_batch_id) SELECT $1,'main_stage_screen',n,$1 FROM generate_series(1,5) n ON CONFLICT DO NOTHING",[order.id]);
 await assignFulfillmentReservations(tx,order.id,now);
 return (await tx.query("SELECT * FROM ads_fulfillment_batches WHERE order_id=$1 AND state='OPEN'",[order.id])).rows[0]||null;
}
export function playbackStatus({playlist,ack,lease,now=Date.now(),config,completed=false}={}){
 const durationMs=Number.isSafeInteger(playlist?.active?.passMs)&&playlist.active.passMs>0?playlist.active.passMs:60000,validUntil=iso(Math.min(now+(config.manifestMs||2000),playlist?.valid_until?+new Date(playlist.valid_until):now+(config.manifestMs||2000)));
 const idle={phase:'IDLE',passId:null,durationMs,startedAt:null,confirmedThrough:null,remainingMs:null,validUntil};
 if(!playlist?.active||playlist.active.plan!=='PASSES'||completed)return idle;
 const base={...idle,phase:ack?'PAUSED':'STARTING',passId:ack?.pass_id||playlist.active.passId||null};
 const fresh=ack&&lease&&(!playlist.active.passId||playlist.active.passId===ack.pass_id)&&(!playlist.active.batchId||playlist.active.batchId===ack.batch_id)&&(!playlist.order_id||playlist.order_id===ack.order_id)&&(!playlist.revision_id||playlist.revision_id===ack.revision_id)&&(!playlist.manifest_hash||playlist.manifest_hash===ack.manifest_hash)&&Number(lease.fence)===Number(ack.fence)&&Number(playlist.version)===Number(ack.version)&&+new Date(lease.expires_at)>now&&now-+new Date(ack.ack_at)<=(config.heartbeatMs||1000)*2.5&&+new Date(playlist.valid_until)>now;
 if(!fresh||!ack.pass_started_at)return base;
 const started=+new Date(ack.pass_started_at),confirmed=+new Date(ack.ack_at);
 return {...base,phase:'PLAYING',startedAt:iso(started),confirmedThrough:iso(confirmed),remainingMs:Math.max(0,Math.min(durationMs,durationMs-(now-started))),validUntil:iso(Math.min(+new Date(validUntil),+new Date(lease.expires_at),confirmed+(config.heartbeatMs||1000)*2.5))};
}
export async function placementPlayback(db,placementId,{config,now=Date.now(),orderId}={}){
 const playlist=(await db.query('SELECT * FROM ads_playlist WHERE placement_id=$1',[placementId])).rows[0];
 if(orderId&&playlist?.order_id!==orderId)return playbackStatus({config,now});
 const ack=(await db.query('SELECT * FROM ads_publisher_acks WHERE placement_id=$1',[placementId])).rows[0];
 const lease=(await db.query("SELECT * FROM ads_leases WHERE name='publisher'")).rows[0];
 const completed=ack?.unit_number?(await db.query('SELECT completed_at FROM ads_fulfillment_units WHERE order_id=$1 AND placement_id=$2 AND number=$3',[ack.order_id,placementId,ack.unit_number])).rows[0]?.completed_at:false;
 return playbackStatus({playlist,ack,lease,config,now,completed:Boolean(completed)});
}
export async function fulfillmentStatus(db,order,{config,now=Date.now()}={}){
 if(!isPilotFulfillment(order))return null;
 const batches=(await db.query('SELECT * FROM ads_fulfillment_batches WHERE order_id=$1 ORDER BY sequence',[order.id])).rows;
 if(!batches.length)return null;
 const paid=(await db.query("SELECT 1 FROM ads_payment_attempts WHERE order_id=$1 AND state='SETTLED'",[order.id])).rowCount>0;
 const units=(await db.query('SELECT * FROM ads_fulfillment_units WHERE order_id=$1 ORDER BY number',[order.id])).rows;
 const slots=(await db.query("SELECT * FROM ads_reservations WHERE order_id=$1 AND state IN ('HELD','COMMITTED') AND ends_at>$2 ORDER BY starts_at,id",[order.id,new Date(now)])).rows;
 const playback=await placementPlayback(db,'main_stage_screen',{config,now,orderId:order.id});
 const open=batches.find(b=>b.state==='OPEN'),current=open||batches.at(-1);
 const lead=order.quote.renderLeadMs??config.renderLeadMs??0;
 const view=units.map(u=>{const slot=slots.find(s=>s.unit_number===u.number&&s.batch_id===u.assigned_batch_id),batch=batches.find(b=>b.id===u.assigned_batch_id);return{number:Number(u.number),status:u.completed_at?'COMPLETED':slot&&playback.phase==='PLAYING'&&playback.passId===slot.pass_id?'ACTIVE':slot?'SCHEDULED':paid&&(!batch||batch.state!=='OPEN'||+new Date(batch.ends_at)<=now)?'DEBT':'PENDING',estimatedStartsAt:slot?iso(+new Date(slot.starts_at)+lead):null,estimatedEndsAt:slot?iso(+new Date(slot.starts_at)+lead+(order.quote.passMs||60000)):null,completedAt:u.completed_at?iso(u.completed_at):null,batchId:u.assigned_batch_id};});
 const next=view.filter(u=>u.status==='SCHEDULED'&&u.estimatedStartsAt&&Date.parse(u.estimatedStartsAt)>now).map(u=>u.estimatedStartsAt).sort()[0]||null;
 const fresh=(await db.query('SELECT fulfillment_version FROM ads_orders WHERE id=$1',[order.id])).rows[0];
 return{version:Number(fresh.fulfillment_version),serverTime:iso(now),window:{startsAt:iso(current.starts_at),endsAt:iso(current.ends_at)},units:view,nextEstimatedAt:next,estimated:true,batches:batches.map(b=>({id:b.id,sequence:b.sequence,status:b.state,required:Number(b.required_units),delivered:Number(b.delivered_units),startsAt:iso(b.starts_at),endsAt:iso(b.ends_at),termsHash:b.terms_hash})),playback};
}
function gap(start,duration,end,blocks){let cursor=start;for(const b of blocks){if(cursor>=b.end)continue;if(cursor+duration<=b.start)break;cursor=Math.max(cursor,b.end);}return cursor+duration<=end?cursor:null;}
/** Uses only free complete gaps: accepted reservations and ongoing passes never move here. */
export async function recoverFulfillment(tx,{config,now=Date.now()}={}){
 await lockInventory(tx,['main_stage_screen']);
 let recovered=0,closed=0;
 const batches=(await tx.query("SELECT b.*,o.quote,o.created_at AS order_created_at,o.state AS order_state,o.suspended,o.queue_state,r.campaign_id,r.state AS revision_state FROM ads_fulfillment_batches b JOIN ads_orders o ON o.id=b.order_id JOIN ads_revisions r ON r.id=o.revision_id WHERE b.state='OPEN' AND EXISTS(SELECT 1 FROM ads_payment_attempts a WHERE a.order_id=o.id AND a.state='SETTLED') ORDER BY o.created_at,o.id,b.sequence")).rows;
 for(const b of batches){
  await tx.query('SELECT id FROM ads_orders WHERE id=$1 FOR UPDATE',[b.order_id]);
  if(+new Date(b.ends_at)>now)continue;
  await tx.query("UPDATE ads_fulfillment_batches SET state=CASE WHEN delivered_units=required_units THEN 'COMPLETED' ELSE 'CLOSED' END,closed_at=$2 WHERE id=$1 AND state='OPEN'",[b.id,new Date(now)]);
  await tx.query("UPDATE ads_reservations SET state='RELEASED' WHERE batch_id=$1 AND state IN ('HELD','COMMITTED')",[b.id]);
  await tx.query("UPDATE ads_placements SET state=CASE WHEN delivered_units=0 THEN 'FAILED' ELSE 'PARTIAL' END WHERE order_id=$1 AND delivered_units<required_units AND state<>'DISPUTED'",[b.order_id]);
  await tx.query('DELETE FROM ads_publisher_acks WHERE batch_id=$1',[b.id]);
  await tx.query("UPDATE ads_playlist SET active=NULL,valid_until=$2 WHERE order_id=$1",[b.order_id,new Date(now)]);
  await tx.query("UPDATE ads_orders SET fulfillment_version=fulfillment_version+1,state=CASE WHEN EXISTS(SELECT 1 FROM ads_fulfillment_units u WHERE u.order_id=ads_orders.id AND u.completed_at IS NULL) THEN 'RECONCILIATION_REQUIRED' ELSE state END,queue_state=NULL,reason=CASE WHEN EXISTS(SELECT 1 FROM ads_fulfillment_units u WHERE u.order_id=ads_orders.id AND u.completed_at IS NULL) THEN 'Incomplete passes remain owed; choose and consent to a new window' ELSE reason END WHERE id=$1",[b.order_id]);
  await enqueue(tx,'registry',b.order_id,'registry:batch-closed:'+b.id,{batchId:b.id});closed++;
 }
 const reservations=(await tx.query("SELECT * FROM ads_reservations WHERE placement_id='main_stage_screen' AND state IN ('HELD','COMMITTED') AND ends_at>$1 AND (state='COMMITTED' OR expires_at>$1) ORDER BY starts_at",[new Date(now)])).rows;
 const blocks=[...reservations.map(s=>({start:+new Date(s.starts_at),end:+new Date(s.ends_at)})),...(config.hostWindows||[]).filter(w=>w.placementId==='main_stage_screen').map(w=>({start:Date.parse(w.startsAt),end:Date.parse(w.endsAt)}))];
 const groups=new Map();
 for(const b of batches){if(+new Date(b.ends_at)<=now||b.suspended||!['QUEUED','LIVE'].includes(b.order_state)||b.queue_state!=='SCHEDULED'||b.revision_state!=='AUDITED')continue;
  if(!(await tx.query("SELECT 1 FROM ads_payment_attempts WHERE order_id=$1 AND state='SETTLED'",[b.order_id])).rowCount)continue;
  const units=(await tx.query('SELECT * FROM ads_fulfillment_units WHERE assigned_batch_id=$1 AND completed_at IS NULL ORDER BY number',[b.id])).rows.filter(u=>!reservations.some(s=>s.order_id===b.order_id&&s.unit_number===u.number&&s.batch_id===b.id));
  const key=b.campaign_id||b.order_id;if(!groups.has(key))groups.set(key,[]);for(const u of units)groups.get(key).push({batch:b,unit:u});
 }
 let progress=true;const changed=new Set();
 while(progress){progress=false;for(const group of groups.values()){
  const next=group[0];if(!next)continue;const {batch:b,unit:u}=next,duration=(b.quote.passMs||60000)+(b.quote.renderLeadMs??config.renderLeadMs??0);
  blocks.sort((a,b)=>a.start-b.start);const start=gap(Math.max(now+1,+new Date(b.starts_at)),duration,+new Date(b.ends_at),blocks);
  if(start===null){group.shift();progress=true;continue;}
  await tx.query("INSERT INTO ads_reservations(id,order_id,placement_id,starts_at,ends_at,expires_at,state,pass_id,delivery_units,batch_id,unit_number) VALUES($1,$2,'main_stage_screen',$3,$4,$5,'COMMITTED',$6,1,$7,$8)",[uuid(),b.order_id,new Date(start),new Date(start+duration),new Date(b.ends_at),uuid(),b.id,u.number]);
  blocks.push({start,end:start+duration});group.shift();progress=true;recovered++;changed.add(b.order_id);
 }}
 for(const id of changed){await tx.query('UPDATE ads_orders SET fulfillment_version=fulfillment_version+1 WHERE id=$1',[id]);await event(tx,id,'scheduler','PASS_RECOVERY_SCHEDULED',{withoutAdditionalCharge:true});}
 if(changed.size||closed)await tx.query("UPDATE ads_inventory SET schedule_version=schedule_version+1 WHERE id='main_stage_screen'");
 return{recovered,closed};
}
export async function reprogramFulfillment(tx,order,payload,config,now=Date.now()){
 assert(isPilotFulfillment(order),409,'fulfillment_not_supported','This order uses its original fulfillment rules.');
 assert(payload&&Object.keys(payload).every(key=>['startsAt','endsAt','fulfillmentVersion','accept'].includes(key)),400,'invalid_reprogram','Only a delivery window and explicit consent may be submitted.');
 assert(payload.accept===true&&Number.isSafeInteger(payload.fulfillmentVersion)&&payload.fulfillmentVersion===Number(order.fulfillment_version),409,'fulfillment_version_conflict','Refresh and explicitly accept the current outstanding delivery proposal.');
 const start=Date.parse(payload.startsAt),end=Date.parse(payload.endsAt);
 assert(Number.isFinite(start)&&Number.isFinite(end)&&start>=now+config.processingMs&&end>start&&end-start<=config.maxWindowMs,400,'invalid_window','Choose a valid new delivery window.');
 await ensureFulfillment(tx,order,now);
 const previous=(await tx.query('SELECT * FROM ads_fulfillment_batches WHERE order_id=$1 ORDER BY sequence DESC LIMIT 1 FOR UPDATE',[order.id])).rows[0];
 assert(+new Date(previous.ends_at)<=now,409,'fulfillment_window_open','Automatic recovery continues inside the current window.');
 const receipt=(await tx.query("SELECT settlement_tx FROM ads_payment_attempts WHERE order_id=$1 AND state='SETTLED'",[order.id])).rows[0];
 assert(receipt?.settlement_tx,409,'payment_not_confirmed','The original payment must be confirmed.');
 assert(!(await tx.query("SELECT 1 FROM ads_refunds WHERE order_id=$1 AND state<>'REJECTED'",[order.id])).rowCount,409,'refund_in_progress','Resolve the outstanding refund before assigning more delivery.');
 assert(!(await tx.query("SELECT 1 FROM ads_disputes WHERE order_id=$1 AND state='OPEN'",[order.id])).rowCount,409,'dispute_open','Resolve the open dispute before choosing another window.');
 const units=(await tx.query('SELECT number FROM ads_fulfillment_units WHERE order_id=$1 AND completed_at IS NULL ORDER BY number FOR UPDATE',[order.id])).rows;
 assert(units.length>0,409,'fulfillment_complete','All purchased passes have already been delivered.');
 await tx.query("UPDATE ads_fulfillment_batches SET state='CLOSED',closed_at=$2 WHERE order_id=$1 AND state='OPEN'",[order.id,new Date(now)]);
 await tx.query("UPDATE ads_reservations SET state='RELEASED' WHERE order_id=$1 AND state IN ('HELD','COMMITTED')",[order.id]);
 await tx.query('DELETE FROM ads_publisher_acks WHERE order_id=$1',[order.id]);
 await tx.query('UPDATE ads_playlist SET active=NULL,valid_until=$2 WHERE order_id=$1',[order.id,new Date(now)]);
 const id=uuid(),consentId=uuid(),terms={version:'fulfillment-v1',orderId:order.id,originalTermsHash:order.terms_hash,paymentReference:receipt.settlement_tx,parentBatchId:previous.id,parentTermsHash:previous.terms_hash,units:units.map(u=>Number(u.number)),window:{startsAt:iso(start),endsAt:iso(end)},consentId,additionalCharge:'0'};
 await tx.query('INSERT INTO ads_consents(id,order_id,owner_id,proposal) VALUES($1,$2,$3,$4)',[consentId,order.id,order.owner_id,terms]);
 await tx.query("INSERT INTO ads_fulfillment_batches(id,order_id,sequence,parent_batch_id,starts_at,ends_at,required_units,state,terms_hash,terms,consent_id) VALUES($1,$2,$3,$4,$5,$6,$7,'OPEN',$8,$9,$10)",[id,order.id,Number(previous.sequence)+1,previous.id,new Date(start),new Date(end),units.length,sha256(terms),terms,consentId]);
 await tx.query('UPDATE ads_fulfillment_units SET assigned_batch_id=$2 WHERE order_id=$1 AND completed_at IS NULL',[order.id,id]);
 const quote={...order.quote,startsAt:iso(start),endsAt:iso(end),requiredUnits:units.length,units:units.length};
 await reserveSchedule(tx,{...order,quote,state:'QUEUED'},config,now);
 const revision=(await tx.query('SELECT state FROM ads_revisions WHERE id=$1',[order.revision_id])).rows[0];
 await tx.query("UPDATE ads_orders SET state='QUEUED',queue_state=$2,reason=NULL,fulfillment_version=fulfillment_version+1 WHERE id=$1",[order.id,revision?.state==='AUDITED'?'SCHEDULED':'PROCESSING']);
 if(revision?.state!=='AUDITED')await enqueue(tx,'creative',order.id,'creative:'+order.id,{revisionId:order.revision_id});
 await tx.query("UPDATE ads_placements SET state='SCHEDULED' WHERE order_id=$1 AND delivered_units<required_units",[order.id]);
 await enqueue(tx,'registry',order.id,'registry:batch:'+id,{batchId:id});
 await event(tx,order.id,order.owner_id,'REPROGRAM_CONSENT',{batchId:id,consentId,deficit:units.length,additionalCharge:false});
 const current=(await tx.query('SELECT fulfillment_version FROM ads_orders WHERE id=$1',[order.id])).rows[0];
 return{orderId:order.id,batchId:id,status:'REPROGRAMMED',additionalCharge:false,fulfillmentVersion:Number(current.fulfillment_version)};
}
