import {readFile} from 'node:fs/promises';
import {createPrivateKey,sign} from 'node:crypto';
import { AdsError, canonical, sha256, uuid } from './common.mjs';
const publicJob=({signed_xdr,...job})=>job;
const operations=new Set(['commit','record_delivery','complete','dispute','expire','resolve_dispute']);
const fail=(code,message)=>{throw new AdsError(503,code,message);};

/** Noncustodial registry outbox. Disabled means unrecorded, never a simulated on-chain receipt. */
export function createRegistryService({db,config,runtime=createSorobanRegistryRuntime({config})}){
 async function recordWith(tx,{orderId,operation,payload}){
  if(!operations.has(operation))throw new AdsError(400,'registry_operation_invalid','Operación de registro no permitida.');
  if(!config.registryContract)return {state:'DISABLED',reason:'registry_not_deployed'};
  registryArguments(operation,payload,await import('@stellar/stellar-sdk'));
  const payloadHash=sha256(canonical({orderId,operation,payload}));
  const rows=(await tx.query("INSERT INTO ads_registry_jobs(id,order_id,operation,payload,payload_hash) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(payload_hash) DO UPDATE SET payload_hash=EXCLUDED.payload_hash RETURNING *",[uuid(),orderId,operation,JSON.stringify(payload),payloadHash])).rows;
  return rows[0];
 }
 const record=options=>recordWith(db,options);
 async function syncOrder(orderId){
  if(!config.registryContract)return {state:'DISABLED',reason:'registry_not_deployed'};
  return db.transaction(async tx=>{
   const order=(await tx.query('SELECT * FROM ads_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
   if(!order)throw new AdsError(404,'order_not_found','Order unavailable.');
   const revision=(await tx.query('SELECT * FROM ads_revisions WHERE id=$1',[order.revision_id])).rows[0];
   if(revision?.state!=='AUDITED'||!revision.manifest_hash)return {state:'WAITING',reason:'manifest_not_audited'};
   const payment=(await tx.query("SELECT * FROM ads_payment_attempts WHERE order_id=$1 AND state='SETTLED'",[orderId])).rows[0];
   if(!payment)return {state:'WAITING',reason:'payment_not_confirmed'};
   const existing=(await tx.query('SELECT * FROM ads_registry_jobs WHERE order_id=$1 ORDER BY sequence',[orderId])).rows;
   const commitment=prepareRegistryCommit(order,revision,payment,config),prior=existing.find(j=>j.operation==='commit');
   if(prior&&canonical(prior.payload)!==canonical(commitment))return {state:'RECONCILIATION_REQUIRED',reason:'registry_commitment_changed'};
   const jobs=[];
   const disputes=(await tx.query('SELECT * FROM ads_disputes WHERE order_id=$1 ORDER BY created_at,id',[orderId])).rows;
   const open=disputes.filter(d=>d.state==='OPEN');
   if(open.length)await tx.query("UPDATE ads_registry_jobs SET state='CANCELLED',evidence=$2::jsonb,updated_at=now() WHERE order_id=$1 AND operation='complete' AND state='READY'",[orderId,JSON.stringify({reason:'disputed_before_submission'})]);
   const lastDispute=[...existing].reverse().find(j=>j.operation==='dispute'),lastResolution=[...existing].reverse().find(j=>j.operation==='resolve_dispute');
   const unresolvedRegistry=lastDispute&&(!lastResolution||Number(lastDispute.sequence)>Number(lastResolution.sequence));
   let resolutionHash=lastResolution?.payload?.remedy_hash;
   if(unresolvedRegistry){
    if(open.length)return {state:'DISPUTED',jobs:[]};
    if(lastDispute.state!=='CONFIRMED')return {state:'WAITING',reason:'registry_dispute_not_confirmed'};
    resolutionHash=sha256(disputes.filter(d=>d.resolved_at).map(d=>({id:d.id,state:d.state,resolvedAt:new Date(d.resolved_at).toISOString(),resolution:d.resolution??null})));
    jobs.push(await recordWith(tx,{orderId,operation:'resolve_dispute',payload:{order:commitment.order,remedy_hash:resolutionHash}}));
   }
   if(!prior)jobs.push(await recordWith(tx,{orderId,operation:'commit',payload:commitment}));
   const registered=new Set(existing.filter(j=>j.operation==='record_delivery').map(j=>j.payload.segment));
   const rows=(await tx.query('SELECT * FROM ads_delivery WHERE order_id=$1 ORDER BY starts_at,placement_id,id',[orderId])).rows.filter(r=>!registered.has(sha256(r.id)));
   const nonces=existing.filter(j=>j.operation==='record_delivery').map(j=>BigInt(j.payload.nonce));
   const nonceStart=nonces.reduce((n,v)=>v>=n?v+1n:n,0n);
   const payloads=rows.length?await prepareRegistryDelivery(order,rows,{config,nonceStart}):[];
   for(const payload of payloads)jobs.push(await recordWith(tx,{orderId,operation:'record_delivery',payload}));
   if(open.length){jobs.push(await recordWith(tx,{orderId,operation:'dispute',payload:{order:commitment.order,disputeIds:open.map(d=>d.id)}}));return {state:'DISPUTED',jobs:jobs.map(j=>j.id)};}
   const placements=(await tx.query('SELECT * FROM ads_placements WHERE order_id=$1',[orderId])).rows;
   if(placements.length===commitment.placements.length&&placements.every(p=>BigInt(p.delivered_units)===BigInt(p.required_units)))jobs.push(await recordWith(tx,{orderId,operation:'complete',payload:{order:commitment.order,...(resolutionHash?{resolutionHash}:{})}}));
   else if(Date.now()>commitment.deadline)jobs.push(await recordWith(tx,{orderId,operation:'expire',payload:{order:commitment.order}}));
   return {state:'PREPARED',jobs:jobs.map(j=>j.id)};
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
  const ids=(await db.query("SELECT j.id FROM ads_registry_jobs j WHERE j.state='READY' AND NOT EXISTS(SELECT 1 FROM ads_registry_jobs prior WHERE prior.order_id=j.order_id AND prior.sequence<j.sequence AND prior.state NOT IN ('CONFIRMED','CANCELLED')) ORDER BY j.sequence LIMIT $1",[Math.min(100,Math.max(1,limit))])).rows;
  const results=[];
  for(const {id} of ids){
   const prepared=await db.transaction(async tx=>{
    const job=(await tx.query('SELECT * FROM ads_registry_jobs WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(job.state!=='READY')return null;
    const signed=await runtime.prepare(job);
    if(!signed?.txHash||!signed.signedXdr)fail('registry_signer_unavailable','No hay una transacción de registro firmada.');
    await tx.query("UPDATE ads_registry_jobs SET state='SUBMITTED',transaction_hash=$2,signed_xdr=$3,updated_at=now() WHERE id=$1",[id,signed.txHash,signed.signedXdr]);
    return {...job,state:'SUBMITTED',transaction_hash:signed.txHash,signed_xdr:signed.signedXdr};
   });
   if(!prepared)continue;
   try{await runtime.submit(prepared);}catch{/* Preserve exact hash; no new signature on an uncertain submission. */}
   const result=await reconcile(id);results.push(result);if(result.state==='CONFIRMED'&&['dispute','resolve_dispute'].includes(result.operation))await syncOrder(result.order_id);
  }
  return {processed:results.length,results};
 }
 async function expire({orderId,orderHash}){return record({orderId,operation:'expire',payload:{order:orderHash}});}
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
export function createSorobanRegistryRuntime({config,signer,rpc,loadSdk=()=>import('@stellar/stellar-sdk')}){
 if(!signer&&config.registrySignerSecretFile)signer=createOperatorRegistrySigner({secretFile:config.registrySignerSecretFile,config,rpc,loadSdk});
 const ready=()=>{if(config.network!=='stellar:testnet'||!config.registryContract)fail('registry_not_configured','El registro Soroban no está desplegado en Testnet.');};
 const server=async()=>{ready();if(!rpc){const {Server}=await import('@stellar/stellar-sdk/rpc');rpc=new Server(config.rpcUrl??'https://soroban-testnet.stellar.org');}return rpc;};
 const validate=async(job,envelope)=>{
  const s=await loadSdk(),tx=s.TransactionBuilder.fromXDR(envelope,s.Networks.TESTNET),op=tx.operations[0];
  if(tx.innerTransaction||tx.operations.length!==1||op?.type!=='invokeHostFunction'||op.func.switch().name!=='hostFunctionTypeInvokeContract')fail('registry_transaction_invalid','Invocación de registro inválida.');
  const f=op.func.invokeContract(),expected=registryArguments(job.operation,job.payload,s);
  if(s.Address.fromScAddress(f.contractAddress()).toString()!==config.registryContract||f.functionName().toString()!==job.operation||canonical(f.args().map(a=>a.toXDR('base64')))!==canonical(expected.map(a=>a.toXDR('base64'))))fail('registry_transaction_invalid','La firma modificó la invocación autorizada.');
  return tx;
 };
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

/** File-backed issuer exposes only the five restricted registry operations. */
export function createOperatorRegistrySigner({secretFile,config,rpc,loadSdk=()=>import('@stellar/stellar-sdk')}){
 return {address:config.registryIssuer,async prepare(job){
  if(!secretFile||!operations.has(job.operation)||!(config.operators??[]).includes(config.registryIssuer))fail('registry_signer_unavailable','The configured registry issuer is not authorized.');
  const s=await loadSdk();let key;try{key=s.Keypair.fromSecret((await readFile(secretFile,'utf8')).trim());}catch{fail('registry_signer_unavailable','The restricted registry issuer key could not be loaded.');}
  if(key.publicKey()!==config.registryIssuer)fail('registry_signer_mismatch','The issuer key does not match the configured public authority.');
  const signer={address:key.publicKey(),async signTransaction(xdr,{networkPassphrase}){if(networkPassphrase!==s.Networks.TESTNET)fail('registry_testnet_only','Only Testnet is permitted.');const tx=s.TransactionBuilder.fromXDR(xdr,s.Networks.TESTNET);tx.sign(key);return {signedTxXdr:tx.toXDR()};}};
  return createSorobanRegistryRuntime({config,signer,rpc,loadSdk}).prepare(job);
 }};
}
