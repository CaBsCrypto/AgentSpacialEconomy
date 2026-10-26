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
"let qaEye;const qaSetPose=setPose;setPose=(...a)=>{qaSetPose(...a);if(Number.isFinite(qaEye))camera.position.y=qaEye;};globalThis.__venueQA={summary(){const gl=renderer?.getContext();const dbg=gl?.getExtension('WEBGL_debug_renderer_info');let meshes=0;model?.traverse(o=>{if(o.isMesh)meshes++});return{mode,pose:{...pose},ready:venueLoading.state.phase,zones:layout?.zones.map(z=>({id:z.id,view:z.view,label:z.label})),exhibition:layout?.exhibition,render:renderer?{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,memory:{...renderer.info.memory},pixelRatio:renderer.getPixelRatio(),gpu:dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):gl?.getParameter(gl.RENDERER)}:null,meshes};},view(p){qaEye=p.eye;pose={...pose,...p};chooseMode('walk');setPose();},select(id){const z=layout.zones.find(z=>z.id===id);if(!z)throw Error('Missing zone '+id);qaEye=undefined;pose={...pose,...z.view,pitch:z.view.pitch??0};chooseMode('walk');setPose();},mode(next){chooseMode(next);},review(){if(typeof reviewEnabled!=='undefined')reviewEnabled=false;updateReview(performance.now());}};";
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.glb':'model/gltf-binary','.gz':'application/octet-stream'};
const viewpoints=[
 ['arrival',{x:0,z:4,yaw:0,pitch:-.12}],
 ['lower-lounge-left',{x:-1,z:3.5,yaw:1.4,pitch:-.13}],
 ['lower-lounge-right',{x:1,z:3.5,yaw:-1.4,pitch:-.13}],
 ['checkin',{x:0,z:-2.6,yaw:0,pitch:.12}],
 ['checkin-close',{x:0,z:-4.6,yaw:0,pitch:0}],
 ['buffet',{zone:'buffet'}],
 ['lower-lounge-rail',{x:0,z:4.8,yaw:0,pitch:-.1}],
 ['keyboard',{x:-9.0,z:-8.0,yaw:.90,pitch:-.11}],
 ['arcade',{x:-9.2,z:-15.5,yaw:1.05,pitch:-.16}],
 ['arcade-above',{x:-12.1,z:-17.25,yaw:0,pitch:-Math.PI/2,eye:3.2}],
 ['skills',{x:4.7,z:-7.1,yaw:-.4,pitch:-.08}],
 ['skills-close',{x:5.8,z:-7.8,yaw:0,pitch:-.13}],
 ['stands',{x:0,z:-25.3,yaw:0,pitch:-.12}],
 ['stand-reverse',{x:0,z:-30.2,yaw:Math.PI,pitch:-.12}],
 ['energy',{x:11,z:-28.5,yaw:-Math.PI/2,pitch:-.35}],
 ['photobooth',{x:10,z:-34,yaw:-Math.PI/2,pitch:.02}],
 ['content-hub',{zone:'content-hub'}],
 ['content-hub-lights',{x:8,z:-14.75,yaw:-Math.PI/2,pitch:.50}],
 ['activation',{zone:'activation'}],
 ['central-seating-13',{x:0,z:-15,yaw:0,pitch:-.12}],
 ['hack-seating',{x:-6,z:-18.1,yaw:.75,pitch:-.10}],
 ['removed-curtain',{x:-8,z:-30.5,yaw:-Math.PI/2,pitch:-.02}],
 ['palta-table',{x:-2.6,z:-29.2,yaw:.84,pitch:-.10}],
 ['passport-display',{zone:'passport'}],
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
  const standViews=(start.exhibition?.positions??[]).map((p,i)=>{const x=p.side==='left'?-1.1:1.1,z=p.table.z+(p.face==='stage'?-1:1),dx=p.table.x-x,dz=p.table.z-z;return ['table-'+(i+1)+'-'+p.graphic,{x,z,yaw:Math.atan2(-dx,-dz),pitch:-Math.atan2(.857,Math.hypot(dx,dz))}];});
  const headerViews=(start.exhibition?.positions??[]).map((position,index)=>{
    const x=position.side==='left'?-1.1:1.1,z=position.table.z+(position.face==='stage'?-1:1),tx=position.graphic==='booth-passport'?3.5:position.table.x;
    const tz=-(position.row===1?27.8:32),dx=tx-x,dz=tz-z;
    return ['header-'+(index+1)+'-'+position.graphic,{x,z,yaw:Math.atan2(-dx,-dz),pitch:Math.atan2(2.4-1.65,Math.hypot(dx,dz))}];
  });
  for(const [label,pose] of (process.env.VENUE_QA_MOBILE_ONLY?[]:[...viewpoints,...standViews,...headerViews])){
   await page.evaluate(p=>p.zone?window.__venueQA.select(p.zone):window.__venueQA.view(p),pose);
   await page.waitForTimeout(label==='palta-table'?3000:150);
   await page.screenshot({path:path.join(output,name+'-'+label+'.jpg'),type:'jpeg',quality:86});
   const stats=await page.evaluate(async()=>{
    const times=[];let last=performance.now();
    await new Promise(resolve=>{let n=0;const tick=now=>{if(n++>0)times.push(now-last);last=now;if(n<45)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});
    times.sort((a,b)=>a-b);return{...window.__venueQA.summary(),frameMedianMs:times[Math.floor(times.length*.5)],frameP95Ms:times[Math.floor(times.length*.95)]};
   });
   frames.push({label,...stats});
  }
  if(name==='after'){
   if(!process.env.VENUE_QA_MOBILE_ONLY){
   await page.evaluate(()=>{window.__venueQA.view({x:0,z:4,yaw:0,pitch:0});window.__venueQA.review(true);});
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
   await page.setViewportSize({width:390,height:844});
   await page.evaluate(()=>window.__venueQA.review(false));
   for(const id of ['arrival','buffet','skills','games','content-hub','energy','photo','cafe','stands','passport','passport-stand16']){
    await page.evaluate(id=>window.__venueQA.select(id),id);
    await page.waitForTimeout(120);
    await page.screenshot({path:path.join(output,'after-mobile-zone-'+id+'.jpg'),type:'jpeg',quality:86});
   }
  }
  const report={name,fixture:'File-backed HTTP responses; original application modules and GLB; no external network',start,errors,missingLocalFiles:[...new Set(misses)],requests,frames};
  reports.push(report);
  fs.writeFileSync(path.join(output,name+'-render.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({name,firstFrameMs:start.firstFrameMs,gpu:start.render?.gpu,meshes:start.meshes,textures:start.render?.memory.textures,errors,missing:report.missingLocalFiles,medianFrameMs:frames.map(f=>({label:f.label,median:f.frameMedianMs,p95:f.frameP95Ms}))}));
  await context.close();
 }
 const beforeFile=path.join(output,'before-render.json');
 const complete=reports.some(r=>r.name==='before')||!fs.existsSync(beforeFile)?reports:[JSON.parse(fs.readFileSync(beforeFile,'utf8')),...reports];
 fs.writeFileSync(path.join(output,'render-comparison.json'),JSON.stringify(complete,null,2));
}finally{await browser.close();}
