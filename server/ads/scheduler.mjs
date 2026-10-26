import {AdsError,assert,integer,uuid} from './common.mjs';
import {PLACEMENTS,PLANS} from './config.mjs';
const time=v=>typeof v==='number'?v:Date.parse(v);
const overlap=(a,b)=>a.start<b.end&&b.start<a.end;
const capacity=()=>new AdsError(409,'capacity_unavailable','Insufficient capacity within the contracted window.');
export function buildDemand(order,config){
 assert(PLANS.includes(order.plan),400,'invalid_plan','Unknown plan.');
 config={...config,...Object.fromEntries(['timeUnitMs','passMs','rotationMs','exclusiveUnitMs','renderLeadMs'].filter(k=>order[k]!==undefined).map(k=>[k,order[k]]))};
 const units=integer(order.units,'units',{max:config.maxUnits});
 const start=time(order.startsAt),end=time(order.endsAt);
 assert(Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end-start<=config.maxWindowMs,400,'invalid_window','Invalid contract window.');
 const duration=order.plan==='TIME'?units*config.timeUnitMs:order.plan==='PASSES'?units*(config.passMs+(config.renderLeadMs||0)):end-start;
 assert(Number.isSafeInteger(duration)&&duration>0,400,'invalid_duration','Invalid delivery duration.');
 if(order.plan==='EXCLUSIVE')assert(duration===units*config.exclusiveUnitMs,400,'invalid_exclusive_units','Exclusive window must match the quoted units.');
 return {durationMs:duration,requiredUnits:order.plan==='PASSES'?units:duration,unit:order.plan==='PASSES'?'PASSES':'MILLISECONDS',turnMs:order.plan==='PASSES'?config.passMs+(config.renderLeadMs||0):config.rotationMs};
}
export function quotePrice(placements,plan,units,config){
 const lines=placements.map(placementId=>{
  const price=config.pricing?.[placementId]?.[plan];
  assert(price&&/^[0-9]+$/.test(price.unitAmount)&&/^[0-9]+$/.test(price.designAmount),503,'price_unconfigured','Prices must be explicitly configured.');
  return {placementId,plan,units,unitAmount:price.unitAmount,designAmount:price.designAmount,deliveryAmount:(BigInt(price.unitAmount)*BigInt(units)).toString(),amountUnits:(BigInt(price.unitAmount)*BigInt(units)+BigInt(price.designAmount)).toString()};
 });
 const amountUnits=lines.reduce((n,l)=>n+BigInt(l.amountUnits),0n).toString();assert(amountUnits.length<=39,400,'amount_limit','The configured amount exceeds the supported integer range.');return {lines,amountUnits};
}
/** Deterministic conservative admission: complete planning succeeds or no reservation is committed. */
export function planRotations(orders,hostBlocks,config){
 const sorted=[...orders].sort((a,b)=>time(a.committedAt)-time(b.committedAt)||a.id.localeCompare(b.id));
 const fixed=hostBlocks.map(b=>({start:time(b.start??b.startsAt),end:time(b.end??b.endsAt)}));
 const slots=[],rotating=[];
 for(const order of sorted){
  const demand=buildDemand(order,config),start=time(order.startsAt),end=time(order.endsAt);
  if(order.plan==='EXCLUSIVE'){
   const block={start,end};if(fixed.some(b=>overlap(b,block)))throw capacity();
   fixed.push(block);slots.push({orderId:order.id,campaignId:order.campaignId,start,end,plan:order.plan,passIndex:null,deliveryUnits:end-start});
  }else rotating.push({...order,...demand,start,end,remaining:demand.durationMs,passIndex:0});
 }
 fixed.sort((a,b)=>a.start-b.start);
 const groups=new Map();for(const o of rotating){const key=o.campaignId||o.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(o);}
 let cursor=rotating.length?Math.min(...rotating.map(o=>o.start)):0;
 let rounds=0;
 while([...groups.values()].some(g=>g.some(o=>o.remaining>0))){
  if(++rounds>100000)throw new AdsError(400,'schedule_too_large','Reduce units or increase rotation duration.');
  let progressed=false;
  for(const group of groups.values()){
   const o=group.find(x=>x.remaining>0);if(!o)continue;
   const duration=Math.min(o.turnMs,o.remaining),occupiedDuration=duration+(o.plan==='TIME'?(o.renderLeadMs??config.renderLeadMs??0):0);let start=Math.max(cursor,o.start);
   for(const block of fixed){if(start>=block.end)continue;if(start+occupiedDuration<=block.start)break;start=block.end;}
   const end=start+occupiedDuration;if(end>o.end)throw capacity();
   slots.push({orderId:o.id,campaignId:o.campaignId,start,end,plan:o.plan,passIndex:o.plan==='PASSES'?o.passIndex++:null,deliveryUnits:o.plan==='PASSES'?1:duration});
   o.remaining-=duration;cursor=end;progressed=true;
  }
  if(!progressed)throw capacity();
 }
 for(const o of rotating){
  const campaignDuration=rotating.filter(x=>(x.campaignId||x.id)===(o.campaignId||o.id)).reduce((n,x)=>n+x.durationMs,0);
  if(campaignDuration>(o.end-o.start)*config.maxCampaignSharePercent/100)throw capacity();
 }
 return slots.sort((a,b)=>a.start-b.start||a.orderId.localeCompare(b.orderId));
}
export async function lockInventory(tx,placements){
 assert(Array.isArray(placements)&&placements.length>0&&new Set(placements).size===placements.length&&placements.every(p=>PLACEMENTS.includes(p)),400,'invalid_placement','Select valid distinct digital placements.');
 for(const id of [...placements].sort())await tx.query('SELECT id FROM ads_inventory WHERE id=$1 FOR UPDATE',[id]);
}
/** Replan only unstarted rotations; active intervals and existing exclusives remain fixed. */
export async function reserveSchedule(tx,newOrder,config,now=Date.now()){
 const placements=newOrder.quote.placements;await lockInventory(tx,placements);
 await tx.query("UPDATE ads_reservations SET state='RELEASED' WHERE state='HELD' AND expires_at<=$1",[new Date(now)]);
 for(const placementId of [...placements].sort()){
  const {rows:existing}=await tx.query(`SELECT o.*,r.campaign_id,p.required_units,p.delivered_units FROM ads_orders o JOIN ads_revisions r ON r.id=o.revision_id JOIN ads_placements p ON p.order_id=o.id WHERE p.placement_id=$1 AND o.id<>$2 AND o.state IN ('RESERVED','PAYMENT_PENDING','QUEUED','LIVE') AND p.delivered_units<p.required_units AND (o.quote->>'endsAt')::timestamptz>$3 AND (o.state NOT IN ('RESERVED','PAYMENT_PENDING') OR (o.quote->>'expiresAt')::timestamptz>$3) ORDER BY o.created_at,o.id`,[placementId,newOrder.id,new Date(now)]);
  const {rows:fixedRows}=await tx.query("SELECT * FROM ads_reservations WHERE placement_id=$1 AND state IN ('HELD','COMMITTED') AND starts_at<=$2 AND ends_at>$2",[placementId,new Date(now)]);
  const blocks=[...(config.hostWindows||[]).filter(w=>w.placementId===placementId).map(w=>({start:time(w.startsAt),end:time(w.endsAt)})),...fixedRows.map(s=>({start:+new Date(s.starts_at),end:+new Date(s.ends_at)}))];
  const movable=[];
  for(const order of [...existing,newOrder]){
   const q=order.quote;
   const future=(await tx.query("SELECT * FROM ads_reservations WHERE order_id=$1 AND placement_id=$2 AND state IN ('HELD','COMMITTED') AND starts_at>$3",[order.id,placementId,new Date(now)])).rows;
   if(order.id!==newOrder.id&&q.plan==='EXCLUSIVE'){
    blocks.push(...future.map(s=>({start:+new Date(s.starts_at),end:+new Date(s.ends_at)})));continue;
   }
   let remaining=order.id===newOrder.id?q.requiredUnits:Number(order.required_units)-Number(order.delivered_units);
   for(const slot of fixedRows.filter(s=>s.order_id===order.id)){
    const credited=(await tx.query('SELECT COALESCE(sum(units),0)::text AS units FROM ads_delivery WHERE order_id=$1 AND placement_id=$2 AND starts_at>=$3 AND ends_at<=$4',[order.id,placementId,slot.starts_at,slot.ends_at])).rows[0];
    remaining-=Math.max(0,Number(slot.delivery_units)-Number(credited.units));
   }
   if(remaining<=0)continue;
   const units=q.plan==='TIME'?remaining:q.plan==='PASSES'?remaining:q.units;
   movable.push({timeUnitMs:1,rotationMs:q.rotationMs||config.rotationMs,passMs:q.passMs||config.passMs,renderLeadMs:q.renderLeadMs??config.renderLeadMs,exclusiveUnitMs:q.exclusiveUnitMs||config.exclusiveUnitMs,id:order.id,campaignId:order.campaign_id||q.campaignId,plan:q.plan,units,startsAt:Math.max(time(q.startsAt),now+1),endsAt:q.endsAt,committedAt:order.created_at||now});
  }
  const slots=planRotations(movable,blocks,{...config,timeUnitMs:1,maxUnits:Number.MAX_SAFE_INTEGER});
  const ids=movable.map(o=>o.id);
  if(ids.length)await tx.query("DELETE FROM ads_reservations WHERE placement_id=$1 AND order_id=ANY($2::uuid[]) AND starts_at>$3 AND state IN ('HELD','COMMITTED')",[placementId,ids,new Date(now)]);
  for(const s of slots){
   const order=s.orderId===newOrder.id?newOrder:existing.find(o=>o.id===s.orderId);
   const committed=!['RESERVED','PAYMENT_PENDING'].includes(order.state);
   await tx.query('INSERT INTO ads_reservations(id,order_id,placement_id,starts_at,ends_at,expires_at,state,pass_id,delivery_units) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[uuid(),s.orderId,placementId,new Date(s.start),new Date(s.end),new Date(order.quote.expiresAt),committed?'COMMITTED':'HELD',s.plan==='PASSES'?uuid():null,s.deliveryUnits]);
  }
 }
}

/** All inventory-changing actors lock locations before order/placement rows. */
export async function lockOrderInventory(tx,id,ownerId){
 const params=ownerId?[id,ownerId]:[id],where=ownerId?'id=$1 AND owner_id=$2':'id=$1';
 const before=(await tx.query('SELECT * FROM ads_orders WHERE '+where,params)).rows[0];
 assert(before,404,'order_not_found','Order unavailable.');
 await lockInventory(tx,before.quote.placements);
 const locked=(await tx.query('SELECT * FROM ads_orders WHERE '+where+' FOR UPDATE',params)).rows[0];
 assert(locked,404,'order_not_found','Order unavailable.');
 return locked;
}
