import {lockOrderInventory} from './scheduler.mjs';
import {readFile} from 'node:fs/promises';
import { AdsError, canonical, sha256, uuid } from './common.mjs';
import { TESTNET_USDC, TESTNET_ISSUER } from './stellar-payments.mjs';
const publicRefund=({signed_xdr,...row})=>row;
const fail=(status,code,message)=>{throw new AdsError(status,code,message);};
const positive=value=>{if(!/^\d+$/.test(String(value))||BigInt(value)<=0n)fail(400,'refund_amount_invalid','Importe entero positivo requerido.');return String(value);};

/** Refunds are separate operator transfers; a bookkeeping entry never means money returned. */
export function createRefundService({db,config,runtime=createStellarRefundRuntime({config}),now=Date.now}) {
 const admin=actor=>{if(!actor||!(config.operatorIds??config.operators??[]).includes(actor))fail(403,'refund_operator_required','Se requiere la autoridad de devoluciones configurada.');};
 const row=async(tx,id,lock=false)=>{const r=(await tx.query(`SELECT * FROM ads_refunds WHERE id=$1${lock?' FOR UPDATE':''}`,[id])).rows[0];if(!r)fail(404,'refund_not_found','Devolución no disponible.');return r;};
 const orderFor=async(tx,id)=>{const o=(await tx.query('SELECT * FROM ads_orders WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!o)fail(404,'order_not_found','Orden no disponible.');return o;};
 const event=(tx,r,type)=>tx.query('INSERT INTO ads_events(aggregate_id,actor,event,data) VALUES($1,$2,$3,$4::jsonb)',[r.order_id,r.approved_by??r.requested_by,type,JSON.stringify({refundId:r.id,amount:String(r.amount),transaction:r.transaction_hash??null})]);
 async function request({orderId,ownerId,amount,reason,idempotencyKey}){
  positive(amount);if(typeof reason!=='string'||!reason.trim()||reason.length>1000)fail(400,'refund_reason_required','Indica el motivo de la reclamación.');
  if(typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)fail(400,'idempotency_required','Incluye una clave idempotente estable.');
  return db.transaction(async tx=>{
   const order=await orderFor(tx,orderId);if(!ownerId||order.owner_id!==ownerId)fail(404,'order_not_found','Orden no disponible.');
   const prior=(await tx.query('SELECT * FROM ads_refunds WHERE order_id=$1 AND idempotency_key=$2',[orderId,idempotencyKey])).rows[0];
   if(prior){if(String(prior.amount)!==String(amount)||prior.reason!==reason)fail(409,'idempotency_conflict','La clave corresponde a otra reclamación.');return prior;}
   const paid=(await tx.query("SELECT * FROM ads_payment_attempts WHERE order_id=$1 AND state='SETTLED'",[orderId])).rows[0];
   if(!paid)fail(409,'refund_payment_unconfirmed','No se puede devolver un pago sin liquidación confirmada.');
   const sum=(await tx.query("SELECT COALESCE(SUM(amount),0)::text AS total FROM ads_refunds WHERE order_id=$1 AND state<>'REJECTED'",[orderId])).rows[0].total;
   if(BigInt(sum)+BigInt(amount)>BigInt(order.amount))fail(409,'refund_exceeds_payment','El importe supera el saldo pendiente de devolución.');
   const r={id:uuid(),order_id:orderId,requested_by:ownerId,amount:String(amount),reason,state:'REQUESTED'};
   await tx.query("INSERT INTO ads_refunds(id,order_id,idempotency_key,requested_by,amount,reason,state) VALUES($1,$2,$3,$4,$5,$6,'REQUESTED')",[r.id,orderId,idempotencyKey,ownerId,r.amount,reason]);
   await event(tx,r,'refund_requested');return r;
  });
 }
 async function requestSettlementRemedy({orderId,ownerId,reason,idempotencyKey,operatorId}){
  if(typeof reason!=='string'||!reason.trim()||reason.length>1000)fail(400,'refund_reason_required','Indica el motivo de la reclamación.');
  if(typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)fail(400,'idempotency_required','Incluye una clave idempotente estable.');
  if(operatorId)admin(operatorId);
  return db.transaction(async tx=>{
   const order=await orderFor(tx,orderId);if(!ownerId||ownerId!==order.owner_id)fail(404,'order_not_found','Orden no disponible.');
   const prior=(await tx.query('SELECT * FROM ads_refunds WHERE order_id=$1 AND idempotency_key=$2',[orderId,idempotencyKey])).rows[0];
   if(prior){if(prior.reason!==reason)fail(409,'idempotency_conflict','La clave corresponde a otra reclamación.');return prior;}
   if(!(await tx.query("SELECT id FROM ads_payment_attempts WHERE order_id=$1 AND state='SETTLED'",[orderId])).rows[0])fail(409,'refund_payment_unconfirmed','No hay liquidación confirmada.');
   if(order.quote?.terms?.refundPolicy==='FULFILL_REMAINING')fail(409,'delivery_still_owed','Las entregas incompletas siguen pendientes; solicita reprogramación o abre una reclamación.');
   const deadline=order.quote?.terms?.refundDeadlineMs;if(!Number.isSafeInteger(deadline)||deadline<1)fail(409,'refund_policy_missing','Falta el plazo de devolución contratado.');
   if(now()>Date.parse(order.quote.endsAt)+deadline)fail(409,'refund_window_expired','El plazo de devolución requiere revisión de la autoridad de disputa.');
   const placements=(await tx.query('SELECT * FROM ads_placements WHERE order_id=$1 FOR UPDATE',[orderId])).rows;
   const revision=(await tx.query('SELECT * FROM ads_revisions WHERE id=$1',[order.revision_id])).rows[0];
   const dispute=operatorId&&(await tx.query("SELECT id FROM ads_disputes WHERE order_id=$1 AND state='OPEN' LIMIT 1",[orderId])).rows.length>0;
   const remedy=calculateSettlementRemedy(order,placements,revision,{operatorVerified:!!dispute});
   const total=(await tx.query("SELECT COALESCE(SUM(amount),0)::text AS total FROM ads_refunds WHERE order_id=$1 AND state<>'REJECTED'",[orderId])).rows[0].total;
   if(BigInt(remedy.amount)+BigInt(total)>BigInt(order.amount))fail(409,'refund_exceeds_payment','Otra devolución ya reserva ese saldo.');
   const r={id:uuid(),order_id:orderId,requested_by:ownerId,amount:remedy.amount,reason,state:'REQUESTED',remedy};
   await tx.query("INSERT INTO ads_refunds(id,order_id,idempotency_key,requested_by,amount,reason,state,remedy) VALUES($1,$2,$3,$4,$5,$6,'REQUESTED',$7::jsonb)",[r.id,orderId,idempotencyKey,ownerId,r.amount,reason,JSON.stringify(remedy)]);
   await event(tx,r,'refund_requested');return r;
  });
 }
 async function approve({refundId,operatorId}){
  admin(operatorId);return db.transaction(async tx=>{
   const r=await row(tx,refundId,true);if(r.state==='APPROVED')return r;if(r.state!=='REQUESTED')fail(409,'refund_not_approvable','La devolución no está pendiente de aprobación.');
   const order=await lockOrderInventory(tx,r.order_id);
   if(r.remedy){const placements=(await tx.query('SELECT * FROM ads_placements WHERE order_id=$1 FOR UPDATE',[order.id])).rows,revision=(await tx.query('SELECT * FROM ads_revisions WHERE id=$1',[order.revision_id])).rows[0];const current=calculateSettlementRemedy(order,placements,revision,{operatorVerified:r.remedy.operatorVerified});if(BigInt(r.amount)>BigInt(current.amount))fail(409,'refund_progress_changed','La entrega cambió; rechaza y recalcula la reclamación antes de aprobarla.');}
   await tx.query("UPDATE ads_orders SET suspended=true,state='QUARANTINED',reason='Refund approved; delivery paused',updated_at=now() WHERE id=$1",[order.id]);
   await tx.query("UPDATE ads_placements SET state='PAUSED' WHERE order_id=$1 AND delivered_units<required_units",[order.id]);
   await tx.query("UPDATE ads_reservations SET state='RELEASED' WHERE order_id=$1 AND state IN ('HELD','COMMITTED')",[order.id]);
   await tx.query('UPDATE ads_playlist SET active=NULL,valid_until=now(),updated_at=now() WHERE order_id=$1',[order.id]);
   await tx.query('DELETE FROM ads_publisher_acks WHERE order_id=$1',[order.id]);
   await tx.query("UPDATE ads_refunds SET state='APPROVED',approved_by=$2,updated_at=now() WHERE id=$1",[refundId,operatorId]);const approved={...r,state:'APPROVED',approved_by:operatorId};await event(tx,approved,'refund_approved');return approved;
  });
 }
 async function reconcile(refundId){
  const r=await row(db,refundId);if(r.state==='CONFIRMED')return publicRefund(r);
  if(!r.transaction_hash)return publicRefund(r);
  const order=(await db.query('SELECT * FROM ads_orders WHERE id=$1',[r.order_id])).rows[0];
  let proof;try{proof=await runtime.confirm({refund:r,order});}catch{proof={state:'UNKNOWN',reason:'refund_confirmation_unavailable'};}
  return db.transaction(async tx=>{const current=await row(tx,r.id,true);if(current.state==='CONFIRMED')return publicRefund(current);
   const confirmed=proof?.state==='CONFIRMED'&&proof.txHash===current.transaction_hash;
   const state=confirmed?'CONFIRMED':'RECONCILIATION_REQUIRED';
   await tx.query('UPDATE ads_refunds SET state=$2,evidence=$3::jsonb,updated_at=now() WHERE id=$1',[r.id,state,JSON.stringify(proof??{})]);
   if(confirmed&&current.remedy){
    await lockOrderInventory(tx,current.order_id);
    const ids=current.remedy.lines.map(l=>l.placementId);
    await tx.query("UPDATE ads_placements SET state='CLOSED_WITH_REMEDY' WHERE order_id=$1 AND placement_id=ANY($2::text[]) AND state<>'FULFILLED'",[current.order_id,ids]);
    await tx.query("UPDATE ads_orders o SET state=CASE WHEN EXISTS(SELECT 1 FROM ads_placements p WHERE p.order_id=o.id AND p.delivered_units>0) THEN 'COMPLETED' ELSE 'CANCELLED' END,queue_state=NULL,suspended=true,reason='Obligations closed with confirmed refund; delivery evidence preserved',updated_at=now() WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM ads_placements p WHERE p.order_id=o.id AND p.state NOT IN ('FULFILLED','CLOSED_WITH_REMEDY')) AND NOT EXISTS(SELECT 1 FROM ads_disputes d WHERE d.order_id=o.id AND d.state='OPEN')",[current.order_id]);
   }
   const result={...current,state,evidence:proof};await event(tx,result,confirmed?'refund_confirmed':'refund_reconciliation_required');return publicRefund(result);});
 }
 async function submit({refundId,operatorId}){
  admin(operatorId);
  const prepared=await db.transaction(async tx=>{
   const r=await row(tx,refundId,true);if(['SUBMITTED','CONFIRMED','RECONCILIATION_REQUIRED'].includes(r.state))return {refund:r,recovered:true};
   if(r.state!=='APPROVED')fail(409,'refund_not_approved','La devolución debe estar aprobada.');
   const order=await orderFor(tx,r.order_id);
   const transfer=await runtime.prepare({refund:r,order});
   if(!transfer?.txHash||!transfer?.signedXdr)fail(503,'refund_signer_unavailable','No hay una transferencia firmada válida.');
   await tx.query("UPDATE ads_refunds SET state='SUBMITTED',transaction_hash=$2,signed_xdr=$3,updated_at=now() WHERE id=$1",[r.id,transfer.txHash,transfer.signedXdr]);
   const submitted={...r,state:'SUBMITTED',transaction_hash:transfer.txHash,signed_xdr:transfer.signedXdr};await event(tx,submitted,'refund_submitted');return {refund:submitted,order};
  });
  if(prepared.recovered)return reconcile(refundId);
  try{await runtime.submit(prepared);}catch{/* Hash and signed envelope remain durable. Never sign another transfer. */}
  return reconcile(refundId);
 }
 async function reject({refundId,operatorId,reason}){admin(operatorId);if(typeof reason!=='string'||!reason.trim())fail(400,'refund_reason_required','Indica el motivo.');return db.transaction(async tx=>{const r=await row(tx,refundId,true);if(r.state!=='REQUESTED')fail(409,'refund_not_rejectable','Solo se puede rechazar una solicitud sin aprobar.');await tx.query("UPDATE ads_refunds SET state='REJECTED',evidence=$2::jsonb,updated_at=now() WHERE id=$1",[refundId,JSON.stringify({reason,operatorId})]);await event(tx,{...r,approved_by:operatorId},'refund_rejected');return {...r,state:'REJECTED'};});}
 return {request,requestSettlementRemedy,approve,reject,submit,reconcile};
}

export function createStellarRefundRuntime({config,signer,rpc,loadSdk=()=>import('@stellar/stellar-sdk')}){
 if(!signer&&config.refundSecretFile)signer=createOperatorRefundSigner({secretFile:config.refundSecretFile,config,rpc,loadSdk});
 const sdk=loadSdk;
 const checked=()=>{if(config.network!=='stellar:testnet'||config.asset!==TESTNET_USDC||config.issuer!==TESTNET_ISSUER)fail(503,'refund_testnet_only','Devoluciones disponibles exclusivamente en Testnet.');};
 const server=async()=>{checked();if(!rpc){const {Server}=await import('@stellar/stellar-sdk/rpc');rpc=new Server(config.rpcUrl??'https://soroban-testnet.stellar.org');}return rpc;};
 const validate=async({refund,order},xdr)=>{
  const s=await sdk(),tx=s.TransactionBuilder.fromXDR(xdr,s.Networks.TESTNET);
  if(tx.innerTransaction||tx.source!==config.payTo||tx.operations.length!==1||order.pay_to!==config.payTo||!order.payer||BigInt(refund.amount)>BigInt(order.amount))fail(422,'refund_transfer_invalid','Transferencia fuera de la devolución autorizada.');
  const op=tx.operations[0];if(op.type!=='invokeHostFunction'||op.func.switch().name!=='hostFunctionTypeInvokeContract')fail(422,'refund_transfer_invalid','Operación no permitida.');
  const f=op.func.invokeContract(),args=f.args().map(s.scValToNative);
  if(s.Address.fromScAddress(f.contractAddress()).toString()!==config.asset||f.functionName().toString()!=='transfer'||args.length!==3||args[0]!==config.payTo||args[1]!==order.payer||String(args[2])!==String(refund.amount))fail(422,'refund_transfer_invalid','Beneficiario o importe fuera de la devolución.');
  if((op.auth??[]).some(a=>a.credentials().switch().name!=='sorobanCredentialsSourceAccount'))fail(422,'refund_transfer_invalid','No se admiten permisos de gasto adicionales.');
  return tx;
 };
 return {
  async prepare(input){
   checked();if(signer?.prepare){const result=await signer.prepare(input);const tx=await validate(input,result.signedXdr);if(tx.hash().toString('hex')!==result.txHash)fail(422,'refund_hash_mismatch','Hash de devolución incorrecto.');return result;}if(!signer||signer.address!==config.payTo||!config.payTo?.startsWith('G')||typeof signer.signTransaction!=='function')fail(503,'refund_signer_unavailable','Falta el firmante restringido del operador.');
   const s=await sdk(),r=await server();positive(input.refund.amount);
   const tx=new s.TransactionBuilder(await r.getAccount(config.payTo),{networkPassphrase:s.Networks.TESTNET,fee:s.BASE_FEE}).addMemo(s.Memo.hash(Buffer.from(sha256(input.refund.id),'hex'))).addOperation(new s.Contract(config.asset).call('transfer',s.nativeToScVal(config.payTo,{type:'address'}),s.nativeToScVal(input.order.payer,{type:'address'}),s.nativeToScVal(BigInt(input.refund.amount),{type:'i128'}))).setTimeout(60).build();
   await validate(input,tx.toXDR());const ready=await r.prepareTransaction(tx);await validate(input,ready.toXDR());const signed=await signer.signTransaction(ready.toXDR(),{networkPassphrase:s.Networks.TESTNET});
   if(signed.error||!signed.signedTxXdr)fail(503,'refund_signature_failed','El operador no firmó la devolución.');
   const final=await validate(input,signed.signedTxXdr);return {signedXdr:final.toXDR(),txHash:final.hash().toString('hex')};
  },
  async submit(input){const tx=await validate(input,input.refund.signed_xdr);if(tx.hash().toString('hex')!==input.refund.transaction_hash)fail(422,'refund_hash_mismatch','Hash de devolución incorrecto.');return (await server()).sendTransaction(tx);},
  async confirm(input){
   const r=await server(),s=await sdk(),result=await r.getTransaction(input.refund.transaction_hash);
   if(result.status!=='SUCCESS'||!result.envelopeXdr)return {state:'UNKNOWN',reason:'refund_transaction_unconfirmed'};
   const envelope=typeof result.envelopeXdr==='string'?result.envelopeXdr:result.envelopeXdr.toXDR('base64'),tx=await validate(input,envelope);
   if(tx.hash().toString('hex')!==input.refund.transaction_hash)return {state:'UNKNOWN',reason:'refund_hash_mismatch'};
   const page=await r.getEvents({startLedger:result.ledger,endLedger:result.ledger+1,filters:[{type:'contract',contractIds:[config.asset]}],limit:1000});
   const event=page.events.find(e=>{if(e.txHash!==input.refund.transaction_hash)return false;try{const t=e.topic.map(v=>s.scValToNative(typeof v==='string'?s.xdr.ScVal.fromXDR(v,'base64'):v)),v=s.scValToNative(typeof e.value==='string'?s.xdr.ScVal.fromXDR(e.value,'base64'):e.value);return t[0]==='transfer'&&t[1]===config.payTo&&t[2]===input.order.payer&&String(v)===String(input.refund.amount);}catch{return false;}});
   return event?{state:'CONFIRMED',txHash:input.refund.transaction_hash,ledger:result.ledger,eventId:event.id,amount:String(input.refund.amount),recipient:input.order.payer}:{state:'UNKNOWN',reason:'refund_transfer_not_proven'};
  }
 };
}

/** Exact integer remedy: design and publication remain separate obligations. */
export function calculateSettlementRemedy(order,placements,revision,{operatorVerified=false}={}){
 const q=order.quote,policy=q?.terms?.refundPolicy,design=q?.terms?.refundDesign;
 if(!['FULL','PRO_RATA'].includes(policy)||!['ALWAYS','IF_UNDELIVERED','NEVER'].includes(design)||!Array.isArray(q.lines))fail(409,'refund_policy_missing','La cotización no contiene políticas completas de devolución.');
 let quoted=0n;const lines=[];
 for(const line of q.lines){
  if(!/^\d+$/.test(String(line.deliveryAmount))||!/^\d+$/.test(String(line.designAmount)))fail(409,'refund_policy_missing','Partidas de cotización inválidas.');
  const delivery=BigInt(line.deliveryAmount),art=BigInt(line.designAmount);quoted+=delivery+art;
  const p=placements.find(p=>p.placement_id===line.placementId);if(!p)fail(409,'refund_policy_missing','Falta una obligación de ubicación.');
  const required=BigInt(p.required_units),delivered=BigInt(p.delivered_units);if(required<=0n||delivered<0n||delivered>required)fail(409,'refund_units_invalid','Contabilidad de entrega inválida.');
  const deficit=required-delivered;if(p.state==='CLOSED_WITH_REMEDY'||(deficit===0n&&!operatorVerified))continue;
  const numerator=delivery*(operatorVerified&&deficit===0n?required:deficit),publication=policy==='FULL'?delivery:numerator/required;
  const designDelivered=order.design_fulfilled||(revision?.state==='AUDITED'&&revision.manifest?.artifacts?.some(a=>(a.placement??a.placementId)===line.placementId));
  const designRefund=design==='ALWAYS'||(design==='IF_UNDELIVERED'&&!designDelivered)?art:0n;
  lines.push({placementId:line.placementId,required:required.toString(),delivered:delivered.toString(),deficit:deficit.toString(),deliveryAmount:publication.toString(),designAmount:designRefund.toString(),amount:(publication+designRefund).toString(),roundingRemainder:policy==='PRO_RATA'?(numerator%required).toString():'0',roundingDenominator:required.toString(),designDelivered:!!designDelivered});
 }
 if(quoted!==BigInt(order.amount))fail(409,'refund_quote_mismatch','Las partidas no coinciden con el importe liquidado.');
 const amount=lines.reduce((sum,l)=>sum+BigInt(l.amount),0n);if(amount<=0n)fail(409,'refund_not_due','No hay déficit reembolsable; conserva el canal de reclamación.');
 return {policy,designPolicy:design,amount:amount.toString(),lines,operatorVerified,rounding:'floor per placement; fractional remainder retained in this remedy record'};
}
/** A dedicated file-backed operator authority exposes only restricted refund preparation. */
export function createOperatorRefundSigner({secretFile,config,rpc,loadSdk=()=>import('@stellar/stellar-sdk')}){
 return {address:config.payTo,async prepare(input){
  if(!secretFile||input.refund.state!=='APPROVED'||!(config.operatorIds??config.operators??[]).includes(input.refund.approved_by))fail(503,'refund_signer_unavailable','Falta una devolución aprobada por la autoridad configurada.');
  const s=await loadSdk();let key;try{key=s.Keypair.fromSecret((await readFile(secretFile,'utf8')).trim());}catch{fail(503,'refund_signer_unavailable','No se pudo cargar el firmante restringido del operador.');}
  if(key.publicKey()!==config.payTo)fail(503,'refund_signer_mismatch','El firmante no corresponde al beneficiario configurado.');
  const signer={address:key.publicKey(),async signTransaction(xdr,{networkPassphrase}){if(networkPassphrase!==s.Networks.TESTNET)fail(503,'refund_testnet_only','Red no permitida.');const tx=s.TransactionBuilder.fromXDR(xdr,s.Networks.TESTNET);tx.sign(key);return {signedTxXdr:tx.toXDR()};}};
  return createStellarRefundRuntime({config,signer,rpc,loadSdk}).prepare(input);
 }};
}
