import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createVercelRunner,createVercelRunnerHandler,cronAuthorized,MAX_RUN_MS,createRuntimeBrowserLauncher,runRendererSmoke} from '../server/ads/vercel-runner.mjs';
import {runCanonicalRenderer} from '../server/ads/publisher.mjs';
import {claimJob} from '../server/ads/jobs.mjs';
import {createTestDatabase} from './helpers/ads-db.mjs';

const config={enabled:true,missing:[],origin:'https://example.com',publisherOrigin:'https://example.com',publisherToken:'private-machine-token',publisherKey:'test-only-key',publisherPublicKey:'test-only-public',heartbeatMs:1000,publisherLeaseMs:5000,manifestMs:2000,hostWindows:[],model:{maxCalls:2,timeoutMs:15000}};
const noWork={seedMaintenance:async()=>{},jobRunnerFactory:()=>({runOnce:async()=>false})};
const fakePublisher=()=>({lease:async()=>true,schedule:async()=>{},acknowledge:async()=>{throw Error('No acknowledgement expected');}});
async function request(handler,{method='GET',authorization,url='/api/ads-runner'}={}){
 let status,headers,body;
 await handler({method,url,headers:{authorization}},{writeHead(s,h){status=s;headers=h;},end(value){body=JSON.parse(value);}});
 return {status,headers,body};
}
function fakeBrowser({status=200,url='https://example.com/one16?publisher=1'}={}){
 const state={opened:0,contextsClosed:0,browsersClosed:0,bindings:{},route:null,headers:null};
 const page={exposeBinding:async(name,fn)=>{state.bindings[name]=fn;},goto:async()=>({ok:()=>status>=200&&status<300}),url:()=>url};
 const context={route:async(_pattern,handler)=>{state.route=handler;},newPage:async()=>page,close:async()=>{state.contextsClosed++;}};
 const browser={newContext:async(options)=>{state.opened++;state.headers=options.extraHTTPHeaders;return context;},close:async()=>{state.browsersClosed++;}};
 return {state,browser};
}
test('private Cron authorization rejects absent, malformed and different tokens',()=>{
 assert(cronAuthorized('Bearer correct','correct'));
 for(const value of [undefined,'correct','bearer correct','Bearer wrong','Bearer correct extra'])assert(!cronAuthorized(value,'correct'));
 assert(!cronAuthorized('Bearer correct',''));
});
test('unauthorized requests never initialize runtime or access the database',async()=>{
 let touched=0;
 const handler=createVercelRunnerHandler({env:{CRON_SECRET:'private'},getRuntime:()=>{touched++;throw Error('must not initialize');}});
 for(const authorization of [undefined,'Bearer wrong','Bearer private-extra'])assert.equal((await request(handler,{authorization})).status,401);
 assert.equal((await request(handler,{method:'DELETE'})).status,405);
 assert.equal(touched,0);
 assert.equal((await request(createVercelRunnerHandler({env:{},getRuntime:()=>{throw Error('no runtime');}}))).status,503);
});
test('authenticated disabled configuration returns a safe503 without creating a runner',async()=>{
 let created=0;
 const handler=createVercelRunnerHandler({env:{CRON_SECRET:'private'},getRuntime:async()=>({config:{enabled:false},db:{query(){throw Error('no database');}}}),runnerFactory:()=>{created++;}});
 const response=await request(handler,{method:'POST',authorization:'Bearer private'});
 assert.equal(response.status,503);assert.equal(response.headers['Cache-Control'],'no-store');assert.equal(created,0);
});
test('authenticated machine caller requires no browser Origin and receives bounded status',async()=>{
 const handler=createVercelRunnerHandler({env:{CRON_SECRET:'private'},getRuntime:async()=>({config}),runnerFactory:()=>({run:async()=>({state:'IDLE',jobs:0})})});
 assert.deepEqual((await request(handler,{authorization:'Bearer private'})).body,{state:'IDLE',jobs:0});
 const failing=createVercelRunnerHandler({env:{CRON_SECRET:'private'},getRuntime:async()=>{throw Error('DO_NOT_LEAK_SECRET');}});
 assert(!JSON.stringify(await request(failing,{authorization:'Bearer private'})).includes('DO_NOT_LEAK_SECRET'));
 assert.equal(MAX_RUN_MS,600000);
});
test('invalid configuration is rejected before a lease or database operation',async()=>{
 for(const c of [{...config,enabled:false},{...config,missing:['incomplete']},{...config,publisherOrigin:'https://other.example.com'},{...config,publisherToken:''}]){
  const runner=createVercelRunner({config:c,publisherFactory:()=>{throw Error('must not create publisher');}});
  await assert.rejects(runner.run(),error=>error.code==='runner_unconfigured');
 }
});
test('busy global publisher lease returns immediately before jobs, scheduling or Chromium',async()=>{
 let browser=0,jobs=0;
 const runner=createVercelRunner({config,db:{query(){throw Error('no SQL after busy');}},publisherFactory:()=>({lease:async()=>false}),seedMaintenance:async()=>{jobs++;},launchBrowser:()=>{browser++;}});
 assert.deepEqual(await runner.run(),{state:'BUSY',jobs:0});assert.equal(browser,0);assert.equal(jobs,0);
});
test('deadline abort closes actual renderer context and owned browser without recording delivery',async()=>{
 const {state,browser}=fakeBrowser();let launches=0;
 const runner=createVercelRunner({config,...noWork,publisherFactory:fakePublisher,maxJobs:0,maxRunMs:30,hasReadyPlacement:async()=>true,launchBrowser:async()=>{launches++;return browser;}});
 const result=await runner.run();
 assert.equal(result.state,'DEADLINE');assert.equal(launches,1);assert.equal(state.contextsClosed,1);assert.equal(state.browsersClosed,1);
 assert.equal(await state.bindings.__adsPublisherAck(null,{units:300000}),false);
 assert.deepEqual(state.headers,{'x-ads-publisher':config.publisherToken});
 let continued=0,aborted=0;
 await state.route({request:()=>({url:()=>'https://vercel.com/login'}),continue:()=>continued++,abort:()=>aborted++});
 assert.equal(continued,0);assert.equal(aborted,1);
});
test('aborted and busy renderer never launches Chromium',async()=>{
 const controller=new AbortController();controller.abort();let opened=0;
 assert.deepEqual(await runCanonicalRenderer({config,publisher:fakePublisher(),signal:controller.signal,browserFactory:()=>{opened++;}}),{state:'ABORTED'});
 await assert.rejects(runCanonicalRenderer({config,publisher:{lease:async()=>false},browserFactory:()=>{opened++;}}),error=>error.code==='publisher_in_use');
 assert.equal(opened,0);
});
test('navigation failure closes owned resources and refuses a login redirect',async()=>{
 for(const options of [{status:403},{url:'https://vercel.com/login'}]){
  const {state,browser}=fakeBrowser(options);
  await assert.rejects(runCanonicalRenderer({config,publisher:fakePublisher(),browserFactory:async()=>browser}),error=>error.code==='publisher_navigation_failed');
  assert.equal(state.contextsClosed,1);assert.equal(state.browsersClosed,1);
 }
});
test('abort during browser startup closes a late browser and removes heartbeat work',async()=>{
 let resolve;const opening=new Promise(done=>{resolve=done;});const controller=new AbortController();const {state,browser}=fakeBrowser();
 const running=runCanonicalRenderer({config,publisher:fakePublisher(),signal:controller.signal,browserFactory:()=>opening});
 await new Promise(done=>setImmediate(done));controller.abort();
 assert.deepEqual(await running,{state:'ABORTED'});resolve(browser);await new Promise(done=>setImmediate(done));
 assert.equal(state.opened,0);assert.equal(state.browsersClosed,1);
});
test('real PostgreSQL outbox reclaims a crashed lease once and a later Cron does not repeat it',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const id=randomUUID(),orderId=randomUUID();let reconciled=0;
 await db.query("INSERT INTO ads_outbox(id,topic,aggregate_id,payload,dedupe_key) VALUES($1,'payment-reconcile',$2,$3,$4)",[id,orderId,{attemptId:'test-attempt'},'runner-crash']);
 await db.query("UPDATE ads_outbox SET available_at=$2 WHERE id=$1",[id,new Date(Date.now()-120000)]);
 assert.equal((await claimJob(db,'crashed-process',Date.now()-60000)).id,id);
 const runner=createVercelRunner({db,config,seedMaintenance:async()=>{},hasReadyPlacement:async()=>false,payments:{reconcile:async()=>{reconciled++;return {paymentState:'SETTLED'};}}});
 assert.equal((await runner.run()).state,'IDLE');
 assert.equal((await runner.run()).state,'IDLE');
 const row=(await db.query('SELECT status,attempts FROM ads_outbox WHERE id=$1',[id])).rows[0];
 assert.equal(row.status,'DONE');assert.equal(row.attempts,2);assert.equal(reconciled,1);
});
test('real SQL readiness requires settled payment, audited revision and unpaused scheduled obligation; launching grants no units',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());
 const campaign=randomUUID(),upload=randomUUID(),revision=randomUUID(),quote=randomUUID(),order=randomUUID(),reservation=randomUUID(),hash='a'.repeat(64),clock=Date.now();let renders=0;
 await db.query('INSERT INTO ads_campaigns(id,owner_id,brief) VALUES($1,$2,$3)',[campaign,'owner',{}]);
 await db.query("INSERT INTO ads_uploads(id,owner_id,storage_key,hash,mime,width,height,size) VALUES($1,'owner',$2,$3,'image/png',1,1,1)",[upload,hash+'.png',hash]);
 await db.query("INSERT INTO ads_revisions(id,campaign_id,brief,logo_id,content_hash,state,manifest_hash,manifest) VALUES($1,$2,$3,$4,$5,'AUDITED',$5,$3)",[revision,campaign,{},upload,hash]);
 const snapshot={placements:['main_stage_screen'],plan:'TIME',passMs:1000,endsAt:new Date(clock+392000).toISOString()};
 await db.query('INSERT INTO ads_quotes(id,owner_id,campaign_id,revision_id,snapshot,terms_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[quote,'owner',campaign,revision,snapshot,hash,new Date(clock+392000)]);
 await db.query("INSERT INTO ads_orders(id,owner_id,quote_id,revision_id,state,queue_state,amount,pay_to,terms_hash,quote) VALUES($1,'owner',$2,$3,'QUEUED','SCHEDULED',50000000,'recipient',$4,$5)",[order,quote,revision,hash,snapshot]);
 await db.query("INSERT INTO ads_placements(order_id,placement_id,required_units,delivered_units,unit,state) VALUES($1,'main_stage_screen',300000,0,'MILLISECONDS','SCHEDULED')",[order]);
 await db.query("INSERT INTO ads_reservations(id,order_id,placement_id,starts_at,ends_at,expires_at,state,delivery_units) VALUES($1,$2,'main_stage_screen',$3,$4,$4,'COMMITTED',300000)",[reservation,order,new Date(clock-1000),new Date(clock+392000)]);
 const runner=createVercelRunner({db,config,...noWork,maxJobs:0,renderer:async()=>{renders++;}});
 assert.equal((await runner.run()).state,'IDLE');assert.equal(renders,0);
 await db.query("INSERT INTO ads_payment_attempts(id,order_id,idempotency_key,payload_hash,signed_payload,network,payer,auth_nonce,auth_hash,expires_ledger,start_ledger,state,settlement_tx) VALUES($1,$2,'runner-payment-key',$3,$4,'stellar:testnet','payer','1',$3,100,90,'SETTLED',$3)",[randomUUID(),order,hash,{}]);
 await db.query("UPDATE ads_revisions SET state='PREAUDITED' WHERE id=$1",[revision]);assert.equal((await runner.run()).state,'IDLE');
 await db.query("UPDATE ads_revisions SET state='AUDITED' WHERE id=$1",[revision]);
 await db.query('UPDATE ads_orders SET suspended=true WHERE id=$1',[order]);assert.equal((await runner.run()).state,'IDLE');
 await db.query("UPDATE ads_orders SET suspended=false,queue_state='PROCESSING' WHERE id=$1",[order]);assert.equal((await runner.run()).state,'IDLE');
 await db.query("UPDATE ads_orders SET queue_state='SCHEDULED' WHERE id=$1",[order]);
 await db.query('UPDATE ads_reservations SET starts_at=$2 WHERE order_id=$1',[order,new Date(clock+90000)]);
 assert.equal((await runner.run()).state,'COMPLETE');assert.equal(renders,1,'launches 90 seconds before the first slot');
 assert.equal(Number((await db.query('SELECT delivered_units FROM ads_placements WHERE order_id=$1',[order])).rows[0].delivered_units),0);
 assert.equal((await db.query('SELECT * FROM ads_delivery WHERE order_id=$1',[order])).rowCount,0);
});

test('admission caps each invocation at eight existing jobs and stops at its time budget',async()=>{
 for(const [advance,expected] of [[0,8],[50000,2]]){
  let clock=Date.now(),calls=0;
  const runner=createVercelRunner({config,now:()=>clock,maxRunMs:300000,publisherFactory:fakePublisher,seedMaintenance:async()=>{},jobRunnerFactory:()=>({runOnce:async()=>{calls++;clock+=advance;return true;}}),hasReadyPlacement:async()=>false,launchBrowser:()=>{throw Error('No ready obligation');}});
  assert.equal((await runner.run()).jobs,expected);assert.equal(calls,expected);
 }
});
test('registry pending hashes are reconciled before bounded flushing, without submitting a payment',async()=>{
 const calls=[];
 const runner=createVercelRunner({config:{...config,registryContract:'configured-test-registry'},...noWork,publisherFactory:fakePublisher,db:{query:async sql=>{assert.match(sql,/ads_registry_jobs/);return {rows:[{id:'persisted-registry-job'}]};}},registry:{reconcile:async id=>{calls.push(['reconcile',id]);},flush:async value=>{calls.push(['flush',value]);return {processed:calls.length===2?1:0};}},hasReadyPlacement:async()=>false,payments:{settle:()=>{throw Error('Never settle from Cron');}}});
 const result=await runner.run();assert.equal(result.registryProcessed,1);
 assert.deepEqual(calls,[['reconcile','persisted-registry-job'],['flush',{limit:1}],['flush',{limit:1}]]);
});
test('concurrent real database Cron invocations share one fenced publisher authority',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());let entered,release,launched=0;
 const ready=new Promise(resolve=>{entered=resolve;}),wait=new Promise(resolve=>{release=resolve;});
 const first=createVercelRunner({db,config,...noWork,hasReadyPlacement:async()=>{entered();await wait;return false;},launchBrowser:()=>{launched++;}});
 const second=createVercelRunner({db,config,...noWork,hasReadyPlacement:async()=>{throw Error('Busy caller must not query readiness');},launchBrowser:()=>{launched++;}});
 const running=first.run();await ready;
 assert.equal((await second.run()).state,'BUSY');release();assert.equal((await running).state,'IDLE');assert.equal(launched,0);
 assert.equal((await db.query("SELECT * FROM ads_leases WHERE name='publisher'")).rowCount,1);
});
test('renderer stops early after its last ready obligation and closes on lost authority',async()=>{
 {
  const {state,browser}=fakeBrowser();
  const result=await runCanonicalRenderer({config:{...config,heartbeatMs:5},publisher:fakePublisher(),browserFactory:async()=>browser,shouldContinue:async()=>false});
  assert.deepEqual(result,{state:'COMPLETE'});assert.equal(state.contextsClosed,1);assert.equal(state.browsersClosed,1);
 }
 {
  const {state,browser}=fakeBrowser();let calls=0;
  await assert.rejects(runCanonicalRenderer({config:{...config,heartbeatMs:5},publisher:{...fakePublisher(),lease:async()=>++calls===1},browserFactory:async()=>browser}),/Publisher lease lost/);
  assert.equal(state.contextsClosed,1);assert.equal(state.browsersClosed,1);
 }
});

test('runtime launcher uses the Linux package only on Vercel',async()=>{
 const calls=[],options={headless:true,timeout:123};
 const vercel=async value=>{calls.push(['vercel',value]);return 'serverless';},local=async value=>{calls.push(['local',value]);return 'desktop';};
 for(const env of [{},{NODE_ENV:'production'},{VERCEL:'0'}])assert.equal(await createRuntimeBrowserLauncher({env,vercel,local})(options),'desktop');
 assert.equal(await createRuntimeBrowserLauncher({env:{VERCEL:'1'},vercel,local})(options),'serverless');
 assert.deepEqual(calls.map(([kind])=>kind),['local','local','local','vercel']);assert(calls.every(([,value])=>value===options));
});
test('serverless browser package and Playwright client pin the same Chromium major',async()=>{
 const {readFile}=await import('node:fs/promises');
 const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 const browserList=JSON.parse(await readFile(new URL('../node_modules/playwright-core-vercel/browsers.json',import.meta.url),'utf8'));
 const major=browserList.browsers.find(browser=>browser.name==='chromium').browserVersion.split('.')[0];
 assert.equal(manifest.dependencies['@sparticuz/chromium'].split('.')[0],major);
 assert.equal(manifest.dependencies['playwright-core-vercel'],'npm:playwright-core@1.63.0');
 const binary=await import('@sparticuz/chromium');assert.equal(typeof binary.default.executablePath,'function');assert(Array.isArray(binary.default.args));
});
test('Vercel hosting has a private minute Cron,800s limit and explicit binary tracing without memory override',async()=>{
 const {readFile}=await import('node:fs/promises');
 const settings=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 const runner=settings.functions['api/ads-runner.js'];
 assert.equal(runner.maxDuration,800);assert(!Object.hasOwn(runner,'memory'));assert.match(runner.includeFiles,/@sparticuz\/chromium\/bin/);assert.match(runner.includeFiles,/playwright-core-vercel\/\{browsers\.json,package\.json\}/);
 assert.deepEqual(settings.crons.filter(job=>job.path==='/api/ads-runner'),[{path:'/api/ads-runner',schedule:'* * * * *'}]);
 const ignored=await readFile(new URL('../.vercelignore',import.meta.url),'utf8');
 for(const path of ['.ads-secrets/','.ads-qa/','.ads-private/','.ads-*/','.ads-*.pem'])assert(ignored.split(/\r?\n/).includes(path));
});

test('Linux serverless binary smoke renders WebGL2 without external requests',{skip:process.platform!=='linux',timeout:60000},async()=>{
 const result=await runRendererSmoke();assert.equal(result.ok,true);assert.equal(result.webgl2,true);assert.equal(result.clearReadPixels,true);
});

function smokeBrowser(result={webgl2:true,clearReadPixels:true,pixel:[0,255,0,255],glError:0,webglVersion:'WebGL 2.0 test fixture',renderer:'Explicit software fixture'}){
 const state={contexts:0,closed:0,browsersClosed:0,html:null,route:null,options:null};
 const page={setContent:async html=>{state.html=html;},evaluate:async()=>result};
 const context={route:async(_pattern,handler)=>{state.route=handler;},newPage:async()=>page,close:async()=>{state.closed++;}};
 const browser={version:()=> 'HeadlessChrome/153 explicit test fixture',newContext:async options=>{state.contexts++;state.options=options;return context;},close:async()=>{state.browsersClosed++;}};
 return {state,browser,page};
}
test('private renderer check authenticates before any browser,configuration or database access',async()=>{
 let probes=0,runtime=0;
 const handler=createVercelRunnerHandler({env:{CRON_SECRET:'private'},getRuntime:async()=>{runtime++;throw Error('No application runtime for probe');},rendererSmoke:async()=>{probes++;return {check:'renderer',ok:true};}});
 assert.equal((await request(handler,{url:'/api/ads-runner?check=renderer'})).status,401);
 assert.equal((await request(handler,{url:'/api/ads-runner?check=renderer',authorization:'Bearer wrong'})).status,401);
 assert.equal(probes,0);assert.equal(runtime,0);
 const response=await request(handler,{url:'/api/ads-runner?check=renderer',authorization:'Bearer private'});
 assert.equal(response.status,200);assert.deepEqual(response.body,{check:'renderer',ok:true});assert.equal(probes,1);assert.equal(runtime,0);
});
test('renderer check admits only its exact fixed mode and no caller URL or additional options',async()=>{
 let probes=0;
 const handler=createVercelRunnerHandler({env:{CRON_SECRET:'private'},getRuntime:async()=>{throw Error('No runtime for invalid check');},rendererSmoke:async()=>{probes++;return {ok:true};}});
 for(const url of ['/api/ads-runner?check=Renderer','/api/ads-runner?check=','/api/ads-runner?check=renderer&url=https://attacker.example','/api/ads-runner?check=renderer&check=renderer']){
  assert.equal((await request(handler,{url,authorization:'Bearer private'})).status,400);
 }
 assert.equal(probes,0);
});
test('technical renderer check uses fixed inline content,blocks requests and closes resources',async()=>{
 const {state,browser}=smokeBrowser(),result=await runRendererSmoke({launchBrowser:async()=>browser});
 assert.equal(result.ok,true);assert.equal(result.check,'renderer');assert.deepEqual(result.pixel,[0,255,0,255]);assert.equal(result.webgl2,true);
 assert.equal(state.closed,1);assert.equal(state.browsersClosed,1);assert.match(state.html,/<canvas id="probe"/);
 assert(!state.html.includes('https:'));assert.equal(state.options.extraHTTPHeaders,undefined);
 let aborted=0;await state.route({abort:()=>{aborted++;}});assert.equal(aborted,1);
 assert(!Object.hasOwn(result,'receipt'));assert(!Object.hasOwn(result,'deliveryUnits'));
});
test('unsupported WebGL and browser errors produce truthful failures with cleanup and no application runtime',async()=>{
 const {state,browser}=smokeBrowser({webgl2:false,clearReadPixels:false});
 const proof=await runRendererSmoke({launchBrowser:async()=>browser});assert.equal(proof.ok,false);assert.equal(state.closed,1);assert.equal(state.browsersClosed,1);
 const handler=createVercelRunnerHandler({env:{CRON_SECRET:'private'},getRuntime:async()=>{throw Error('No runtime');},rendererSmoke:async()=>proof});
 assert.equal((await request(handler,{url:'/api/ads-runner?check=renderer',authorization:'Bearer private'})).status,503);
 const failed=createVercelRunnerHandler({env:{CRON_SECRET:'private'},rendererSmoke:async()=>{throw Error('fixture library missing');}});
 const response=await request(failed,{url:'/api/ads-runner?check=renderer',authorization:'Bearer private'});
 assert.equal(response.status,503);assert.equal(response.body.ok,false);assert.equal(response.body.error.message,'fixture library missing');
});
test('technical renderer timeout closes a stalled browser instead of reporting success',async()=>{
 const {state,browser,page}=smokeBrowser();page.evaluate=async()=>new Promise(()=>{});
 await assert.rejects(runRendererSmoke({launchBrowser:async()=>browser,timeoutMs:10}),error=>error.code==='renderer_smoke_timeout');
 assert.equal(state.closed,1);assert.equal(state.browsersClosed,1);
});

test('publisher startup uses 120 seconds lookahead by default with 180 seconds ceiling',async()=>{
 for(const [value,expected] of [[undefined,120000],[300000,180000],[60000,60000]]){
  let observed;
  const runner=createVercelRunner({config,...noWork,publisherFactory:fakePublisher,...(value===undefined?{}:{lookaheadMs:value}),hasReadyPlacement:async(_db,_clock,lookahead)=>{observed=lookahead;return false;}});
  assert.equal((await runner.run()).state,'IDLE');assert.equal(observed,expected);
 }
});

test('serverless launcher supplies the explicit shipped bin directory before browser startup',async()=>{
 const {resolve}=await import('node:path');const {inspectVercelBrowserBundle,launchVercelBrowser}=await import('../server/ads/vercel-runner.mjs');
 const readiness=await inspectVercelBrowserBundle();assert.equal(readiness.readable,true);assert.equal(readiness.files.length,4);
 const stages=[];let suppliedDirectory,options,bundle;
 const browser=await launchVercelBrowser({timeout:123,onStage:value=>stages.push(value),onBundle:value=>{bundle=value;}},{
  loadClient:async()=>({chromium:{launch:async value=>{options=value;return 'explicit-test-browser';}}}),
  loadBinary:async()=>({default:{args:['--fixture-only'],executablePath:async directory=>{suppliedDirectory=directory;return '/tmp/fixture-only-chromium';}}}),
 });
 assert.equal(browser,'explicit-test-browser');assert.equal(suppliedDirectory,resolve(process.cwd(),'node_modules/@sparticuz/chromium/bin'));
 assert.deepEqual(stages,['bundle-files','module-load','binary-extract','binary-launch']);assert.equal(bundle.readable,true);
 assert.equal(options.executablePath,'/tmp/fixture-only-chromium');assert.equal(options.headless,true);assert(!Object.hasOwn(options,'onStage'));assert(!Object.hasOwn(options,'onBundle'));
});
test('unreadable shipped binary is diagnosed before loading or launching Chromium',async()=>{
 const {inspectVercelBrowserBundle,launchVercelBrowser}=await import('../server/ads/vercel-runner.mjs');let clients=0;
 const bundle=await inspectVercelBrowserBundle({accessFile:async file=>{if(file.endsWith('chromium.br'))throw Error('fixture unreadable');}});
 assert.equal(bundle.readable,false);assert.equal(bundle.files.find(file=>file.name==='chromium.br').readable,false);
 await assert.rejects(launchVercelBrowser({}, {inspectBundle:async()=>bundle,loadClient:async()=>{clients++;},loadBinary:async()=>{clients++;}}),error=>error.code==='CHROMIUM_BUNDLE_MISSING');
 assert.equal(clients,0);
});
test('private smoke diagnostics preserve bounded library failure details and redact credentials',async()=>{
 const token='explicit-test-cron-token-for-redaction',key='S'+'A'.repeat(55);
 const error=Object.assign(new Error('Startup '+token+' key='+key+' Bearer another-token '+ 'x'.repeat(3000)+' missing libnspr4.so'),{code:'ENOENT',rendererSmokeStage:'binary-launch',rendererSmokeBundle:{directory:'untrusted-directory',files:[{name:'chromium.br',readable:false}],privateDump:'MUST_NOT_SERIALIZE'}});
 const handler=createVercelRunnerHandler({env:{CRON_SECRET:token},getRuntime:async()=>{throw Error('No runtime');},rendererSmoke:async()=>{throw error;}});
 const response=await request(handler,{url:'/api/ads-runner?check=renderer',authorization:'Bearer '+token}),serialized=JSON.stringify(response.body);
 assert.equal(response.status,503);assert.equal(response.body.stage,'binary-launch');assert.equal(response.body.error.code,'ENOENT');
 assert(response.body.error.message.length<=800);assert(response.body.error.message.includes('libnspr4.so'));
 assert(!serialized.includes(token));assert(!serialized.includes(key));assert(!serialized.includes('another-token'));assert(!serialized.includes('MUST_NOT_SERIALIZE'));assert(!serialized.includes('stack'));
 assert.equal(response.body.bundle.directory,'node_modules/@sparticuz/chromium/bin');
});
test('private probe failure reports its stage and closes resources on content failure',async()=>{
 const {state,browser,page}=smokeBrowser();page.setContent=async()=>{throw Object.assign(new Error('fixture content failed'),{code:'CONTENT_FAILED'});};
 const handler=createVercelRunnerHandler({env:{CRON_SECRET:'private'},getRuntime:async()=>{throw Error('No runtime');},rendererSmoke:()=>runRendererSmoke({launchBrowser:async()=>browser})});
 const response=await request(handler,{url:'/api/ads-runner?check=renderer',authorization:'Bearer private'});
 assert.equal(response.status,503);assert.equal(response.body.stage,'content');assert.equal(response.body.error.code,'CONTENT_FAILED');
 assert.equal(state.closed,1);assert.equal(state.browsersClosed,1);
});

test('private bundle check authenticates before filesystem,browser or database access',async()=>{
 let reads=0,runtime=0,browsers=0;
 const handler=createVercelRunnerHandler({env:{CRON_SECRET:'private'},getRuntime:async()=>{runtime++;throw Error('No runtime');},rendererSmoke:async()=>{browsers++;},bundleProbe:async()=>{reads++;return {directory:'ignored',files:['chromium.br','al2023.tar.br','fonts.tar.br','swiftshader.tar.br'].map(name=>({name,readable:true})),metadata:['browsers.json','package.json'].map(name=>({name,readable:true,valid:true}))};}});
 assert.equal((await request(handler,{url:'/api/ads-runner?check=bundle'})).status,401);assert.equal(reads,0);
 const result=await request(handler,{url:'/api/ads-runner?check=bundle',authorization:'Bearer private'});assert.equal(result.status,200);assert.equal(result.body.check,'bundle');assert.equal(result.body.ok,true);
 assert.equal(reads,1);assert.equal(runtime,0);assert.equal(browsers,0);
 for(const url of ['/api/ads-runner?check=bundle&path=/private','/api/ads-runner?check=bundle&check=bundle'])assert.equal((await request(handler,{url,authorization:'Bearer private'})).status,400);
 assert.equal(reads,1);
});
test('private bundle check exposes only the fixed relative file list and truthful readability',async()=>{
 const handler=createVercelRunnerHandler({env:{CRON_SECRET:'private'},getRuntime:async()=>{throw Error('No runtime');},bundleProbe:async()=>({directory:'/private/root',readable:true,files:[{name:'chromium.br',readable:true},{name:'arbitrary-private-name',readable:true}],privateValue:'MUST_NOT_SERIALIZE'})});
 const result=await request(handler,{url:'/api/ads-runner?check=bundle',authorization:'Bearer private'}),text=JSON.stringify(result.body);
 assert.equal(result.status,503);assert.equal(result.body.ok,false);assert.equal(result.body.readable,false);assert.equal(result.body.directory,'node_modules/@sparticuz/chromium/bin');assert.equal(result.body.files.length,4);
 assert(!text.includes('/private/root'));assert(!text.includes('arbitrary-private-name'));assert(!text.includes('MUST_NOT_SERIALIZE'));
});


test('browser bundle requires readable and valid pinned Playwright metadata before imports',async()=>{
 const {inspectVercelBrowserBundle,launchVercelBrowser}=await import('../server/ads/vercel-runner.mjs');
 let imports=0;
 for(const mode of ['missing','corrupt','wrong-version']){
  const bundle=await inspectVercelBrowserBundle({
   accessFile:async path=>{if(mode==='missing'&&path.endsWith('browsers.json'))throw Error('missing client metadata');},
   readJsonFile:async path=>path.endsWith('package.json')?JSON.stringify({name:'playwright-core',version:mode==='wrong-version'?'1.64.1':'1.63.0'}):mode==='corrupt'?'not json':JSON.stringify({browsers:[{name:'chromium',browserVersion:'153.0.8010.12'}]})
  });
  assert(bundle.files.every(file=>file.readable));assert.equal(bundle.readable,false);assert.equal(bundle.metadata.length,2);
  await assert.rejects(launchVercelBrowser({}, {inspectBundle:async()=>bundle,loadClient:async()=>{imports++;},loadBinary:async()=>{imports++;}}),error=>error.code==='CHROMIUM_BUNDLE_MISSING');
 }
 assert.equal(imports,0);
});

test('private bundle check fails when Playwright metadata is omitted despite readable Brotli assets',async()=>{
 const handler=createVercelRunnerHandler({env:{CRON_SECRET:'private'},getRuntime:async()=>{throw Error('No runtime');},bundleProbe:async()=>({files:['chromium.br','al2023.tar.br','fonts.tar.br','swiftshader.tar.br'].map(name=>({name,readable:true}))})});
 const response=await request(handler,{url:'/api/ads-runner?check=bundle',authorization:'Bearer private'});
 assert.equal(response.status,503);assert.equal(response.body.ok,false);assert.equal(response.body.files.length,4);assert.equal(response.body.metadata.length,2);
 assert.equal(response.body.clientDirectory,'node_modules/playwright-core-vercel');assert(response.body.metadata.every(file=>!file.readable&&!file.valid));
});
