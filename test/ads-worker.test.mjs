import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createVercelWorker,createVercelWorkerHandler,seedWorkerMaintenance,MAX_WORKER_RUN_MS} from '../server/ads/vercel-worker.mjs';
import {createPublisher} from '../server/ads/publisher.mjs';
import {createVercelRunner} from '../server/ads/vercel-runner.mjs';
import {claimJob} from '../server/ads/jobs.mjs';
import {createTestDatabase} from './helpers/ads-db.mjs';

const config={enabled:true,missing:[],network:'stellar:testnet',origin:'https://example.com',publisherOrigin:'https://example.com',publisherToken:'test-only-private',publisherKey:'test-only-key',publisherPublicKey:'test-only-public',heartbeatMs:1000,publisherLeaseMs:5000,manifestMs:2000,hostWindows:[],model:{maxCalls:3,timeoutMs:20000}};
const noWork={seedMaintenance:async()=>{},maintainFulfillment:async()=>{},jobRunnerFactory:()=>({runOnce:async()=>false})};
async function request(handler,{method='GET',authorization,url='/api/ads-worker'}={}){
 let status,headers,body;await handler({method,url,headers:{authorization}},{writeHead(s,h){status=s;headers=h;},end(value){body=JSON.parse(value);}});return {status,headers,body};
}

test('private worker authenticates before runtime, database or job access',async()=>{
 let touched=0;const handler=createVercelWorkerHandler({env:{CRON_SECRET:'private'},getRuntime:()=>{touched++;throw Error('Do not initialize');}});
 for(const authorization of [undefined,'private','Bearer wrong','bearer private','Bearer private extra'])assert.equal((await request(handler,{authorization})).status,401);
 assert.equal((await request(handler,{method:'DELETE'})).status,405);assert.equal(touched,0);
 assert.equal((await request(createVercelWorkerHandler({env:{},getRuntime:()=>{throw Error('No runtime');}}))).status,503);
});

test('worker rejects caller options and disabled configuration without constructing jobs',async()=>{
 let runtime=0,created=0;const handler=createVercelWorkerHandler({env:{CRON_SECRET:'private'},getRuntime:async()=>{runtime++;return {config:{enabled:false}};},workerFactory:()=>{created++;}});
 assert.equal((await request(handler,{authorization:'Bearer private',url:'/api/ads-worker?check=renderer'})).status,400);assert.equal(runtime,0);
 const response=await request(handler,{authorization:'Bearer private'});assert.equal(response.status,503);assert.equal(response.body.error.code,'worker_unconfigured');assert.equal(created,0);
 for(const settings of [{enabled:false},{enabled:true,missing:['required']}])await assert.rejects(createVercelWorker({config:settings,...noWork}).run(),error=>error.code==='worker_unconfigured');
});

test('worker returns bounded aggregate status and does not leak failures',async()=>{
 const handler=createVercelWorkerHandler({env:{CRON_SECRET:'private'},getRuntime:async()=>({config}),workerFactory:()=>({run:async()=>({state:'IDLE',jobs:0})})});
 const result=await request(handler,{authorization:'Bearer private'});assert.equal(result.status,200);assert.equal(result.headers['Cache-Control'],'no-store');assert.deepEqual(result.body,{state:'IDLE',jobs:0});
 const failed=createVercelWorkerHandler({env:{CRON_SECRET:'private'},getRuntime:async()=>{throw Error('PRIVATE_VALUE_MUST_NOT_LEAK');}});
 assert(!JSON.stringify(await request(failed,{authorization:'Bearer private'})).includes('PRIVATE_VALUE_MUST_NOT_LEAK'));assert.equal(MAX_WORKER_RUN_MS,90000);
});

test('operational worker continues existing obligations with checkout closed while publisher authority is occupied',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const publisher=createPublisher({db,config,owner:'occupied-renderer'});await publisher.lease();
 const before=(await db.query("SELECT owner,fence,expires_at FROM ads_leases WHERE name='publisher'")).rows[0];
 const id=randomUUID(),orderId=randomUUID();let reconciled=0,recoveryCalls=0;
 await db.query("INSERT INTO ads_outbox(id,topic,aggregate_id,payload,dedupe_key) VALUES($1,'payment-reconcile',$2,$3,$4)",[id,orderId,{attemptId:'persisted-attempt'},'worker-with-live-publisher']);
 const worker=createVercelWorker({db,config:{...config,enabled:false,operationalReady:true,missing:['ADS_CHECKOUT_ENABLED','walletCompatibilityVerified']},seedMaintenance:async()=>{},maintainFulfillment:async()=>{recoveryCalls++;return {recovered:recoveryCalls===1?1:0,closed:0};},payments:{reconcile:async()=>{reconciled++;return {paymentState:'SETTLED'};},settle:()=>{throw Error('Worker never creates a new charge');}},publisherFactory:()=>{throw Error('Worker cannot use publisher authority');},launchBrowser:()=>{throw Error('Worker cannot open Chromium');}});
 const result=await worker.run();assert.equal(result.jobs,1);assert.equal(result.recovery.recovered,1);assert.equal(reconciled,1);assert.equal(recoveryCalls,2);
 const after=(await db.query("SELECT owner,fence,expires_at FROM ads_leases WHERE name='publisher'")).rows[0];assert.deepEqual(after,before);
 assert.equal((await db.query('SELECT status FROM ads_outbox WHERE id=$1',[id])).rows[0].status,'DONE');
 const busy=createVercelRunner({db,config,publisherFactory:()=>createPublisher({db,config,owner:'other-renderer'}),hasReadyPlacement:()=>{throw Error('Busy publisher does not drain work');}});
 assert.equal((await busy.run()).state,'BUSY');
});

test('parallel workers respect the existing job lease without a global publisher lease',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const id=randomUUID(),orderId=randomUUID();let enter,release,calls=0;
 const entered=new Promise(resolve=>{enter=resolve;}),held=new Promise(resolve=>{release=resolve;});
 await db.query("INSERT INTO ads_outbox(id,topic,aggregate_id,payload,dedupe_key) VALUES($1,'payment-reconcile',$2,$3,$4)",[id,orderId,{attemptId:'shared-attempt'},'parallel-worker-job']);
 const options={db,config,seedMaintenance:async()=>{},maintainFulfillment:async()=>{},payments:{reconcile:async()=>{calls++;enter();await held;return {paymentState:'SETTLED'};}}};
 const running=createVercelWorker(options).run();await entered;
 const second=await createVercelWorker(options).run();assert.equal(second.jobs,0);release();assert.equal((await running).jobs,1);assert.equal(calls,1);
 assert.equal((await db.query("SELECT * FROM ads_leases WHERE name='publisher'")).rowCount,0);
 assert.equal((await db.query('SELECT status,attempts FROM ads_outbox WHERE id=$1',[id])).rows[0].attempts,1);
});

test('a crashed job lease is reclaimed once and a later worker does not repeat reconciliation',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const id=randomUUID(),orderId=randomUUID();let reconciled=0;
 await db.query("INSERT INTO ads_outbox(id,topic,aggregate_id,payload,dedupe_key) VALUES($1,'payment-reconcile',$2,$3,$4)",[id,orderId,{attemptId:'recovered-attempt'},'worker-crash']);
 await db.query('UPDATE ads_outbox SET available_at=$2 WHERE id=$1',[id,new Date(Date.now()-120000)]);assert.equal((await claimJob(db,'crashed-process',Date.now()-60000)).id,id);
 const worker=createVercelWorker({db,config,seedMaintenance:async()=>{},maintainFulfillment:async()=>{},payments:{reconcile:async()=>{reconciled++;return {paymentState:'SETTLED'};}}});
 assert.equal((await worker.run()).jobs,1);assert.equal((await worker.run()).jobs,0);const row=(await db.query('SELECT status,attempts FROM ads_outbox WHERE id=$1',[id])).rows[0];
 assert.equal(row.status,'DONE');assert.equal(row.attempts,2);assert.equal(reconciled,1);
});

test('worker caps admission at eight jobs and leaves headroom for durable operations',async()=>{
 for(const [advance,expected] of [[0,8],[30000,2],[90000,1]]){
  let clock=1000,calls=0;const worker=createVercelWorker({config,...noWork,now:()=>clock,maxJobs:100,jobRunnerFactory:()=>({runOnce:async()=>{calls++;clock+=advance;return true;}})});
  const result=await worker.run();assert.equal(result.jobs,expected);assert.equal(calls,expected);assert.equal(result.state,advance===90000?'DEADLINE':'PROCESSED');
 }
});

test('worker budget never cancels an in-flight durable job or starts a second job afterward',async()=>{
 let calls=0,done=false;
 const worker=createVercelWorker({config,...noWork,maxRunMs:10,minJobBudgetMs:1,jobRunnerFactory:()=>({runOnce:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,25));done=true;return true;}})});
 const result=await worker.run();assert.equal(result.state,'DEADLINE');assert.equal(result.jobs,1);assert.equal(calls,1);assert(done);
});

test('pre-aborted worker does not touch recovery, SQL or jobs',async()=>{
 const abort=new AbortController();abort.abort();let touches=0;
 const worker=createVercelWorker({config,maintainFulfillment:async()=>{touches++;},seedMaintenance:async()=>{touches++;},jobRunnerFactory:()=>{touches++;},db:{query(){touches++;}}});
 assert.equal((await worker.run({signal:abort.signal})).state,'DEADLINE');assert.equal(touches,0);
});

test('registry reconciliation precedes bounded flushing independently of publishing',async()=>{
 const calls=[];const db={query:async sql=>{assert.match(sql,/ads_registry_jobs/);return {rows:[{id:'durable-registry-job'}]};}};
 const worker=createVercelWorker({db,config:{...config,registryContract:'test-registry'},...noWork,registry:{reconcile:async id=>{calls.push(['reconcile',id]);},flush:async value=>{calls.push(['flush',value]);return {processed:calls.length===2?1:0};}}});
 const result=await worker.run();assert.equal(result.registryProcessed,1);assert.deepEqual(calls,[['reconcile','durable-registry-job'],['flush',{limit:1}],['flush',{limit:1}]]);
});

test('recovery runs before seeding and again after durable work using the runtime service',async()=>{
 const calls=[];const worker=createVercelWorker({config,service:{maintainFulfillment:async()=>{calls.push('recover');return {recovered:1,closed:0};}},seedMaintenance:async()=>{calls.push('seed');},jobRunnerFactory:()=>({runOnce:async()=>{calls.push('jobs');return false;}})});
 const result=await worker.run();assert.deepEqual(calls,['recover','seed','jobs','recover']);assert.equal(result.recovery.recovered,2);
});

test('maintenance enqueues only persisted reconciliation and destination-monitor work',async()=>{
 const writes=[];const pendingId=randomUUID(),orderId=randomUUID(),liveId=randomUUID();const tx={query:async(sql,params)=>{
  if(sql.includes('FROM ads_payment_attempts'))return {rows:[{id:pendingId,order_id:orderId}]};
  if(sql.includes('SELECT o.id FROM ads_orders'))return {rows:[{id:liveId}]};
  writes.push({sql,params});return {rows:[]};
 }};await seedWorkerMaintenance({transaction:work=>work(tx)},120000);
 assert.equal(writes.length,2);assert(writes.every(write=>write.sql.includes('INSERT INTO ads_outbox')));
 assert.equal(writes[0].params[1],'payment-reconcile');assert.equal(writes[0].params[3],'payment-reconcile:'+pendingId+':2');assert.equal(writes[1].params[1],'cta-check');
});

test('Vercel exposes separate minute Crons with180s worker and800s publisher limits',async()=>{
 const {readFile}=await import('node:fs/promises');const settings=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.equal(settings.functions['api/ads-worker.js'].maxDuration,180);assert.equal(settings.functions['api/ads-runner.js'].maxDuration,800);
 for(const path of ['/api/ads-worker','/api/ads-runner'])assert.deepEqual(settings.crons.filter(job=>job.path===path),[{path,schedule:'* * * * *'}]);
 assert(!settings.functions['api/ads-worker.js'].includeFiles.includes('@sparticuz'));
});


test('private worker accepts operational readiness with checkout disabled but never ignores technical readiness',async()=>{
 const settings={...config,enabled:false,operationalReady:true,missing:['ADS_CHECKOUT_ENABLED','walletCompatibilityVerified']};let jobs=0;
 const handler=createVercelWorkerHandler({env:{CRON_SECRET:'private'},getRuntime:async()=>({config:settings}),workerFactory:runtime=>createVercelWorker({...noWork,...runtime,jobRunnerFactory:()=>({runOnce:async()=>{jobs++;return false;}})})});
 const result=await request(handler,{authorization:'Bearer private'});assert.equal(result.status,200);assert.equal(result.body.state,'IDLE');assert.equal(jobs,1);
 await assert.rejects(createVercelWorker({config:{...config,operationalReady:false},...noWork}).run(),error=>error.code==='worker_unconfigured');
 const failed=createVercelWorkerHandler({env:{CRON_SECRET:'private'},getRuntime:async()=>({config:{...config,enabled:true,operationalReady:false}}),workerFactory:()=>{throw Error('No jobs without technical readiness');}});
 assert.equal((await request(failed,{authorization:'Bearer private'})).status,503);
});
