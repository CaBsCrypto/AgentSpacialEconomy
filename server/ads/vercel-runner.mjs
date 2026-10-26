import {createHash,timingSafeEqual} from 'node:crypto';
import {access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';
import {createJobRunner} from './jobs.mjs';
import {createPublisher,runCanonicalRenderer} from './publisher.mjs';
import {AdsError,enqueue} from './common.mjs';

export const MAX_RUN_MS=600000;
const positive=(value,fallback,ceiling)=>Number.isSafeInteger(value)&&value>0?Math.min(value,ceiling):fallback;
const unavailable=()=>new AdsError(503,'runner_unconfigured','The private advertising runner is not configured.');
export function cronAuthorized(header,secret){
 if(typeof secret!=='string'||!secret||typeof header!=='string'||!header.startsWith('Bearer '))return false;
 const digest=value=>createHash('sha256').update(value).digest();
 return timingSafeEqual(digest(header.slice(7)),digest(secret));
}
const CHROMIUM_DIRECTORY='node_modules/@sparticuz/chromium/bin';
const CHROMIUM_FILES=['chromium.br','al2023.tar.br','fonts.tar.br','swiftshader.tar.br'];
const SMOKE_STAGES=new Set(['bundle-files','module-load','binary-extract','binary-launch','context','content','webgl','metadata','cleanup','complete']);
export async function inspectVercelBrowserBundle({cwd=process.cwd(),accessFile=access}={}){
 const directory=resolve(cwd,CHROMIUM_DIRECTORY);
 const results=await Promise.all(CHROMIUM_FILES.map(async name=>{
  try{await accessFile(resolve(directory,name),constants.R_OK);return {name,readable:true};}
  catch{return {name,readable:false};}
 }));
 return {directory:CHROMIUM_DIRECTORY,readable:results.every(file=>file.readable),files:results};
}
export async function launchVercelBrowser(options={},{
 loadClient=()=>import('playwright-core-vercel'),loadBinary=()=>import('@sparticuz/chromium'),inspectBundle=inspectVercelBrowserBundle,
}={}){
 const {onStage,onBundle,...launchOptions}=options;
 const mark=stage=>{if(typeof onStage==='function')onStage(stage);};
 mark('bundle-files');
 const bundle=await inspectBundle();if(typeof onBundle==='function')onBundle(bundle);
 if(!bundle.readable){const error=new Error('Bundled Chromium files are unreadable: '+bundle.files.filter(file=>!file.readable).map(file=>file.name).join(', '));error.code='CHROMIUM_BUNDLE_MISSING';throw error;}
 mark('module-load');
 const [{chromium},module]=await Promise.all([loadClient(),loadBinary()]);
 const binary=module.default;
 mark('binary-extract');
 // Vercel may relocate bundled JS. includeFiles preserves this explicit path.
 const executablePath=await binary.executablePath(resolve(process.cwd(),CHROMIUM_DIRECTORY));
 mark('binary-launch');
 return chromium.launch({...launchOptions,args:binary.args,executablePath,headless:true});
}
// Keep the desktop Playwright browser for local development. The serverless
// binary/client pair is used only by the Vercel runtime.
export function createRuntimeBrowserLauncher({
 env=process.env,vercel=launchVercelBrowser,
 local=options=>import('playwright').then(({chromium})=>chromium.launch(options)),
}={}){
 return options=>env.VERCEL==='1'?vercel(options):local(options);
}
/** Private technical probe: fixed inline canvas, no application runtime or ledger. */
export async function runRendererSmoke({launchBrowser=launchVercelBrowser,timeoutMs=55000}={}){
 const started=Date.now(),workMs=positive(timeoutMs,55000,55000);
 let browser,context,workTimer,closeTimer,ended=false,stage='binary-launch',bundle;
 const failure=()=>new AdsError(503,'renderer_smoke_timeout','The technical renderer probe exceeded its deadline.');
 const deadline=new Promise((_,reject)=>{workTimer=setTimeout(()=>reject(failure()),workMs);});deadline.catch(()=>{});
 const guard=work=>Promise.race([work,deadline]);
 try{
  const opening=Promise.resolve().then(()=>launchBrowser({headless:true,timeout:30000,onStage:value=>{if(SMOKE_STAGES.has(value))stage=value;},onBundle:value=>{bundle=value;}})).then(async value=>{if(ended)await value.close();return value;});
  browser=await guard(opening);
  stage='context';
  context=await guard(browser.newContext({viewport:{width:32,height:32}}));
  await guard(context.route('**/*',route=>route.abort()));
  const page=await guard(context.newPage());
  stage='content';
  await guard(page.setContent('<!doctype html><html><head><meta charset="utf-8"><title>Private renderer check</title></head><body><canvas id="probe" width="2" height="2"></canvas></body></html>',{timeout:10000}));
  stage='webgl';
  const result=await guard(page.evaluate(()=>{
   const gl=document.getElementById('probe').getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:true});
   if(!gl)return {webgl2:false,clearReadPixels:false};
   gl.clearColor(0,1,0,1);gl.clear(gl.COLOR_BUFFER_BIT);
   const pixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
   const error=gl.getError(),debug=gl.getExtension('WEBGL_debug_renderer_info');
   return {webgl2:true,clearReadPixels:error===gl.NO_ERROR&&pixel[0]===0&&pixel[1]===255&&pixel[2]===0&&pixel[3]===255,
    pixel:Array.from(pixel),glError:error,webglVersion:String(gl.getParameter(gl.VERSION)).slice(0,200),
    renderer:String(gl.getParameter(debug?debug.UNMASKED_RENDERER_WEBGL:gl.RENDERER)).slice(0,200)};
  }));
  stage='metadata';
  return {check:'renderer',stage:result.webgl2&&result.clearReadPixels?'complete':'webgl',bundle,ok:result.webgl2===true&&result.clearReadPixels===true,browserVersion:browser.version(),
   webgl2:result.webgl2,clearReadPixels:result.clearReadPixels,pixel:result.pixel,glError:result.glError,
   webglVersion:result.webglVersion,renderer:result.renderer,durationMs:Date.now()-started,
   meaning:'Technical browser probe only; no advertisement, acknowledgement or ledger operation.'};
 }catch(error){throw taggedSmokeError(error,stage,bundle);}
 finally{
  ended=true;clearTimeout(workTimer);
  if(browser||context){
   const closing=Promise.all([context?.close().catch(()=>{}),browser?.close()]);
   const closeDeadline=new Promise((_,reject)=>{closeTimer=setTimeout(()=>reject(failure()),5000);});
   try{await Promise.race([closing,closeDeadline]);}catch(error){throw taggedSmokeError(error,'cleanup',bundle);}finally{clearTimeout(closeTimer);}
  }
 }
}
function taggedSmokeError(error,stage,bundle){
 const tagged=new Error(typeof error?.message==='string'?error.message:'Technical renderer probe failed.');
 tagged.name=typeof error?.name==='string'?error.name:'Error';tagged.code=error?.code;
 tagged.rendererSmokeStage=stage;tagged.rendererSmokeBundle=bundle;return tagged;
}
function safeBrowserBundle(bundle){
 const files=CHROMIUM_FILES.map(name=>({name,readable:Array.isArray(bundle?.files)&&bundle.files.find(file=>file.name===name)?.readable===true}));
 return {directory:CHROMIUM_DIRECTORY,readable:files.every(file=>file.readable),files};
}
function privateSmokeDiagnostic(error,secret){
 const redact=value=>{
  let text=typeof value==='string'?value:'';
  if(secret)text=text.split(secret).join('[REDACTED]');
  text=text.replace(/S[A-Z2-7]{55}/g,'[REDACTED_STELLAR_KEY]').replace(/Bearer[ \t]+[^\s,;]+/gi,'Bearer [REDACTED]').replace(/[\u0000-\u001f\u007f]/g,' ');
  return text.length<=800?text:text.slice(0,398)+' ... '+text.slice(-397);
 };
 const identifier=(value,fallback)=>{const text=redact(value);return /^[A-Za-z0-9_.-]{1,64}$/.test(text)?text:fallback;};
 const stage=SMOKE_STAGES.has(error?.rendererSmokeStage)?error.rendererSmokeStage:'unknown';
 const result={check:'renderer',ok:false,stage,error:{code:identifier(error?.code,'renderer_smoke_failed'),name:identifier(error?.name,'Error'),message:redact(error?.message)||'Technical renderer probe failed.'}};
 const bundle=error?.rendererSmokeBundle;
 if(bundle&&Array.isArray(bundle.files))result.bundle=safeBrowserBundle(bundle);
 return result;
}
async function maintenance(db,clock){
 await db.transaction(async tx=>{
  const pending=(await tx.query("SELECT id,order_id FROM ads_payment_attempts WHERE state IN ('VERIFYING','SETTLING','RECONCILIATION_REQUIRED') AND updated_at<$1 ORDER BY updated_at LIMIT 8",[new Date(clock-15000)])).rows;
  for(const a of pending)await enqueue(tx,'payment-reconcile',a.order_id,'payment-reconcile:'+a.id+':'+Math.floor(clock/60000),{attemptId:a.id});
  const live=(await tx.query("SELECT o.id FROM ads_orders o JOIN ads_revisions r ON r.id=o.revision_id WHERE o.state IN ('QUEUED','LIVE') AND r.state='AUDITED' AND o.suspended=false ORDER BY o.created_at LIMIT 8")).rows;
  for(const order of live)await enqueue(tx,'cta-check',order.id,'cta-check:'+order.id+':'+Math.floor(clock/60000),{});
 });
}
async function readyPlacement(db,clock,lookaheadMs){
 return (await db.query(`SELECT s.id FROM ads_reservations s
 JOIN ads_orders o ON o.id=s.order_id JOIN ads_revisions r ON r.id=o.revision_id
 JOIN ads_placements p ON p.order_id=o.id AND p.placement_id=s.placement_id
 WHERE s.state='COMMITTED' AND s.starts_at<=$1 AND s.ends_at>$2
 AND o.state IN ('QUEUED','LIVE') AND o.queue_state='SCHEDULED' AND o.suspended=false
 AND r.state='AUDITED' AND r.manifest_hash IS NOT NULL
 AND p.delivered_units<p.required_units AND p.state<>'DISPUTED'
 AND EXISTS(SELECT 1 FROM ads_payment_attempts a WHERE a.order_id=o.id AND a.state='SETTLED')
 LIMIT 1`,[new Date(clock+lookaheadMs),new Date(clock)])).rowCount>0;
}

/** Cron only wakes existing durable work. PostgreSQL retains attempts, retries and accounting. */
export function createVercelRunner({
 db,config,creative,payments,registry,
 publisherFactory=()=>createPublisher({db,config}),
 jobRunnerFactory=()=>createJobRunner({db,config,creative,payments,registry}),
 renderer=runCanonicalRenderer,launchBrowser=createRuntimeBrowserLauncher(),
 now=Date.now,maxRunMs=MAX_RUN_MS,maxJobs=8,jobBudgetMs=90000,lookaheadMs=120000,
 seedMaintenance=maintenance,hasReadyPlacement=readyPlacement,
}={}){
 return {async run({signal}={}){
  if(!config?.enabled||config.missing?.length||!config.publisherToken||!config.publisherKey||!config.publisherPublicKey)throw unavailable();
  let origin,publisherOrigin;
  try{origin=new URL(config.origin);publisherOrigin=new URL(config.publisherOrigin);}catch{throw unavailable();}
  if(origin.origin!==publisherOrigin.origin||origin.username||origin.password||!['https:','http:'].includes(origin.protocol)||origin.protocol==='http:'&&!['localhost','127.0.0.1'].includes(origin.hostname))throw unavailable();
  const budget=positive(maxRunMs,MAX_RUN_MS,MAX_RUN_MS),deadline=now()+budget;
  const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const timeout=setTimeout(()=>controller.abort('deadline'),budget);
  const publisher=publisherFactory();
  let held=false,heartbeat,pulse,leaseLost=false,jobs=0,registryProcessed=0;
  const stopped=()=>controller.signal.aborted||now()>=deadline;
  const remaining=()=>Math.max(0,deadline-now());
  try{
   if(stopped())return {state:'DEADLINE',jobs};
   if(!await publisher.lease())return {state:'BUSY',jobs};
   held=true;
   if(stopped())return {state:'DEADLINE',jobs};
   pulse=setInterval(()=>{
    if(heartbeat||stopped())return;
    heartbeat=Promise.resolve().then(()=>publisher.lease()).then(ok=>{if(!ok){leaseLost=true;controller.abort('lease_lost');}})
     .catch(()=>{leaseLost=true;controller.abort('lease_lost');}).finally(()=>{heartbeat=null;});
   },Math.max(10,config.heartbeatMs||1000));
   await seedMaintenance(db,now());
   const jobRunner=jobRunnerFactory();
   const jobDeadline=Math.min(deadline,now()+positive(jobBudgetMs,90000,120000));
   const max=Math.min(8,Math.max(0,Number.isSafeInteger(maxJobs)?maxJobs:8));
   // Reserve the configured model timeout and bounded network/decoder overhead
   // before starting another job. Running jobs keep their existing PG lease.
   const jobReserve=Math.max(60000,(config.model?.maxCalls||2)*(config.model?.timeoutMs||15000)+30000);
   while(jobs<max&&!stopped()&&now()<jobDeadline&&remaining()>jobReserve){
    if(!await jobRunner.runOnce())break;jobs++;
   }
   if(config.registryContract&&registry&&!stopped()&&remaining()>60000){
    const pending=(await db.query("SELECT id FROM ads_registry_jobs WHERE state IN ('SUBMITTED','RECONCILIATION_REQUIRED') AND transaction_hash IS NOT NULL ORDER BY sequence LIMIT 8")).rows;
    for(const job of pending){if(stopped()||remaining()<=60000)break;await registry.reconcile(job.id);}
    for(let i=0;i<8&&!stopped()&&remaining()>60000;i++){const flushed=await registry.flush({limit:1});registryProcessed+=flushed.processed||0;if(!flushed.processed)break;}
   }
   if(stopped())return {state:leaseLost?'LEASE_LOST':'DEADLINE',jobs,registryProcessed};
   await publisher.schedule();
   if(!await hasReadyPlacement(db,now(),positive(lookaheadMs,120000,180000)))return {state:'IDLE',jobs,registryProcessed};
   if(stopped())return {state:'DEADLINE',jobs,registryProcessed};
   await renderer({publisher,config,signal:controller.signal,browserFactory:launchBrowser,shouldContinue:()=>hasReadyPlacement(db,now(),positive(lookaheadMs,120000,180000))});
   return {state:leaseLost?'LEASE_LOST':controller.signal.aborted?'DEADLINE':'COMPLETE',jobs,registryProcessed};
  }finally{
   clearTimeout(timeout);clearInterval(pulse);signal?.removeEventListener('abort',abort);
   if(heartbeat)await heartbeat;
   // Expire only this fenced authority; a replacement publisher is never released.
   if(held&&publisher.owner&&publisher.fence!=null)await db.query("UPDATE ads_leases SET expires_at=now() WHERE name='publisher' AND owner=$1 AND fence=$2",[publisher.owner,publisher.fence]);
  }
 }};
}

function send(res,status,value){
 res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...(status===405?{Allow:'GET, POST'}:{})});res.end(JSON.stringify(value));
}
export function createVercelRunnerHandler({
 env=process.env,
 getRuntime=()=>import('./runtime.mjs').then(module=>module.getAdsRuntime()),
 runnerFactory=createVercelRunner,rendererSmoke=runRendererSmoke,bundleProbe=inspectVercelBrowserBundle,
}={}){
 return async function adsRunner(req,res){
  if(!['GET','POST'].includes(req.method))return send(res,405,{error:{code:'method_not_allowed'}});
  if(!env.CRON_SECRET)return send(res,503,{error:{code:'runner_unconfigured'}});
  const header=typeof req.headers?.get==='function'?req.headers.get('authorization'):req.headers?.authorization;
  if(!cronAuthorized(header,env.CRON_SECRET))return send(res,401,{error:{code:'unauthorized'}});
  let query;try{query=new URL(req.url||'/api/ads-runner','https://runner.invalid').searchParams;}catch{return send(res,400,{error:{code:'invalid_request'}});}
  if(query.has('check')){
   if(query.size!==1||query.getAll('check').length!==1||!['renderer','bundle'].includes(query.get('check')))return send(res,400,{error:{code:'unsupported_check'}});
   if(query.get('check')==='bundle'){
    try{const bundle=safeBrowserBundle(await bundleProbe());return send(res,bundle.readable?200:503,{check:'bundle',ok:bundle.readable,...bundle});}
    catch{return send(res,503,{check:'bundle',ok:false,error:{code:'bundle_probe_failed'}});}
   }
   try{const result=await rendererSmoke();return send(res,result.ok?200:503,result);}
   catch(error){return send(res,503,privateSmokeDiagnostic(error,env.CRON_SECRET));}
  }
  try{
   const runtime=await getRuntime();
   if(!runtime.config?.enabled||runtime.config.missing?.length)return send(res,503,{error:{code:'runner_unconfigured'}});
   const result=await runnerFactory(runtime).run();return send(res,200,result);
  }catch(error){return send(res,503,{error:{code:error?.code==='runner_unconfigured'?'runner_unconfigured':'runner_unavailable'}});}
 };
}
