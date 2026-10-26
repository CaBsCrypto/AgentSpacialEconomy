/** GPU browser QA of the real venue/panel/tour and Passport iframe.
 * All production files stay unchanged. Only HTTP-routed JS receives lexical QA
 * hooks and a restored-wallet provider fixture; signing and POST are forbidden.
 * GUIDED_TOUR_QA_MAP_ONLY=1 limits the run to unlock + four plan viewports,
 * with a separate default map/ output. Run serially after final dist is ready.
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
const directory=path.resolve(process.env.GUIDED_TOUR_QA_DIST||path.join(root,'dist'));
const mapOnly=process.env.GUIDED_TOUR_QA_MAP_ONLY==='1';
const output=process.env.GUIDED_TOUR_QA_DIR||path.join(root,'docs/render-review-2026-10-26/final-guided-tour',mapOnly?'map':'flow');
const executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'C:/Users/cabs_/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.glb':'model/gltf-binary','.gz':'application/octet-stream'};
const report={mode:mapOnly?'map-only':'full-flow',fixture:'Original local dist + route-only lexical instrumentation. Real wallet controller and panel; restored provider fixture, no signing or POST. Real GPU Passport iframe first frame is delayed, never fabricated.',hardwareRequired:process.env.GUIDED_TOUR_REQUIRE_HARDWARE_GPU!=='0',playwrightModule,executable,checks:[],contexts:[]};

const walletFixture=String.raw`
import {createWalletController as realController,TESTNET_PASSPHRASE} from './wallet-controller.mjs';
const fixture={mode:'funded',reads:0,restores:0,signatures:0,requests:[]};
const address='C'+'A'.repeat(55);
const reply=body=>({ok:true,status:200,json:async()=>body});
export function createWalletController(){
 const controller=realController({pollAttempts:0,sleep:async()=>{},
  fetcher:async(url,options={})=>{
   const method=options.method||'GET';fixture.requests.push({url,method});
   if(method!=='GET')throw Error('Guided tour QA forbids wallet POST');
   if(url==='/api/wallet/config')return reply({enabled:true,configured:true,networkPassphrase:TESTNET_PASSPHRASE,configFingerprint:'guided-tour-gpu-fixture-v1',origin:location.origin,rpId:location.hostname});
   if(url==='/api/wallet/faucet')return reply({available:true});
   if(url.startsWith('/api/wallet/faucet?address='))return reply({state:fixture.mode==='pending'?'pending':'none'});
   throw Error('Unexpected fixture request '+url);
  },loadProvider:async()=>({
   restore:async()=>{fixture.restores++;return{address};},
   create(){fixture.signatures++;throw Error('QA forbids passkey creation');},
   connect(){fixture.signatures++;throw Error('QA forbids passkey authentication');},
   async readWallet(){fixture.reads++;if(fixture.mode==='error')throw Error('QA temporary RPC error');return{deployed:true,balanceUnits:fixture.mode==='funded'?'1000000000':'0'};}
  })});
 fixture.controller=controller;
 fixture.setMode=async mode=>{if(!['funded','zero','pending','error'].includes(mode))throw Error('Invalid fixture mode');fixture.mode=mode;return controller.refresh();};
 fixture.summary=()=>({mode:fixture.mode,reads:fixture.reads,restores:fixture.restores,signatures:fixture.signatures,requests:fixture.requests.slice(),state:controller.state});
 globalThis.__qaWalletFixture=fixture;return controller;
}
`;
const passportShim=String.raw`
let qaPassportHold=true,qaPassportPending=null,qaPassportFirstFrames=0;
const qaTellParent=tellParent;
tellParent=data=>{
 if(data?.type==='passport-first-frame'){
  qaPassportFirstFrames++;
  if(qaPassportHold){qaPassportPending=data;return;}
 }
 qaTellParent(data);
};
globalThis.__passportTourQA={
 summary(){return{firstFrames:qaPassportFirstFrames,held:!!qaPassportPending,mode,hasView:!!view,calls:view?.renderer?.info.render.calls??0,canvasCount:document.querySelectorAll('canvas').length};},
 release(){qaPassportHold=false;if(qaPassportPending){const event=qaPassportPending;qaPassportPending=null;qaTellParent(event);return true;}return false;}
};
`;
const viewerShim=String.raw`
function qaTourSummary(){
 const gl=renderer?.getContext(),extension=gl?.getExtension('WEBGL_debug_renderer_info');
 return{ready:venueLoading.state.phase,active,mode,pose:{...pose},sceneId:scene?.uuid,tour:guidedTour.state,wallet:walletExperience.state,
  gpu:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl?.getParameter(gl.RENDERER),
  routes:(activationGuide?.routes??[]).map(route=>({id:route.root.userData.routeId,points:route.points.length,dimmed:route.root.userData.dimmed})),
  routeVisible:!!activationGuide?.root.visible,pointCount:activationGuide?.points.length??0,paltaOpen:palta?.isOpen??false,paltaReady:!!palta,
  mapRoutes:[...document.querySelectorAll('#miniMapImage [data-guidance-route]')].map(node=>({id:node.dataset.guidanceRoute,visited:node.dataset.routeVisited})),
  numericMapText:[...document.querySelectorAll('#miniMapImage svg text,#plan svg text,.static-map svg text')].filter(node=>/^\s*\d+\s*$/.test(node.textContent)).map(node=>node.textContent),
  numericFloorGroups:scene?[...scene.children].filter(node=>/floor.*(?:numbers|review)|walk.*numbers/i.test(node.name)).length:0,
  text:tourText.textContent,fixture:globalThis.__qaWalletFixture?.summary()};
}
function qaTourView(point){clearInput();pose={...pose,...point,pitch:point.pitch??0};chooseMode('walk');setPose();}
function qaCompany(id){
 const branch=layout.companyRoutes?.branches?.find(branch=>branch.id===id);
 const point=branch?.approach||(id==='passport'?layout.passportDisplay?.approach:null);
 if(!point)throw Error('Missing company approach '+id);
 qaTourView(point);
 if(id==='palta'&&palta){
  const center=new THREE.Box3().setFromObject(palta.root).getCenter(new THREE.Vector3());
  const dx=center.x-camera.position.x,dz=center.z-camera.position.z;
  pose={...pose,yaw:Math.atan2(-dx,-dz),pitch:Math.atan2(center.y-camera.position.y,Math.hypot(dx,dz))};setPose();
 }
}
function qaObjectPoint(kind){
 const box=new THREE.Box3();
 if(kind==='palta'&&palta)box.setFromObject(palta.root);
 else if(kind==='totem')model?.traverse(object=>{if(object.isMesh&&isActivationObject(object))box.expandByObject(object);});
 if(box.isEmpty())throw Error('Missing target '+kind);
 const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),rect=canvas.getBoundingClientRect();
 camera.updateMatrixWorld(true);model.updateMatrixWorld(true);palta?.root.updateMatrixWorld(true);
 for(const fraction of [.55,.75,.35,.9]){
  const world=new THREE.Vector3(center.x,box.min.y+size.y*fraction,center.z),ndc=world.clone().project(camera);
  if(Math.abs(ndc.x)>.96||Math.abs(ndc.y)>.96||Math.abs(ndc.z)>1)continue;
  const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(ndc.x,ndc.y),camera);
  const hit=ray.intersectObjects(palta?[model,palta.root]:[model],true)[0];
  let hits=kind==='totem'&&hit&&isActivationObject(hit.object);
  if(kind==='palta')for(let object=hit?.object;object;object=object.parent)if(object===palta?.root)hits=true;
  if(hits)return{x:rect.left+(ndc.x+1)*rect.width/2,y:rect.top+(1-ndc.y)*rect.height/2,hit:hit.object.name};
 }
 throw Error('Target '+kind+' is not visible to an unobstructed native tap');
}
globalThis.__guidedQA={
 summary:qaTourSummary,view:qaTourView,company:qaCompany,point:qaObjectPoint,
 totem(){const point=layout.activation.approach;qaTourView(point);const dy=1.04-camera.position.y;pose={...pose,pitch:Math.atan2(dy,Math.hypot(layout.activation.position.x-pose.x,layout.activation.position.z-pose.z))};setPose();},
 mode:chooseMode,openTotem:openActivation,
 closePanels(){venueUI?.closePanels();$('helpPanel').hidden=true;clearInput();},
 closePalta(){palta?.close();},
 async rebuild(){contextFailed=true;await retryVenue('walk');},
 colors(){return(activationGuide?.routes??[]).flatMap(route=>route.root.children.flatMap(mesh=>mesh.instanceColor?Array.from(mesh.instanceColor.array):[]));},
 paltaTransforms(){const transforms=[];palta?.root.traverse(object=>transforms.push([...object.position,...object.quaternion,...object.scale]));return transforms;}
};
`;

async function frames(page,n=3){await page.evaluate(n=>new Promise(resolve=>{const tick=()=>--n<=0?resolve():requestAnimationFrame(tick);requestAnimationFrame(tick);}),n);}
const summary=page=>page.evaluate(()=>window.__guidedQA.summary());
async function snap(page,name){const file=name+'.jpg';await page.screenshot({path:path.join(output,file),type:'jpeg',quality:87});return file;}
let currentPage=null,currentErrors=[];
async function check(name,task){
 try{const details=await task();report.checks.push({name,pass:true,...(details?{details}:{})});console.log(JSON.stringify({check:name,pass:true}));}
 catch(error){
  let diagnostic={errors:currentErrors.slice(-4)};
  try{diagnostic={...diagnostic,...await currentPage.evaluate(()=>({phase:window.__guidedQA?.summary().tour.phase,ready:window.__guidedQA?.summary().ready,wallet:window.__guidedQA?.summary().wallet?.status,dialogs:[...document.querySelectorAll('dialog[open]')].map(node=>node.id)}))};}catch{}
  report.checks.push({name,pass:false,error:error.message,diagnostic});console.log(JSON.stringify({check:name,pass:false,error:error.message,diagnostic}));
 }
}
async function waitPhase(page,phase){await page.waitForFunction(phase=>window.__guidedQA.summary().tour.phase===phase,phase,{timeout:12000});await frames(page);}
async function setWalletMode(page,mode){await page.evaluate(mode=>window.__qaWalletFixture.setMode(mode),mode);}
async function totemTap(page){await page.evaluate(()=>window.__guidedQA.totem());await frames(page);const point=await page.evaluate(()=>window.__guidedQA.point('totem'));await page.mouse.click(point.x,point.y);await page.locator('#walletContinue').waitFor({state:'visible'});}
async function unlock(page){await setWalletMode(page,'funded');await totemTap(page);await page.locator('#walletContinue').click();await waitPhase(page,'companies');}
async function company(page,id){await page.evaluate(id=>window.__guidedQA.company(id),id);await frames(page,5);}
async function passport(page,label){
 try{
  await company(page,'passport');await page.locator('#nearPassport').waitFor({state:'visible'});await page.locator('#nearPassport').click();
  await page.waitForFunction(()=>document.querySelector('#passportEmbedded iframe')?.contentWindow?.__passportTourQA?.summary().firstFrames>0,null,{timeout:45000});
  const child=page.frames().find(frame=>frame.url().includes('/passport-ar.html'));
  assert.ok(child,'Real Passport iframe was not mounted');const before=await child.evaluate(()=>window.__passportTourQA.summary());
  assert.ok(before.hasView&&before.calls>0&&before.canvasCount>0,'Passport did not render a real GPU first frame');
  assert.equal((await summary(page)).tour.milestones.passport,false,'Passport completed before its first-frame event was released');
  await snap(page,label+'-passport-first-frame');assert.equal(await child.evaluate(()=>window.__passportTourQA.release()),true);
  await page.waitForFunction(()=>window.__guidedQA.summary().tour.milestones.passport,null,{timeout:4000});
  await page.locator('#closePassport').click();await frames(page);return before;
 }finally{
  // A failed iframe assertion must not leave a modal intercepting later taps.
  await page.evaluate(()=>{const dialog=document.getElementById('passportDialog');if(dialog?.open)dialog.close();}).catch(()=>{});
 }
}
async function paltaPoint(page){await company(page,'palta');return page.evaluate(()=>window.__guidedQA.point('palta'));}
async function assertNoFinancialActions(page){const f=await page.evaluate(()=>window.__qaWalletFixture.summary());assert.equal(f.signatures,0);assert.deepEqual(f.requests.filter(request=>request.method!=='GET'),[]);return{restores:f.restores,reads:f.reads,requests:f.requests.length};}

let browser;
try{
 fs.mkdirSync(output,{recursive:true});
 browser=await chromium.launch({headless:true,executablePath:executable,args:['--enable-webgl','--ignore-gpu-blocklist',...(process.env.VENUE_QA_SOFTWARE_GPU?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:(process.platform==='win32'?['--use-angle=d3d11','--use-gl=angle','--enable-gpu','--disable-software-rasterizer']:[]))]});
 for(const reducedMotion of (mapOnly?['no-preference']:['no-preference','reduce'])){
  const label=reducedMotion==='reduce'?'reduced':'normal',context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,hasTouch:true,reducedMotion});
  const page=await context.newPage(),errors=[],missing=[],external=[],walletApiRequests=[];
  currentPage=page;currentErrors=errors;page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{window.__qaTourEvents=[];for(const type of ['one16-wallet-open','one16-wallet-close','one16-wallet-continue'])document.addEventListener(type,event=>window.__qaTourEvents.push({type,source:event.detail?.source,status:event.detail?.state?.status}));});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='one16.test'){external.push(url.href);return route.fulfill({status:404,body:'External network disabled in guided tour QA'});}
   if(url.pathname.startsWith('/api/')){if(url.pathname.startsWith('/api/wallet/'))walletApiRequests.push({url:url.pathname,method:route.request().method()});return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'QA forbids actual wallet/API traffic'})});}
   const relative=decodeURIComponent(url.pathname).replace(/^\/+/, '')||'index.html';
   if(relative==='qa-wallet.mjs')return route.fulfill({contentType:'text/javascript',body:walletFixture});
   const target=path.resolve(directory,relative);
   if(!target.startsWith(directory+path.sep))return route.fulfill({status:403,body:'Forbidden'});
   if(!fs.existsSync(target)||!fs.statSync(target).isFile()){missing.push(relative);return route.fulfill({status:404,body:'Not found'});}
   let body=fs.readFileSync(target);
   if(relative==='viewer.js')body=Buffer.from(body.toString('utf8')+'\n'+viewerShim);
   if(relative==='world-wallet.mjs'){
    const source=body.toString('utf8'),from="loadModules = () => Promise.all([import('./wallet-controller.mjs'), import('./wallet-panel.mjs')])";
    assert.ok(source.includes(from),'QA lazy wallet module hook no longer matches');
    body=Buffer.from(source.replace(from,"loadModules = () => Promise.all([import('./qa-wallet.mjs'), import('./wallet-panel.mjs')])"));
   }
   if(relative==='passport-ar.mjs'){
    const source=body.toString('utf8'),declaration='const tellParent=data=>';
    assert.ok(source.includes(declaration),'QA Passport first-frame hook no longer matches');
    body=Buffer.from(source.replace(declaration,'let tellParent=data=>')+'\n'+passportShim);
   }
   await route.fulfill({contentType:mime[path.extname(target)]||'application/octet-stream',body});
  });
  await page.goto('http://one16.test/?lang=es',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__guidedQA?.summary().ready==='ready'&&window.__guidedQA.summary().paltaReady&&window.__qaWalletFixture?.summary().state.prepared,null,{timeout:90000});
  const initial=await summary(page),hardware=!!initial.gpu&&!/swiftshader|llvmpipe|software rasterizer/i.test(initial.gpu);
  const record={label,gpu:initial.gpu,hardwareAccelerated:hardware,initial};report.contexts.push(record);
  if(report.hardwareRequired)assert.ok(hardware,'Hardware GPU required; detected '+initial.gpu);
  await check(label+': entry uses one luminous route and maps have no numeric pins',async()=>{
   assert.equal(initial.tour.phase,'entry');assert.deepEqual(initial.routes.map(route=>route.id),['entry']);assert.ok(initial.pointCount>40);
   assert.deepEqual(initial.numericMapText,[]);assert.equal(initial.numericFloorGroups,0);await snap(page,label+'-entry');return{pointCount:initial.pointCount};
  });
  if(label==='normal'&&!mapOnly){
   await check('normal: generic wallet Continue and close never unlock a restored funded wallet',async()=>{
    await page.evaluate(()=>window.__one16.wallet.open());await page.locator('#walletContinue').waitFor({state:'visible'});await page.locator('#walletContinue').click();await waitPhase(page,'entry');
    await totemTap(page);await page.locator('#closeActivation').click();await waitPhase(page,'entry');
    return page.evaluate(()=>window.__qaTourEvents.slice());
   });
   for(const mode of ['error','pending','zero'])await check('normal: '+mode+' totem Continue remains entry',async()=>{
    await setWalletMode(page,mode);await totemTap(page);const wallet=(await summary(page)).wallet;await snap(page,'normal-wallet-'+mode);await page.locator('#walletContinue').click();await waitPhase(page,'entry');return{status:wallet.status,balance:wallet.balanceUnits};
   });
  }
  await check(label+': explicit funded totem Continue replaces entry with shared trunk and two branches',async()=>{
   await unlock(page);const state=await summary(page);assert.deepEqual(state.routes.map(route=>route.id),['companies','passport','palta']);assert.ok(state.routes.every(route=>route.points>1));
   assert.ok(!state.routes.some(route=>route.id==='entry'));await snap(page,label+'-companies');
   await page.evaluate(()=>window.__guidedQA.mode('plan'));await frames(page);await snap(page,label+'-companies-plan');
   const dom=await page.evaluate(()=>({ids:[...document.querySelectorAll('#plan [data-guidance-route]')].map(node=>node.dataset.guidanceRoute),labels:[...document.querySelectorAll('#plan [data-guidance-label]')].map(node=>node.textContent)}));
   assert.deepEqual(dom.ids,['trunk','passport','palta']);assert.ok(dom.labels.some(text=>text.includes('Stellar Passport')));assert.ok(dom.labels.some(text=>text.includes('DeFindex')));
   await page.evaluate(()=>window.__guidedQA.mode('walk'));return dom;
  });
  if(mapOnly){
   record.planViewports=[];
   for(const [width,height] of [[320,568],[390,844],[844,390],[1440,900]]){
    await check(`map: companies plan ${width}x${height} keeps readable status and an accessible reset`,async()=>{
     await page.setViewportSize({width,height});
     await page.evaluate(()=>{window.__guidedQA.closePanels();window.__guidedQA.mode('plan');});await frames(page,5);
     const audit=await page.evaluate(()=>{
      const inspect=id=>{
       const node=document.getElementById(id),css=getComputedStyle(node),rect=node.getBoundingClientRect();
       return{id,x:rect.x,y:rect.y,width:rect.width,height:rect.height,visible:!node.hidden&&css.display!=='none'&&css.visibility!=='hidden'&&Number(css.opacity)>0&&rect.width>0&&rect.height>0,fontSize:parseFloat(css.fontSize),lineHeight:parseFloat(css.lineHeight),clientWidth:node.clientWidth,scrollWidth:node.scrollWidth,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight};
      };
      return{viewport:{width:innerWidth,height:innerHeight},mode:window.__guidedQA.summary().mode,tour:window.__guidedQA.summary().tour,
       panel:inspect('guidedTourStatus'),text:inspect('guidedTourText'),reset:inspect('guidedTourReset'),plan:inspect('plan'),
       openDialogs:[...document.querySelectorAll('dialog[open]')].map(node=>node.id),zonesOpen:document.getElementById('viewer').classList.contains('zones-open'),
       numericPins:[...document.querySelectorAll('#plan svg text')].filter(node=>/^\s*\d+\s*$/.test(node.textContent)).map(node=>node.textContent),
       routes:[...document.querySelectorAll('#plan [data-guidance-route]')].map(node=>node.dataset.guidanceRoute),
       labels:[...document.querySelectorAll('#plan [data-guidance-label]')].map(node=>{const css=getComputedStyle(node),matrix=node.getScreenCTM(),fontSize=parseFloat(css.fontSize);return{text:node.textContent,fontSize,effectivePixels:fontSize*Math.hypot(matrix?.a??1,matrix?.b??0)};})};
     });
     record.planViewports.push(audit);audit.screenshot=await snap(page,`companies-plan-${width}x${height}`);
     assert.equal(audit.mode,'plan');assert.equal(audit.tour.phase,'companies');assert.deepEqual(audit.openDialogs,[]);assert.equal(audit.zonesOpen,false);
     assert.deepEqual(audit.numericPins,[]);assert.deepEqual(audit.routes,['trunk','passport','palta']);
     for(const element of [audit.panel,audit.text,audit.reset,audit.plan]){
      assert.ok(element.visible,`${element.id} is hidden`);
      assert.ok(element.x>=-.5&&element.y>=-.5&&element.x+element.width<=width+.5&&element.y+element.height<=height+.5,`${element.id} extends beyond ${width}x${height}`);
     }
     assert.ok(audit.reset.width>=44&&audit.reset.height>=44,'Reset action is smaller than 44px');
     assert.ok(audit.text.fontSize>=12&&audit.text.lineHeight>=audit.text.fontSize*1.2,'Status CSS text is too small or tightly spaced');
     for(const element of [audit.text,audit.reset])assert.ok(element.scrollWidth<=element.clientWidth+1&&element.scrollHeight<=element.clientHeight+1,`${element.id} clips or overflows its text`);
     return audit;
    });
   }
   await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>{window.__guidedQA.closePanels();window.__guidedQA.mode('walk');});await frames(page);
   await check('map: preparation and unlock never sign, POST or leave runtime errors',async()=>{
    const financial=await assertNoFinancialActions(page);assert.deepEqual(walletApiRequests,[]);assert.deepEqual(errors,[]);assert.deepEqual([...new Set(missing)],[]);return financial;
   });
   record.final=await summary(page);record.errors=errors;record.missing=[...new Set(missing)];record.externalBlocked=[...new Set(external)];record.walletApiRequests=walletApiRequests;record.events=await page.evaluate(()=>window.__qaTourEvents.slice());await context.close();currentPage=null;currentErrors=[];
   continue;
  }
  if(label==='normal'){
   await check('normal: Passport requires a real iframe GPU frame before completing',()=>passport(page,'normal-first-order'));
   await check('normal: scene rebuild preserves identity and first destination',async()=>{
    const before=await summary(page);await page.evaluate(()=>window.__guidedQA.rebuild());await page.waitForFunction(()=>window.__guidedQA.summary().ready==='ready'&&window.__guidedQA.summary().paltaReady,null,{timeout:90000});
    const after=await summary(page);assert.notEqual(after.sceneId,before.sceneId);assert.equal(after.fixture.restores,before.fixture.restores,'Scene rebuild restored/reconnected the wallet again');assert.deepEqual(after.tour,before.tour);assert.equal(after.routes.find(route=>route.id==='passport').dimmed,true);return{beforeScene:before.sceneId,afterScene:after.sceneId};
   });
   await check('normal: proximity, drag and two-finger gestures do not complete Palta',async()=>{
    let point=await paltaPoint(page);await page.waitForTimeout(3200);assert.equal((await summary(page)).tour.milestones.palta,false);
    await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+24,point.y,{steps:4});await page.mouse.move(point.x,point.y,{steps:4});await page.mouse.up();await page.waitForTimeout(150);assert.equal((await summary(page)).tour.milestones.palta,false);
    point=await paltaPoint(page);const cdp=await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x-8,y:point.y,id:1},{x:point.x+8,y:point.y,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
    await page.waitForTimeout(150);assert.equal((await summary(page)).tour.milestones.palta,false);
   });
   await check('normal: native Palta tap completes Passport-first order and removes routes',async()=>{
    const point=await paltaPoint(page);await page.mouse.click(point.x,point.y);await waitPhase(page,'completed');const state=await summary(page);assert.equal(state.pointCount,0);assert.deepEqual(state.routes,[]);assert.equal(await page.locator('#room').textContent(),'Recorrido completado');await snap(page,'normal-completed-passport-first');return state.tour;
   });
   await check('normal: reset preserves wallet and requires another explicit totem Continue',async()=>{
    const before=(await summary(page)).wallet;await page.locator('#guidedTourReset').click();await waitPhase(page,'entry');assert.equal((await summary(page)).wallet.address,before.address);await frames(page,10);assert.equal((await summary(page)).tour.phase,'entry');await unlock(page);
   });
   await check('normal: hidden Palta animation cannot complete until visible again',async()=>{
    await paltaPoint(page);await page.evaluate(()=>window.__guidedQA.closePalta());await page.waitForTimeout(3400);const point=await page.evaluate(()=>window.__guidedQA.point('palta'));await page.mouse.click(point.x,point.y);await page.evaluate(()=>window.__guidedQA.mode('plan'));await page.waitForTimeout(3400);
    assert.equal((await summary(page)).tour.milestones.palta,false,'Hidden Palta animation completed the destination');await snap(page,'normal-palta-paused-in-plan');await company(page,'palta');await page.waitForFunction(()=>window.__guidedQA.summary().tour.milestones.palta,null,{timeout:6000});assert.equal((await summary(page)).tour.phase,'companies');
   });
   await check('normal: Passport after Palta completes the reverse order',async()=>{const result=await passport(page,'normal-reverse-order');await waitPhase(page,'completed');await snap(page,'normal-completed-palta-first');return result;});
   await check('normal: reload restores completed milestones only after verified matching wallet',async()=>{
    await assertNoFinancialActions(page);await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__guidedQA?.summary().ready==='ready'&&window.__qaWalletFixture?.summary().state.status==='ready',null,{timeout:90000});await waitPhase(page,'completed');assert.equal((await summary(page)).pointCount,0);return(await summary(page)).tour;
   });
  }else{
   await check('reduced: luminous dots and open Palta transforms remain static',async()=>{
    const first=await page.evaluate(()=>window.__guidedQA.colors());await page.waitForTimeout(250);assert.deepEqual(await page.evaluate(()=>window.__guidedQA.colors()),first);
    await company(page,'palta');await page.waitForTimeout(150);assert.equal((await summary(page)).tour.milestones.palta,false);const before=await page.evaluate(()=>window.__guidedQA.paltaTransforms());await page.waitForTimeout(300);assert.deepEqual(await page.evaluate(()=>window.__guidedQA.paltaTransforms()),before);
   });
   await check('reduced: accessible Enter opens Palta and actual Passport first frame completes',async()=>{
    await page.locator('#paltaNearButton').waitFor({state:'visible'});await page.locator('#paltaNearButton').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__guidedQA.summary().tour.milestones.palta,null,{timeout:5000});await passport(page,'reduced');await waitPhase(page,'completed');await snap(page,'reduced-completed');
   });
  }
  await check(label+': no signing, faucet POST, runtime exceptions or missing local resources',async()=>{
   const financial=await assertNoFinancialActions(page);assert.deepEqual(walletApiRequests,[],'Wallet escaped its in-memory fixture');assert.deepEqual(errors,[]);assert.deepEqual([...new Set(missing)],[]);return financial;
  });
  record.final=await summary(page);record.errors=errors;record.missing=[...new Set(missing)];record.externalBlocked=[...new Set(external)];record.walletApiRequests=walletApiRequests;record.events=await page.evaluate(()=>window.__qaTourEvents.slice());await context.close();currentPage=null;currentErrors=[];
 }
}catch(error){report.fatal={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 if(browser)await browser.close();report.pass=!report.fatal&&report.checks.every(check=>check.pass);if(!report.pass)process.exitCode=1;
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'guided-tour-browser.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,failed:report.checks.filter(check=>!check.pass).map(check=>check.name),fatal:report.fatal?.message,output}));
}
