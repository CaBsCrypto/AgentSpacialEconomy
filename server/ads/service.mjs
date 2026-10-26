import {ensureFulfillment,isPilotFulfillment,recoverFulfillment,reprogramFulfillment,fulfillmentStatus,placementPlayback} from './fulfillment.mjs';
import {isPilotConfig,applyPilotConfig,resolveQuoteOffer} from './offers.mjs';
import {AdsError,assert,identifier,integer,sha256,uuid,event,enqueue,idempotent,durableAction} from './common.mjs';
import {PLACEMENTS,PLANS,requireCheckout} from './config.mjs';
import {buildDemand,quotePrice,reserveSchedule,lockInventory,lockOrderInventory,planRotations} from './scheduler.mjs';
const date=v=>new Date(v).toISOString();
export function createAdsService({db,config,creative,storage,payments,refunds,registry,now=Date.now}){
 const owned=async(tx,id,ownerId,table='ads_campaigns')=>{
  identifier(id);assert(['ads_campaigns','ads_orders'].includes(table),500,'invalid_table','Invalid resource.');
  const {rows:[row]}=await tx.query('SELECT * FROM '+table+' WHERE id=$1 AND owner_id=$2',[id,ownerId]);
  assert(row,404,'not_found','The requested resource is unavailable.');return row;
 };
 const currentRevision=async(tx,campaign)=>{
  assert(campaign.current_revision,409,'logo_required','Add a logo and an immutable creative revision first.');
  return(await tx.query('SELECT r.*,u.storage_key,u.hash AS logo_hash,u.mime,u.width,u.height FROM ads_revisions r JOIN ads_uploads u ON u.id=r.logo_id WHERE r.id=$1',[campaign.current_revision])).rows[0];
 };
 const logoOf=r=>({id:r.logo_id,key:r.storage_key,hash:r.logo_hash,mime:r.mime,width:r.width,height:r.height});
 const operator=identity=>assert(config.operators.includes(identity.address||identity.ownerId),403,'operator_required','Operator authorization is required.');
 async function getOrder(id,ownerId){
  const order=await owned(db,id,ownerId,'ads_orders');
  const [placements,payment,disputes,refundRows,registryRows]=await Promise.all([
   db.query('SELECT * FROM ads_placements WHERE order_id=$1 ORDER BY placement_id',[id]),
   db.query('SELECT id,state,settlement_tx,payer,error_code FROM ads_payment_attempts WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1',[id]),
   db.query('SELECT id,state,reason,created_at FROM ads_disputes WHERE order_id=$1',[id]),
   db.query('SELECT id,state,amount,transaction_hash,reason FROM ads_refunds WHERE order_id=$1',[id]),
   db.query('SELECT operation,state,transaction_hash,batch_id FROM ads_registry_jobs WHERE order_id=$1',[id])
  ]);
  const p=payment.rows[0],fulfillment=await fulfillmentStatus(db,order,{config,now:now()});
  return {...(fulfillment?{fulfillment,playback:fulfillment.playback}:{}),id:order.id,status:order.state,suspended:order.suspended,design:{status:order.design_fulfilled?'AUDITED':'PENDING'},revisionId:order.revision_id,quote:order.quote,amountUnits:order.amount,reason:order.reason,
   payment:{status:p?.state||'REQUIRED',attemptId:p?.id,transaction:p?.settlement_tx,payer:p?.payer},
   queue:{state:order.queue_state,reason:order.reason||p?.error_code||null},
   placements:placements.rows.map(p=>({placementId:p.placement_id,delivered:Number(p.delivered_units),required:Number(p.required_units),deficit:Number(p.required_units)-Number(p.delivered_units),unit:p.unit,status:p.state})),
   receipt:p?.state==='SETTLED'?{transaction:p.settlement_tx,network:config.network,amountUnits:order.amount,payTo:order.pay_to,meaning:'Payment confirmed; delivery is accounted separately.'}:null,
   disputes:disputes.rows,refunds:refundRows.rows,registry:{status:config.registryContract?'PENDING_OR_RECORDED':'NOT_DEPLOYED',entries:registryRows.rows}};
 }
 return {
  privateStorage:storage,
  async maintainFulfillment(){return db.transaction(async tx=>{const orders=(await tx.query("SELECT * FROM ads_orders WHERE state IN ('QUEUED','LIVE') ORDER BY id")).rows.filter(isPilotFulfillment);await lockInventory(tx,['main_stage_screen']);for(const order of orders)await ensureFulfillment(tx,order,now());return recoverFulfillment(tx,{config,now:now()});});},
  async availability(ownerId,campaignId,{startsAfter}={}){
   const campaign=await owned(db,identifier(campaignId),ownerId),clock=now(),horizon=clock+config.maxWindowMs;
   let start=Math.ceil(Math.max(clock+config.processingMs+120000,startsAfter===undefined?0:Date.parse(startsAfter))/60000)*60000;
   assert(Number.isFinite(start),400,'invalid_window','Choose a valid start for the suggested window.');
   const duration=3600000;
   assert(duration>=5*(60000+(config.renderLeadMs||0)),409,'capacity_unavailable','The configured horizon cannot fit five complete passes.');
   const occupied=(await db.query("SELECT starts_at,ends_at FROM ads_reservations WHERE placement_id='main_stage_screen' AND state IN ('HELD','COMMITTED') AND ends_at>$1 AND (state='COMMITTED' OR expires_at>$1) ORDER BY starts_at",[new Date(clock)])).rows;
   const blocks=[...occupied.map(s=>({start:+new Date(s.starts_at),end:+new Date(s.ends_at)})),...(config.hostWindows||[]).filter(w=>w.placementId==='main_stage_screen').map(w=>({start:Date.parse(w.startsAt),end:Date.parse(w.endsAt)}))];
   for(let attempts=0;attempts<1440&&start+duration<=horizon;attempts++,start+=60000){
    try{const slots=planRotations([{id:'availability',campaignId:campaign.id,plan:'PASSES',units:5,startsAt:start,endsAt:start+duration,committedAt:clock,passMs:60000,renderLeadMs:config.renderLeadMs||0}],blocks,{...config,passMs:60000,maxUnits:5});return{serverTime:date(clock),window:{startsAt:date(start),endsAt:date(start+duration)},estimatedPasses:slots.map((s,i)=>({number:i+1,estimatedStartsAt:date(s.start+(config.renderLeadMs||0)),estimatedEndsAt:date(s.start+(config.renderLeadMs||0)+60000)})),estimated:true};}catch(error){if(error.code!=='capacity_unavailable')throw error;}
   }
   assert(false,409,'capacity_unavailable','No suitable window remains in the configured horizon.');
  },
  async upload(ownerId,bytes,mime,key){
   const sanitized=await creative.sanitizeUpload(bytes,mime);
   return db.transaction(tx=>idempotent(tx,{ownerId,key,action:'upload',payload:{hash:sha256(bytes),mime}},async()=>{
    const id=sanitized.id||uuid();await tx.query('INSERT INTO ads_uploads(id,owner_id,storage_key,hash,mime,width,height,size) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,ownerId,sanitized.key,sanitized.hash,sanitized.mime,sanitized.width,sanitized.height,sanitized.size||bytes.length]);return {...sanitized,id,key:undefined};
   }));
  },
  async campaign(ownerId,payload,key){
   return db.transaction(tx=>idempotent(tx,{ownerId,key,action:'campaign',payload},async()=>{
    const brief=payload.brief||{};assert(brief&&typeof brief==='object'&&!Array.isArray(brief),400,'invalid_brief','Provide a project brief.');
    const id=uuid();await tx.query('INSERT INTO ads_campaigns(id,owner_id,brief) VALUES($1,$2,$3)',[id,ownerId,brief]);
    let revisionId=null;
    if(payload.logoId){
     identifier(payload.logoId);const {rows:[logo]}=await tx.query('SELECT * FROM ads_uploads WHERE id=$1 AND owner_id=$2',[payload.logoId,ownerId]);assert(logo,404,'logo_not_found','Select an uploaded logo.');
     revisionId=uuid();await tx.query('INSERT INTO ads_revisions(id,campaign_id,brief,logo_id,content_hash) VALUES($1,$2,$3,$4,$5)',[revisionId,id,brief,logo.id,sha256({brief,logo:logo.hash})]);
     await tx.query('UPDATE ads_campaigns SET current_revision=$2 WHERE id=$1',[id,revisionId]);
    }
    await event(tx,id,ownerId,'CAMPAIGN_CREATED',{revisionId});return {id,revisionId,status:'DRAFT'};
   }));
  },
  async revision(ownerId,campaignId,payload,key){
   return db.transaction(tx=>idempotent(tx,{ownerId,key,action:'revision',payload:{...payload,campaignId}},async()=>{
    await owned(tx,campaignId,ownerId);identifier(payload.logoId);const {rows:[logo]}=await tx.query('SELECT * FROM ads_uploads WHERE id=$1 AND owner_id=$2',[payload.logoId,ownerId]);assert(logo,404,'logo_not_found','Select an uploaded logo.');
    const revisionId=uuid();await tx.query('INSERT INTO ads_revisions(id,campaign_id,brief,logo_id,content_hash) VALUES($1,$2,$3,$4,$5)',[revisionId,campaignId,payload.brief,logo.id,sha256({brief:payload.brief,logo:logo.hash})]);
    await tx.query("UPDATE ads_campaigns SET brief=$2,current_revision=$3,state='DRAFT',updated_at=now() WHERE id=$1",[campaignId,payload.brief,revisionId]);
    await event(tx,campaignId,ownerId,'REVISION_CREATED',{revisionId});return {id:campaignId,revisionId,status:'DRAFT',additionalCharge:false};
   }));
  },
  async preaudit(ownerId,id,key){
   const campaign=await owned(db,id,ownerId),revision=await currentRevision(db,campaign);
   return durableAction(db,{ownerId,key,action:'preaudit',payload:{campaignId:id,revisionId:revision.id}},async()=>{
   assert(!revision.manifest&&!(await db.query('SELECT 1 FROM ads_orders WHERE revision_id=$1',[revision.id])).rowCount,409,'immutable_revision','Create a new revision before preauditing a creative already attached to an order.');
   const quotaKey='preaudit:'+ownerId;
   await db.transaction(async tx=>{
    await tx.query("INSERT INTO ads_rate_limits(key,count,expires_at) VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN ads_rate_limits.expires_at<now() THEN 1 ELSE ads_rate_limits.count+1 END,expires_at=CASE WHEN ads_rate_limits.expires_at<now() THEN EXCLUDED.expires_at ELSE ads_rate_limits.expires_at END",[quotaKey,new Date(now()+3600000)]);
    const limit=(await tx.query('SELECT count FROM ads_rate_limits WHERE key=$1 FOR UPDATE',[quotaKey])).rows[0];assert(limit.count<=(config.model.preauditPerHour||1),429,'preaudit_quota','The automatic preaudit quota is exhausted.');
   });
   const verdict=await creative.preaudit({brief:revision.brief,logo:logoOf(revision)});
   await db.transaction(async tx=>{
    await tx.query('UPDATE ads_revisions SET state=$2,verdict=$3 WHERE id=$1',[revision.id,verdict.state,{...verdict,contentHash:revision.content_hash}]);
    await tx.query('UPDATE ads_campaigns SET state=$2 WHERE id=$1 AND current_revision=$3',[id,verdict.state,revision.id]);await event(tx,id,ownerId,'PREAUDIT',{revisionId:revision.id,...verdict});
   });return {revisionId:revision.id,...verdict};
   });
  },
  async preview(ownerId,id,idempotencyKey){
   const campaign=await owned(db,id,ownerId),revision=await currentRevision(db,campaign);
   return durableAction(db,{ownerId,key:idempotencyKey,action:'preview',payload:{campaignId:id,revisionId:revision.id}},async()=>{
   const key='preview:'+ownerId;
   await db.transaction(async tx=>{
    await tx.query("INSERT INTO ads_rate_limits(key,count,expires_at) VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN ads_rate_limits.expires_at<now() THEN 1 ELSE ads_rate_limits.count+1 END,expires_at=CASE WHEN ads_rate_limits.expires_at<now() THEN EXCLUDED.expires_at ELSE ads_rate_limits.expires_at END",[key,new Date(now()+3600000)]);
    const {rows:[limit]}=await tx.query('SELECT count FROM ads_rate_limits WHERE key=$1 FOR UPDATE',[key]);assert(limit.count<=(config.model.previewPerHour||1),429,'preview_quota','The free preview quota is exhausted.');
   });
   const preview=await creative.generate({brief:revision.brief,logo:logoOf(revision),revisionId:revision.id,placements:isPilotConfig(config)?['main_stage_screen']:PLACEMENTS});
   await db.query('INSERT INTO ads_previews(id,revision_id,artifacts,expires_at) VALUES($1,$2,$3,$4)',[uuid(),revision.id,preview.artifacts||[],new Date(now()+3600000)]);
   return {revisionId:revision.id,verdict:preview.verdict,artifacts:preview.artifacts?.map(a=>({...a,imageUrl:'/api/ads/previews/'+revision.id+'/'+a.key}))||[],meaning:'Preview only; no payment or delivery.'};
   });
  },
  async quote(ownerId,payload,key){
   requireCheckout(config);
   const request=payload;payload=resolveQuoteOffer(payload,config);
   const saleConfig=isPilotConfig(config)?applyPilotConfig(config):config;
   return db.transaction(tx=>idempotent(tx,{ownerId,key,action:'quote',payload:request},async()=>{
    const campaign=await owned(tx,payload.campaignId,ownerId),revision=await currentRevision(tx,campaign);
    assert(revision.state==='PREAUDITED'&&revision.verdict?.allowed&&revision.verdict?.contentHash===revision.content_hash,409,'preaudit_required','A passing preaudit is required.');
    await lockInventory(tx,payload.placements);
    const startsAt=Date.parse(payload.startsAt),endsAt=Date.parse(payload.endsAt);
    assert(startsAt>=now()+config.processingMs,400,'processing_window','Allow the configured generation and audit lead time.');
    const demand=buildDemand({...payload,startsAt,endsAt},saleConfig),price=quotePrice(payload.placements,payload.plan,payload.units,saleConfig);
    // Each order gets its own immutable generation revision; editing/preauditing the intake draft cannot alter a paid order.
    const quotedRevisionId=uuid();
    await tx.query("INSERT INTO ads_revisions(id,campaign_id,brief,logo_id,content_hash,state,verdict) VALUES($1,$2,$3,$4,$5,'PREAUDITED',$6)",[quotedRevisionId,campaign.id,revision.brief,revision.logo_id,revision.content_hash,revision.verdict]);
    const id=uuid(),orderId=uuid(),expiresAt=date(now()+config.reservationMs);
    const terms={version:config.termsVersion,policyVersion:config.policyVersion,refundPolicy:saleConfig.refundPolicy,refundDesign:saleConfig.refundDesign,refundDeadlineMs:config.refundDeadlineMs,disputeAuthority:config.disputeAuthority,interruptions:config.interruptions,hostPriority:true,processingMs:config.processingMs,includedRevisions:config.includedRevisions,designDefinition:'Design is fulfilled when the immutable creative and manifest pass final audit; publication units are separate.',measurement:'Canonical publisher activity; never audience or physical views.',fulfillment:isPilotConfig(config)?'Five complete sixty-second plays. An interrupted play earns no unit and remains owed; a missing play is never closed by an automatic refund.':'Delivery follows the immutable plan, units and remedy of this quote.',correctionsPolicy:'Included corrections require a new passing preaudit, no outstanding hold/refund/dispute and no prepared registry commitment.',reprogramPolicy:saleConfig.refundPolicy==='FULFILL_REMAINING'?'Uncompleted plays remain owed. Reprogramming requires consent and compatible registry evidence; a missed deadline does not fulfill a play.':'Undelivered obligations may be reprogrammed by consent before registry commitment; partial deficits retain the configured refund remedy.'};
    const snapshot={...(payload.offerId?{offerId:payload.offerId,offerVersion:2}:{}),timeUnitMs:saleConfig.timeUnitMs,rotationMs:config.rotationMs,passMs:saleConfig.passMs,exclusiveUnitMs:config.exclusiveUnitMs,renderLeadMs:config.renderLeadMs,schedulerVersion:'rotations-v1',id,orderId,campaignId:campaign.id,sourceRevisionId:revision.id,revisionId:quotedRevisionId,placements:payload.placements,plan:payload.plan,units:payload.units,startsAt:date(startsAt),endsAt:date(endsAt),expiresAt,...price,requiredUnits:demand.requiredUnits,unit:demand.unit,network:config.network,asset:config.asset,issuer:config.issuer,payTo:config.payTo,terms};
    const termsHash=sha256(snapshot);
    await tx.query('INSERT INTO ads_quotes(id,owner_id,campaign_id,revision_id,snapshot,terms_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,ownerId,campaign.id,quotedRevisionId,snapshot,termsHash,new Date(expiresAt)]);
    await tx.query('INSERT INTO ads_orders(id,owner_id,quote_id,revision_id,amount,pay_to,terms_hash,quote) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[orderId,ownerId,id,quotedRevisionId,price.amountUnits,config.payTo,termsHash,snapshot]);
    for(const placementId of payload.placements)await tx.query('INSERT INTO ads_placements(order_id,placement_id,required_units,unit) VALUES($1,$2,$3,$4)',[orderId,placementId,demand.requiredUnits,demand.unit]);
    await ensureFulfillment(tx,{id:orderId,owner_id:ownerId,quote:snapshot,terms_hash:termsHash},now());
    await reserveSchedule(tx,{id:orderId,state:'RESERVED',campaign_id:campaign.id,quote:snapshot},saleConfig,now());
    await event(tx,orderId,ownerId,'RESERVED',{quoteId:id,termsHash});return {...snapshot,termsHash};
   }));
  },
  async order(ownerId,quoteId){identifier(quoteId);const {rows:[order]}=await db.query('SELECT id FROM ads_orders WHERE quote_id=$1 AND owner_id=$2',[quoteId,ownerId]);assert(order,404,'quote_not_found','Quote unavailable.');return getOrder(order.id,ownerId);},
  getOrder,
  async evidence(ownerId,id,cursor){
   await owned(db,id,ownerId,'ads_orders');let afterDate=new Date(0),afterId='00000000-0000-0000-0000-000000000000';
   if(cursor){try{assert(cursor.length<=256,400,'invalid_cursor','Invalid evidence cursor.');const v=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));afterDate=new Date(v.at);afterId=identifier(v.id);assert(Number.isFinite(+afterDate),400,'invalid_cursor','Invalid evidence cursor.');}catch{throw new AdsError(400,'invalid_cursor','Invalid evidence cursor.');}}
   const rows=(await db.query('SELECT id,placement_id,revision_id,manifest_hash,starts_at,ends_at,units,pass_id,signature,publisher_key,evidence,batch_id,unit_number FROM ads_delivery WHERE order_id=$1 AND (ends_at,id)>($2,$3::uuid) ORDER BY ends_at,id LIMIT 101',[id,afterDate,afterId])).rows;
   const page=rows.slice(0,100),last=page.at(-1);
   return {orderId:id,evidence:page,nextCursor:rows.length>100?Buffer.from(JSON.stringify({at:last.ends_at,id:last.id})).toString('base64url'):null,meaning:'Signed operator canonical activity; not independent audience evidence.'};
  },
  async pay(ownerId,id,key,payload){requireCheckout(config);return payments.pay({orderId:identifier(id),ownerId,idempotencyKey:key,payload});},
  async dispute(ownerId,id,payload,key){
   return db.transaction(tx=>idempotent(tx,{ownerId,key,action:'dispute',payload:{...payload,id}},async()=>{
    const order=await lockOrderInventory(tx,id,ownerId);assert(typeof payload.reason==='string'&&payload.reason.trim().length>=3&&payload.reason.length<=2000,400,'reason_required','Explain the disputed delivery.');
    const disputeId=uuid();await tx.query('INSERT INTO ads_disputes(id,order_id,owner_id,reason) VALUES($1,$2,$3,$4)',[disputeId,id,ownerId,payload.reason.trim()]);
    await tx.query("UPDATE ads_placements SET state='DISPUTED' WHERE order_id=$1",[id]);await event(tx,id,ownerId,'DISPUTED',{disputeId});
    await enqueue(tx,'registry',id,'dispute:'+disputeId,{operation:'dispute',disputeId});return {id:disputeId,orderId:id,status:'OPEN',meaning:'Evidence preserved; direct payments are not frozen.'};
   }));
  },
  async reprogram(ownerId,id,payload,key){
   return db.transaction(tx=>idempotent(tx,{ownerId,key,action:'reprogram',payload:{...payload,id}},async()=>{
    const order=await lockOrderInventory(tx,id,ownerId);
    if(isPilotFulfillment(order)){assert(config.operationalReady??config.enabled,503,'operations_unconfigured','Paid obligations require configured operational services.');assert(!order.suspended&&!['COMPLETED','CANCELLED','BLOCKED','QUARANTINED'].includes(order.state),409,'order_closed','This order requires review before reprogramming.');return reprogramFulfillment(tx,order,payload,config,now());}
    requireCheckout(config);
    assert(!['COMPLETED','CANCELLED','BLOCKED','QUARANTINED'].includes(order.state),409,'order_closed','This order is closed.');
    assert(!(await tx.query("SELECT 1 FROM ads_refunds WHERE order_id=$1 AND state<>'REJECTED'",[id])).rowCount,409,'refund_in_progress','Resolve the refund before reprogramming.');
    const {rows:[dispute]}=await tx.query("SELECT id FROM ads_disputes WHERE order_id=$1 AND state='OPEN' LIMIT 1",[id]);assert(!dispute,409,'dispute_open','Resolve the disputed obligation before reprogramming.');
    assert(!(await tx.query("SELECT 1 FROM ads_registry_jobs WHERE order_id=$1 AND operation='commit' AND state<>'CANCELLED'",[id])).rowCount,409,'registry_amendment_required','A prepared registry commitment requires operator reconciliation; refund remains available.');
    const start=Date.parse(payload.startsAt),end=Date.parse(payload.endsAt);assert(start>=now()+config.processingMs&&end>start&&end-start<=config.maxWindowMs,400,'invalid_window','Invalid replacement window.');
    const progress=(await tx.query('SELECT * FROM ads_placements WHERE order_id=$1 FOR UPDATE',[id])).rows;
    assert(progress.every(p=>Number(p.delivered_units)===0),409,'partial_reprogram_operator','Partially delivered obligations require an operator proposal to preserve independent deficits.');
    const quote={...order.quote,startsAt:date(start),endsAt:date(end)};
    if(quote.plan==='EXCLUSIVE')assert(end-start===Date.parse(order.quote.endsAt)-Date.parse(order.quote.startsAt),400,'exclusive_duration','The replacement must preserve the purchased exclusive duration.');
    await lockInventory(tx,quote.placements);await tx.query("UPDATE ads_reservations SET state='RELEASED' WHERE order_id=$1 AND state IN ('HELD','COMMITTED')",[id]);
    await tx.query('INSERT INTO ads_consents(id,order_id,owner_id,proposal) VALUES($1,$2,$3,$4)',[uuid(),id,ownerId,{previous:order.quote,accepted:quote,previousHash:order.terms_hash,acceptedHash:sha256(quote)}]);
    await tx.query('UPDATE ads_orders SET quote=$2,terms_hash=$3,updated_at=now() WHERE id=$1',[id,quote,sha256(quote)]);await reserveSchedule(tx,{...order,quote},config,now());await event(tx,id,ownerId,'REPROGRAM_CONSENT',{startsAt:quote.startsAt,endsAt:quote.endsAt});return {orderId:id,status:'REPROGRAMMED',additionalCharge:false};
   }));
  },
  async suspend(identity,id,reason){
   operator(identity);
   await db.transaction(async tx=>{
    const order=await lockOrderInventory(tx,identifier(id));assert(order,404,'not_found','Order unavailable.');
    assert(typeof reason==='string'&&reason.length>=3&&reason.length<=2000,400,'reason_required','Provide a suspension reason.');
    await lockInventory(tx,order.quote.placements);
    await tx.query("UPDATE ads_orders SET suspended=true,state='QUARANTINED',reason=$2,updated_at=now() WHERE id=$1",[id,reason]);
    await tx.query("UPDATE ads_placements SET state='PAUSED' WHERE order_id=$1",[id]);
    await tx.query("UPDATE ads_playlist SET active=NULL,valid_until=now(),updated_at=now() WHERE order_id=$1",[id]);await tx.query('DELETE FROM ads_publisher_acks WHERE order_id=$1',[id]);await event(tx,id,identity.ownerId,'EMERGENCY_STOP',{reason});
   });return {orderId:id,status:'QUARANTINED'};
  },
  async asset(key,{ownerId,publisher=false}={}){
   assert(typeof key==='string'&&/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(key),404,'asset_unavailable','Asset unavailable.');
   const t=new Date(now());
   const {rows}=await db.query(`SELECT p.active FROM ads_playlist p JOIN ads_orders o ON o.id=p.order_id JOIN ads_revisions r ON r.id=p.revision_id WHERE p.valid_until>$1 AND o.suspended=false AND o.state IN ('QUEUED','LIVE') AND r.state='AUDITED' AND p.active IS NOT NULL AND (p.active->>'imageKey')=$2 AND EXISTS(SELECT 1 FROM ads_payment_attempts a WHERE a.order_id=o.id AND a.state='SETTLED')`,[t,key]);
   let allowed=rows.length>0;
   if(ownerId&&!allowed)allowed=(await db.query('SELECT id FROM ads_uploads WHERE storage_key=$1 AND owner_id=$2',[key,ownerId])).rowCount>0;
   assert(allowed,404,'asset_unavailable','Asset is not authorized for current publication.');
   return {bytes:await storage.get(key),mime:key.endsWith('.png')?'image/png':key.endsWith('.webp')?'image/webp':'image/jpeg'};
  },
  async playlist(placementId,{publisher=false}={}){
   assert(PLACEMENTS.includes(placementId),404,'unknown_placement','Unknown digital placement.');
   const neutral={placementId,serverTime:date(now()),version:0,validUntil:date(now()+config.manifestMs),active:null,playback:{phase:'IDLE',passId:null,durationMs:60000,startedAt:null,confirmedThrough:null,remainingMs:null,validUntil:date(now()+config.manifestMs)}};
   if(!config.databaseUrl&&!db.testDatabase)return neutral;
   const {rows:[row]}=await db.query(`SELECT p.*,o.suspended,o.state AS order_state,o.quote AS order_quote,r.state AS revision_state FROM ads_playlist p LEFT JOIN ads_orders o ON o.id=p.order_id LEFT JOIN ads_revisions r ON r.id=p.revision_id WHERE p.placement_id=$1`,[placementId]);
   if(!row)return neutral;
   const visible=row.active&&['QUEUED','LIVE'].includes(row.order_state)&&!row.suspended&&row.revision_state==='AUDITED'&&+new Date(row.valid_until)>now();
   let healthy=publisher;
   if(!publisher)healthy=(await db.query('SELECT 1 FROM ads_publisher_acks a JOIN ads_leases l ON l.name=$1 AND l.fence=a.fence WHERE a.placement_id=$2 AND a.version=$3 AND a.ack_at>$4 AND l.expires_at>$5',['publisher',placementId,row.version,new Date(now()-config.manifestMs),new Date(now())])).rowCount>0;
   return {...neutral,version:Number(row.version),validUntil:date(row.valid_until),active:visible&&healthy?row.active:null,playback:isPilotFulfillment({quote:row.order_quote})?await placementPlayback(db,placementId,{config,now:now()}):null};
  }
 };
}
export async function confirmPaidOrder(tx,order,receipt,{config,now=Date.now}){
 await lockInventory(tx,order.quote.placements);
 await ensureFulfillment(tx,order,now());
 const {rows:slots}=await tx.query("SELECT * FROM ads_reservations WHERE order_id=$1 AND state='HELD' FOR UPDATE",[order.id]);
 const conflict=slots.some(s=>(config.hostWindows||[]).some(w=>w.placementId===s.placement_id&&Date.parse(w.startsAt)<+new Date(s.ends_at)&&Date.parse(w.endsAt)>+new Date(s.starts_at)));
 const incomplete=order.quote.placements.some(p=>slots.filter(s=>s.placement_id===p).reduce((n,s)=>n+BigInt(s.delivery_units),0n)<BigInt(order.quote.requiredUnits));
 if(incomplete||!slots.length||slots.some(s=>+new Date(s.expires_at)<=now())||conflict){
  await tx.query("UPDATE ads_orders SET state='RECONCILIATION_REQUIRED',reason='Payment confirmed after capacity expired or changed',updated_at=now() WHERE id=$1",[order.id]);await event(tx,order.id,'settlement','CAPACITY_RECONCILIATION',receipt);return;
 }
 await tx.query("UPDATE ads_reservations SET state='COMMITTED' WHERE order_id=$1 AND state='HELD'",[order.id]);
 await tx.query("UPDATE ads_orders SET state='QUEUED',queue_state='PROCESSING',payer=$2,updated_at=now() WHERE id=$1",[order.id,receipt.payer]);
 await enqueue(tx,'creative',order.id,'creative:'+order.id,{revisionId:order.revision_id});

 await event(tx,order.id,'settlement','QUEUED',receipt);
}
