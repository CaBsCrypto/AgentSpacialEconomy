import {assertPurchaseAllowed,purchaseEligibility} from './checkout.mjs';
import {AdsError,assert,sameSecret,identifier,canonical} from './common.mjs';
import {publicAdsConfig,PLACEMENTS} from './config.mjs';
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
export async function readBytes(request,max){
 const reader=request.body?.getReader();if(!reader)return Buffer.alloc(0);const chunks=[];let length=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>max){await reader.cancel();throw new AdsError(413,'body_too_large','Request exceeds the configured byte limit.');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
 return Buffer.concat(chunks);
}
async function readJson(request,max=32768){const bytes=await readBytes(request,max);if(!bytes.length)return {};try{return JSON.parse(bytes.toString('utf8'));}catch{throw new AdsError(400,'invalid_json','Provide a valid JSON request.');}}
export function createAdsHandler({config,db,auth,service,refunds,corrections,compatibility}){
 return async request=>{
  try{
   const url=new URL(request.url),parts=url.pathname.split('/').filter(Boolean).slice(2).map(decodeURIComponent);
   if(parts.length===1&&parts[0]==='config'&&request.method==='GET'){
    const selected=url.searchParams.getAll('placement');assert(selected.length<=1&&selected.every(id=>PLACEMENTS.includes(id)),400,'unknown_placement','The QR or NFC link refers to an unknown digital placement.');
    return json({...publicAdsConfig(config),selectedPlacement:selected[0]||null});
   }
   const publisher=sameSecret(request.headers.get('x-ads-publisher'),config.publisherToken);
   if(parts[0]==='playlists'&&parts.length===2&&request.method==='GET')return json(await service.playlist(parts[1],{publisher}));
   if(parts[0]==='assets'&&parts.length===2&&request.method==='GET'){
    const asset=await service.asset(parts[1],{publisher});return new Response(asset.bytes,{headers:{'Content-Type':asset.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
   }
   assert(['GET','POST'].includes(request.method),405,'method_not_allowed','Method not allowed.');
   if(request.method==='POST')assert(request.headers.get('origin')===config.origin,403,'origin_rejected','The request origin does not match this venue.');
   if(parts[0]==='auth'){
    if(parts[1]==='challenge'&&request.method==='POST')return json(await auth.challenge(await readJson(request,4096)));
    if(parts[1]==='verify'&&request.method==='POST'){const result=await auth.verify(await readJson(request,16384));return json({identity:result.identity,expiresAt:result.expiresAt,purchaseEligibility:purchaseEligibility(config,result.identity)},200,{'Set-Cookie':result.cookie});}
    if(parts[1]==='logout'&&request.method==='POST'){const result=await auth.logout(request);return json({status:'SIGNED_OUT'},200,{'Set-Cookie':result?.cookie||'__Host-ads_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});}
   }
   const identity=await auth.authenticate(request),ownerId=identity.ownerId,key=request.headers.get('idempotency-key');
   if(request.method==='POST')assert(typeof key==='string'&&/^[A-Za-z0-9:_-]{8,160}$/.test(key),400,'idempotency_required','Provide an Idempotency-Key of 8 to 160 characters.');
   if(request.method==='POST'&&(parts[0]==='quotes'||parts[0]==='orders'&&(parts.length===1||parts[2]==='pay')))assertPurchaseAllowed(config,identity);
   // Scope quotas by authenticated wallet, without retaining raw IP addresses.
   const rateKey='http:'+ownerId+':'+request.method;
   await db.query("INSERT INTO ads_rate_limits(key,count,expires_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN ads_rate_limits.expires_at<now() THEN 1 ELSE ads_rate_limits.count+1 END,expires_at=CASE WHEN ads_rate_limits.expires_at<now() THEN EXCLUDED.expires_at ELSE ads_rate_limits.expires_at END",[rateKey]);
   const rate=(await db.query('SELECT count FROM ads_rate_limits WHERE key=$1',[rateKey])).rows[0];assert(rate.count<=(request.method==='GET'?240:60),429,'rate_limited','Wait before making another request.');
   if(parts[0]==='auth'&&parts[1]==='me'&&request.method==='GET')return json({identity,purchaseEligibility:purchaseEligibility(config,identity)});
   if(parts[0]==='compatibility'&&parts.length===2&&parts[1]==='status'&&request.method==='GET'){
    assert(compatibility,503,'compatibility_unconfigured','Compatibility verification is unavailable.');
    const ids=url.searchParams.getAll('attemptId');
    assert(ids.length<=1&&[...url.searchParams.keys()].every(name=>name==='attemptId'),400,'compatibility_request_invalid','Select at most one compatibility attempt.');
    return json(await compatibility.status(identity,{...(ids.length?{attemptId:identifier(ids[0])}:{})}));
   }
   if(parts[0]==='compatibility'&&request.method==='POST'){
    assert(compatibility,503,'compatibility_unconfigured','Compatibility verification is unavailable.');
    if(parts.length===2&&parts[1]==='challenge')return json(await compatibility.challenge(identity,await readJson(request,4096),key),201);
    if(parts.length===3&&parts[2]==='verify'){const result=await compatibility.verify(identity,identifier(parts[1]),await readJson(request,140000),key);return json(result,['VERIFYING','RECONCILIATION_REQUIRED'].includes(result.status)?202:200);}
   }
   if(parts[0]==='availability'&&parts.length===1&&request.method==='GET'){const ids=url.searchParams.getAll('campaignId');assert(ids.length===1&&url.searchParams.getAll('startsAfter').length<=1,400,'availability_request_invalid','Selecciona una campaña y una ventana válida.');return json(await service.availability(ownerId,identifier(ids[0]),{startsAfter:url.searchParams.get('startsAfter')||undefined}));}
   if(parts[0]==='uploads'&&parts.length===1&&request.method==='POST')return json(await service.upload(ownerId,await readBytes(request,config.limits.uploadBytes||1048576),request.headers.get('content-type')?.split(';')[0],key),201);
   if(parts[0]==='campaigns'){
    if(parts.length===1&&request.method==='POST')return json(await service.campaign(ownerId,await readJson(request),key),201);
    if(parts.length===3&&request.method==='POST'){
     identifier(parts[1]);
     if(parts[2]==='revisions')return json(await service.revision(ownerId,parts[1],await readJson(request),key),201);
     if(parts[2]==='preaudit')return json(await service.preaudit(ownerId,parts[1],key));
     if(parts[2]==='preview')return json(await service.preview(ownerId,parts[1],key));
    }
   }
   if(parts[0]==='previews'&&parts.length===3&&request.method==='GET'){
    identifier(parts[1]);const {rows}=await db.query('SELECT p.artifacts FROM ads_previews p JOIN ads_revisions r ON r.id=p.revision_id JOIN ads_campaigns c ON c.id=r.campaign_id WHERE p.revision_id=$1 AND c.owner_id=$2 AND p.expires_at>now()',[parts[1],ownerId]);
    assert(rows.some(r=>r.artifacts.some(a=>a.key===parts[2])),404,'preview_unavailable','Preview unavailable.');
    const bytes=await service.privateStorage.get(parts[2]);return new Response(bytes,{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
   }
   if(parts[0]==='quotes'&&parts.length===1&&request.method==='POST')return json(await service.quote(ownerId,await readJson(request),key),201);
   if(parts[0]==='orders'){
    if(parts.length===1&&request.method==='POST')return json(await service.order(ownerId,(await readJson(request)).quoteId),201);
    if(parts.length===2&&request.method==='GET')return json(await service.getOrder(identifier(parts[1]),ownerId));
    if(parts.length===3&&parts[2]==='evidence'&&request.method==='GET')return json(await service.evidence(ownerId,parts[1],url.searchParams.get('cursor')));
    if(parts.length===3&&request.method==='POST'){
     const id=identifier(parts[1]),body=await readJson(request,262144);
     if(parts[2]==='pay'){
      let payload=body.paymentPayload||body.payload;
      const signedHeader=request.headers.get('payment-signature');
      if(signedHeader){assert(signedHeader.length<=140000,413,'payment_payload_limit','The signed payment exceeds its byte limit.');let decoded;try{decoded=JSON.parse(Buffer.from(signedHeader,'base64').toString('utf8'));}catch{throw new AdsError(400,'payment_header_invalid','The x402 payment header is malformed.');}
       assert(!payload||canonical(payload)===canonical(decoded),409,'payment_payload_conflict','The payment header and body do not match.');payload=decoded;
      }
      const result=await service.pay(ownerId,id,key,payload);
      if(result.status===402)return json(result.paymentRequired,402,{'PAYMENT-REQUIRED':Buffer.from(JSON.stringify(result.paymentRequired)).toString('base64')});
      return json(result,result.paymentState==='SETTLED'?200:202,result.paymentState==='SETTLED'?{'PAYMENT-RESPONSE':Buffer.from(JSON.stringify({success:true,network:config.network,payer:result.payer,transaction:result.transaction})).toString('base64')}:{ });
     }
     if(parts[2]==='revision')return json(await corrections.apply({ownerId,orderId:id,revisionId:body.revisionId,idempotencyKey:key}));
     if(parts[2]==='disputes')return json(await service.dispute(ownerId,id,body,key),201);
     if(parts[2]==='reprogram')return json(await service.reprogram(ownerId,id,body,key));
     if(parts[2]==='refunds')return json(await refunds.requestSettlementRemedy({orderId:id,ownerId,idempotencyKey:key,reason:body.reason}),201);
    }
   }
   if(parts[0]==='operator'){
    assert(identity.role==='operator',403,'operator_required','Operator authorization is required.');
    if(parts.length===2&&parts[1]==='orders'&&request.method==='GET')return json({orders:(await db.query('SELECT id,state AS status,reason,created_at FROM ads_orders ORDER BY created_at DESC LIMIT 100')).rows});
    if(parts.length===2&&parts[1]==='refunds'&&request.method==='GET')return json({refunds:(await db.query('SELECT id,order_id,state,amount,reason,transaction_hash FROM ads_refunds ORDER BY created_at DESC LIMIT 100')).rows});
    if(parts.length===4&&parts[1]==='disputes'&&parts[3]==='resolve'&&request.method==='POST'){const body=await readJson(request);return json(await corrections.resolve({identity,disputeId:parts[2],outcome:body.outcome,reason:body.reason}));}
    if(parts.length===4&&parts[1]==='orders'&&parts[3]==='release'&&request.method==='POST')return json(await corrections.release({identity,orderId:parts[2],reason:(await readJson(request)).reason}));
    if(parts.length===4&&parts[1]==='orders'&&parts[3]==='suspend'&&request.method==='POST')return json(await service.suspend(identity,identifier(parts[2]),(await readJson(request)).reason));
    if(parts.length===4&&parts[1]==='refunds'&&request.method==='POST'){
     const refundId=identifier(parts[2]),operatorId=identity.address;
     if(parts[3]==='reject')return json(await refunds.reject({refundId,operatorId,reason:(await readJson(request)).reason}));
     if(parts[3]==='approve')return json(await refunds.approve({refundId,operatorId}));
     if(parts[3]==='submit')return json(await refunds.submit({refundId,operatorId}));
     if(parts[3]==='reconcile')return json(await refunds.reconcile(refundId));
    }
   }
   throw new AdsError(404,'route_not_found','Advertising operation not found.');
  }catch(error){
   if(['23P01','40001','40P01'].includes(error.code))return json({error:{code:'capacity_conflict',message:'Capacity changed concurrently. Request another quote.'}},409);
   const known=error instanceof AdsError;
   const retryAt=known&&error.status===429&&error.code==='compatibility_quota'?Date.parse(error.details?.retryAt):NaN;
   const serverTime=Date.parse(error.details?.serverTime),delay=Number.isFinite(retryAt)?Math.max(1,Math.ceil((retryAt-(Number.isFinite(serverTime)?serverTime:Date.now()))/1000)):null;
   return json({error:{code:known?error.code:'service_unavailable',message:known?error.message:'The operation could not be completed. Existing payment attempts remain protected.',...(known&&error.details?{details:error.details}:{})}},known?error.status:503,delay!==null?{'Retry-After':String(delay)}:{});
  }
 };
}
export async function adsNodeHandler(req,res,handler,origin){
 const headers=new Headers();for(const[key,value]of Object.entries(req.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):String(value));
 const url=new URL(req.url,origin);const request=new Request(url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:req.body!==undefined?(typeof req.body==='string'||Buffer.isBuffer(req.body)?req.body:JSON.stringify(req.body)):req,duplex:'half'}:{})});
 const response=await handler(request);res.statusCode=response.status;for(const[key,value]of response.headers)res.setHeader(key,value);res.end(Buffer.from(await response.arrayBuffer()));
}
