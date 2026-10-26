/** Local GPU/browser QA for the authored activation guide.
 * Authoring/--check does not launch a browser; execute only when authorized.
 * Original viewer, guide, GLB and wallet UI are served from local files.
 * Route-only probes add no production debug APIs. Disabled wallet config and
 * action/request guards ensure this tests UI entry, never funding or payments.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.VENUE_UI_PLAYWRIGHT_MODULE||'C:/Users/cabs_/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=fileURLToPath(new URL('../',import.meta.url)),directory=path.resolve(process.env.ACTIVATION_QA_DIST||path.join(root,'dist'));
const output=path.resolve(process.env.ACTIVATION_QA_DIR||path.join(root,'docs/render-review-2026-10-26/activation-guide'));
const executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'C:/Users/cabs_/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.glb':'model/gltf-binary','.gz':'application/octet-stream'};
const report={fixture:'Local file-backed HTTP; original viewer, guide, wallet UI and rebuilt GLB; route-only instrumentation',walletScope:'Existing USDC Testnet wallet panel entry only. Disabled config; no wallet provider, funded-wallet claim, redemption or payment.',checks:[],contexts:[]};
fs.mkdirSync(output,{recursive:true});

const viewerShim=String.raw`
import {sampleActivationRoute as qaSampleRoute} from './activation-guide.mjs';
import {canStand as qaCanStand} from './navigation.mjs';
let qaStartPose;
function qaGuides(){const result=[];scene?.traverse(o=>{if(o.userData?.role==='activation-guide')result.push(o);});return result;}
function qaTotems(){const result=new Set();model?.traverse(o=>{if(!isActivationObject(o))return;while(o.parent&&isActivationObject(o.parent))o=o.parent;result.add(o);});return [...result];}
function qaVisible(o){for(;o;o=o.parent)if(o.visible===false)return false;return true;}
function qaProject(p){camera.updateMatrixWorld(true);const n=p.clone().project(camera),r=canvas.getBoundingClientRect(),x=r.left+(n.x+1)*r.width/2,y=r.top+(1-n.y)*r.height/2;return{x,y,ndc:n.toArray(),inViewport:Math.abs(n.x)<.98&&Math.abs(n.y)<.98&&n.z>-1&&n.z<1,uncovered:document.elementFromPoint(x,y)===canvas};}
function qaGuideData(){
 if(typeof THREE==='undefined'||!THREE)return{roots:0,visible:false,pointCount:0,layers:[]};
 const roots=qaGuides(),guide=roots[0],layers=[],matrix=new THREE.Matrix4(),position=new THREE.Vector3();guide?.updateMatrixWorld(true);
 guide?.traverse(mesh=>{if(!mesh.isInstancedMesh)return;const points=[];for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix).applyMatrix4(mesh.matrixWorld);points.push({x:position.x,y:position.y,z:position.z});}layers.push({name:mesh.name,count:mesh.count,points,colors:mesh.instanceColor?Array.from(mesh.instanceColor.array):[],visible:qaVisible(mesh),opacity:mesh.material.opacity});});
 return{roots:roots.length,uuid:guide?.uuid,visible:!!guide&&qaVisible(guide),pointCount:guide?.userData.pointCount??0,layers};
}
function qaSummary(){
 if(!qaStartPose&&venueLoading.state.phase==='ready')qaStartPose={...pose};
 model?.updateMatrixWorld(true);const gl=renderer?.getContext(),dbg=gl?.getExtension('WEBGL_debug_renderer_info');
 const numbers=[];scene?.traverse(o=>{if(o.userData?.reviewId)numbers.push({id:o.userData.reviewId});});
 return{ready:venueLoading.state.phase,active,mode,pose:{...pose},activation:layout.activation,route:layout.activationRoute,
 samples:qaSampleRoute(layout).map(p=>({...p,floor:floorHeight(p.x,p.z,layout)})),guide:qaGuideData(),
 totems:qaTotems().map(o=>({name:o.name,uuid:o.uuid,position:o.getWorldPosition(new THREE.Vector3()).toArray()})),
 numbers,
 nearButton:{hidden:$('nearActivation').hidden,text:$('nearActivation').textContent},dialogOpen:$('activationDialog').open,
 forbidden:globalThis.__activationForbidden??[],walletOpenEvents:globalThis.__activationWalletOpens??0,
 gpu:dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):gl?.getParameter(gl.RENDERER)};
}
function qaView(label){
 const route=qaSampleRoute(layout);let next;
 if(label==='spawn')next=qaStartPose||layout.spawn;
 else if(label==='corridor'){const candidates=route.filter(p=>p.z>6&&p.z<layout.spawn.z-1),p=candidates[Math.floor(candidates.length/2)];if(!p)throw Error('No shortened-corridor guide samples');next={x:p.x,z:p.z,yaw:0,pitch:-.18};}
 else if(label==='stairs')next={x:0,z:3.15,yaw:0,pitch:-.22};
 else if(label==='approach')next=layout.activation?.approach;
 if(!next)throw Error('Missing activation viewpoint '+label);pose={...pose,...next};chooseMode('walk');setPose();
}
function qaProjection(){
 const data=qaGuideData(),layer=data.layers.find(l=>/white dots/i.test(l.name))||data.layers[0];if(!layer)return{visible:0,samples:[]};
 const candidates=layer.points.map(p=>({world:{...p},...qaProject(new THREE.Vector3(p.x,p.y,p.z))})).filter(p=>p.inViewport&&p.uncovered),samples=[];
 for(const p of candidates.slice(0,8)){const world=new THREE.Vector3(p.world.x,p.world.y,p.world.z),distance=camera.position.distanceTo(world),direction=world.clone().sub(camera.position).normalize(),ray=new THREE.Raycaster(camera.position,direction,0,Math.max(0,distance-.035)),hit=ray.intersectObjects(model.children,true)[0];samples.push({...p,screen:{x:p.x,y:p.y},blocked:!!hit,hitName:hit?.object.name??null});}
 return{projected:candidates.length,visible:samples.filter(p=>!p.blocked).length,samples};
}
function qaHit(){
 model.updateMatrixWorld(true);
 for(const actor of qaTotems()){const center=new THREE.Box3().setFromObject(actor).getCenter(new THREE.Vector3());for(const height of [1.25,1.5,.95])for(const offset of [0,-.1,.1]){
 const p=qaProject(new THREE.Vector3(center.x+offset,height,center.z));if(!p.inViewport||!p.uncovered)continue;const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(p.ndc[0],p.ndc[1]),camera);const hit=ray.intersectObjects(model.children,true)[0];if(hit&&isActivationObject(hit.object))return{...p,hit:hit.object.name};}}
 return null;
}
function qaWalkRoute(){
 const approach=layout.activation?.approach,points=layout.activationRoute;if(!approach||!Array.isArray(points))throw Error('Missing activation route');
 pose={...pose,...layout.spawn,mode:'walk'};chooseMode('walk');const trace=[{x:pose.x,z:pose.z,y:floorHeight(pose.x,pose.z,layout)}];
 for(const[index,target]of [...points,{x:approach.x,z:approach.z}].entries()){let n=0;for(;;){const dx=target.x-pose.x,dz=target.z-pose.z,d=Math.hypot(dx,dz);if(d<.025)break;if(++n>5000)throw Error('Route did not reach waypoint '+index);const next=walk({...pose,yaw:Math.atan2(-dx,-dz)},{forward:1,right:0},Math.min(.05,d/2.2),layout);if(Math.hypot(next.x-pose.x,next.z-pose.z)<1e-6)throw Error('Route blocked at waypoint '+index);pose=next;if(!qaCanStand(pose.x,pose.z,layout))throw Error('Route crossed collision');trace.push({x:pose.x,z:pose.z,y:floorHeight(pose.x,pose.z,layout)});}}
 pose={...pose,...approach};setPose();return trace;
}
globalThis.__activationQA={summary:qaSummary,view:qaView,projection:qaProjection,point:qaHit,walkRoute:qaWalkRoute,mode(next){chooseMode(next);},review(){updateReview(performance.now()+1000);},async rebuild(){discardVenueScene();await retryVenue('walk');}};
`;
const walletShim=String.raw`
export function createWalletController(options){const owner=qaOriginalCreateWalletController(options);return new Proxy(owner,{get(target,key){const value=Reflect.get(target,key,target);if(['connect','ensureWalletReady','retryFunding'].includes(key)&&typeof value==='function')return()=>{(globalThis.__activationForbidden??=[]).push({kind:'wallet-action',method:String(key)});throw Error('No creation, redemption or payment in route QA');};return typeof value==='function'?value.bind(target):value;}});}
`;

const summary=page=>page.evaluate(()=>window.__activationQA.summary());
const near=(a,b)=>Math.abs(a-b)<1e-5;
async function frames(page,count=3){await page.evaluate(count=>new Promise(resolve=>{const next=()=>--count<=0?resolve():requestAnimationFrame(next);requestAnimationFrame(next);}),count);}
async function choose(page,label){await page.evaluate(label=>window.__activationQA.view(label),label);await frames(page);}
async function capture(page,label){const file=label+'.jpg';await page.screenshot({path:path.join(output,file),type:'jpeg',quality:88});return file;}
async function check(name,fn){const diagnostic={};try{const detail=await fn(diagnostic);report.checks.push({name,pass:true,detail});console.log(JSON.stringify({check:name,pass:true}));}catch(error){report.checks.push({name,pass:false,error:error.message,...(Object.keys(diagnostic).length?{detail:diagnostic}:{})});console.log(JSON.stringify({check:name,pass:false,error:error.message}));}}
async function walletOpen(page){await page.waitForFunction(()=>document.getElementById('activationDialog')?.open&&document.getElementById('activationTitle'),null,{timeout:10000});assert.match(await page.locator('#activationDialog').innerText(),/USDC de prueba/i);assert.deepEqual((await summary(page)).forbidden,[]);}
async function closeWallet(page){await page.locator('#closeActivation').click();await frames(page);}
let browser;
try{
 for(const file of ['activation-guide.mjs','viewer.js','wallet-controller.mjs','assets/one16.glb'])assert.ok(fs.existsSync(path.join(directory,file)),'Missing activation build input '+file);
 browser=await chromium.launch({headless:true,executablePath:executable,args:['--enable-webgl','--ignore-gpu-blocklist',...(process.env.VENUE_QA_SOFTWARE_GPU?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:(process.platform==='win32'?['--use-angle=d3d11','--use-gl=angle','--enable-gpu','--disable-software-rasterizer']:[]))]});
 for(const reducedMotion of ['no-preference','reduce']){
  const label=reducedMotion==='reduce'?'reduced':'normal',context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,hasTouch:true,reducedMotion});
  const page=await context.newPage(),errors=[],missing=[],writes=[],requests=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   window.__activationForbidden=[];window.__activationWalletOpens=0;document.addEventListener('one16-wallet-open',()=>window.__activationWalletOpens++);
   try{const proto=Object.getPrototypeOf(navigator.credentials);for(const method of ['create','get'])Object.defineProperty(proto,method,{configurable:true,value(){window.__activationForbidden.push({kind:'webauthn',method});return Promise.reject(Error('No credential ceremony in route QA'));}});}catch{}
   if(window.PaymentRequest)PaymentRequest.prototype.show=function(){window.__activationForbidden.push({kind:'payment-request'});return Promise.reject(Error('No payment in route QA'));};
  });
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url()),method=request.method();requests.push({method,path:url.pathname,host:url.hostname});
   if(!['GET','HEAD'].includes(method)){writes.push({method,path:url.pathname});return route.fulfill({status:403,contentType:'application/json',body:'{"error":"Writes disabled in route QA"}'});}
   if(url.hostname!=='one16.test'){external.push({method,host:url.hostname,path:url.pathname});return route.fulfill({status:404,body:'External network disabled'});}
   if(url.pathname==='/api/wallet/config')return route.fulfill({contentType:'application/json',body:JSON.stringify({enabled:false,network:'testnet',networkPassphrase:'Test SDF Network ; September 2015',message:'Fixture de acceso USDC de prueba; sin fondeo ni pagos.'})});
   if(url.pathname.startsWith('/api/'))return route.fulfill({status:403,contentType:'application/json',body:'{"error":"No wallet operation in route QA"}'});
   const relative=decodeURIComponent(url.pathname).replace(/^\/+/, '')||'index.html',target=path.resolve(directory,relative);
   if(!target.startsWith(directory+path.sep))return route.fulfill({status:403,body:'Forbidden'});
   if(!fs.existsSync(target)||!fs.statSync(target).isFile()){missing.push(relative);return route.fulfill({status:404,body:'Not found'});}
   let body=fs.readFileSync(target);
   if(relative==='viewer.js')body=Buffer.from(body.toString('utf8')+'\n'+viewerShim);
   if(relative==='wallet-controller.mjs'){const source=body.toString('utf8'),factory=/export\s+function\s+createWalletController\s*\(/;if(!factory.test(source))throw Error('Wallet guard no longer matches source');body=Buffer.from(source.replace(factory,'function qaOriginalCreateWalletController(')+'\n'+walletShim);}
   return route.fulfill({status:200,contentType:mime[path.extname(target)]||'application/octet-stream',body});
  });
  await page.goto('http://one16.test/?lang=es',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__activationQA?.summary().ready==='ready',null,{timeout:90000});
  const initial=await summary(page),hardware=!!initial.gpu&&!/swiftshader|llvmpipe|software rasterizer/i.test(initial.gpu);report.contexts.push({label,reducedMotion,gpu:initial.gpu,hardwareAccelerated:hardware});
  if(process.env.ACTIVATION_REQUIRE_HARDWARE_GPU!=='0')assert.ok(hardware,'Hardware GPU required; detected '+initial.gpu);
  await check(label+' floor route and seven stair heights',async()=>{
   const s=await summary(page);assert.equal(s.guide.roots,1);assert.equal(s.totems.length,1);assert.ok(s.samples.length>15);assert.equal(s.guide.layers.length,2);
   assert.ok(s.guide.layers.every(layer=>layer.count===s.samples.length));
   for(const p of s.samples)assert.ok(near(p.y-(p.surfaceY??p.floor),.025),'A guide point does not follow its visible floor finish');
   const stairs=[...new Set(s.samples.filter(p=>p.stairs).map(p=>Number(p.floor.toFixed(2))))].sort((a,b)=>a-b);assert.deepEqual(stairs,[-.9,-.75,-.6,-.45,-.3,-.15,0]);
   assert.ok(near(s.totems[0].position[0],2.6)&&near(s.totems[0].position[2],-5.6));
   assert.ok(near(s.activation.approach.x,2.6)&&near(s.activation.approach.z,-4.3));return{samples:s.samples.length,stairs,activation:s.activation,totem:s.totems[0]};
  });
  await check(label+' production walk reaches food-side approach without collision',async()=>{
   const trace=await page.evaluate(()=>window.__activationQA.walkRoute()),s=await summary(page);assert.ok(Math.hypot(s.pose.x-2.6,s.pose.z+4.3)<.03);
   const levels=[...new Set(trace.filter(p=>p.z>=0&&p.z<=2.45).map(p=>Number(p.y.toFixed(2))))];for(const h of [-.9,-.75,-.6,-.45,-.3,-.15,0])assert.ok(levels.includes(h),'Skipped stair '+h);
   assert.ok(trace.some(p=>p.z>6));assert.ok(trace.some(p=>p.z<-3.6&&p.x>2));return{steps:trace.length,levels,end:s.pose};
  });
  await check(label+' public review references removed',async()=>{
   const s=await summary(page);assert.deepEqual(s.numbers,[]);assert.match(s.activation.purpose,/Testnet/i);
   const count=await page.locator('#reviewToggle,#reviewNames,#reviewNumbers,[data-review-number],[data-review-id]').count();assert.equal(count,0);return{numbers:s.numbers,reviewElements:count};
  });
  if(label==='normal'){
   for(const[width,height]of [[320,568],[390,844],[844,390],[1440,900]]){
    await page.setViewportSize({width,height});
    for(const view of ['spawn','corridor','stairs','approach'])await check(view+' '+width+'x'+height,async diagnostic=>{
     await choose(page,view);const s=await summary(page),projection=await page.evaluate(()=>window.__activationQA.projection());
     Object.assign(diagnostic,{file:await capture(page,view+'-'+width+'x'+height),pose:s.pose,projection,mode:s.mode,guideVisible:s.guide.visible,nearButton:s.nearButton});
     assert.equal(s.mode,'walk');assert.equal(s.guide.visible,true);
     if(view!=='approach')assert.ok(projection.visible>0,'No unobscured guide point visible on the floor');else assert.equal(s.nearButton.hidden,false);
     return diagnostic;
    });
    await page.evaluate(()=>{window.__activationQA.review(true);window.__activationQA.mode('overview');});await frames(page);
    await check('overview walk-only guide '+width+'x'+height,async diagnostic=>{Object.assign(diagnostic,{file:await capture(page,'overview-'+width+'x'+height),guide:(await summary(page)).guide});assert.equal(diagnostic.guide.visible,false);return diagnostic;});
    await page.evaluate(()=>window.__activationQA.mode('plan'));await frames(page);
    await check('plan route '+width+'x'+height,async diagnostic=>{
     const markup=await page.evaluate(()=>[...document.querySelectorAll('svg [data-activation-route]')].map(o=>({tag:o.tagName,points:o.getAttribute('points'),path:o.getAttribute('d')})));
     Object.assign(diagnostic,{file:await capture(page,'plan-'+width+'x'+height),markup,guideVisible:(await summary(page)).guide.visible});
     assert.ok(markup.length,'SVG lacks data-activation-route');assert.equal(diagnostic.guideVisible,false);return diagnostic;
    });
   }
   await page.setViewportSize({width:1440,height:900});await choose(page,'corridor');
   await check('native corridor walking input',async()=>{
    const before=(await summary(page)).pose;await page.keyboard.down('w');try{await page.waitForFunction(z=>window.__activationQA.summary().pose.z<z-.2,before.z,{timeout:3000,polling:'raf'});}finally{await page.keyboard.up('w');}
    return{before,after:(await summary(page)).pose};
   });
   await check('native kiosk ray tap opens existing USDC wallet only',async()=>{
    await choose(page,'approach');const point=await page.evaluate(()=>window.__activationQA.point());assert.ok(point,'No uncovered 3D kiosk hit');await page.mouse.click(point.x,point.y);await walletOpen(page);
    const detail={point,file:await capture(page,'wallet-native-ray'),state:await summary(page)};await closeWallet(page);return detail;
   });
   await check('nearby action supports Enter and native touch',async()=>{
    await choose(page,'approach');await page.locator('#nearActivation').focus();await page.keyboard.press('Enter');await walletOpen(page);await closeWallet(page);
    await page.setViewportSize({width:390,height:844});await choose(page,'approach');const b=await page.locator('#nearActivation').boundingBox();assert.ok(b&&b.width>=44&&b.height>=44);await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);await walletOpen(page);
    const file=await capture(page,'wallet-near-action-390x844');await closeWallet(page);return{file,button:b};
   });
   await check('rebuild replaces guide and kiosk without duplicates or double shortening',async()=>{
    const before=await summary(page);await page.evaluate(()=>window.__activationQA.rebuild());await page.waitForFunction(()=>window.__activationQA.summary().ready==='ready',null,{timeout:90000});await choose(page,'approach');const after=await summary(page);
    assert.equal(after.guide.roots,1);assert.equal(after.totems.length,1);assert.notEqual(before.guide.uuid,after.guide.uuid);assert.notEqual(before.totems[0].uuid,after.totems[0].uuid);assert.deepEqual(after.samples,before.samples);return{points:after.guide.pointCount};
   });
  }else{
   await page.setViewportSize({width:390,height:844});await choose(page,'stairs');
   await check('reduced motion guide stays static',async diagnostic=>{const before=(await summary(page)).guide;await frames(page,24);const after=(await summary(page)).guide;Object.assign(diagnostic,{file:await capture(page,'reduced-motion-stairs-390x844'),points:after.pointCount,before,after,projection:await page.evaluate(()=>window.__activationQA.projection())});assert.equal(after.visible,true);assert.deepEqual(after.layers,before.layers);return diagnostic;});
  }
  await check(label+' no automatic wallet action, write, redeem, payment or page error',async()=>{
   const s=await summary(page);assert.deepEqual(s.forbidden,[]);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.deepEqual([...new Set(missing)].filter(p=>p!=='favicon.ico'),[]);
   return{forbidden:s.forbidden,writes,errors,missing:[...new Set(missing)],externalBlocked:external,requests,walletOpenEvents:s.walletOpenEvents};
  });
  await context.close();
 }
}catch(error){report.fatal={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 if(browser)await browser.close();report.pass=!report.fatal&&report.checks.every(c=>c.pass);if(!report.pass)process.exitCode=1;
 fs.writeFileSync(path.join(output,'activation-guide-browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass).map(c=>c.name),fatal:report.fatal?.message,output}));
}

