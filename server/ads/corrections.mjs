import {lockOrderInventory} from './scheduler.mjs';
import {assert,identifier,uuid,event,enqueue,idempotent} from './common.mjs';
export function createCorrectionService({db,config,now=Date.now}){
 return {
  async apply({ownerId,orderId,revisionId,idempotencyKey}){
   identifier(orderId);identifier(revisionId);
   return db.transaction(tx=>idempotent(tx,{ownerId,key:idempotencyKey,action:'paid-correction',payload:{orderId,revisionId}},async()=>{
    const order=await lockOrderInventory(tx,orderId,ownerId);assert(order,404,'order_not_found','Order unavailable.');
    assert(!order.suspended,409,'operator_hold','The operator or safety hold must be released before applying a correction.');
    assert(['BLOCKED','QUARANTINED'].includes(order.state),409,'correction_state','Corrections are available for blocked or quarantined paid creatives.');
    const paid=(await tx.query("SELECT id FROM ads_payment_attempts WHERE order_id=$1 AND state='SETTLED'",[orderId])).rowCount;assert(paid,409,'payment_unconfirmed','A paid order is required.');
    assert(!(await tx.query("SELECT 1 FROM ads_refunds WHERE order_id=$1 AND state<>'REJECTED'",[orderId])).rowCount,409,'refund_in_progress','Resolve the financial remedy before changing the creative.');
    const count=Number((await tx.query('SELECT count(*) FROM ads_order_corrections WHERE order_id=$1',[orderId])).rows[0].count);
    assert(Number.isSafeInteger(order.quote.terms?.includedRevisions)&&count<order.quote.terms.includedRevisions,409,'included_revisions_exhausted','Included corrections are exhausted; the original remedy remains available.');
    const revision=(await tx.query('SELECT r.*,c.owner_id FROM ads_revisions r JOIN ads_campaigns c ON c.id=r.campaign_id WHERE r.id=$1',[revisionId])).rows[0];
    assert(revision&&revision.owner_id===ownerId&&revision.campaign_id===order.quote.campaignId&&revision.id!==order.revision_id,404,'revision_not_found','Select a new revision from this campaign.');
    assert(revision.state==='PREAUDITED'&&revision.verdict?.allowed&&revision.verdict.contentHash===revision.content_hash,409,'preaudit_required','The corrected revision must pass preaudit.');
    assert(Date.parse(order.quote.endsAt)>now(),409,'window_expired','The delivery window expired; obtain a consented alternative or refund.');
    assert(!(await tx.query("SELECT 1 FROM ads_registry_jobs WHERE order_id=$1 AND operation='commit' AND state<>'CANCELLED'",[orderId])).rowCount,409,'registry_amendment_required','A recorded immutable commitment needs operator reconciliation; a refund remains available.');
    assert(!(await tx.query("SELECT 1 FROM ads_disputes WHERE order_id=$1 AND state='OPEN'",[orderId])).rowCount,409,'dispute_open','Resolve the open dispute before changing its creative evidence.');
    for(const id of [...order.quote.placements].sort())await tx.query('SELECT id FROM ads_inventory WHERE id=$1 FOR UPDATE',[id]);
    const appliedRevisionId=uuid();
    await tx.query("INSERT INTO ads_revisions(id,campaign_id,brief,logo_id,content_hash,state,verdict) VALUES($1,$2,$3,$4,$5,'PREAUDITED',$6)",[appliedRevisionId,revision.campaign_id,revision.brief,revision.logo_id,revision.content_hash,revision.verdict]);
    await tx.query('INSERT INTO ads_order_corrections(order_id,revision_id,previous_revision,owner_id) VALUES($1,$2,$3,$4)',[orderId,appliedRevisionId,order.revision_id,ownerId]);
    await tx.query("UPDATE ads_orders SET revision_id=$2,state='QUEUED',queue_state='PROCESSING',reason=NULL,suspended=false,updated_at=now() WHERE id=$1",[orderId,appliedRevisionId]);
    await tx.query("UPDATE ads_placements SET state=CASE WHEN delivered_units=required_units THEN 'FULFILLED' ELSE 'PENDING' END WHERE order_id=$1",[orderId]);
    await tx.query('UPDATE ads_playlist SET active=NULL,valid_until=now() WHERE order_id=$1',[orderId]);await tx.query('DELETE FROM ads_publisher_acks WHERE order_id=$1',[orderId]);
    await enqueue(tx,'creative',orderId,'creative:'+orderId+':'+appliedRevisionId,{revisionId:appliedRevisionId});
    await event(tx,orderId,ownerId,'CORRECTION_CONSENT',{previousRevision:order.revision_id,sourceRevisionId:revisionId,revisionId:appliedRevisionId,additionalCharge:false});
    return {orderId,revisionId:appliedRevisionId,sourceRevisionId:revisionId,status:'QUEUED',additionalCharge:false,remainingCorrections:order.quote.terms.includedRevisions-count-1};
   }));
  },
  async release({identity,orderId,reason}){
   assert(identity.role==='operator'&&config.operators.includes(identity.address),403,'operator_required','Operator authorization required.');
   identifier(orderId);assert(typeof reason==='string'&&reason.length>=3&&reason.length<=2000,400,'reason_required','Explain why the hold can be released for correction.');
   return db.transaction(async tx=>{
    const order=(await tx.query('SELECT * FROM ads_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];assert(order,404,'order_not_found','Order unavailable.');
    assert(order.state==='QUARANTINED',409,'hold_state','Only quarantined orders can be released for correction.');
    assert(!(await tx.query("SELECT 1 FROM ads_refunds WHERE order_id=$1 AND state<>'REJECTED'",[orderId])).rowCount,409,'refund_in_progress','Do not release an order with an outstanding financial remedy.');
    await tx.query("UPDATE ads_orders SET suspended=false,queue_state=NULL,reason=$2,updated_at=now() WHERE id=$1",[orderId,'Hold released for a newly audited correction: '+reason]);
    await event(tx,orderId,identity.ownerId,'HOLD_RELEASED_FOR_CORRECTION',{reason});
    return {orderId,status:'QUARANTINED',publicationAuthorized:false};
   });
  },
  async resolve({identity,disputeId,outcome,reason}){
   assert(identity.role==='operator'&&config.operators.includes(identity.address),403,'operator_required','Operator authorization required.');
   identifier(disputeId);assert(['REMEDIED','REJECTED'].includes(outcome)&&typeof reason==='string'&&reason.length>=3&&reason.length<=2000,400,'resolution_required','Provide a resolution outcome and reason.');
   return db.transaction(async tx=>{
    const d=(await tx.query('SELECT * FROM ads_disputes WHERE id=$1 FOR UPDATE',[disputeId])).rows[0];assert(d,404,'dispute_not_found','Dispute unavailable.');if(d.state!=='OPEN')return {id:d.id,status:d.state};
    const order=await lockOrderInventory(tx,d.order_id);assert(identity.address===order.quote.terms?.disputeAuthority,403,'dispute_authority_required','The contracted dispute authority must resolve this case.');
    const progress=(await tx.query('SELECT * FROM ads_placements WHERE order_id=$1 FOR UPDATE',[d.order_id])).rows;
    const closed=progress.every(p=>Number(p.delivered_units)===Number(p.required_units)||p.state==='CLOSED_WITH_REMEDY');
    assert(outcome!=='REMEDIED'||closed,409,'remedy_not_confirmed','Do not resolve as remedied before delivery or confirmed refund.');
    const resolution={outcome,reason,actor:identity.address,at:new Date(now()).toISOString()};
    await tx.query('UPDATE ads_disputes SET state=$2,resolved_at=$3,resolution=$4 WHERE id=$1',[d.id,outcome,new Date(now()),resolution]);
    if(outcome==='REJECTED')await tx.query("UPDATE ads_placements SET state=CASE WHEN delivered_units=required_units THEN 'FULFILLED' WHEN delivered_units>0 THEN 'PARTIAL' ELSE 'SCHEDULED' END WHERE order_id=$1 AND state='DISPUTED'",[d.order_id]);
    const open=Number((await tx.query("SELECT count(*) FROM ads_disputes WHERE order_id=$1 AND state='OPEN'",[d.order_id])).rows[0].count);
    if(closed&&!open)await tx.query("UPDATE ads_orders SET state=$2,queue_state=NULL WHERE id=$1",[d.order_id,progress.every(p=>Number(p.delivered_units)===Number(p.required_units))?'COMPLETED':'CANCELLED']);
    await enqueue(tx,'registry',d.order_id,'registry:resolve:'+d.id,{operation:'resolve_dispute'});await event(tx,d.order_id,identity.ownerId,'DISPUTE_RESOLVED',resolution);
    return {id:d.id,status:outcome};
   });
  }
 };
}
