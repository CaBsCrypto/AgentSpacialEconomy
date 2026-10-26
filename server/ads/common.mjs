import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
export class AdsError extends Error { constructor(status, code, message, details) { super(message); this.name = 'AdsError'; Object.assign(this,{status,code,details}); } }
export const uuid = () => randomUUID();
function sort(v) { if(typeof v==='bigint')return v.toString(); if(Array.isArray(v))return v.map(sort); if(v&&typeof v==='object'&&!(v instanceof Date))return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])); return v; }
export const canonical = v => JSON.stringify(sort(v));
export const sha256 = v => createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:canonical(v)).digest('hex');
export function assert(ok,status,code,message){if(!ok)throw new AdsError(status,code,message);}
export function integer(value,name,{min=1,max=Number.MAX_SAFE_INTEGER}={}) { assert(Number.isSafeInteger(value)&&value>=min&&value<=max,400,'invalid_quantity',name+' is outside its integer limits.');return value; }
export function identifier(value){assert(typeof value==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value),400,'invalid_id','Invalid identifier.');return value;}
export function sameSecret(a,b){const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length>0&&x.length===y.length&&timingSafeEqual(x,y);}
export async function event(tx,id,actor,name,data={}){await tx.query('INSERT INTO ads_events(aggregate_id,actor,event,data) VALUES($1,$2,$3,$4)',[id,actor,name,data]);}
export async function enqueue(tx,topic,id,key,payload={}){await tx.query('INSERT INTO ads_outbox(id,topic,aggregate_id,dedupe_key,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(dedupe_key) DO NOTHING',[uuid(),topic,id,key,payload]);}
export async function idempotent(tx,{ownerId,key,action,payload},work){
 assert(typeof key==='string'&&/^[A-Za-z0-9:_-]{8,160}$/.test(key),400,'idempotency_required','Provide an Idempotency-Key of 8 to 160 characters.');
 const hash=sha256({action,payload});
 await tx.query('INSERT INTO ads_idempotency(owner_id,key,action,fingerprint) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,key) DO NOTHING',[ownerId,key,action,hash]);
 const {rows:[row]}=await tx.query('SELECT * FROM ads_idempotency WHERE owner_id=$1 AND key=$2 FOR UPDATE',[ownerId,key]);
 assert(row.fingerprint===hash&&row.action===action,409,'idempotency_conflict','Key already belongs to a different request.');
 if(row.response!==null)return row.response;
 const response=await work();await tx.query('UPDATE ads_idempotency SET response=$3 WHERE owner_id=$1 AND key=$2',[ownerId,key,response]);return response;
}


// Commit an intent before external model work. An interrupted action is never silently re-executed.
export async function durableAction(db,{ownerId,key,action,payload},work){
 assert(typeof key==='string'&&/^[A-Za-z0-9:_-]{8,160}$/.test(key),400,'idempotency_required','Provide an Idempotency-Key of 8 to 160 characters.');
 const fingerprint=sha256({action,payload});
 const claim=await db.transaction(async tx=>{
  const inserted=await tx.query("INSERT INTO ads_actions(owner_id,key,action,fingerprint,state) VALUES($1,$2,$3,$4,'RUNNING') ON CONFLICT(owner_id,key) DO NOTHING RETURNING key",[ownerId,key,action,fingerprint]);
  const row=(await tx.query('SELECT * FROM ads_actions WHERE owner_id=$1 AND key=$2 FOR UPDATE',[ownerId,key])).rows[0];
  assert(row.action===action&&row.fingerprint===fingerprint,409,'idempotency_conflict','Key already belongs to a different request.');
  return {fresh:inserted.rowCount===1,row};
 });
 if(!claim.fresh){
  if(claim.row.state==='DONE')return claim.row.response;
  if(claim.row.state==='FAILED'){const e=claim.row.failure;throw new AdsError(e.status,e.code,e.message);}
  throw new AdsError(409,'action_reconciliation_required','This action is still running or its external consumption is uncertain. Keep its original key; create a new revision only after review.');
 }
 try{
  const response=await work();
  await db.query("UPDATE ads_actions SET state='DONE',response=$3,updated_at=now() WHERE owner_id=$1 AND key=$2",[ownerId,key,response]);
  return response;
 }catch(error){
  const failure=error instanceof AdsError?{status:error.status,code:error.code,message:error.message}:{status:503,code:'action_failed_closed',message:'The external action failed closed. Review the saved attempt before creating another revision.'};
  await db.query("UPDATE ads_actions SET state='FAILED',failure=$3,updated_at=now() WHERE owner_id=$1 AND key=$2",[ownerId,key,failure]);
  throw new AdsError(failure.status,failure.code,failure.message);
 }
}
