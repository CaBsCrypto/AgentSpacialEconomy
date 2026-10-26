import {createHash,timingSafeEqual} from 'node:crypto';
import {createJobRunner} from './jobs.mjs';
import {AdsError,enqueue} from './common.mjs';

export const MAX_WORKER_RUN_MS=90000;
const bounded=(value,fallback,maximum)=>Number.isSafeInteger(value)&&value>0?Math.min(value,maximum):fallback;
const unavailable=()=>new AdsError(503,'worker_unconfigured','The private advertising worker is not configured.');
const operational=config=>config?.operationalReady??(config?.enabled===true&&!config?.missing?.length);
function authorized(header,secret){
 if(typeof secret!=='string'||!secret||typeof header!=='string'||!header.startsWith('Bearer '))return false;
 const digest=value=>createHash('sha256').update(value).digest();
 return timingSafeEqual(digest(header.slice(7)),digest(secret));
}
/** Seed only existing durable obligations; no new purchase or wallet funding is possible. */
export async function seedWorkerMaintenance(db,clock){
 await db.transaction(async tx=>{
  const pending=(await tx.query("SELECT id,order_id FROM ads_payment_attempts WHERE state IN ('VERIFYING','SETTLING','RECONCILIATION_REQUIRED') AND updated_at<$1 ORDER BY updated_at LIMIT 8",[new Date(clock-15000)])).rows;
  for(const attempt of pending)await enqueue(tx,'payment-reconcile',attempt.order_id,'payment-reconcile:'+attempt.id+':'+Math.floor(clock/60000),{attemptId:attempt.id});
  const live=(await tx.query("SELECT o.id FROM ads_orders o JOIN ads_revisions r ON r.id=o.revision_id WHERE o.state IN ('QUEUED','LIVE') AND r.state='AUDITED' AND o.suspended=false ORDER BY o.created_at LIMIT 8")).rows;
  for(const order of live)await enqueue(tx,'cta-check',order.id,'cta-check:'+order.id+':'+Math.floor(clock/60000),{});
 });
}

/** Short durable worker; it never acquires publication authority or starts a browser. */
export function createVercelWorker({
 db,config,creative,payments,registry,service,
 jobRunnerFactory=()=>createJobRunner({db,config,creative,payments,registry}),
 seedMaintenance=seedWorkerMaintenance,maintainFulfillment=()=>service?.maintainFulfillment?.(),
 now=Date.now,maxRunMs=MAX_WORKER_RUN_MS,maxJobs=8,minJobBudgetMs=60000,
}={}){
 return {async run({signal}={}){
  if(!operational(config))throw unavailable();
  const budget=bounded(maxRunMs,MAX_WORKER_RUN_MS,MAX_WORKER_RUN_MS),deadline=now()+budget;
  const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const timer=setTimeout(()=>controller.abort('deadline'),budget);
  const stopped=()=>controller.signal.aborted||now()>=deadline,remaining=()=>Math.max(0,deadline-now());
  let jobs=0,registryProcessed=0;
  const recovery={recovered:0,closed:0};
  const recover=async()=>{const result=await maintainFulfillment();if(result){recovery.recovered+=Number(result.recovered)||0;recovery.closed+=Number(result.closed)||0;}};
  try{
   if(stopped())return {state:'DEADLINE',jobs,registryProcessed,recovery};
   await recover();
   if(!stopped())await seedMaintenance(db,now());
   const runner=jobRunnerFactory(),limit=Math.min(8,Math.max(0,Number.isSafeInteger(maxJobs)?maxJobs:8));
   const reserve=bounded(minJobBudgetMs,60000,60000);
   // The 90-second budget controls admission. A durable operation already started
   // finishes under its own outbox lease; the function's hard limit is 180 seconds.
   while(jobs<limit&&!stopped()&&remaining()>=reserve){
    if(!await runner.runOnce())break;jobs++;
   }
   if(config.registryContract&&registry&&!stopped()&&remaining()>15000){
    const pending=(await db.query("SELECT id FROM ads_registry_jobs WHERE state IN ('SUBMITTED','RECONCILIATION_REQUIRED') AND transaction_hash IS NOT NULL ORDER BY sequence LIMIT 8")).rows;
    for(const job of pending){if(stopped()||remaining()<=15000)break;await registry.reconcile(job.id);}
    for(let i=0;i<8&&!stopped()&&remaining()>15000;i++){const result=await registry.flush({limit:1});registryProcessed+=result.processed||0;if(!result.processed)break;}
   }
   if(!stopped()&&remaining()>5000)await recover();
   return {state:stopped()?'DEADLINE':jobs||registryProcessed?'PROCESSED':'IDLE',jobs,registryProcessed,recovery};
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }};
}
function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...(status===405?{Allow:'GET, POST'}:{})});res.end(JSON.stringify(value));}
export function createVercelWorkerHandler({
 env=process.env,getRuntime=()=>import('./runtime.mjs').then(module=>module.getAdsRuntime()),workerFactory=createVercelWorker,
}={}){
 return async function adsWorker(req,res){
  if(!['GET','POST'].includes(req.method))return send(res,405,{error:{code:'method_not_allowed'}});
  if(!env.CRON_SECRET)return send(res,503,{error:{code:'worker_unconfigured'}});
  const header=typeof req.headers?.get==='function'?req.headers.get('authorization'):req.headers?.authorization;
  if(!authorized(header,env.CRON_SECRET))return send(res,401,{error:{code:'unauthorized'}});
  let url;try{url=new URL(req.url||'/api/ads-worker','https://worker.invalid');}catch{return send(res,400,{error:{code:'invalid_request'}});}
  if(url.searchParams.size)return send(res,400,{error:{code:'unsupported_request'}});
  try{
   const runtime=await getRuntime();
   if(!operational(runtime.config))return send(res,503,{error:{code:'worker_unconfigured'}});
   return send(res,200,await workerFactory(runtime).run());
  }catch(error){return send(res,503,{error:{code:error?.code==='worker_unconfigured'?'worker_unconfigured':'worker_unavailable'}});}
 };
}
