import {readFile} from 'node:fs/promises';
import {createPrivateKey,sign} from 'node:crypto';
import { AdsError, canonical, sha256, uuid } from './common.mjs';
const publicJob=({signed_xdr,...job})=>job;
const operations=new Set(['commit','record_delivery','complete','dispute','expire','resolve_dispute']);
const fail=(code,message)=>{throw new AdsError(503,code,message);};

/** Noncustodial registry outbox. Disabled means unrecorded, never a simulated on-chain receipt. */
export function createRegistryService({db,config,runtime=createSorobanRegistryRuntime({config}),now=Date.now,owner=uuid()}){
 let flushing=false;
 async function recordWith(tx,{orderId,operation,payload,batchId=null}){
  if(!operations.has(operation))throw new AdsError(400,'registry_operation_invalid','Operación de registro no permitida.');
  if(!config.registryContract)return {state:'DISABLED',reason:'registry_not_deployed'};
  registryArguments(operation,payload,await import('@stellar/stellar-sdk'));
  if(!batchId&&payload.order===sha256(orderId))batchId=(await tx.query('SELECT id FROM ads_fulfillment_batches WHERE id=$1 AND order_id=$1',[orderId])).rows[0]?.id||null;
  // Preserve existing fingerprints and on-chain identifiers; the payload already binds its batch.
  const payloadHash=sha256(canonical({orderId,operation,payload}));
  return (await tx.query("INSERT INTO ads_registry_jobs(id,order_id,batch_id,operation,payload,payload_hash) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(payload_hash) DO UPDATE SET batch_id=COALESCE(ads_registry_jobs.batch_id,EXCLUDED.batch_id) RETURNING *",[uuid(),orderId,batchId,operation,JSON.stringify(payload),payloadHash])).rows[0];
 }
 const record=options=>recordWith(db,options);
 async function syncScope(tx,root,revision,payment,batch){
  const order=batch?{...root,id:batch.id,terms_hash:batch.terms_hash,quote:{...root.quote,startsAt:new Date(batch.starts_at).toISOString(),endsAt:new Date(batch.ends_at).toISOString(),requiredUnits:Number(batch.required_units)}}:root;
  const batchId=batch?.id||null,orderId=root.id;
  const existing=(await tx.query('SELECT * FROM ads_registry_jobs WHERE order_id=$1 AND batch_id IS NOT DISTINCT FROM $2::uuid ORDER BY sequence',[orderId,batchId])).rows;
  const commitment=prepareRegistryCommit(order,revision,payment,config),prior=existing.find(j=>j.operation==='commit');
  if(prior&&canonical(prior.payload)!==canonical(commitment))return {state:'RECONCILIATION_REQUIRED',reason:'registry_commitment_changed',batchId};
  const jobs=[],save=(operation,payload)=>recordWith(tx,{orderId,batchId,operation,payload});
  const disputes=(await tx.query('SELECT * FROM ads_disputes WHERE order_id=$1 ORDER BY created_at,id',[orderId])).rows;
  const open=disputes.filter(d=>d.state==='OPEN');
  if(open.length)await tx.query("UPDATE ads_registry_jobs SET state='CANCELLED',evidence=$3::jsonb,updated_at=now() WHERE order_id=$1 AND batch_id IS NOT DISTINCT FROM $2::uuid AND operation='complete' AND state='READY'",[orderId,batchId,JSON.stringify({reason:'disputed_before_submission'})]);
  const lastDispute=[...existing].reverse().find(j=>j.operation==='dispute'),lastResolution=[...existing].reverse().find(j=>j.operation==='resolve_dispute');
  const unresolved=lastDispute&&(!lastResolution||Number(lastDispute.sequence)>Number(lastResolution.sequence));
  let resolutionHash=lastResolution?.payload?.remedy_hash;
  if(unresolved){
   if(open.length)return {state:'DISPUTED',jobs:[],batchId};
   if(lastDispute.state!=='CONFIRMED')return {state:'WAITING',reason:'registry_dispute_not_confirmed',batchId};
   resolutionHash=sha256(disputes.filter(d=>d.resolved_at).map(d=>({id:d.id,state:d.state,resolvedAt:new Date(d.resolved_at).toISOString(),resolution:d.resolution??null})));
   jobs.push(await save('resolve_dispute',{order:commitment.order,remedy_hash:resolutionHash}));
  }
  if(!prior)jobs.push(await save('commit',commitment));
  const registered=new Set(existing.filter(j=>j.operation==='record_delivery').map(j=>j.payload.segment));
  const rows=(await tx.query('SELECT * FROM ads_delivery WHERE order_id=$1 AND batch_id IS NOT DISTINCT FROM $2::uuid ORDER BY starts_at,placement_id,id',[orderId,batchId])).rows;
  const fresh=rows.filter(r=>!registered.has(sha256(r.id)));
  const nonces=existing.filter(j=>j.operation==='record_delivery').map(j=>BigInt(j.payload.nonce));
  const nonceStart=nonces.reduce((n,v)=>v>=n?v+1n:n,0n);
  // Commercial order IDs remain on the ledger. The contract signs each batch's independent commitment.
  const payloads=fresh.length?await prepareRegistryDelivery(order,batch?fresh.map(row=>({...row,order_id:batch.id})):fresh,{config,nonceStart}):[];
  for(const payload of payloads)jobs.push(await save('record_delivery',payload));
  if(open.length){jobs.push(await save('dispute',{order:commitment.order,disputeIds:open.map(d=>d.id)}));return {state:'DISPUTED',jobs:jobs.map(j=>j.id),batchId};}
  let complete;
  if(batch)complete=Number(batch.delivered_units)===Number(batch.required_units)&&rows.reduce((n,r)=>n+Number(r.units),0)===Number(batch.required_units);
  else{const placements=(await tx.query('SELECT * FROM ads_placements WHERE order_id=$1',[orderId])).rows;complete=placements.length===commitment.placements.length&&placements.every(p=>BigInt(p.delivered_units)===BigInt(p.required_units));}
  if(complete)jobs.push(await save('complete',{order:commitment.order,...(resolutionHash?{resolutionHash}:{})}));
  else if(now()>commitment.deadline)jobs.push(await save('expire',{order:commitment.order}));
  return {state:'PREPARED',jobs:jobs.map(j=>j.id),batchId};
 }
 async function syncOrder(orderId){
  if(!config.registryContract)return {state:'DISABLED',reason:'registry_not_deployed'};
  return db.transaction(async tx=>{
   const order=(await tx.query('SELECT * FROM ads_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
   if(!order)throw new AdsError(404,'order_not_found','Order unavailable.');
   const revision=(await tx.query('SELECT * FROM ads_revisions WHERE id=$1',[order.revision_id])).rows[0];
   if(revision?.state!=='AUDITED'||!revision.manifest_hash)return {state:'WAITING',reason:'manifest_not_audited'};
   const payment=(await tx.query("SELECT * FROM ads_payment_attempts WHERE order_id=$1 AND state='SETTLED'",[orderId])).rows[0];
   if(!payment)return {state:'WAITING',reason:'payment_not_confirmed'};
   const batches=(await tx.query('SELECT * FROM ads_fulfillment_batches WHERE order_id=$1 ORDER BY sequence',[orderId])).rows;
   if(!batches.length)return syncScope(tx,order,revision,payment,null);
   const results=[];
   for(const batch of batches)results.push(await syncScope(tx,order,revision,payment,batch));
   const blocked=results.find(r=>['RECONCILIATION_REQUIRED','WAITING','DISPUTED'].includes(r.state));
   return {state:blocked?.state||'PREPARED',...(blocked?.reason?{reason:blocked.reason}:{}),jobs:results.flatMap(r=>r.jobs||[]),batches:results};
  });
 }
 async function reconcile(jobId){
  const job=(await db.query('SELECT * FROM ads_registry_jobs WHERE id=$1',[jobId])).rows[0];
  if(!job)throw new AdsError(404,'registry_job_not_found','Registro no disponible.');
  if(job.state==='CONFIRMED'||!job.transaction_hash)return publicJob(job);
  let result;try{result=await runtime.confirm(job);}catch{result={state:'UNKNOWN'};}
  const state=result?.state==='CONFIRMED'&&result.txHash===job.transaction_hash?'CONFIRMED':'RECONCILIATION_REQUIRED';
  await db.query('UPDATE ads_registry_jobs SET state=$2,evidence=$3::jsonb,updated_at=now() WHERE id=$1',[jobId,state,JSON.stringify(result)]);
  return publicJob({...job,state,evidence:result});
 }
 async function flush({limit=10}={}){
  if(!config.registryContract)return {state:'DISABLED',processed:0};
  if(flushing)return {state:'BUSY',processed:0};
  flushing=true;
  const name='registry-issuer:'+(config.registryIssuer||config.registryContract),leaseMs=config.registryLeaseMs||30000;
  let fence=null,heartbeat=null,timer,lost=false;
  const assertLease=async(tx,lock=false)=>{
   const result=await tx.query("SELECT 1 FROM ads_leases WHERE name=$1 AND owner=$2 AND fence=$3 AND expires_at>$4"+(lock?' FOR UPDATE':''),[name,owner,fence,new Date(now())]);
   if(lost||!result.rowCount)fail('registry_issuer_fenced','The restricted registry issuer lease expired.');
  };
  try{
   const lease=(await db.query("INSERT INTO ads_leases(name,owner,fence,expires_at) VALUES($1,$2,1,$3) ON CONFLICT(name) DO UPDATE SET owner=EXCLUDED.owner,fence=ads_leases.fence+1,expires_at=EXCLUDED.expires_at WHERE ads_leases.expires_at<=$4 RETURNING *",[name,owner,new Date(now()+leaseMs),new Date(now())])).rows[0];
   if(!lease)return {state:'BUSY',processed:0};fence=Number(lease.fence);
   timer=setInterval(()=>{
    if(heartbeat)return;
    heartbeat=db.query('UPDATE ads_leases SET expires_at=$4 WHERE name=$1 AND owner=$2 AND fence=$3 AND expires_at>$5 RETURNING fence',[name,owner,fence,new Date(now()+leaseMs),new Date(now())]).then(r=>{if(!r.rowCount)lost=true;}).catch(()=>{lost=true;}).finally(()=>{heartbeat=null;});
   },Math.max(10,Math.min(10000,Math.floor(leaseMs/3))));
   // An uncertain envelope owns its source-account sequence until its original hash reconciles.
   const pending=(await db.query("SELECT id FROM ads_registry_jobs WHERE state IN ('SUBMITTED','RECONCILIATION_REQUIRED') AND transaction_hash IS NOT NULL ORDER BY sequence")).rows;
   for(const job of pending){await assertLease(db);const result=await reconcile(job.id);if(result.state!=='CONFIRMED')return {state:'RECONCILIATION_REQUIRED',processed:0,jobId:job.id};}
   const ids=(await db.query("SELECT j.id FROM ads_registry_jobs j WHERE j.state='READY' AND NOT EXISTS(SELECT 1 FROM ads_registry_jobs prior WHERE prior.order_id=j.order_id AND prior.sequence<j.sequence AND prior.state NOT IN ('CONFIRMED','CANCELLED')) ORDER BY j.sequence LIMIT $1",[Math.min(100,Math.max(1,limit))])).rows;
   const results=[];
   for(const {id} of ids){
    await assertLease(db);
    const prepared=await db.transaction(async tx=>{
     const job=(await tx.query('SELECT * FROM ads_registry_jobs WHERE id=$1 FOR UPDATE',[id])).rows[0];
     if(job.state!=='READY')return null;
     await assertLease(tx);
     const signed=await runtime.prepare(job);
     if(!signed?.txHash||!signed.signedXdr)fail('registry_signer_unavailable','No hay una transacción de registro firmada.');
     await assertLease(tx,true);
     await tx.query("UPDATE ads_registry_jobs SET state='SUBMITTED',transaction_hash=$2,signed_xdr=$3,updated_at=now() WHERE id=$1",[id,signed.txHash,signed.signedXdr]);
     return {...job,state:'SUBMITTED',transaction_hash:signed.txHash,signed_xdr:signed.signedXdr};
    });
    if(!prepared)continue;
    await assertLease(db);
    try{await runtime.submit(prepared);}catch{/* The exact durable envelope is reconciled, never silently replaced. */}
    const result=await reconcile(id);results.push(result);
    if(result.state!=='CONFIRMED')break;
    if(['dispute','resolve_dispute'].includes(result.operation))await syncOrder(result.order_id);
   }
   return {processed:results.length,results};
  }finally{
   clearInterval(timer);if(heartbeat)await heartbeat;
   if(fence!==null)await db.query('UPDATE ads_leases SET expires_at=$4 WHERE name=$1 AND owner=$2 AND fence=$3',[name,owner,fence,new Date(now())]);
   flushing=false;
  }
 }
 async function expire({orderId,orderHash,batchId}){return record({orderId,batchId,operation:'expire',payload:{order:orderHash}});}
 return {record,syncOrder,flush,reconcile,expire,keeper:flush};
}

/** Smart-contract arguments use explicit XDR types, never automatic object inference. */
export function registryArguments(operation,payload,s){
 const bytes=(value,size=32)=>{if(typeof value!=='string'||!new RegExp(`^[0-9a-f]{${size*2}}$`,'i').test(value))throw new AdsError(400,'registry_hash_invalid','Hash de registro inválido.');return s.nativeToScVal(Buffer.from(value,'hex'),{type:'bytes'});};
 const sym=v=>s.nativeToScVal(v,{type:'symbol'}),u64=v=>s.nativeToScVal(BigInt(v),{type:'u64'}),u32=v=>s.nativeToScVal(Number(v),{type:'u32'});
 const struct=fields=>s.xdr.ScVal.scvMap(Object.keys(fields).sort().map(key=>new s.xdr.ScMapEntry({key:sym(key),val:fields[key]})));
 if(operation==='commit'){
  const placements=(payload.placements??[]).map(p=>struct({slot:sym(p.slot),plan:s.xdr.ScVal.scvVec([sym({TIME:'Time',PASSES:'Passes',EXCLUSIVE:'Exclusive'}[p.plan]??p.plan)]),units:u64(p.units),pass_ms:u32(p.pass_ms??0),start:u64(p.start),end:u64(p.end)}));
  return [struct({order:bytes(payload.order),revision:bytes(payload.revision),terms:bytes(payload.terms),manifest:bytes(payload.manifest),payment:bytes(payload.payment),claimant:s.nativeToScVal(payload.claimant,{type:'address'}),deadline:u64(payload.deadline),placements:s.xdr.ScVal.scvVec(placements)})];
 }
 if(operation==='record_delivery')return [struct({order:bytes(payload.order),nonce:u64(payload.nonce),placement:u32(payload.placement),revision:bytes(payload.revision),manifest:bytes(payload.manifest),segment:bytes(payload.segment),start:u64(payload.start),end:u64(payload.end),units:u64(payload.units)}),bytes(payload.signature,64)];
 if(operation==='resolve_dispute')return [bytes(payload.order),bytes(payload.remedy_hash)];
 if(['complete','dispute','expire'].includes(operation))return [bytes(payload.order)];
 throw new AdsError(400,'registry_operation_invalid','Operación no permitida.');
}
function validateRegistryTransaction(job,envelope,config,s,expectedSource){
 if(config.network!=='stellar:testnet')fail('registry_testnet_only','Only Testnet is permitted.');
 if(!operations.has(job?.operation))fail('registry_operation_invalid','Registry operation is not admitted.');
 const tx=s.TransactionBuilder.fromXDR(envelope,s.Networks.TESTNET),op=tx.operations[0];
 if(tx.innerTransaction||tx.operations.length!==1||op?.type!=='invokeHostFunction'||op.func.switch().name!=='hostFunctionTypeInvokeContract')fail('registry_transaction_invalid','Invocación de registro inválida.');
 const fn=op.func.invokeContract(),expected=registryArguments(job.operation,job.payload,s);
 if(s.Address.fromScAddress(fn.contractAddress()).toString()!==config.registryContract||fn.functionName().toString()!==job.operation||canonical(fn.args().map(a=>a.toXDR('base64')))!==canonical(expected.map(a=>a.toXDR('base64'))))fail('registry_transaction_invalid','La firma modificó la invocación autorizada.');
 if(expectedSource&&(tx.source!==expectedSource||op.source&&op.source!==expectedSource))fail('registry_transaction_invalid','El origen de registro no coincide con su autoridad.');
 return tx;
}
export function createSorobanRegistryRuntime({config,signer,rpc,loadSdk=()=>import('@stellar/stellar-sdk')}){
 if(!signer&&(config.registrySignerSecret||config.registrySignerSecretFile))signer=createOperatorRegistrySigner({secret:config.registrySignerSecret,secretFile:config.registrySignerSecretFile,config,rpc,loadSdk});
 const ready=()=>{if(config.network!=='stellar:testnet'||!config.registryContract)fail('registry_not_configured','El registro Soroban no está desplegado en Testnet.');};
 const server=async()=>{ready();if(!rpc){const {Server}=await import('@stellar/stellar-sdk/rpc');rpc=new Server(config.rpcUrl??'https://soroban-testnet.stellar.org');}return rpc;};
 const validate=async(job,envelope)=>validateRegistryTransaction(job,envelope,config,await loadSdk(),signer?.address||config.registryIssuer);
 return {
  async prepare(job){
   ready();if(signer?.prepare){const signed=await signer.prepare(job);const tx=await validate(job,signed.signedXdr);if(tx.hash().toString('hex')!==signed.txHash)fail('registry_transaction_invalid','Hash de registro incorrecto.');return signed;}if(!signer?.address?.startsWith('G')||typeof signer.signTransaction!=='function')fail('registry_signer_unavailable','Falta el firmante restringido del registro.');
   const s=await loadSdk(),r=await server(),tx=new s.TransactionBuilder(await r.getAccount(signer.address),{networkPassphrase:s.Networks.TESTNET,fee:s.BASE_FEE}).addOperation(new s.Contract(config.registryContract).call(job.operation,...registryArguments(job.operation,job.payload,s))).setTimeout(60).build();
   await validate(job,tx.toXDR());const prepared=await r.prepareTransaction(tx);await validate(job,prepared.toXDR());const signed=await signer.signTransaction(prepared.toXDR(),{networkPassphrase:s.Networks.TESTNET});
   if(signed.error||!signed.signedTxXdr)fail('registry_signature_failed','No se firmó el registro.');
   const final=await validate(job,signed.signedTxXdr);if(final.source!==signer.address)fail('registry_transaction_invalid','Origen de registro modificado.');
   return {signedXdr:final.toXDR(),txHash:final.hash().toString('hex')};
  },
  async submit(job){const tx=await validate(job,job.signed_xdr);if(tx.hash().toString('hex')!==job.transaction_hash)fail('registry_transaction_invalid','Hash de registro incorrecto.');return (await server()).sendTransaction(tx);},
  async confirm(job){const r=await (await server()).getTransaction(job.transaction_hash);if(r.status!=='SUCCESS'||!r.envelopeXdr)return {state:'UNKNOWN'};const tx=await validate(job,typeof r.envelopeXdr==='string'?r.envelopeXdr:r.envelopeXdr.toXDR('base64'));return tx.hash().toString('hex')===job.transaction_hash?{state:'CONFIRMED',txHash:job.transaction_hash,ledger:r.ledger}:{state:'UNKNOWN'};}
 };
}

/** Digest the publisher signs (Ed25519) for the contract's network/domain-bound evidence. */
export function registryEvidenceDigest(config,payload,s){
 const evidence=registryArguments('record_delivery',{...payload,signature:payload.signature??'00'.repeat(64)},s)[0];
 const message=s.xdr.ScVal.scvVec([s.nativeToScVal('ads_delivery_v1',{type:'symbol'}),s.nativeToScVal(Buffer.from(sha256(s.Networks.TESTNET),'hex'),{type:'bytes'}),s.nativeToScVal(config.registryContract,{type:'address'}),evidence]);
 return Buffer.from(sha256(message.toXDR()),'hex');
}

const registryHash=(value,label)=>{if(typeof value!=='string'||!/^[0-9a-f]{64}$/i.test(value))throw new AdsError(409,'registry_not_ready',label+' is not an immutable 32-byte hash.');return value.toLowerCase();};
export function prepareRegistryCommit(order,revision,receipt,config){
 const q=order.quote,grace=config.registryEvidenceGraceMs;
 if(!Number.isSafeInteger(grace)||grace<1)throw new AdsError(503,'registry_deadline_unconfigured','Configure the registry evidence submission grace period.');
 if(!q||!Array.isArray(q.placements)||!q.placements.length)throw new AdsError(409,'registry_not_ready','The order has no committed placement terms.');
 const start=Date.parse(q.startsAt),end=Date.parse(q.endsAt);
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<=start)throw new AdsError(409,'registry_not_ready','The delivery window is not valid.');
 const claimant=order.payer??receipt.payer;if(!/^[CG][A-Z2-7]{55}$/.test(claimant??''))throw new AdsError(409,'registry_not_ready','The confirmed payer is required.');
 return {order:sha256(order.id),revision:sha256(order.revision_id),terms:registryHash(order.terms_hash,'Terms'),manifest:registryHash(revision.manifest_hash,'Audited manifest'),payment:registryHash(receipt.transaction??receipt.settlement_tx??receipt.tx,'Settlement'),claimant,deadline:end+grace,placements:[...q.placements].sort().map(slot=>({slot,plan:q.plan,units:String(q.requiredUnits),pass_ms:q.plan==='PASSES'?(q.passMs??config.passMs):0,start,end}))};
}
/** Call with only previously unregistered rows, under the order's registry lock. */
export async function prepareRegistryDelivery(order,deliveryRows,{config,nonceStart=0,publisherKey=config.publisherKey,sdk}={}){
 if(!publisherKey)throw new AdsError(503,'registry_publisher_unconfigured','The restricted publisher signer is required.');
 const s=sdk??await import('@stellar/stellar-sdk'),key=createPrivateKey(publisherKey),placements=[...order.quote.placements].sort();
 const rows=[...deliveryRows].sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at)||a.placement_id.localeCompare(b.placement_id)||a.id.localeCompare(b.id));
 return rows.map((row,i)=>{const placement=placements.indexOf(row.placement_id);if(placement<0||row.order_id!==order.id||row.revision_id!==order.revision_id)throw new AdsError(409,'registry_evidence_invalid','Evidence does not belong to the committed order and revision.');
 const payload={order:sha256(order.id),nonce:String(BigInt(nonceStart)+BigInt(i)),placement,revision:sha256(row.revision_id),manifest:registryHash(row.manifest_hash,'Evidence manifest'),segment:sha256(row.id),start:new Date(row.starts_at).getTime(),end:new Date(row.ends_at).getTime(),units:String(row.units)};
 payload.signature=sign(null,registryEvidenceDigest(config,payload,s),key).toString('hex');return payload;});
}

/** Restricted operator key stays in memory or a private file; it is never returned. */
export function createOperatorRegistrySigner({secret,secretFile,config,rpc,loadSdk=()=>import('@stellar/stellar-sdk')}){
 return {address:config.registryIssuer,async prepare(job){
  if(config.network!=='stellar:testnet')fail('registry_testnet_only','Only Testnet is permitted.');
  if(!operations.has(job?.operation)||!(config.operators??[]).includes(config.registryIssuer)||!secret&&!secretFile)fail('registry_signer_unavailable','The configured registry issuer is not authorized.');
  const s=await loadSdk();
  if(!s.StrKey.isValidEd25519PublicKey(config.registryIssuer||'')||!s.StrKey.isValidContract(config.registryContract||''))fail('registry_signer_unavailable','Configure the public registry and its issuer.');
  registryArguments(job.operation,job.payload,s);
  let key;try{key=s.Keypair.fromSecret((secret||(await readFile(secretFile,'utf8'))).trim());}catch{fail('registry_signer_unavailable','The restricted registry issuer key could not be loaded.');}
  if(key.publicKey()!==config.registryIssuer)fail('registry_signer_mismatch','The issuer key does not match the configured public authority.');
  const signer={address:key.publicKey(),async signTransaction(envelope,{networkPassphrase}){
   if(networkPassphrase!==s.Networks.TESTNET)fail('registry_testnet_only','Only Testnet is permitted.');
   // Re-check after RPC preparation and before using the key.
   const tx=validateRegistryTransaction(job,envelope,config,s,key.publicKey());tx.sign(key);return {signedTxXdr:tx.toXDR()};
  }};
  return createSorobanRegistryRuntime({config,signer,rpc,loadSdk}).prepare(job);
 }};
}
