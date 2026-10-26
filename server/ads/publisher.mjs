import {ensureFulfillment,isPilotFulfillment,recoverFulfillment} from './fulfillment.mjs';
import {sign,verify,createPublicKey} from 'node:crypto';
import {assert,uuid,canonical,sha256,event,enqueue} from './common.mjs';
import {PLACEMENTS} from './config.mjs';
const iso=v=>new Date(v).toISOString();
export function signEvidence(evidence,privateKey){return sign(null,Buffer.from(canonical(evidence)),privateKey).toString('base64');}
export function verifyEvidence(evidence,signature,publicKey){try{return verify(null,Buffer.from(canonical(evidence)),publicKey,Buffer.from(signature,'base64'));}catch{return false;}}
export function deliveryInterval(previous,current,{now,slotStart,slotEnd,maxGapMs,requiredRemaining}){
 if(!previous||current.fence!==Number(previous.fence)||current.version!==Number(previous.version)||current.revisionId!==previous.revision_id||current.manifestHash!==previous.manifest_hash)return null;
 const from=Math.max(+new Date(previous.ack_at),slotStart),to=Math.min(now,slotEnd);
 if(now-+new Date(previous.ack_at)>maxGapMs||to<=from)return null;
 const units=Math.min(to-from,requiredRemaining);return units>0?{start:from,end:from+units,units}:null;
}
export function createPublisher({db,config,now=Date.now,owner=uuid()}){
 let fence=null;
 async function lease(){
  const {rows:[row]}=await db.query(`INSERT INTO ads_leases(name,owner,fence,expires_at) VALUES('publisher',$1,1,$2) ON CONFLICT(name) DO UPDATE SET owner=EXCLUDED.owner,fence=CASE WHEN ads_leases.owner=EXCLUDED.owner AND ads_leases.expires_at>$3 THEN ads_leases.fence ELSE ads_leases.fence+1 END,expires_at=EXCLUDED.expires_at WHERE ads_leases.owner=EXCLUDED.owner OR ads_leases.expires_at<=$3 RETURNING *`,[owner,new Date(now()+config.publisherLeaseMs),new Date(now())]);
  fence=row?Number(row.fence):null;return row;
 }
 async function schedule(){
  assert(fence!==null,409,'publisher_lease_required','Acquire publisher authority first.');
  await db.transaction(async tx=>{
   const valid=await tx.query("SELECT 1 FROM ads_leases WHERE name='publisher' AND owner=$1 AND fence=$2 AND expires_at>$3 FOR UPDATE",[owner,fence,new Date(now())]);assert(valid.rowCount,409,'publisher_fenced','Publisher authority expired.');
   const pilotOrders=(await tx.query("SELECT * FROM ads_orders WHERE state IN ('QUEUED','LIVE')")).rows.filter(isPilotFulfillment);
   for(const order of pilotOrders)await ensureFulfillment(tx,order,now());
   await recoverFulfillment(tx,{config,now:now()});
   for(const placementId of [...PLACEMENTS].sort()){
    await tx.query('SELECT id FROM ads_inventory WHERE id=$1 FOR UPDATE',[placementId]);
    const host=(config.hostWindows||[]).some(w=>w.placementId===placementId&&Date.parse(w.startsAt)<=now()&&Date.parse(w.endsAt)>now());
    const {rows:[slot]}=host?{rows:[]}:await tx.query(`SELECT s.*,o.revision_id,o.quote,o.state AS order_state,r.manifest,r.manifest_hash FROM ads_reservations s JOIN ads_orders o ON o.id=s.order_id JOIN ads_revisions r ON r.id=o.revision_id JOIN ads_placements p ON p.order_id=o.id AND p.placement_id=s.placement_id WHERE s.placement_id=$1 AND s.state='COMMITTED' AND s.starts_at<=$2 AND s.ends_at>$2 AND o.suspended=false AND o.state IN ('QUEUED','LIVE') AND o.queue_state='SCHEDULED' AND r.state='AUDITED' AND p.delivered_units<p.required_units AND p.state<>'DISPUTED' AND (s.batch_id IS NULL OR EXISTS(SELECT 1 FROM ads_fulfillment_batches b JOIN ads_fulfillment_units u ON u.assigned_batch_id=b.id WHERE b.id=s.batch_id AND b.state='OPEN' AND u.order_id=s.order_id AND u.placement_id=s.placement_id AND u.number=s.unit_number AND u.completed_at IS NULL)) AND EXISTS(SELECT 1 FROM ads_payment_attempts a WHERE a.order_id=o.id AND a.state='SETTLED') LIMIT 1`,[placementId,new Date(now())]);
    const previous=(await tx.query('SELECT * FROM ads_playlist WHERE placement_id=$1',[placementId])).rows[0];
    const artifact=slot?.manifest?.artifacts?.find(a=>(a.placement||a.placementId)===placementId);
    const active=artifact?{orderId:slot.order_id,revisionId:slot.revision_id,manifestHash:slot.manifest_hash,imageKey:artifact.key,imageUrl:'/api/ads/assets/'+artifact.key,imageHash:artifact.hash,alt:artifact.alt,cta:slot.manifest.cta||[],startsAt:iso(slot.starts_at),endsAt:iso(slot.ends_at),plan:slot.quote.plan,offerVersion:slot.quote.offerVersion??null,passMs:slot.quote.passMs||config.passMs,passId:slot.pass_id,batchId:slot.batch_id||null,unitNumber:slot.unit_number||null}:null;
    const changed=previous?.reservation_id!==(slot?.id||null)||previous?.manifest_hash!==(slot?.manifest_hash||null)||Boolean(previous?.active)!==Boolean(active);
    const version=changed?Number((await tx.query('UPDATE ads_inventory SET playlist_version=playlist_version+1 WHERE id=$1 RETURNING playlist_version',[placementId])).rows[0].playlist_version):Number(previous?.version||0);
    const until=active?Math.min(now()+config.manifestMs,+new Date(slot.ends_at)):now()+config.manifestMs;
    await tx.query(`INSERT INTO ads_playlist(placement_id,version,order_id,revision_id,reservation_id,manifest_hash,active,valid_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(placement_id) DO UPDATE SET version=EXCLUDED.version,order_id=EXCLUDED.order_id,revision_id=EXCLUDED.revision_id,reservation_id=EXCLUDED.reservation_id,manifest_hash=EXCLUDED.manifest_hash,active=EXCLUDED.active,valid_until=EXCLUDED.valid_until,updated_at=now()`,[placementId,version,active?slot.order_id:null,active?slot.revision_id:null,active?slot.id:null,active?slot.manifest_hash:null,active,new Date(until)]);
    if(changed)await tx.query('DELETE FROM ads_publisher_acks WHERE placement_id=$1',[placementId]);
   }
   await tx.query("UPDATE ads_reservations SET state='RELEASED' WHERE state='HELD' AND expires_at<=$1",[new Date(now())]);
   const expired=(await tx.query("SELECT DISTINCT o.id FROM ads_orders o JOIN ads_placements p ON p.order_id=o.id WHERE o.state IN ('QUEUED','LIVE') AND NOT EXISTS(SELECT 1 FROM ads_fulfillment_batches b WHERE b.order_id=o.id) AND (o.quote->>'endsAt')::timestamptz<=$1 AND p.delivered_units<p.required_units AND p.state NOT IN ('FAILED','PARTIAL','DISPUTED')",[new Date(now())])).rows;
   for(const row of expired){
    await tx.query('SELECT id FROM ads_orders WHERE id=$1 FOR UPDATE',[row.id]);
    await tx.query("UPDATE ads_placements SET state=CASE WHEN delivered_units=0 THEN 'FAILED' ELSE 'PARTIAL' END WHERE order_id=$1 AND delivered_units<required_units AND state<>'DISPUTED'",[row.id]);
    await tx.query("UPDATE ads_orders SET state='RECONCILIATION_REQUIRED',queue_state=NULL,reason='Delivery window expired with an unresolved placement deficit',updated_at=now() WHERE id=$1",[row.id]);
    await event(tx,row.id,'scheduler','DELIVERY_DEFICIT',{remedyRequired:true});
   }
  });
 }
 async function acknowledge(ack){
  if(!PLACEMENTS.includes(ack?.placementId)||!Number.isFinite(ack.frameAt)||now()-ack.frameAt>config.manifestMs||ack.frameAt>now()+100)return false;
  return db.transaction(async tx=>{
   const l=(await tx.query("SELECT * FROM ads_leases WHERE name='publisher' AND owner=$1 AND fence=$2 AND expires_at>$3 FOR UPDATE",[owner,fence,new Date(now())])).rows[0];if(!l)return false;
   await tx.query('SELECT id FROM ads_inventory WHERE id=$1 FOR UPDATE',[ack.placementId]);
   const p=(await tx.query('SELECT p.*,s.pass_id,s.starts_at,s.ends_at,s.batch_id,s.unit_number,s.state AS reservation_state,o.quote,o.suspended,o.state AS order_state FROM ads_playlist p JOIN ads_reservations s ON s.id=p.reservation_id JOIN ads_orders o ON o.id=p.order_id WHERE p.placement_id=$1 FOR UPDATE OF p,o',[ack.placementId])).rows[0];
   if(!p?.active||p.reservation_state!=='COMMITTED'||p.suspended||!['QUEUED','LIVE'].includes(p.order_state)||+new Date(p.valid_until)<=now()||ack.revisionId!==p.revision_id||ack.manifestHash!==p.manifest_hash||ack.imageHash!==p.active.imageHash||Number(ack.version)!==Number(p.version))return false;
   const progress=(await tx.query('SELECT * FROM ads_placements WHERE order_id=$1 AND placement_id=$2 FOR UPDATE',[p.order_id,ack.placementId])).rows[0];
   if(progress.state==='DISPUTED'||Number(progress.delivered_units)>=Number(progress.required_units))return false;
   if(ack.passId!==undefined&&ack.passId!==p.pass_id||ack.batchId!==undefined&&ack.batchId!==p.batch_id)return false;
   if(p.batch_id){const unit=(await tx.query("SELECT u.*,b.state AS batch_state FROM ads_fulfillment_units u JOIN ads_fulfillment_batches b ON b.id=u.assigned_batch_id WHERE u.order_id=$1 AND u.placement_id=$2 AND u.number=$3 FOR UPDATE OF u,b",[p.order_id,ack.placementId,p.unit_number])).rows[0];if(!unit||unit.completed_at||unit.assigned_batch_id!==p.batch_id||unit.batch_state!=='OPEN')return false;}
   const previous=(await tx.query('SELECT * FROM ads_publisher_acks WHERE placement_id=$1 FOR UPDATE',[ack.placementId])).rows[0];
   if(previous&&ack.frameAt<=+new Date(previous.ack_at))return false;
   const current={...ack,fence:Number(fence),version:Number(p.version)},gap=config.heartbeatMs*2.5;
   const continuous=previous&&current.fence===Number(previous.fence)&&current.version===Number(previous.version)&&ack.frameAt-+new Date(previous.ack_at)<=gap;
   let span=null,passStart=continuous&&previous.pass_started_at?+new Date(previous.pass_started_at):ack.frameAt;
   if(p.quote.plan==='PASSES'){
    const finish=passStart+(p.quote.passMs||config.passMs);
    if(continuous&&ack.frameAt>=finish&&finish<=+new Date(p.ends_at))span={start:passStart,end:finish,units:1,passId:p.pass_id};
   }else span=deliveryInterval(previous,current,{now:ack.frameAt,slotStart:+new Date(p.starts_at),slotEnd:+new Date(p.ends_at),maxGapMs:gap,requiredRemaining:Number(progress.required_units)-Number(progress.delivered_units)});
   if(span){
    const evidence={domain:'ADS_DELIVERY_V1',network:config.network,orderId:p.order_id,placementId:ack.placementId,revisionId:p.revision_id,manifestHash:p.manifest_hash,playlistVersion:Number(p.version),fence,startsAt:iso(span.start),endsAt:iso(span.end),units:span.units,passId:span.passId||null,...(p.batch_id?{batchId:p.batch_id,unitNumber:p.unit_number}:{}),nonce:uuid()};
    const signature=signEvidence(evidence,config.publisherKey);
    const recorded=await tx.query('INSERT INTO ads_delivery(id,order_id,placement_id,revision_id,manifest_hash,playlist_version,fence,starts_at,ends_at,units,pass_id,signature,publisher_key,evidence,batch_id,unit_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT DO NOTHING RETURNING id',[uuid(),p.order_id,ack.placementId,p.revision_id,p.manifest_hash,p.version,fence,new Date(span.start),new Date(span.end),span.units,span.passId||null,signature,config.publisherPublicKey,evidence,p.batch_id||null,p.unit_number||null]);
    if(recorded.rowCount){
     if(p.batch_id){const consumed=await tx.query('UPDATE ads_fulfillment_units SET completed_delivery_id=$4,completed_at=$5 WHERE order_id=$1 AND placement_id=$2 AND number=$3 AND assigned_batch_id=$6 AND completed_at IS NULL',[p.order_id,ack.placementId,p.unit_number,recorded.rows[0].id,new Date(span.end),p.batch_id]);assert(consumed.rowCount===1,409,'entitlement_already_completed','This purchased pass has already been consumed.');await tx.query("UPDATE ads_fulfillment_batches SET delivered_units=delivered_units+1,state=CASE WHEN delivered_units+1=required_units THEN 'COMPLETED' ELSE state END,closed_at=CASE WHEN delivered_units+1=required_units THEN $2 ELSE closed_at END WHERE id=$1",[p.batch_id,new Date(now())]);await tx.query('UPDATE ads_orders SET fulfillment_version=fulfillment_version+1 WHERE id=$1',[p.order_id]);}
     await tx.query("UPDATE ads_placements SET delivered_units=delivered_units+$3,state=CASE WHEN delivered_units+$3=required_units THEN 'FULFILLED' ELSE 'ACTIVE' END WHERE order_id=$1 AND placement_id=$2",[p.order_id,ack.placementId,span.units]);
     await tx.query("UPDATE ads_orders SET state='LIVE',updated_at=now() WHERE id=$1",[p.order_id]);
     await enqueue(tx,'registry',p.order_id,'registry:evidence:'+recorded.rows[0].id,{operation:'record_delivery',evidence,signature});
     const completed=(await tx.query("UPDATE ads_orders o SET state='COMPLETED',queue_state=NULL,updated_at=now() WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM ads_placements p WHERE p.order_id=o.id AND p.delivered_units<p.required_units) AND NOT EXISTS(SELECT 1 FROM ads_disputes d WHERE d.order_id=o.id AND d.state='OPEN') RETURNING id",[p.order_id])).rowCount;
     if(completed)await tx.query("UPDATE ads_reservations SET state='RELEASED' WHERE order_id=$1 AND state='COMMITTED' AND ends_at>$2",[p.order_id,new Date(now())]);
     await event(tx,p.order_id,'publisher',completed?'DELIVERY_COMPLETED':'DELIVERY_ATTESTED',{evidence,signature,trust:'Operator canonical renderer; no audience measurement.'});
    }
   }
   await tx.query(`INSERT INTO ads_publisher_acks(placement_id,order_id,revision_id,manifest_hash,image_hash,version,fence,ack_at,pass_id,pass_started_at,batch_id,unit_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(placement_id) DO UPDATE SET order_id=EXCLUDED.order_id,revision_id=EXCLUDED.revision_id,manifest_hash=EXCLUDED.manifest_hash,image_hash=EXCLUDED.image_hash,version=EXCLUDED.version,fence=EXCLUDED.fence,ack_at=EXCLUDED.ack_at,pass_id=EXCLUDED.pass_id,pass_started_at=EXCLUDED.pass_started_at,batch_id=EXCLUDED.batch_id,unit_number=EXCLUDED.unit_number`,[ack.placementId,p.order_id,p.revision_id,p.manifest_hash,ack.imageHash,p.version,fence,new Date(ack.frameAt),p.pass_id,new Date(passStart),p.batch_id||null,p.unit_number||null]);
   return true;
  });
 }
 return {lease,schedule,acknowledge,get fence(){return fence;},owner};
}
export async function runCanonicalRenderer({publisher,config,signal,browser:injected,browserFactory,launchOptions={},shouldContinue}){
 if(signal?.aborted)return {state:'ABORTED'};
 // Authority and heartbeats cover browser startup as well as navigation.
 assert(await publisher.lease(),409,'publisher_in_use','Another canonical publisher holds the lease.');
 let browser,context,timer,heartbeat,stopped=false,onAbort;
 const abortError=()=>Object.assign(new Error('Renderer stopped'),{name:'AbortError'});
 let rejectFailure;
 const failure=new Promise((_,reject)=>{rejectFailure=reject;});failure.catch(()=>{});
 const aborted=new Promise((_,reject)=>{onAbort=()=>reject(abortError());signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort();});aborted.catch(()=>{});
 const guard=work=>Promise.race([work,failure,aborted]);
 let finish;const completed=new Promise(resolve=>{finish=resolve;});
 timer=setInterval(()=>{
  if(heartbeat||stopped)return;
  heartbeat=(async()=>{if(!await publisher.lease())throw Error('Publisher lease lost');await publisher.schedule();if(shouldContinue&&!await shouldContinue())finish();})()
   .catch(rejectFailure).finally(()=>{heartbeat=null;});
 },config.heartbeatMs);
 try{
  const launch=browserFactory||((options)=>import('playwright').then(({chromium})=>chromium.launch(options)));
  const opening=Promise.resolve(injected||launch({headless:true,timeout:30000,...launchOptions})).then(async value=>{if(stopped&&!injected)await value.close();return value;});
  browser=await guard(opening);
  const origin=new URL(config.publisherOrigin).origin;
  context=await guard(browser.newContext({extraHTTPHeaders:{'x-ads-publisher':config.publisherToken||''}}));
  await guard(context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort()));
  const page=await guard(context.newPage());
  await guard(page.exposeBinding('__adsPublisherAck',async(_source,ack)=>!stopped&&!signal?.aborted&&publisher.acknowledge(ack)));
  await guard(publisher.schedule());
  const response=await guard(page.goto(origin+'/one16?publisher=1',{waitUntil:'domcontentloaded',timeout:60000}));
  assert(!response||response.ok(),503,'publisher_navigation_failed','The canonical venue did not load.');
  if(typeof page.url==='function')assert(new URL(page.url()).origin===origin&&new URL(page.url()).pathname==='/one16',503,'publisher_navigation_failed','The canonical venue redirected away from its admitted page.');
  await Promise.race([guard(new Promise(()=>{})),completed]);return {state:'COMPLETE'};
 }catch(error){if(error?.name!=='AbortError')throw error;return {state:'ABORTED'};}
 finally{
  stopped=true;clearInterval(timer);signal?.removeEventListener('abort',onAbort);
  if(heartbeat)await heartbeat;
  try{await context?.close();}finally{if(!injected)await browser?.close();}
 }
}
