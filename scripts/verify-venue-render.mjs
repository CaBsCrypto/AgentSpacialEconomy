/** Actual viewer/Three/WebGL QA against local file-backed HTTP fixtures.
 * No production debug API: instrumentation is appended only to routed JS.
 * VENUE_UI_PLAYWRIGHT_MODULE and PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH are optional.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.VENUE_UI_PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const baseline=process.env.VENUE_BASELINE_DIST;
const output=process.env.VENUE_RENDER_QA_DIR||path.join(root,'docs/render-review-2026-10-26/verification');
fs.mkdirSync(output,{recursive:true});
const shim=
"globalThis.__venueQA={summary(){const gl=renderer?.getContext();const dbg=gl?.getExtension('WEBGL_debug_renderer_info');let meshes=0;model?.traverse(o=>{if(o.isMesh)meshes++});return{mode,pose:{...pose},ready:venueLoading.state.phase,zones:layout?.zones.map(z=>({id:z.id,view:z.view,label:z.label})),render:renderer?{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,memory:{...renderer.info.memory},pixelRatio:renderer.getPixelRatio(),gpu:dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):gl?.getParameter(gl.RENDERER)}:null,meshes};},view(p){pose={...pose,...p};chooseMode('walk');setPose();},select(id){const z=layout.zones.find(z=>z.id===id);if(!z)throw Error('Missing zone '+id);pose={...pose,...z.view,pitch:0};chooseMode('walk');setPose();},mode(next){chooseMode(next);},review(enabled){reviewEnabled=enabled;updateReview(performance.now());}};";
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.glb':'model/gltf-binary','.gz':'application/octet-stream'};
const viewpoints=[
 ['arrival',{x:0,z:4,yaw:0,pitch:-.12}],
 ['lower-lounge-left',{x:-1,z:3.5,yaw:1.4,pitch:-.13}],
 ['lower-lounge-right',{x:1,z:3.5,yaw:-1.4,pitch:-.13}],
 ['checkin',{x:0,z:-2.6,yaw:0,pitch:.12}],
 ['keyboard',{x:-9.0,z:-8.0,yaw:.90,pitch:-.11}],
 ['arcade',{x:-9.2,z:-15.5,yaw:1.05,pitch:-.16}],
 ['skills',{x:4.7,z:-7.1,yaw:-.4,pitch:-.08}],
 ['stands',{x:0,z:-25.3,yaw:0,pitch:-.12}],
 ['stand-reverse',{x:0,z:-30.2,yaw:Math.PI,pitch:-.12}],
 ['energy',{x:11,z:-28.5,yaw:-Math.PI/2,pitch:-.06}],
 ['photobooth',{x:10,z:-34,yaw:-Math.PI/2,pitch:.02}],
 ['content-hub',{x:11.6,z:-14,yaw:-.25,pitch:-.02}],
 ['stage',{x:0,z:-39,yaw:0,pitch:.04}],
 ['photocall',{x:10,z:-38,yaw:0,pitch:-.04}]
];
const reports=[];
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),args:['--enable-webgl','--ignore-gpu-blocklist',...(process.env.VENUE_QA_SOFTWARE_GPU?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:(process.platform==='win32'?['--use-angle=d3d11','--use-gl=angle','--enable-gpu','--disable-software-rasterizer']:[]))]});
try{
 for(const [name,directory] of (process.env.VENUE_QA_BASELINE_ONLY?[['before',baseline]]:[...(baseline?[['before',baseline]]:[]),['after',path.join(root,'dist')]])){
  const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,reducedMotion:'reduce'});
  const page=await context.newPage();const errors=[],misses=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{window.__venueStart=performance.now();document.addEventListener('one16-ready',()=>window.__venueReady=performance.now(),{once:true});});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='one16.test')return route.fulfill({status:404,body:'External network disabled in local QA'});
   if(url.pathname==='/api/wallet/config')return route.fulfill({contentType:'application/json',body:JSON.stringify({enabled:false,network:'testnet',reason:'Local rendering verification'})});
   let relative=decodeURIComponent(url.pathname).replace(/^\/+/,'')||'index.html';
   const target=path.resolve(directory,relative);
   if(!target.startsWith(path.resolve(directory)+path.sep))return route.fulfill({status:403,body:'Forbidden'});
   if(!fs.existsSync(target)||!fs.statSync(target).isFile()){misses.push(relative);return route.fulfill({status:404,body:'Not found'});}
   let body=fs.readFileSync(target);requests.push({path:relative,bytes:body.length});
   if(relative==='viewer.js')body=Buffer.from(body.toString('utf8')+'\n'+shim);
   await route.fulfill({status:200,contentType:mime[path.extname(target)]||'application/octet-stream',body});
  });
  await page.goto('http://one16.test/?lang=es',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__venueQA?.summary().ready==='ready',{timeout:90000});
  await page.waitForTimeout(350);
  const start=await page.evaluate(()=>({firstFrameMs:window.__venueReady-window.__venueStart,...window.__venueQA.summary()}));
  await page.evaluate(()=>window.__venueQA.review(false));
  const frames=[];
  for(const [label,pose] of viewpoints){
   await page.evaluate(p=>window.__venueQA.view(p),pose);
   await page.waitForTimeout(150);
   await page.screenshot({path:path.join(output,name+'-'+label+'.jpg'),type:'jpeg',quality:86});
   const stats=await page.evaluate(async()=>{
    const times=[];let last=performance.now();
    await new Promise(resolve=>{let n=0;const tick=now=>{if(n++>0)times.push(now-last);last=now;if(n<45)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});
    times.sort((a,b)=>a-b);return{...window.__venueQA.summary(),frameMedianMs:times[Math.floor(times.length*.5)],frameP95Ms:times[Math.floor(times.length*.95)]};
   });
   frames.push({label,...stats});
  }
  if(name==='after'){
   await page.evaluate(()=>window.__venueQA.review(true));
   await page.evaluate(()=>window.__venueQA.mode('overview'));
   await page.screenshot({path:path.join(output,'after-overview.jpg'),type:'jpeg',quality:86});
   for(const [w,h] of [[320,568],[390,844],[844,390],[1440,900]]){
    await page.setViewportSize({width:w,height:h});
    await page.evaluate(()=>window.__venueQA.mode('walk'));
    await page.waitForTimeout(100);
    await page.screenshot({path:path.join(output,'after-ui-'+w+'x'+h+'.jpg'),type:'jpeg',quality:86});
    await page.locator('#toggleZones').click();
    await page.screenshot({path:path.join(output,'after-places-'+w+'x'+h+'.jpg'),type:'jpeg',quality:86});
    await page.locator('#closePlaces').click();
   }
  }
  const report={name,fixture:'File-backed HTTP responses; original application modules and GLB; no external network',start,errors,missingLocalFiles:[...new Set(misses)],requests,frames};
  reports.push(report);
  fs.writeFileSync(path.join(output,name+'-render.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({name,firstFrameMs:start.firstFrameMs,gpu:start.render?.gpu,meshes:start.meshes,textures:start.render?.memory.textures,errors,missing:report.missingLocalFiles,medianFrameMs:frames.map(f=>({label:f.label,median:f.frameMedianMs,p95:f.frameP95Ms}))}));
  await context.close();
 }
 fs.writeFileSync(path.join(output,'render-comparison.json'),JSON.stringify(reports,null,2));
}finally{await browser.close();}
