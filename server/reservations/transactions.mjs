import { canonical, exactKeys, fail, hexId, requireHost, uuid } from '../identity/common.mjs';
import { requireCapability,requireBrandAdmission } from './config.mjs';
import { lock } from './db.mjs';
import { createIntakeService } from './intake.mjs';
const ACTIVE = ['PREPARED','SUBMITTING','PENDING','NEEDS_RECONCILIATION'];
export function createTransactionService({ db,config,chain,projects,now = Date.now,intake=createIntakeService({db,config,now}) }) {
  async function load(id,tx=db) {
    return (await tx.query('SELECT a.*,o.snapshot_id,o.project_id,o.state AS offer_state,o.holder AS offer_holder,s.data AS snapshot FROM reservation_attempts a JOIN reservation_offers o ON o.id=a.offer_id JOIN reservation_snapshots s ON s.id=o.snapshot_id WHERE a.id=$1 AND o.project_id=$2',[id,config.projectId])).rows[0];
  }
  const intent=row=>({operation:row.operation,offerId:row.offer_id,spaceId:row.snapshot.spaceId,actorAddress:row.actor_address});
  const summary=row=>({id:row.id,operation:row.operation,state:row.state,offerId:row.offer_id,snapshotId:row.snapshot_id,actorAddress:row.actor_address,expiresAt:new Date(row.expires_at).toISOString()});
  function owner(row,identity) { if (!row || row.actor_address!==identity.address) fail(404,'ATTEMPT_NOT_FOUND','The transaction attempt was not found.'); }
  function response(row,signing=false) {
    const value={attempt:summary(row),receipt:row.receipt??null};
    if (signing) {
      value.review={operation:row.operation,offerId:row.offer_id,snapshotId:row.snapshot_id,projectId:row.snapshot.projectId,spaceId:row.snapshot.spaceId,actorAddress:row.actor_address,contractId:config.contractId,title:row.snapshot.title,spaceName:row.snapshot.space.name,network:'stellar:testnet',paymentRequired:false};
      value.signing=row.state==='PREPARED'&&row.preparation ? Object.fromEntries(Object.entries(row.preparation).filter(([key])=>key!=='startLedger')) : null;
    }
    return value;
  }
  async function rejectUnsent(row) {
    await db.transaction(async tx=>{
      await lock(tx,'attempt:'+row.id);
      const current=await load(row.id,tx);
      if (current.state!=='PREPARED'||current.signed_payload) return;
      await tx.query("UPDATE reservation_attempts SET state='REJECTED',updated_at=now() WHERE id=$1",[row.id]);
      if (current.operation==='publish') await tx.query("UPDATE reservation_offers SET state='REJECTED' WHERE id=$1 AND state='PREPARING'",[current.offer_id]);
    });
  }
  async function prepare(identity,input) {
    if (!identity?.address) fail(401,'AUTH_REQUIRED','Sign in with a wallet first.');
    if (input?.operation==='publish') { exactKeys(input,['operation','snapshotId']); requireHost(identity,config); hexId(input.snapshotId); }
    else if (input?.operation==='reserve') { exactKeys(input,['operation','offerId']); hexId(input.offerId); if (identity.role!=='brand') fail(403,'BRAND_REQUIRED','Connect a brand wallet to reserve.'); }
    else fail(422,'INVALID_OPERATION','Only publication or reservation is allowed.');
    requireCapability(config,input.operation==='publish'?'publication':'reservation',now());
    if (input.operation==='reserve') requireBrandAdmission(config,identity);
    await intake.requireOpen(undefined,input.operation==='publish'?'publication':'reservation');
    const created=await db.transaction(async tx=>{
      await intake.requireOpen(tx,input.operation==='publish'?'publication':'reservation');
      await lock(tx,'project:'+config.projectId);
      let offer;
      if (input.operation==='publish') {
        const project=await projects.row(tx);
        const snapshot=(await tx.query('SELECT * FROM reservation_snapshots WHERE id=$1 AND project_id=$2',[input.snapshotId,config.projectId])).rows[0];
        if (!snapshot) fail(404,'SNAPSHOT_NOT_FOUND','The approved snapshot was not found.');
        offer=(await tx.query('SELECT * FROM reservation_offers WHERE snapshot_id=$1',[input.snapshotId])).rows[0];
        if (!offer || offer.state==='REJECTED') {
          if (project.approved_snapshot_id!==input.snapshotId || project.revision!==snapshot.revision) fail(409,'APPROVAL_STALE','Approve the current revision before publication.');
          const active=(await tx.query("SELECT id FROM reservation_offers WHERE project_id=$1 AND state IN ('PREPARING','AVAILABLE','UNCERTAIN')",[config.projectId])).rows[0];
          if (active) fail(409,'OFFER_ALREADY_ACTIVE','The project already has an available or unresolved offer.');
          if (!offer) { offer={id:uuid(),snapshot_id:input.snapshotId}; await tx.query("INSERT INTO reservation_offers(id,project_id,snapshot_id,state) VALUES($1,$2,$3,'PREPARING')",[offer.id,config.projectId,input.snapshotId]); }
          else await tx.query("UPDATE reservation_offers SET state='PREPARING' WHERE id=$1",[offer.id]);
        }
      } else {
        offer=(await tx.query("SELECT * FROM reservation_offers WHERE id=$1 AND project_id=$2 AND published_at IS NOT NULL",[input.offerId,config.projectId])).rows[0];
        if (!offer) fail(404,'OFFER_NOT_FOUND','The published offer was not found.');
      }
      const existing=(await tx.query("SELECT id FROM reservation_attempts WHERE offer_id=$1 AND actor_address=$2 AND operation=$3 AND state IN ('PREPARED','SUBMITTING','PENDING','NEEDS_RECONCILIATION','CONFIRMED') ORDER BY created_at DESC LIMIT 1",[offer.id,identity.address,input.operation])).rows[0];
      if (existing) return {row:await load(existing.id,tx),created:false};
      if (input.operation==='reserve'&&offer.state!=='AVAILABLE') fail(409,'OFFER_UNAVAILABLE','The offer is reserved or requires reconciliation.');
      const id=uuid(),expiresAt=new Date(now()+120000);
      await tx.query("INSERT INTO reservation_attempts(id,offer_id,actor_address,operation,state,expires_at) VALUES($1,$2,$3,$4,'PREPARED',$5)",[id,offer.id,identity.address,input.operation,expiresAt]);
      return {row:await load(id,tx),created:true};
    });
    if (!created.created) {
      if (created.row.state==='PREPARED'&&new Date(created.row.expires_at).getTime()<=now()) { await rejectUnsent(created.row); return response(await load(created.row.id),true); }
      return response(created.row,true);
    }
    try {
      await intake.requireOpen(undefined,input.operation==='publish'?'publication':'reservation');
      const preparation=await chain.prepare(intent(created.row),identity);
      await db.query("UPDATE reservation_attempts SET preparation=$2,updated_at=now() WHERE id=$1 AND state='PREPARED' AND signed_payload IS NULL",[created.row.id,preparation]);
      return response(await load(created.row.id),true);
    } catch(error) { await rejectUnsent(created.row); throw error; }
  }
  async function reconcile(identity,id) {
    hexId(id); let row=await load(id); owner(row,identity);
    if (row.state==='PREPARED') { if (new Date(row.expires_at).getTime()<=now()) { await rejectUnsent(row); row=await load(id); } return response(row); }
    if (!['SUBMITTING','PENDING','NEEDS_RECONCILIATION'].includes(row.state)) return response(row);
    requireCapability(config,'recovery',now());
    let evidence;
    try { evidence=await chain.reconcile(intent(row),row.preparation,row.tx_hash,row.signed_payload); }
    catch { evidence={state:'NEEDS_RECONCILIATION'}; }
    await db.transaction(async tx=>{
      await lock(tx,'attempt:'+id); const current=await load(id,tx);
      if (!['SUBMITTING','PENDING','NEEDS_RECONCILIATION'].includes(current.state)) return;
      let state='NEEDS_RECONCILIATION',receipt=null;
      if (evidence.state==='CONFIRMED' && /^[a-f0-9]{64}$/.test(evidence.hash||'') && Number.isSafeInteger(evidence.ledger) && evidence.ledger>0 && evidence.offer?.id===row.offer_id && evidence.offer.projectId===config.projectId && evidence.offer.spaceId===row.snapshot.spaceId && evidence.offer.host===config.hostAddress && (row.operation==='publish' ? ['AVAILABLE','RESERVED'].includes(evidence.offer.state) : evidence.offer.state==='RESERVED'&&evidence.offer.holder===row.actor_address)) {
        // Final holder state cannot regress, including when a concurrent public read
        // has already observed the winner while publication reconciliation lagged.
        const changed=row.operation==='publish'
          ? await tx.query("UPDATE reservation_offers SET state=$2,holder=$3,published_at=COALESCE(published_at,$4),publish_hash=$5 WHERE id=$1 AND (state<>'RESERVED' OR ($2='RESERVED' AND holder IS NOT DISTINCT FROM $3)) RETURNING id",[row.offer_id,evidence.offer.state,evidence.offer.holder,new Date(now()),evidence.hash])
          : await tx.query("UPDATE reservation_offers SET state='RESERVED',holder=$2 WHERE id=$1 AND (state<>'RESERVED' OR holder=$2) RETURNING id",[row.offer_id,row.actor_address]);
        if (changed.rows.length) {state='CONFIRMED'; receipt={txHash:evidence.hash,ledger:evidence.ledger,explorerUrl:'https://stellar.expert/explorer/testnet/tx/'+evidence.hash,offer:evidence.offer};}
      } else if (evidence.state==='REJECTED'&&evidence.definitive===true) {
        state='REJECTED'; if (row.operation==='publish') await tx.query("UPDATE reservation_offers SET state='REJECTED' WHERE id=$1 AND state IN ('PREPARING','UNCERTAIN')",[row.offer_id]);
      } else if (evidence.state==='CONFLICT'&&evidence.offer?.state==='RESERVED') {
        const changed=await tx.query("UPDATE reservation_offers SET state='RESERVED',holder=$2 WHERE id=$1 AND (state<>'RESERVED' OR holder=$2) RETURNING id",[row.offer_id,evidence.offer.holder]);if(changed.rows.length)state='CONFLICT';
      }
      else if (evidence.state==='PENDING') state='PENDING';
      await tx.query('UPDATE reservation_attempts SET state=$2,receipt=$3,tx_hash=COALESCE(tx_hash,$4),updated_at=now() WHERE id=$1',[id,state,receipt,/^[a-f0-9]{64}$/.test(evidence.hash||'')?evidence.hash:null]);
    });
    return response(await load(id));
  }
  async function submit(identity,id,body) {
    hexId(id); const row=await load(id); owner(row,identity);
    if (row.signed_payload && canonical(row.signed_payload)!==canonical(body)) fail(409,'SIGNED_PAYLOAD_CONFLICT','This intent already holds a different signed payload.');
    if (row.state!=='PREPARED') return reconcile(identity,id);
    requireCapability(config,row.operation==='publish'?'publication':'reservation',now());
    if (row.operation==='reserve') requireBrandAdmission(config,identity);
    await intake.requireOpen(undefined,row.operation==='publish'?'publication':'reservation');
    if (!row.preparation) fail(409,'PREPARATION_PENDING','The signing preparation is not yet available.');
    if (new Date(row.expires_at).getTime()<=now()) { await rejectUnsent(row); fail(409,'PREPARATION_EXPIRED','The unsigned preparation expired.'); }
    chain.validate(body,row.preparation,intent(row));
    // Preflight cannot transmit. Failure leaves this unsigned intent safely reviewable.
    await chain.preflight(body,row.preparation,intent(row));
    const claimed=await db.transaction(async tx=>{
      // The shared pause and this claim serialize on the same admission row.
      // Once committed, the admitted send may finish even if pause wins later.
      await intake.requireOpen(tx,row.operation==='publish'?'publication':'reservation');
      await lock(tx,'project:'+config.projectId);
      await lock(tx,'attempt:'+id); const current=await load(id,tx);
      if (current.state!=='PREPARED') return false;
      if (row.operation==='publish') {
        const project=await projects.row(tx);
        if (project.approved_snapshot_id!==row.snapshot_id || project.revision!==row.snapshot.revision) fail(409,'APPROVAL_STALE','The project changed after review. The old preparation cannot be published.');
      }
      if (new Date(current.expires_at).getTime()<=now()) fail(409,'PREPARATION_EXPIRED','The unsigned preparation expired.');
      await tx.query("UPDATE reservation_attempts SET state='SUBMITTING',signed_payload=$2,updated_at=now() WHERE id=$1",[id,body]);
      if (row.operation==='publish') await tx.query("UPDATE reservation_offers SET state='UNCERTAIN' WHERE id=$1",[row.offer_id]);
      return true;
    });
    if (!claimed) return reconcile(identity,id);
    try {
      const result=await chain.submit(body);
      if (!/^[a-f0-9]{64}$/.test(result?.hash||'')) throw new Error('Missing relay hash');
      await db.query("UPDATE reservation_attempts SET state=CASE WHEN state IN ('SUBMITTING','NEEDS_RECONCILIATION') THEN 'PENDING' ELSE state END,tx_hash=COALESCE(tx_hash,$2),updated_at=now() WHERE id=$1",[id,result.hash]);
    } catch {
      await db.query("UPDATE reservation_attempts SET state='NEEDS_RECONCILIATION',updated_at=now() WHERE id=$1 AND state='SUBMITTING'",[id]);
      return response(await load(id));
    }
    return reconcile(identity,id);
  }
  async function pending(identity) {
    const row=(await db.query("SELECT a.id FROM reservation_attempts a JOIN reservation_offers o ON o.id=a.offer_id WHERE a.actor_address=$1 AND o.project_id=$2 AND a.state IN ('PREPARED','SUBMITTING','PENDING','NEEDS_RECONCILIATION') ORDER BY a.created_at DESC LIMIT 1",[identity.address,config.projectId])).rows[0];
    if (!row) return null; const value=summary(await load(row.id)); delete value.actorAddress; delete value.expiresAt; return value;
  }
  // Budget selection only; reconcile still checks the authenticated actor again.
  async function owns(identity,id){return Boolean((await db.query('SELECT a.id FROM reservation_attempts a JOIN reservation_offers o ON o.id=a.offer_id WHERE a.id=$1 AND a.actor_address=$2 AND o.project_id=$3',[id,identity.address,config.projectId])).rows.length);}
  return { prepare,submit,reconcile,pending,owns };
}
