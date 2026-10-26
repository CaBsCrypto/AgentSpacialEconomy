import {StrKey} from '@stellar/stellar-sdk';
import {ASSET,ISSUER,NETWORK} from './config.mjs';
import {AdsError,assert,canonical,identifier,idempotent,sha256,uuid} from './common.mjs';

export const COMPATIBILITY_TTL_MS=60000;
export const COMPATIBILITY_LIMIT=3;
const AMOUNT='50000000';
const KEY=/^[A-Za-z0-9:_-]{8,160}$/;
const HASH=/^[a-f0-9]{64}$/i;
const fail=(status,code,message)=>{throw new AdsError(status,code,message);};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const iso=value=>new Date(value).toISOString();
// Fixed protocol tokens from the pinned Stellar facilitator. Free-form messages,
// extensions and payload fragments are never diagnostic output or persisted here.
const REJECTION_PREFIX='facilitator_rejected:';
const VERIFICATION_REASONS=new Set([
 'invalid_exact_stellar_payload_event_missing_contract_id',
 'invalid_exact_stellar_payload_event_not_transfer',
 'invalid_exact_stellar_payload_event_wrong_amount',
 'invalid_exact_stellar_payload_event_wrong_asset',
 'invalid_exact_stellar_payload_event_wrong_from',
 'invalid_exact_stellar_payload_event_wrong_to',
 'invalid_exact_stellar_payload_facilitator_in_auth',
 'invalid_exact_stellar_payload_facilitator_is_payer',
 'invalid_exact_stellar_payload_fee_exceeds_maximum',
 'invalid_exact_stellar_payload_has_subinvocations',
 'invalid_exact_stellar_payload_malformed',
 'invalid_exact_stellar_payload_missing_payer_signature',
 'invalid_exact_stellar_payload_multiple_transfers',
 'invalid_exact_stellar_payload_no_auth_entries',
 'invalid_exact_stellar_payload_no_transfer_events',
 'invalid_exact_stellar_payload_simulation_failed',
 'invalid_exact_stellar_payload_unexpected_pending_signatures',
 'invalid_exact_stellar_payload_unsafe_tx_or_op_source',
 'invalid_exact_stellar_payload_unsupported_credential_type',
 'invalid_exact_stellar_payload_wrong_amount',
 'invalid_exact_stellar_payload_wrong_asset',
 'invalid_exact_stellar_payload_wrong_function_name',
 'invalid_exact_stellar_payload_wrong_operation',
 'invalid_exact_stellar_payload_wrong_recipient',
 'invalid_exact_stellar_signature_expiration_too_far',
 'invalid_network',
 'invalid_exact_payload_malformed',
 'unsupported_network',
 'invalid_scheme',
 'unsupported_asset',
 'verify_network_mismatch',
 'invalid_exact_stellar_payload_wrong_function_args',
 'invalid_exact_stellar_payload_unsafe_from_address',
 'invalid_exact_stellar_payload_unexpected_balance_changes',
 'invalid_exact_stellar_payload_has_envelope_signatures',
 'invalid_exact_stellar_payload_missing_auth_entries',
 'invalid_exact_stellar_payload_missing_payer_auth',
 'invalid_exact_stellar_payload_unsigned_auth_entry',
 'invalid_exact_stellar_payload_auth_expiration_too_far',
 'invalid_exact_stellar_payload_auth_already_expired',
 'invalid_exact_stellar_payload_fee_below_minimum',
 'invalid_x402_version',
 'network_mismatch',
 'unexpected_verify_error',
 'unsupported_scheme',
 ]);
export const safeVerificationReason=value=>typeof value==='string'&&VERIFICATION_REASONS.has(value)?value:null;
const rejectionCode=value=>{const reason=safeVerificationReason(value);return reason?REJECTION_PREFIX+reason:'facilitator_rejected';};
function publicResult(row){
 const e=row.expected,prefixed=typeof row.error_code==='string'&&row.error_code.startsWith(REJECTION_PREFIX);
 const reason=prefixed?safeVerificationReason(row.error_code.slice(REJECTION_PREFIX.length)):null;
 return {id:row.id,status:row.state,isValid:row.state==='VERIFIED'?true:row.state==='REJECTED'?false:null,
  payer:row.payer,expiresAt:iso(row.expires_at),verificationStarted:!!row.verify_key,gateChanged:false,errorCode:prefixed?'facilitator_rejected':row.error_code||null,...(reason?{verificationReason:reason}:{}),
  evidence:{payloadHash:row.payload_hash||null,authHash:row.auth_hash||null,requirementsHash:sha256(row.requirements),
   verificationHash:row.verification_hash||null,expiresLedger:row.expires_ledger==null?null:Number(row.expires_ledger),
   startLedger:row.start_ledger==null?null:Number(row.start_ledger),network:e.network,asset:e.asset,amountUnits:e.amountUnits,payTo:e.payTo,resourceUrl:e.resourceUrl},
  meaning:'Compatibility verification only. No settlement, order, queue entry or publication.'};
}

/** A bounded diagnostic: only decode, ledger read and facilitator verification are available here. */
export function createCompatibilityService({db,config,runtime,now=Date.now}){
 const configuredTimeout=Number(config.paymentRequestTimeoutMs??20000);
 const verifyTimeoutMs=Number.isSafeInteger(configuredTimeout)&&configuredTimeout>0?Math.min(configuredTimeout,20000):20000;
 async function boundedVerify(payload,requirements){let timer;try{return await Promise.race([runtime.verify(payload,requirements),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('verification_timeout')),verifyTimeoutMs);})]);}finally{clearTimeout(timer);}}
 const identity=who=>{
  assert(object(who)&&StrKey.isValidContract(who.address||'')&&who.ownerId==='stellar:testnet:'+who.address,401,'compatibility_identity_required','Authenticate the existing C-account passkey first.');
  return who;
 };
 const configured=()=>{
  let origin,facilitator;
  try{origin=new URL(config.origin);facilitator=new URL(config.facilitatorUrl||'https://x402.org/facilitator');}catch{fail(503,'compatibility_unconfigured','Configure an exact venue origin and facilitator.');}
  assert(origin.origin===config.origin&&(origin.protocol==='https:'||origin.protocol==='http:'&&['localhost','127.0.0.1'].includes(origin.hostname))&&facilitator.protocol==='https:'&&!facilitator.username&&!facilitator.password,503,'compatibility_unconfigured','Configure an exact venue origin and HTTPS facilitator.');
  assert(config.network===NETWORK&&config.asset===ASSET&&config.issuer===ISSUER&&StrKey.isValidEd25519PublicKey(config.payTo||''),503,'compatibility_unconfigured','Only the configured Testnet USDC and public G receiver are allowed.');
  assert(typeof runtime?.decodePayment==='function'&&typeof runtime?.latestLedger==='function'&&typeof runtime?.verify==='function',503,'compatibility_unconfigured','The verification adapter is unavailable.');
  return sha256({origin:config.origin,network:NETWORK,asset:ASSET,issuer:ISSUER,payTo:config.payTo,facilitatorUrl:facilitator.href});
 };
 const key=value=>assert(typeof value==='string'&&KEY.test(value),400,'idempotency_required','Provide an Idempotency-Key of 8 to 160 characters.');
 const walletLock=(tx,ownerId)=>tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',['ads-compatibility:'+ownerId]);
 async function quotaFor(tx,ownerId,clock=now()){
  const row=(await tx.query('SELECT count(*)::int AS used,min(verification_started_at) AS oldest FROM ads_compatibility WHERE owner_id=$1 AND verify_key IS NOT NULL AND verification_started_at>$2',[ownerId,new Date(clock-3600000)])).rows[0];
  const used=Number(row.used);return{limit:COMPATIBILITY_LIMIT,used,remaining:Math.max(0,COMPATIBILITY_LIMIT-used),retryAt:used>=COMPATIBILITY_LIMIT?iso(+new Date(row.oldest)+3600000):null};
 }
 async function requireQuota(tx,who){const serverTime=iso(now()),quota=await quotaFor(tx,who.ownerId);if(!quota.remaining)throw new AdsError(429,'compatibility_quota','At most three signed verification admissions per wallet per hour.',{serverTime,quota,retryAt:quota.retryAt,verificationStarted:false});return quota;}
 const draft=(row,clock)=>({id:row.id,challenge:row.challenge,expected:row.expected,expiresAt:iso(row.expires_at),serverTime:iso(clock)});
 async function reusable(tx,who,configurationHash,clock){return(await tx.query("SELECT * FROM ads_compatibility WHERE owner_id=$1 AND configuration_hash=$2 AND state='PENDING' AND verify_key IS NULL AND expires_at>$3 ORDER BY created_at DESC,id DESC LIMIT 1",[who.ownerId,configurationHash,new Date(clock)])).rows[0]||null;}
 async function status(who,{attemptId}={}){
  identity(who);if(attemptId!==undefined)identifier(attemptId);const configurationHash=configured(),clock=now();
  const row=(await db.query('SELECT * FROM ads_compatibility WHERE owner_id=$1'+(attemptId?' AND id=$2':' ORDER BY created_at DESC,id DESC LIMIT 1'),attemptId?[who.ownerId,attemptId]:[who.ownerId])).rows[0]||null;
  if(attemptId)assert(row&&row.payer===who.address,404,'compatibility_unavailable','Compatibility proof unavailable.');
  const quota=await quotaFor(db,who.ownerId,clock),pending=await reusable(db,who,configurationHash,clock);
  const attempt=row?{...publicResult(row),status:row.state==='PENDING'&&!row.verify_key&&+new Date(row.expires_at)<=clock?'EXPIRED':row.state,configurationMatches:row.configuration_hash===configurationHash}:null;
  return{serverTime:iso(clock),quota,attempt,challenge:pending?draft(pending,clock):null};
 }
 const exactPayload=(payload,row)=>{
  assert(object(payload)&&Object.keys(payload).every(k=>['x402Version','resource','accepted','payload'].includes(k))&&payload.x402Version===2,422,'compatibility_payload_invalid','Provide the exact x402 v2 authorization.');
  assert(canonical(payload.resource)===canonical(row.challenge.resource)&&canonical(payload.accepted)===canonical(row.requirements),422,'compatibility_challenge_mismatch','The signed payload does not match the saved compatibility challenge.');
  assert(object(payload.payload)&&Object.keys(payload.payload).length===1&&typeof payload.payload.transaction==='string',422,'compatibility_payload_invalid','Provide only the signed transaction payload.');
 };
 async function bind(tx,who,id,requestKey,payloadHash,configurationHash){
  await walletLock(tx,who.ownerId);
  const fingerprint=sha256({action:'compatibility-verify',id,payloadHash});
  await tx.query("INSERT INTO ads_idempotency(owner_id,key,action,fingerprint) VALUES($1,$2,'compatibility-verify',$3) ON CONFLICT(owner_id,key) DO NOTHING",[who.ownerId,requestKey,fingerprint]);
  const idem=(await tx.query('SELECT * FROM ads_idempotency WHERE owner_id=$1 AND key=$2 FOR UPDATE',[who.ownerId,requestKey])).rows[0];
  assert(idem.action==='compatibility-verify'&&idem.fingerprint===fingerprint,409,'idempotency_conflict','The key belongs to another compatibility request.');
  let row=(await tx.query('SELECT * FROM ads_compatibility WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,who.ownerId])).rows[0];
  assert(row&&row.payer===who.address,404,'compatibility_unavailable','Compatibility proof unavailable.');
  assert(row.configuration_hash===configurationHash,409,'compatibility_configuration_changed','The receiver or verification configuration changed; obtain a new challenge.');
  if(row.verify_key){
   assert(row.verify_key===requestKey&&row.payload_hash===payloadHash,409,'compatibility_replay_conflict','This challenge is already bound to another request or authorization.');
   if(row.state==='VERIFYING'&&now()>=+new Date(row.verification_deadline)){
    row=(await tx.query("UPDATE ads_compatibility SET state='RECONCILIATION_REQUIRED',error_code='verification_interrupted',updated_at=$2 WHERE id=$1 RETURNING *",[id,new Date(now())])).rows[0];
   }
   return {row,cached:true};
  }
  assert(row.state==='PENDING'&&+new Date(row.expires_at)>now(),410,'compatibility_expired','The compatibility challenge expired; no verification was submitted.');
  return {row,cached:false};
 }
 async function finish(id,requestKey,payloadHash,state,{verificationHash=null,errorCode=null}={}){
  const owner=(await db.query('SELECT owner_id FROM ads_compatibility WHERE id=$1',[id])).rows[0];
  assert(owner,404,'compatibility_unavailable','Compatibility proof unavailable.');
  return db.transaction(async tx=>{
   await walletLock(tx,owner.owner_id);
   await tx.query('SELECT owner_id FROM ads_idempotency WHERE owner_id=$1 AND key=$2 FOR UPDATE',[owner.owner_id,requestKey]);
   const row=(await tx.query('SELECT * FROM ads_compatibility WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(row.state!=='VERIFYING'||row.verify_key!==requestKey||row.payload_hash!==payloadHash)return publicResult(row);
   const updated=(await tx.query('UPDATE ads_compatibility SET state=$2,verification_hash=$3,error_code=$4,verified_at=$5,updated_at=$6 WHERE id=$1 RETURNING *',[id,state,verificationHash,errorCode,state==='VERIFIED'?new Date(now()):null,new Date(now())])).rows[0];
   const response=publicResult(updated);
   await tx.query('UPDATE ads_idempotency SET response=$3 WHERE owner_id=$1 AND key=$2',[row.owner_id,requestKey,response]);
   return response;
  });
 }
 async function challenge(who,body,requestKey){
  identity(who);key(requestKey);const configurationHash=configured();
  assert(object(body)&&Object.keys(body).length===0,400,'compatibility_request_invalid','The server fixes all compatibility requirements.');
  return db.transaction(async tx=>{
   await walletLock(tx,who.ownerId);
   return idempotent(tx,{ownerId:who.ownerId,key:requestKey,action:'compatibility-challenge',payload:body},async()=>{
    const quota=await requireQuota(tx,who),clock=now(),existing=await reusable(tx,who,configurationHash,clock);
    if(existing)return{...draft(existing,clock),quota,verificationStarted:false};
    const id=uuid(),expiresAt=iso(clock+COMPATIBILITY_TTL_MS),resourceUrl=new URL('/api/ads/compatibility/'+id+'/verify',config.origin).href;
    const requirements={scheme:'exact',network:NETWORK,asset:ASSET,amount:AMOUNT,payTo:config.payTo,maxTimeoutSeconds:60,extra:{areFeesSponsored:true}};
    const expected={network:NETWORK,asset:ASSET,issuer:ISSUER,amountUnits:AMOUNT,payTo:config.payTo,payer:who.address,resourceUrl};
    const paymentChallenge={x402Version:2,resource:{url:resourceUrl,description:'Verify-only compatibility authorization; this endpoint never settles a payment.',mimeType:'application/json'},accepts:[requirements]};
    await tx.query("INSERT INTO ads_compatibility(id,owner_id,payer,challenge_key,challenge,expected,requirements,configuration_hash,state,expires_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9,$10,$10)",[id,who.ownerId,who.address,requestKey,paymentChallenge,expected,requirements,configurationHash,new Date(expiresAt),new Date(clock)]);
    return{id,challenge:paymentChallenge,expected,expiresAt,serverTime:iso(clock),quota,verificationStarted:false};
   });
  });
 }
 async function verify(who,id,body,requestKey){
  try{
  identity(who);identifier(id);key(requestKey);const configurationHash=configured();
  assert(object(body)&&Object.keys(body).length===1&&Object.hasOwn(body,'payload')&&object(body.payload),400,'compatibility_request_invalid','Provide only the signed payload.');
  let serialized;
  try{serialized=canonical(body.payload);}catch{fail(422,'compatibility_payload_invalid','The signed payload is not a JSON object.');}
  assert(Buffer.byteLength(serialized)<=131072,413,'compatibility_payload_limit','The signed payload exceeds its byte limit.');
  const payload=JSON.parse(serialized),payloadHash=sha256(serialized);
  const before=await db.transaction(tx=>bind(tx,who,id,requestKey,payloadHash,configurationHash));
  if(before.cached)return publicResult(before.row);
  exactPayload(payload,before.row);
  let decoded;
  try{decoded=await runtime.decodePayment(payload,{...before.row.requirements,payer:who.address,now:now()});}
  catch{fail(422,'compatibility_payload_invalid','The signed authorization does not match this C-account transfer.');}
  assert(decoded?.payer===who.address&&HASH.test(decoded.authHash||'')&&/^-?[0-9]{1,20}$/.test(String(decoded.nonce))&&Number.isSafeInteger(Number(decoded.expiresLedger)),422,'compatibility_authorization_invalid','The decoded authorization identity or bounds are invalid.');
  const nonce=String(decoded.nonce);let nonceNumber;try{nonceNumber=BigInt(nonce);}catch{fail(422,'compatibility_authorization_invalid','The authorization nonce is invalid.');}
  assert(nonceNumber>=-(1n<<63n)&&nonceNumber<(1n<<63n)&&(!decoded.payloadHash||decoded.payloadHash===payloadHash),422,'compatibility_authorization_invalid','The authorization nonce or payload fingerprint is invalid.');
  let ledger;
  try{ledger=Number(await runtime.latestLedger());}catch{fail(503,'compatibility_ledger_unavailable','The current Testnet ledger could not be read.');}
  assert(Number.isSafeInteger(ledger)&&ledger>0&&Number(decoded.expiresLedger)>=ledger&&Number(decoded.expiresLedger)<=ledger+12,422,'compatibility_authorization_expired','The authorization exceeds its sixty-second ledger window or has expired.');
  let claim;
  try{claim=await db.transaction(async tx=>{
   const current=await bind(tx,who,id,requestKey,payloadHash,configurationHash);if(current.cached)return {...current,execute:false};
   await requireQuota(tx,who);
   const reused=await tx.query('SELECT id FROM ads_payment_attempts WHERE auth_hash=$1 OR (payer=$2 AND auth_nonce=$3) LIMIT 1',[decoded.authHash,who.address,nonce]);
   assert(!reused.rowCount,409,'compatibility_authorization_reused','The authorization is already associated with a payment attempt.');
   const row=(await tx.query("UPDATE ads_compatibility SET state='VERIFYING',verify_key=$2,payload_hash=$3,signed_payload=$4,auth_hash=$5,auth_nonce=$6,expires_ledger=$7,start_ledger=$8,verification_started_at=$9,verification_deadline=$10,updated_at=$9 WHERE id=$1 RETURNING *",[id,requestKey,payloadHash,payload,decoded.authHash,nonce,Number(decoded.expiresLedger),ledger,new Date(now()),new Date(now()+verifyTimeoutMs+5000)])).rows[0];
   return {row,execute:true};
  });}catch(error){if(error.code==='23505')fail(409,'compatibility_authorization_reused','The authorization already belongs to another compatibility attempt.');throw error;}
  if(!claim.execute)return publicResult(claim.row);
  try{
   const verdict=await boundedVerify(payload,claim.row.requirements);
   if(!object(verdict)||typeof verdict.isValid!=='boolean')throw Error('invalid_verification_response');
   if(now()>=+new Date(claim.row.verification_deadline))return await finish(id,requestKey,payloadHash,'RECONCILIATION_REQUIRED',{errorCode:'verification_expired'});
   const valid=verdict.isValid===true&&verdict.payer===who.address;
   return await finish(id,requestKey,payloadHash,valid?'VERIFIED':'REJECTED',{verificationHash:sha256(verdict),errorCode:valid?null:verdict.isValid?'verification_payer_mismatch':rejectionCode(verdict.invalidReason)});
  }catch{return await finish(id,requestKey,payloadHash,'RECONCILIATION_REQUIRED',{errorCode:'facilitator_verification_unavailable'});}
  }catch(error){if(error instanceof AdsError&&[400,410,422,429].includes(error.status))error.details={...error.details,verificationStarted:false};throw error;}
 }
 return Object.freeze({challenge,verify,status});
}
