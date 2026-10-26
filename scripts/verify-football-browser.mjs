/** Native browser/WebGL football QA using only local file-backed HTTP fixtures.
 * The diagnostic API and state callback exist only in routed module responses.
 * No production debug hooks, exports, network calls or payments are added.
 * Run after rebuilding the final GLB/layout. The author does not auto-run it.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const playwrightModule=process.env.VENUE_UI_PLAYWRIGHT_MODULE||'C:/Users/cabs_/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const {chromium}=require(playwrightModule);
const root=fileURLToPath(new URL('../',import.meta.url));
const directory=path.resolve(process.env.FOOTBALL_QA_DIST||path.join(root,'dist'));
const output=process.env.FOOTBALL_QA_DIR||path.join(root,'docs/render-review-2026-10-26/verification/football');
const executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'C:/Users/cabs_/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.glb':'model/gltf-binary','.gz':'application/octet-stream'};
const report={fixture:'Local file-backed HTTP; original viewer, interaction module and final GLB; instrumentation is route-only',playwrightModule,executable,hardwareRequired:process.env.FOOTBALL_REQUIRE_HARDWARE_GPU!=='0',checks:[],contexts:[]};
fs.mkdirSync(output,{recursive:true});

const shim=String.raw`
function createFootballInteraction(owner,options={}){
 const original=qaCreateFootballInteraction(owner,{...options,onState(event){
  (globalThis.__footballEvents??=[]).push({at:performance.now(),...event});
  options.onState?.(event);
 }});
 return new Proxy(original,{get(target,key){
  if(key==='kick')return(...args)=>{const accepted=target.kick(...args);(globalThis.__footballAttempts??=[]).push({at:performance.now(),accepted});return accepted;};
  return Reflect.get(target,key,target);
 }});
}
let qaBall,qaNets=[],qaNetHome=[],qaBallHome,qaSamples=[],qaRecording=false;
function qaLocateFootball(){
 if(!model||!THREE)return false;
 model.updateMatrixWorld(true);qaBall=null;qaNets=[];
 model.traverse(object=>{if(object.userData?.interactionRole==='football'&&!qaBall)qaBall=object;if(object.userData?.interactionRole==='goal-net')qaNets.push(object);});
 if(!qaBall||!qaNets.length)return false;
 qaBallHome=qaBall.getWorldPosition(new THREE.Vector3()).toArray();
 qaNetHome=qaNets.map(object=>object.matrixWorld.toArray());return true;
}
function qaBallPoint(){
 if(!qaBall||!camera||!renderer)return null;
 model.updateMatrixWorld(true);camera.updateMatrixWorld(true);
 const world=qaBall.getWorldPosition(new THREE.Vector3()),ndc=world.clone().project(camera),rect=canvas.getBoundingClientRect();
 const x=rect.left+(ndc.x+1)*rect.width/2,y=rect.top+(1-ndc.y)*rect.height/2;
 const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(ndc.x,ndc.y),camera);
 const hit=ray.intersectObjects(model.children,true)[0];
 return{x,y,ndc:ndc.toArray(),world:world.toArray(),rayHitsBall:!!hit&&!!football?.isBall(hit.object),hitName:hit?.object?.name??null};
}
function qaFootballSummary({withProjection=true}={}){
 model?.updateMatrixWorld(true);
 const gl=renderer?.getContext(),extension=gl?.getExtension('WEBGL_debug_renderer_info');
 const ball=qaBall?.getWorldPosition(new THREE.Vector3()).toArray()??null;
 let netDelta=0;
 qaNets.forEach((object,i)=>object.matrixWorld.elements.forEach((value,j)=>{netDelta=Math.max(netDelta,Math.abs(value-(qaNetHome[i]?.[j]??value)));}));
 const button=document.getElementById('kickFootball');
 return{ready:venueLoading.state.phase,active,mode,pose:{...pose},available:!!football?.available,busy:!!football?.busy,state:globalThis.__footballEvents?.at(-1)?.state??'ready',
  ball,ballHome:qaBallHome,netDelta,netActors:qaNets.length,point:withProjection?qaBallPoint():null,events:(globalThis.__footballEvents??[]).slice(),attempts:(globalThis.__footballAttempts??[]).slice(),
  button:button?{hidden:button.hidden,disabled:button.disabled,text:button.textContent}:null,
  gpu:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl?.getParameter(gl.RENDERER),
  render:renderer?{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles}:null};
}
function qaSelectZone(id,{aimBall=false,reset=false}={}){
 if(reset)football?.reset();const zone=layout.zones.find(zone=>zone.id===id);if(!zone)throw Error('Missing zone '+id);
 pose={...pose,...zone.view,pitch:zone.view.pitch??0};chooseMode('walk');setPose();
 if(aimBall&&qaBall){
  const point=qaBall.getWorldPosition(new THREE.Vector3()),dx=point.x-camera.position.x,dz=point.z-camera.position.z;
  pose={...pose,yaw:Math.atan2(-dx,-dz),pitch:Math.atan2(point.y-camera.position.y,Math.hypot(dx,dz))};setPose();
 }
}
function qaSampleFrame(){
 if(!qaRecording)return;
 const state=qaFootballSummary({withProjection:false});qaSamples.push({at:performance.now(),busy:state.busy,state:state.state,ball:state.ball,netDelta:state.netDelta});
 requestAnimationFrame(qaSampleFrame);
}
globalThis.__footballQA={
 summary:qaFootballSummary,locate:qaLocateFootball,select:qaSelectZone,
 attemptKick(){return football?.kick()??false;},
 beginTrace(){qaSamples=[];qaRecording=true;requestAnimationFrame(qaSampleFrame);},
 endTrace(){qaRecording=false;return qaSamples.slice();},
 leave(){leave();},
 review(){updateReview(performance.now());}
};
`;

const distance=(a,b)=>a&&b?Math.hypot(...a.map((n,i)=>n-b[i])):Infinity;
const summary=page=>page.evaluate(()=>window.__footballQA.summary());
async function frames(page,count=3){await page.evaluate(count=>new Promise(resolve=>{const next=()=>--count<=0?resolve():requestAnimationFrame(next);requestAnimationFrame(next);}),count);}
async function snapshot(page,label){const file=label+'.jpg';await page.screenshot({path:path.join(output,file),type:'jpeg',quality:88});return file;}
async function selectEnergy(page){await page.evaluate(()=>window.__footballQA.select('energy',{aimBall:true,reset:true}));await frames(page);await page.waitForFunction(()=>{const s=window.__footballQA.summary();return s.available&&!s.busy&&!s.button?.hidden;},null,{timeout:3000});}
async function waitReady(page,timeout=4500){await page.waitForFunction(()=>{const s=window.__footballQA.summary();return !s.busy&&s.state==='ready';},null,{timeout});}
async function ballPoint(page){const state=await summary(page),point=state.point;assert.ok(point&&point.ndc[2]>-1&&point.ndc[2]<1,'Football is outside camera clipping planes');assert.ok(Math.abs(point.ndc[0])<.98&&Math.abs(point.ndc[1])<.98,'Football is outside the viewport');assert.equal(point.rayHitsBall,true,`Ball center ray hit ${point.hitName}`);return point;}
async function acceptedAttempts(page){return(await summary(page)).attempts.filter(attempt=>attempt.accepted).length;}
async function check(name,fn){try{const details=await fn();report.checks.push({name,pass:true,...(details?{details}:{})});console.log(JSON.stringify({check:name,pass:true}));}catch(error){report.checks.push({name,pass:false,error:error.message});console.log(JSON.stringify({check:name,pass:false,error:error.message}));}}

let browser;
try{
 assert.ok(fs.existsSync(path.join(directory,'football.mjs')),'Rebuild/finish football.mjs before running this QA');
 assert.ok(fs.existsSync(path.join(directory,'assets/one16.glb')),'Missing final venue GLB');
 browser=await chromium.launch({headless:true,executablePath:executable,args:['--enable-webgl','--ignore-gpu-blocklist',...(process.env.VENUE_QA_SOFTWARE_GPU?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:(process.platform==='win32'?['--use-angle=d3d11','--use-gl=angle','--enable-gpu','--disable-software-rasterizer']:[]))]});
 for(const reducedMotion of ['no-preference','reduce']){
  const label=reducedMotion==='reduce'?'reduced-motion':'normal';
  const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,hasTouch:true,reducedMotion});
  const page=await context.newPage(),errors=[],missing=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='one16.test')return route.fulfill({status:404,body:'External network disabled in football QA'});
   if(url.pathname==='/api/wallet/config')return route.fulfill({contentType:'application/json',body:JSON.stringify({enabled:false,network:'testnet',reason:'Local football interaction verification'})});
   const relative=decodeURIComponent(url.pathname).replace(/^\/+/,'')||'index.html',target=path.resolve(directory,relative);
   if(!target.startsWith(directory+path.sep))return route.fulfill({status:403,body:'Forbidden'});
   if(!fs.existsSync(target)||!fs.statSync(target).isFile()){missing.push(relative);return route.fulfill({status:404,body:'Not found'});}
   let body=fs.readFileSync(target);
   if(relative==='viewer.js'){
    const source=body.toString('utf8'),factory=/import\s*\{\s*createFootballInteraction\s*\}/;
    if(!factory.test(source))throw Error('QA factory import shim no longer matches viewer.js');
    body=Buffer.from(source.replace(factory,'import { createFootballInteraction as qaCreateFootballInteraction }')+'\n'+shim);
   }
   await route.fulfill({status:200,contentType:mime[path.extname(target)]||'application/octet-stream',body});
  });
  await page.goto('http://one16.test/?lang=es',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__footballQA?.summary().ready==='ready',null,{timeout:90000});
  assert.equal(await page.evaluate(()=>window.__footballQA.locate()),true,'Final GLB lacks independent football / goal-net actors');
  await selectEnergy(page);
  const initial=await summary(page);
  const hardware=!!initial.gpu&&!/swiftshader|llvmpipe|software rasterizer/i.test(initial.gpu);
  report.contexts.push({label,reducedMotion,gpu:initial.gpu,hardwareAccelerated:hardware,initial});
  if(report.hardwareRequired)assert.ok(hardware,`Hardware GPU required; detected ${initial.gpu}`);
  if(label==='normal'){
   const layouts=[];
   for(const [width,height] of [[320,568],[390,844],[844,390],[1440,900]]){
    await check(`Energy action layout ${width}x${height}`,async()=>{
     await page.setViewportSize({width,height});await selectEnergy(page);
     const audit=await page.evaluate(()=>{
      const visible=element=>{if(!element)return false;const css=getComputedStyle(element),r=element.getBoundingClientRect();return !element.hidden&&css.display!=='none'&&css.visibility!=='hidden'&&r.width>0&&r.height>0;};
      const box=(selector)=>{const element=document.querySelector(selector);if(!visible(element))return null;const r=element.getBoundingClientRect();return{selector,x:r.x,y:r.y,w:r.width,h:r.height};};
      const button=box('#kickFootball'),blockers=['#venueHud','#walkMinimap','.touch-controls'].map(box).filter(Boolean);
      const overlap=(a,b)=>a.x<b.x+b.w-.5&&a.x+a.w>b.x+.5&&a.y<b.y+b.h-.5&&a.y+a.h>b.y+.5;
      return{viewport:{width:innerWidth,height:innerHeight},button,blockers,overlaps:button?blockers.filter(b=>overlap(button,b)):[]};
     });
     layouts.push(audit);await snapshot(page,`energy-action-${width}x${height}`);
     assert.ok(audit.button,'Patear pelota action is hidden');assert.ok(audit.button.w>=44&&audit.button.h>=44,'Action is smaller than 44px');
     assert.ok(audit.button.x>=0&&audit.button.y>=0&&audit.button.x+audit.button.w<=width+.5&&audit.button.y+audit.button.h<=height+.5,'Action extends outside viewport');
     assert.deepEqual(audit.overlaps,[],'Action overlaps HUD, minimap or joystick');return audit;
    });
   }
   fs.writeFileSync(path.join(output,'football-layout.json'),JSON.stringify(layouts,null,2));
   await page.setViewportSize({width:1440,height:900});await selectEnergy(page);
   await check('Native mouse kick moves ball, rejects busy retry, recoils net and resets',async()=>{
    await selectEnergy(page);const before=await summary(page);await snapshot(page,'normal-before');
    await page.evaluate(()=>window.__footballQA.beginTrace());const point=await ballPoint(page);await page.mouse.click(point.x,point.y);
    await page.waitForFunction(()=>window.__footballQA.summary().busy,null,{timeout:1200});
    assert.equal(await page.locator('#kickFootball').isDisabled(),true);
    assert.equal(await page.evaluate(()=>window.__footballQA.attemptKick()),false,'Busy controller accepted a second kick');
    await page.waitForFunction(()=>{const s=window.__footballQA.summary();return s.netDelta>.02;},null,{timeout:2200,polling:'raf'});
    const impact=await summary(page);await snapshot(page,'normal-impact');
    assert.ok(distance(impact.ball,before.ball)>.25,'Ball did not travel toward goal');assert.ok(impact.netDelta>.01,'Goal net did not recoil');
    await waitReady(page);const after=await summary(page),samples=await page.evaluate(()=>window.__footballQA.endTrace());
    assert.ok(distance(after.ball,after.ballHome)<1e-6,'Ball did not return home');assert.ok(after.netDelta<1e-6,'Goal net did not reset');
    assert.ok(samples.some(s=>s.state==='goal'),'Goal phase was not observed');return{before,impact,after,samples};
   });
   await check('Dragging more than eight pixels does not kick',async()=>{
    await selectEnergy(page);const count=await acceptedAttempts(page),p=await ballPoint(page);
    await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+30,p.y,{steps:4});await page.mouse.up();await frames(page);
    assert.equal(await acceptedAttempts(page),count);assert.equal((await summary(page)).busy,false);
   });
   await check('A drag away and back to its origin still does not kick',async()=>{
    await selectEnergy(page);const count=await acceptedAttempts(page),p=await ballPoint(page);
    await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+30,p.y,{steps:3});await page.mouse.move(p.x,p.y,{steps:3});await page.mouse.up();await frames(page);
    assert.equal(await acceptedAttempts(page),count);assert.equal((await summary(page)).busy,false);
   });
   await check('A native two-finger touch gesture does not kick',async()=>{
    await selectEnergy(page);const count=await acceptedAttempts(page),p=await ballPoint(page),session=await context.newCDPSession(page);
    const points=[{x:p.x,y:p.y,id:11,radiusX:2,radiusY:2},{x:p.x+26,y:p.y,id:12,radiusX:2,radiusY:2}];
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await frames(page);await session.detach();
    assert.equal(await acceptedAttempts(page),count);assert.equal((await summary(page)).busy,false);
   });
   await check('A native single touch kicks the projected football',async()=>{
    await selectEnergy(page);const count=await acceptedAttempts(page),p=await ballPoint(page);await page.touchscreen.tap(p.x,p.y);
    await page.waitForFunction(()=>window.__footballQA.summary().busy,null,{timeout:1200});assert.equal(await acceptedAttempts(page),count+1);await waitReady(page);
   });
   await check('Patear pelota supports keyboard Enter',async()=>{
    await selectEnergy(page);const count=await acceptedAttempts(page);await page.locator('#kickFootball').focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.__footballQA.summary().busy,null,{timeout:1200});assert.equal(await acceptedAttempts(page),count+1);await waitReady(page);
   });
   await check('Leaving Energy Corner resets an in-progress kick',async()=>{
    await selectEnergy(page);await page.locator('#kickFootball').focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.__footballQA.summary().busy,null,{timeout:1200});await page.evaluate(()=>window.__footballQA.select('buffet'));await frames(page);
    const state=await summary(page);assert.equal(state.busy,false);assert.ok(distance(state.ball,state.ballHome)<1e-6);assert.ok(state.netDelta<1e-6);assert.equal(state.button.hidden,true);return state;
   });
   await check('Leaving the viewer resets an in-progress kick',async()=>{
    await selectEnergy(page);await page.locator('#kickFootball').focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.__footballQA.summary().busy,null,{timeout:1200});await page.evaluate(()=>window.__footballQA.leave());
    const state=await summary(page);assert.equal(state.active,false);assert.equal(state.busy,false);assert.ok(distance(state.ball,state.ballHome)<1e-6);assert.ok(state.netDelta<1e-6);assert.equal(state.button.hidden,true);return state;
   });
  }else{
   await check('Reduced motion uses a short, quiet goal state and returns home',async()=>{
    await selectEnergy(page);await snapshot(page,'reduced-before');await page.evaluate(()=>window.__footballQA.beginTrace());
    const count=await acceptedAttempts(page),point=await ballPoint(page),started=Date.now();await page.mouse.click(point.x,point.y);
    await page.waitForFunction(()=>window.__footballQA.summary().busy,null,{timeout:800});await snapshot(page,'reduced-impact');
    await waitReady(page,1800);const elapsedMs=Date.now()-started,samples=await page.evaluate(()=>window.__footballQA.endTrace()),state=await summary(page);
    assert.equal(await acceptedAttempts(page),count+1);assert.ok(elapsedMs<1800,'Reduced-motion action took too long');
    assert.ok(samples.every(s=>s.netDelta<1e-6),'Reduced-motion net still animates');assert.ok(distance(state.ball,state.ballHome)<1e-6);return{elapsedMs,state,samples};
   });
  }
  await check(`${label} viewer has no page errors or missing local modules`,async()=>{assert.deepEqual(errors,[]);assert.deepEqual([...new Set(missing)].filter(file=>file!=='favicon.ico'),[]);return{errors,missing:[...new Set(missing)]};});
  await context.close();
 }
}catch(error){report.fatal={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 if(browser)await browser.close();report.pass=!report.fatal&&report.checks.every(check=>check.pass);if(!report.pass)process.exitCode=1;
 fs.writeFileSync(path.join(output,'football-browser.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,failed:report.checks.filter(check=>!check.pass).map(check=>check.name),fatal:report.fatal?.message,output}));
}
