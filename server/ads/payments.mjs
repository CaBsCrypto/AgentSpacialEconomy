import {PILOT_PROFILE} from './offers.mjs';
import {lockOrderInventory} from './scheduler.mjs';
import { AdsError, canonical, sha256, uuid } from './common.mjs';
import { createStellarPaymentRuntime } from './stellar-payments.mjs';
const json = JSON.stringify;
const fail = (status, code, message) => { throw new AdsError(status, code, message); };
const getOrder = async (tx, id, owner, lock = false) => {
 const row = (await tx.query(`SELECT * FROM ads_orders WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0];
 if (!row || (owner !== undefined && row.owner_id !== owner)) fail(404,'order_not_found','Orden no disponible.');
 return row;
};
const receipt = (order, attempt) => ({status:attempt?.state==='SETTLED'?200:202,orderId:order.id,orderState:order.state,queueState:order.queue_state,attemptId:attempt?.id,paymentState:attempt?.state??'REQUIRED',transaction:attempt?.state==='SETTLED'?attempt.settlement_tx:null,payer:attempt?.payer??null,network:'stellar:testnet'});

/** Persist authorization before transmission; only proof of settlement creates a paid job. */
export function createPaymentService({db,config,runtime=createStellarPaymentRuntime({config}),onSettled,now=Date.now}) {
 const assertAvailableBalance=async(order,ownerId)=>{
  if(order.quote?.offerId!==PILOT_PROFILE)return;
  let balance;
  try{balance=BigInt(await runtime.balance(ownerId.startsWith('stellar:testnet:')?ownerId.slice(16):ownerId));if(balance<0n)throw Error();}
  catch{throw new AdsError(503,'balance_unavailable','No se pudo confirmar el saldo disponible de USDC de prueba.');}
  if(balance<BigInt(order.amount))throw new AdsError(409,'insufficient_balance','Saldo insuficiente: esta compra requiere 5 USDC de prueba.',{balanceUnits:balance.toString(),requiredUnits:String(order.amount)});
 };
 const requirementsFor = order => {
  if(config.network!=='stellar:testnet'||!config.asset||!config.issuer||!config.payTo||order.pay_to!==config.payTo) fail(503,'payments_not_configured','Compras deshabilitadas: falta configuración de pagos.');
  if(!/^\d+$/.test(String(order.amount))||BigInt(order.amount)<=0n) fail(409,'invalid_quote','La cotización no tiene importe válido.');
  return {scheme:'exact',network:'stellar:testnet',asset:config.asset,amount:String(order.amount),payTo:order.pay_to,maxTimeoutSeconds:config.paymentTimeoutSeconds??60,extra:{areFeesSponsored:true}};
 };
 const scheduleReconciliation=(tx,orderId,attemptId,when)=>tx.query("INSERT INTO ads_outbox(id,topic,aggregate_id,payload,dedupe_key,available_at) VALUES($1,'payment-reconcile',$2,$3::jsonb,$4,$5) ON CONFLICT(dedupe_key) DO UPDATE SET available_at=LEAST(ads_outbox.available_at,EXCLUDED.available_at),status=CASE WHEN ads_outbox.status IN ('DONE','FAILED') THEN 'READY' ELSE ads_outbox.status END",[uuid(),orderId,json({attemptId}),'payment-reconcile:'+attemptId,new Date(when)]);
 const event = (tx,id,kind,data) => tx.query('INSERT INTO ads_events(aggregate_id,actor,event,data) VALUES($1,$2,$3,$4::jsonb)',[id,'payments',kind,json(data)]);
 const uncertain = (id,code) => db.transaction(async tx=>{
  const first=(await tx.query('SELECT * FROM ads_payment_attempts WHERE id=$1',[id])).rows[0];
  await getOrder(tx,first.order_id,undefined,true);
  const a=(await tx.query('SELECT * FROM ads_payment_attempts WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(a.state==='SETTLED') return receipt(await getOrder(tx,a.order_id),a);
  await tx.query("UPDATE ads_payment_attempts SET state='RECONCILIATION_REQUIRED',error_code=$2,updated_at=now() WHERE id=$1",[id,code]);
  await tx.query("UPDATE ads_orders SET state='RECONCILIATION_REQUIRED',updated_at=now() WHERE id=$1",[a.order_id]);
  await scheduleReconciliation(tx,a.order_id,a.id,now()+1000);
  await event(tx,a.order_id,'payment_reconciliation_required',{attemptId:id,code});
  return receipt(await getOrder(tx,a.order_id),{...a,state:'RECONCILIATION_REQUIRED'});
 });
 async function reconcile(attemptId) {
  const a=(await db.query('SELECT * FROM ads_payment_attempts WHERE id=$1',[attemptId])).rows[0];
  if(!a) fail(404,'payment_not_found','Intento no disponible.');
  const order=await getOrder(db,a.order_id);
  if(['SETTLED','FAILED'].includes(a.state)) return receipt(order,a);
  let proof;
  try {proof=await runtime.confirm({...a,order,requirements:requirementsFor(order)});} catch {return uncertain(a.id,'confirmation_unavailable');}
  if(proof?.state!=='CONFIRMED'||!proof.txHash||proof.payer!==a.payer) return uncertain(a.id,proof?.reason??'settlement_not_proven');
  return db.transaction(async tx=>{
   const locked=await lockOrderInventory(tx,a.order_id);
   const current=(await tx.query('SELECT * FROM ads_payment_attempts WHERE id=$1 FOR UPDATE',[a.id])).rows[0];
   if(current.state==='SETTLED') return receipt(locked,current);
   await tx.query("UPDATE ads_payment_attempts SET state='SETTLED',settlement_tx=$2,evidence=$3::jsonb,error_code=NULL,updated_at=now() WHERE id=$1",[a.id,proof.txHash,json(proof)]);
   const confirmed={...current,state:'SETTLED',settlement_tx:proof.txHash};
   if(typeof onSettled!=='function') fail(503,'queue_not_configured','Falta la cola durable.');
   await onSettled(tx,locked,{...receipt(locked,confirmed),evidence:proof});
   await event(tx,locked.id,'payment_settled',{attemptId:a.id,transaction:proof.txHash});
   return receipt(await getOrder(tx,locked.id),confirmed);
  });
 }
 async function pay({orderId,ownerId,idempotencyKey,payload}) {
  if(!ownerId) fail(401,'authentication_required','Inicia sesión con tu wallet.');
  const order=await getOrder(db,orderId,ownerId),requirements=requirementsFor(order);
  if(payload&&idempotencyKey){const previous=(await db.query('SELECT * FROM ads_payment_attempts WHERE order_id=$1 AND idempotency_key=$2',[orderId,idempotencyKey])).rows[0];if(previous&&previous.payload_hash!==sha256(canonical(payload)))fail(409,'idempotency_conflict','La clave corresponde a otro contenido.');}
  const paid=(await db.query("SELECT * FROM ads_payment_attempts WHERE order_id=$1 AND state='SETTLED'",[orderId])).rows[0];
  if(paid) return receipt(order,paid);
  if(!payload){const pending=(await db.query("SELECT * FROM ads_payment_attempts WHERE order_id=$1 AND state<>'FAILED'",[orderId])).rows[0];if(pending)return receipt(order,pending);}
  if(!payload){
   if(!['RESERVED','PAYMENT_PENDING'].includes(order.state))fail(409,'order_not_payable','The order is not payable.');
   const held=(await db.query("SELECT * FROM ads_reservations WHERE order_id=$1 AND state='HELD' AND expires_at>now()",[orderId])).rows;
   if(!held.length)fail(409,'reservation_expired','The reservation expired; obtain a new quote before signing.');
   if(Array.isArray(order.quote?.placements)&&order.quote.requiredUnits&&order.quote.placements.some(id=>held.filter(r=>r.placement_id===id).reduce((n,r)=>n+BigInt(r.delivery_units??0),0n)<BigInt(order.quote.requiredUnits)))fail(409,'reservation_incomplete','Reserve all selected placements before authorizing a payment.');
  }
  if(!payload)await assertAvailableBalance(order,ownerId);
  if(!payload) return {status:402,paymentRequired:{x402Version:2,resource:{url:`${config.origin}/api/ads/orders/${orderId}/pay`,description:'Publicidad digital de prueba: recepción durable tras liquidación.',mimeType:'application/json'},accepts:[requirements]}};
  if(typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200) fail(400,'idempotency_required','Incluye una clave idempotente estable.');
  const payloadHash=sha256(canonical(payload));
  const prior=(await db.query('SELECT * FROM ads_payment_attempts WHERE order_id=$1 AND idempotency_key=$2',[orderId,idempotencyKey])).rows[0];
  if(prior){if(prior.payload_hash!==payloadHash) fail(409,'idempotency_conflict','La clave corresponde a otro contenido.');return prior.state==='SETTLED'?receipt(order,prior):reconcile(prior.id);}
  await assertAvailableBalance(order,ownerId);
  const decoded=await runtime.decodePayment(payload,{...requirements,payer:ownerId.startsWith('stellar:testnet:')?ownerId.slice(16):ownerId,now:now()}),startLedger=await runtime.latestLedger();
  if(!decoded?.payer||!decoded.authHash||decoded.nonce===undefined||!Number.isSafeInteger(Number(decoded.expiresLedger))||Number(decoded.expiresLedger)<Number(startLedger)) fail(422,'authorization_invalid','Autorización inválida o vencida.');
  const attempt=await db.transaction(async tx=>{
   const current=await lockOrderInventory(tx,orderId,ownerId);
   const existing=(await tx.query('SELECT * FROM ads_payment_attempts WHERE order_id=$1 AND idempotency_key=$2',[orderId,idempotencyKey])).rows[0];
   if(existing){if(existing.payload_hash!==payloadHash) fail(409,'idempotency_conflict','La clave corresponde a otro contenido.');return {...existing,recovered:true};}
   if((await tx.query("SELECT * FROM ads_payment_attempts WHERE order_id=$1 AND state<>'FAILED'",[orderId])).rows[0]) fail(409,'payment_already_pending','El pago anterior requiere reconciliación.');
   if(!['RESERVED','PAYMENT_PENDING'].includes(current.state)) fail(409,'order_not_payable','La orden no tiene reserva pagable.');
   const held=(await tx.query("SELECT * FROM ads_reservations WHERE order_id=$1 AND state='HELD' AND expires_at>now() FOR UPDATE",[orderId])).rows;
   if(!held.length)fail(409,'reservation_expired','La reserva expiró; solicita otra cotización.');
   if(Array.isArray(current.quote?.placements)&&current.quote.placements.some(id=>held.filter(r=>r.placement_id===id).reduce((sum,r)=>sum+BigInt(r.delivery_units??0),0n)<BigInt(current.quote.requiredUnits)))fail(409,'reservation_incomplete','La reserva no cubre todas las obligaciones; solicita otra cotización.');
   if(canonical(requirementsFor(current))!==canonical(requirements))fail(409,'quote_changed','La cotización cambió antes del pago.');
   const row={id:uuid(),order_id:orderId,state:'VERIFYING',payer:decoded.payer,auth_nonce:String(decoded.nonce),auth_hash:decoded.authHash,signed_payload:payload,payload_hash:payloadHash,start_ledger:Number(startLedger),expires_ledger:Number(decoded.expiresLedger)};
   try{await tx.query("INSERT INTO ads_payment_attempts(id,order_id,idempotency_key,payload_hash,signed_payload,network,payer,auth_nonce,auth_hash,expires_ledger,start_ledger,state) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,'VERIFYING')",[row.id,orderId,idempotencyKey,payloadHash,json(payload),'stellar:testnet',row.payer,row.auth_nonce,row.auth_hash,row.expires_ledger,row.start_ledger]);}catch(e){if(e.code==='23505')fail(409,'authorization_reused','La autorización ya corresponde a otra compra.');throw e;}
   await tx.query("UPDATE ads_orders SET state='PAYMENT_PENDING',payer=$2,updated_at=now() WHERE id=$1",[orderId,row.payer]);
   await scheduleReconciliation(tx,orderId,row.id,now()+(config.paymentTimeoutSeconds??60)*1000);
   await event(tx,orderId,'payment_authorized',{attemptId:row.id,authorization:row.auth_hash});return row;
  });
  if(attempt.recovered)return reconcile(attempt.id);
  let verified;try{verified=await runtime.verify(payload,requirements);}catch{return uncertain(attempt.id,'verification_unavailable');}
  if(!verified?.isValid||verified.payer!==attempt.payer){await db.transaction(async tx=>{await tx.query("UPDATE ads_payment_attempts SET state='FAILED',verification=$2::jsonb,error_code='verification_rejected',updated_at=now() WHERE id=$1",[attempt.id,json(verified??{})]);await event(tx,orderId,'payment_verification_rejected',{attemptId:attempt.id});});fail(422,'payment_verification_rejected','Autorización rechazada antes de transmitir un pago.');}
  await db.query("UPDATE ads_payment_attempts SET state='SETTLING',verification=$2::jsonb,updated_at=now() WHERE id=$1",[attempt.id,json(verified)]);
  let settled;try{settled=await runtime.settle(payload,requirements);}catch{return uncertain(attempt.id,'settlement_timeout');}
  await db.query('UPDATE ads_payment_attempts SET settlement=$2::jsonb,settlement_tx=$3,updated_at=now() WHERE id=$1',[attempt.id,json(settled??{}),settled?.transaction||null]);
  return reconcile(attempt.id);
 }
 return {pay,reconcile};
}
