import {createMainStageSign,isMainStageSign,MAIN_STAGE_ENTRY_URL} from './main-stage-sign.mjs?v=1';
import { applyStageCard } from './stage-screen.mjs?v=2';
import { createDefaultStageLoop, mountAdsSpatial } from './ads-spatial.mjs?v=1';
import { getWorldWallet, isActivationObject } from './world-wallet.mjs?v=1';
import { createEmbeddedPassport } from './embedded-passport.mjs?v=book2';
import { addPassportStand, PASSPORT_STAND } from './passport-stand.mjs?v=1';
import { prepareVenueModel } from './venue-model.mjs?v=1';
import { createVenueLoadingController, mountVenueWelcome, resolveVenueIntent, resolveVenueLanguage } from './venue-loading.mjs?v=1';
import { createWalkFloorNumbers } from './walk-floor-numbers.mjs?v=1';
import { bindAndroidLaunch, checkPassportAsset } from './android-launch.mjs?v=1';
import { bindWalkInput } from './walk-input.mjs?v=1';
import { bindQuickLook } from './quicklook.mjs?v=2';
import { REVIEW_SECTIONS, buildReviewSvg } from './review-map.mjs?v=1';
import { createReviewOverview } from './review-overview.mjs?v=1';
import { overviewPreset, clampOverview } from './overview-controls.mjs?v=1';
import { createOverviewHotspots } from './overview-hotspots.mjs?v=1';
import { enhancePlan, HOTSPOTS } from './map-hotspots.mjs?v=1';
import { bindWorldPassport, isPassportObject } from './world-passport.mjs?v=1';
import { withTimeout } from './load-timeout.mjs?v=8';
import { fetchModel } from './model-transfer.mjs?v=13';
let THREE,GLTFLoader,OrbitControls,enginePromise;
let adsSpatial,defaultStage,mainStageSign;
const adsAckTimes=new Map();
function attestAdsFrame(ack){if(new URLSearchParams(location.search).get('publisher')!=='1'||document.visibilityState!=='visible'||typeof window.__adsPublisherAck!=='function')return;const key=[ack.version,ack.revisionId,ack.manifestHash,ack.imageHash].join(':');const previous=adsAckTimes.get(ack.placementId),time=performance.now();if(previous?.key===key&&time-previous.time<500)return;adsAckTimes.set(ack.placementId,{key,time});Promise.resolve(window.__adsPublisherAck(ack)).catch(()=>{});}
function loadEngine(){return enginePromise??=Promise.all([import('three'),import('./vendor/three/examples/jsm/loaders/GLTFLoader.js'),import('./vendor/three/examples/jsm/controls/OrbitControls.js')]).then(([three,loader,controls])=>{THREE=three;GLTFLoader=loader.GLTFLoader;OrbitControls=controls.OrbitControls}).catch(e=>{enginePromise=null;throw e})}
import { walk,turn,roomAt,changeMode,floorHeight } from './navigation.mjs?v=2';
import { bindEntranceReset } from './reset-controller.mjs?v=4';
const $=id=>document.getElementById(id), canvas=$('scene'),view=$('viewer');
const walletExperience=getWorldWallet(document);
document.addEventListener('one16-wallet-open',()=>{clearInput();if(orbit)orbit.enabled=false;});
document.addEventListener('one16-wallet-close',()=>{clearInput();if(orbit)orbit.enabled=mode==='overview';});
let scene,camera,renderer,orbit,model,layout,pose,mode='walk',active=false,loading=null,last=0,drag=null,pinch=0,frame=0,contextFailed=false,transferController,transferTimer,overviewHotspots,overviewVector;
let venueRenderUntil=0,resourcesPrepared=false,venueAttempt=0,entrySerial=0,initialIntentApplied=false;
let palta,paltaMount=0;
function browserStorage(name){try{return window[name]}catch{return null}}
const venueLanguage=resolveVenueLanguage({search:location.search,storage:browserStorage('localStorage')});
let savedVenueReturn;try{savedVenueReturn=browserStorage('sessionStorage')?.getItem('one16-ar-return')}catch{}
layout=JSON.parse($('embeddedLayout').textContent);
const initialIntent=resolveVenueIntent({hash:location.hash,search:location.search,savedReturn:savedVenueReturn,bounds:layout.bounds});
let restorePassportPending=initialIntent.kind==='ar-return';
if(initialIntent.kind==='ar-return')try{sessionStorage.removeItem('one16-ar-return')}catch{}
const venueWelcome=mountVenueWelcome(document,{language:venueLanguage});
const venueLoading=createVenueLoadingController({
 onState:state=>{venueWelcome.update(state);view.inert=state.cover&&active;},
 onReady:()=>{if(active)$('return').focus({preventScroll:true});document.dispatchEvent(new CustomEvent('one16-ready'));if(restorePassportPending){restorePassportPending=false;if(!$('passportDialog').open)worldPassport.open();}},
 onError:error=>{resourcesPrepared=false;clearInput();document.querySelector('.touch-controls').hidden=true;$('fallback').hidden=venueLoading.state.choice!=='plan';if(venueLoading.state.choice==='plan'){$('fallbackMessage').textContent=error.message;}document.dispatchEvent(new CustomEvent('one16-failed',{detail:{message:error.message}}));}
});
let reviewEnabled=true,reviewOverview,lastMini=0,walkInput,walkFloorNumbers;
// Bind native iOS preparation before any panel or heavy module can open.
bindQuickLook($('iosAR'),$('iosStatus'));
const keys=new Set(),touch=new Set(),heldPointers=new Map(),blockedKeys=new Set();
function clearInput(){walkInput?.clear();for(const key of keys)blockedKeys.add(key);keys.clear();touch.clear();drag=null;pinch=0;for(const [id,element] of heldPointers){try{if(element.hasPointerCapture?.(id))element.releasePointerCapture(id)}catch{}}heldPointers.clear();}
function makeOrbit(){orbit?.dispose();orbit=new OrbitControls(camera,canvas);orbit.enableDamping=true;orbit.dampingFactor=.08;orbit.rotateSpeed=.45;orbit.zoomSpeed=.65;orbit.panSpeed=.45;orbit.screenSpacePanning=false;orbit.minDistance=8;orbit.maxDistance=150;orbit.minPolarAngle=.04;orbit.maxPolarAngle=Math.PI*.42;orbit.mouseButtons={LEFT:THREE.MOUSE.PAN,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.ROTATE};orbit.touches={ONE:THREE.TOUCH.PAN,TWO:THREE.TOUCH.DOLLY_PAN};}
function overhead(){if(!camera||!orbit||!layout)return;camera.fov=65;camera.updateProjectionMatrix();makeOrbit();const p=overviewPreset(layout.bounds,camera.aspect,camera.fov);orbit.maxDistance=Math.max(150,p.height*1.25);camera.position.set(p.x,p.height,p.z+p.height*.045);orbit.target.set(p.x,0,p.z);orbit.enabled=mode==='overview';orbit.update();}
function recenter(){if(!camera||!orbit||!layout)return;const p=overviewPreset(layout.bounds);camera.position.x+=p.x-orbit.target.x;camera.position.z+=p.z-orbit.target.z;orbit.target.set(p.x,0,p.z);orbit.update();}
function reviewLegend(){return '<details class="review-legend"><summary>Referencias 1, 4–20 · nombres</summary><ol>'+REVIEW_SECTIONS.map(s=>'<li value="'+s.id+'">'+s.label+'</li>').join('')+'</ol><p>Mapeo temporal y aproximado. 11: ubicación provisional.</p></details>'}
function renderReviewPlan(container,data,currentPose){container.innerHTML=buildReviewSvg(data,{pose:currentPose,showNumbers:reviewEnabled})+reviewLegend();enhancePlan(container,data,openMapExperience,{legendOnly:true});}
function updateReview(now=0){if(walkFloorNumbers)walkFloorNumbers.visible=reviewEnabled&&mode==='walk'&&!contextFailed;$('reviewTools').hidden=mode!=='overview';$('walkMinimap').hidden=!reviewEnabled||mode!=='walk'||!model||contextFailed;$('reviewNames').hidden=!reviewEnabled||mode!=='overview';if(!$('walkMinimap').hidden&&now-lastMini>120){$('miniMapImage').innerHTML=buildReviewSvg(layout,{pose,compact:true});lastMini=now}if(reviewOverview&&camera&&THREE){overviewVector??=new THREE.Vector3();reviewOverview.update(camera,overviewVector,view.clientWidth,view.clientHeight,reviewEnabled&&mode==='overview'&&!contextFailed)}}

function message(s){$('room').textContent=s;if(!active&&$('landingProgress'))$('landingProgress').textContent=s;}
function fit(){if(!renderer||!camera)return false;const w=view.clientWidth,h=view.clientHeight;if(!w||!h)return false;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();clearInput();return true;}
function setPose(smooth=false,dt=.016){const eye=floorHeight(pose.x,pose.z,layout)+1.65;camera.position.set(pose.x,smooth?THREE.MathUtils.damp(camera.position.y,eye,16,Math.min(dt,.05)):eye,pose.z);camera.rotation.order='YXZ';camera.rotation.set(pose.pitch,pose.yaw,0);}
function drawPlan(){renderReviewPlan($('plan'),layout,pose)}
function chooseMode(next,{explicit=true}={}){clearInput();if(explicit){if(next==='plan'){restorePassportPending=false;venueLoading.choosePlan();document.dispatchEvent(new CustomEvent('one16-plan'));}else venueLoading.show();}view.dataset.mode=next;view.classList.remove('zones-open');$('toggleZones').setAttribute('aria-expanded','false');$('overviewHotspots').hidden=next!=='overview';$('overviewArHint').hidden=next!=='overview';if(next==='plan')$('fallback').hidden=true;mode=next;if(model)model.traverse(o=>{if(o.name.startsWith('roof'))o.visible=next==='walk'});pose=changeMode(pose,next);$('plan').hidden=next!=='plan';canvas.hidden=next==='plan';document.querySelector('.touch-controls').hidden=next!=='walk'||venueLoading.state.cover;if(orbit)orbit.enabled=next==='overview';document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===next)));if(next==='walk'&&camera){camera.fov=65;camera.updateProjectionMatrix();setPose();}else if(next==='overview'&&camera){overhead();}else drawPlan();message(next==='walk'?'Arrastra para mirar · WASD / flechas para caminar':next==='overview'?'Arrastra para desplazar · rueda / pellizco: zoom · botón derecho: orbitar':'Plano de orientación · posición actual en azul');}
function disposeVenueObject(object){if(!object)return;const disposed=new Set();object.traverse(o=>{o.geometry?.dispose();for(const material of Array.isArray(o.material)?o.material:[o.material])if(material&&!disposed.has(material)){disposed.add(material);for(const value of Object.values(material))if(value?.isTexture&&!disposed.has(value)){disposed.add(value);value.dispose();}material.dispose();}});}
// Palta is optional and uses the venue's existing cached scene lifecycle.
function discardPalta(){paltaMount++;palta?.dispose();palta=null;}
function mountVenuePalta(attempt){
 const ownerScene=scene,ownerCamera=camera,mount=++paltaMount;
 const current=()=>mount===paltaMount&&scene===ownerScene&&camera===ownerCamera&&venueLoading.isCurrent(attempt);
 return import('./palta-reveal.mjs?v=palta-publish-1').then(module=>{
  if(current())return module.mountPaltaReveal(THREE,ownerScene,{GLTFLoader,camera:ownerCamera,canvas:null,layout,logoUrl:'./assets/palta-reveal/logo.png'});
 }).then(controller=>{
  if(!controller)return;
  if(!current()){controller.dispose();return;}
  palta=controller;venueRenderUntil=performance.now()+300;
 }).catch(error=>{if(current())console.warn('palta reveal skipped',error);});
}
function discardVenueScene(){mainStageSign?.dispose();mainStageSign=null;adsSpatial?.dispose();adsSpatial=null;defaultStage?.dispose();defaultStage=null;discardPalta();orbit?.dispose();disposeVenueObject(scene);renderer?.dispose();scene=null;camera=null;renderer=null;model=null;orbit=null;walkFloorNumbers=null;resourcesPrepared=false;}
function applyInitialIntent(){if(initialIntentApplied)return;initialIntentApplied=true;mode=initialIntent.mode;pose={...layout.spawn,mode};if(initialIntent.kind==='ar-return'){const p=initialIntent.pose,b=layout.bounds;if(p.x>=b.minX&&p.x<=b.maxX&&p.z>=b.minZ&&p.z<=b.maxZ)pose={...p,mode};}else if(initialIntent.kind==='passport-return'){const target=layout.zones.find(z=>z.id==='passport-stand16');if(target)pose={...pose,...target.view};}if(mode==='plan'){venueLoading.choosePlan();document.dispatchEvent(new CustomEvent('one16-plan'));}}
async function initialize(){
 if(resourcesPrepared&&model&&renderer&&!contextFailed)return;
 if(loading)return loading;
 const attempt=venueAttempt=venueLoading.begin();
 const controller=new AbortController();transferController=controller;
 const timeout=setTimeout(()=>controller.abort(),30000);transferTimer=timeout;
 loading=(async()=>{
  if(renderer)discardVenueScene();contextFailed=false;$('fallback').hidden=true;view.classList.remove('no-webgl');
  layout??=JSON.parse($('embeddedLayout').textContent);applyInitialIntent();$('restart').disabled=false;
  buildZones();overviewHotspots??=createOverviewHotspots($('overviewHotspots'),layout,openMapExperience);$('plan').hidden=mode!=='plan';canvas.hidden=mode==='plan';if(mode==='plan')drawPlan();
  const engine=withTimeout(loadEngine(),15000,'3D engine timeout');
  const pendingBytes=fetchModel({fetcher:url=>fetch(url,{signal:controller.signal}),onProgress:progress=>venueLoading.progress(attempt,'download',progress)});pendingBytes.catch(()=>{});
  await engine;
  if(!venueLoading.isCurrent(attempt))return;
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,matchMedia('(pointer: coarse)').matches?1.25:1.7));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
  scene=new THREE.Scene();scene.background=new THREE.Color('#d7dcdd');scene.add(new THREE.HemisphereLight(0xe7efff,0x7e6a4a,2.4));const sun=new THREE.DirectionalLight(0xfff2d2,2.6);sun.position.set(-20,22,8);scene.add(sun);const fill=new THREE.DirectionalLight(0xffffff,1.2);fill.position.set(15,14,-30);scene.add(fill);
  camera=new THREE.PerspectiveCamera(65,1,.06,400);makeOrbit();
  const bytes=await pendingBytes;venueLoading.progress(attempt,'geometry');
  const parsing=new GLTFLoader().parseAsync(bytes,'./assets/');parsing.then(gltf=>{if(!venueLoading.isCurrent(attempt))disposeVenueObject(gltf.scene);},()=>{});
  const gltf=await withTimeout(parsing,20000,'3D geometry timeout');if(!venueLoading.isCurrent(attempt))return;
  model=prepareVenueModel(gltf.scene,THREE);scene.add(model);
  defaultStage=createDefaultStageLoop(THREE,model);
  mainStageSign=createMainStageSign(THREE,model);
  // The host loop owns the stage; the recorded agent card is a legacy fallback only.
  if(!defaultStage)await applyStageCard(THREE,model,{fetchImpl:(url,options)=>fetch(url,{...options,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(5000)])})});
  if(!venueLoading.isCurrent(attempt))return;
  const adsModel=model;void mountAdsSpatial(THREE,adsModel,{defaultLoop:defaultStage,onApplied:attestAdsFrame,fetchImpl:(url,options)=>fetch(url,{...options,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(5000)])})}).then(value=>{if(model===adsModel)adsSpatial=value;else value?.dispose();}).catch(()=>{});
  mountVenuePalta(attempt);venueLoading.progress(attempt,'textures');
  let finishTextures,failTextures;const textures=new Promise((resolve,reject)=>{finishTextures=resolve;failTextures=reject;});textures.catch(()=>{});
  const manager=new THREE.LoadingManager(finishTextures,undefined,()=>failTextures(Error('Scene texture unavailable')));
  const stand=addPassportStand(model,THREE,{textureLoader:new THREE.TextureLoader(manager),onReady:()=>{if(venueLoading.isCurrent(attempt))venueRenderUntil=performance.now()+300;}});
  if(stand.userData.loadState==='loading')await withTimeout(textures,12000,'Scene texture timeout');
  if(stand.userData.loadState==='error')throw Error('Scene texture unavailable');if(!venueLoading.isCurrent(attempt))return;
  walkFloorNumbers=createWalkFloorNumbers(THREE,layout);scene.add(walkFloorNumbers);model.traverse(o=>{if(o.isMesh)o.frustumCulled=true;});
  fit();chooseMode(mode,{explicit:false});
  if(renderer.compileAsync)await withTimeout(renderer.compileAsync(scene,camera),15000,'Scene preparation timeout');
  if(!venueLoading.isCurrent(attempt))return;resourcesPrepared=true;venueLoading.prepared(attempt);$('zones').querySelectorAll('button').forEach(b=>b.disabled=false);$('fallback').hidden=true;
  document.dispatchEvent(new CustomEvent('one16-prepared'));
 })().catch(error=>{controller.abort();resourcesPrepared=false;venueLoading.fail(attempt,error);discardVenueScene();console.error('ONE16 initialization',error);throw error}).finally(()=>{clearTimeout(timeout);if(transferController===controller)transferController=null;loading=null});return loading;
}
function showFallback(text){clearInput();transferController?.abort();resourcesPrepared=false;document.querySelector('.touch-controls').hidden=true;$('zones').querySelectorAll('button').forEach(b=>b.disabled=!b.dataset.info);venueLoading.fail(venueAttempt,Error(text));if(venueLoading.state.choice==='plan'){mode='plan';view.dataset.mode='plan';view.classList.add('no-webgl');if(layout)drawPlan();$('plan').hidden=false;canvas.hidden=true;}}
function openActivation(){clearInput();if(orbit)orbit.enabled=false;return walletExperience.open();}
function buildZones(){if($('zones').children.length)return;layout.zones.forEach((z,i)=>{const b=document.createElement('button');b.textContent=z.label;b.addEventListener('click',()=>{if(!model)return;pose={...pose,...z.view,pitch:0};chooseMode('walk');message(z.label+' · Vista seleccionada');});$('zones').append(b);if(z.id==='passport'){const link=document.createElement('button');link.dataset.info='true';link.textContent='Inspeccionar Passport · AR';link.className='passport-link';link.addEventListener('click',()=>worldPassport.open());$('zones').append(link);}if(z.id==='activation'){const info=document.createElement('button');info.textContent='Activar wallet · Testnet';info.dataset.info='true';info.addEventListener('click',openActivation);$('zones').append(info);}});}
async function enter(){adsSpatial?.resume();defaultStage?.play();const serial=++entrySerial;active=true;venueLoading.show();document.body.classList.add('wallet-in-venue');view.hidden=false;document.body.style.overflow='hidden';history.replaceState(null,'','#recorrido');if(!venueLoading.state.cover)$('return').focus();try{await initialize();}catch{}if(!active||serial!==entrySerial)return;fit();if(resourcesPrepared&&!frame){last=performance.now();frame=requestAnimationFrame(loop);}}
function leave(){adsSpatial?.suspend();defaultStage?.pause();active=false;restorePassportPending=false;entrySerial++;venueLoading.leave();document.dispatchEvent(new CustomEvent('one16-left'));document.body.classList.remove('wallet-in-venue');clearInput();view.hidden=true;document.body.style.overflow='';history.replaceState(null,'',location.pathname);$('enter').focus();if(frame)cancelAnimationFrame(frame);frame=0;}
async function retryVenue(requestedMode='walk'){if(loading)return;mode=requestedMode;venueLoading.show();if(contextFailed||!resourcesPrepared)discardVenueScene();contextFailed=false;await enter();}
function loop(now){frame=0;if(!active)return;let dt=(now-last)/1000;last=now;if(resourcesPrepared&&model&&renderer){if(mode==='walk'&&!$('activationDialog').open&&!$('passportDialog').open&&!$('arSoonDialog').open&&venueLoading.state.phase==='ready'){const analog=walkInput?.input??{forward:0,right:0};const f=analog.forward+Number(keys.has('w')||keys.has('arrowup')||touch.has('forward'))-Number(keys.has('s')||keys.has('arrowdown')||touch.has('back')),r=analog.right+Number(keys.has('d')||keys.has('arrowright')||touch.has('right'))-Number(keys.has('a')||keys.has('arrowleft')||touch.has('left'));pose=walk(pose,{forward:f,right:r},dt,layout);setPose(true,dt);if(f||r){const id=roomAt(pose,layout.zones),z=layout.zones.find(z=>z.id===id);message(z?.label??'Circulación');}}else if(mode==='overview'&&!$('activationDialog').open&&!$('passportDialog').open&&!$('arSoonDialog').open){orbit.update();clampOverview(camera,orbit,layout.bounds);}$('nearPassport').hidden=mode!=='walk'||Math.hypot(pose.x-8.7,pose.z+3)>3&&Math.hypot(pose.x-PASSPORT_STAND.view.x,pose.z-PASSPORT_STAND.view.z)>2.4; $('nearActivation').hidden=mode!=='walk'||Math.hypot(pose.x-7,pose.z+4)>3;if(!$('nearActivation').hidden)$('nearPassport').hidden=true; palta?.update(dt);adsSpatial?.update();mainStageSign?.updatePlayback(adsSpatial?.playback,{active:adsSpatial?.state?.some(item=>item.placementId==='main_stage_screen'&&item.status==='active')});if(mode!=='plan'&&(!venueLoading.state.prepared||venueLoading.state.phase!=='ready'||!$('passportDialog').open||now<venueRenderUntil)){venueLoading.renderFrame(venueAttempt,{width:view.clientWidth,height:view.clientHeight,contextLost:renderer.getContext().isContextLost(),render:()=>{renderer.render(scene,camera);adsSpatial?.afterFrame({camera});}});if(venueLoading.state.phase==='ready'){document.querySelector('.touch-controls').hidden=mode!=='walk';walletExperience.afterFirstFrame();}}if(overviewHotspots){overviewVector??=new THREE.Vector3();overviewHotspots.update(camera,overviewVector,view.clientWidth,view.clientHeight,mode==='overview'&&!contextFailed);}}updateReview(now);frame=requestAnimationFrame(loop);}
const embeddedPassport=createEmbeddedPassport($('passportEmbedded'),{onReturn:()=>worldPassport.close()});
const worldPassport=bindWorldPassport({dialog:$('passportDialog'),openButtons:[$('nearPassport')],closeButton:$('closePassport'),clearInput,onOpen:()=>{venueRenderUntil=performance.now()+300;if(renderer&&scene&&camera&&mode!=='plan')renderer.render(scene,camera);embeddedPassport.mount()},onClose:()=>embeddedPassport.unmount(),loadPanel:()=>import('./passport.mjs?v=4')});
async function approachPassport(e){e?.preventDefault();if($('activationDialog').open)$('activationDialog').close();if($('passportDialog').open)$('passportDialog').close();if(!active)await enter();const target=layout?.zones.find(z=>z.id==='passport-stand16')||layout?.zones.find(z=>z.id==='passport');if(target){pose={...pose,...target.view};chooseMode(model&&!contextFailed?'walk':'plan')}worldPassport.open();}
$('passportLaunch').addEventListener('click',approachPassport);$('passportFromInfo').addEventListener('click',approachPassport);
const entranceReset=bindEntranceReset($('restart'),{getLayout:()=>layout,isWalkReady:()=>resourcesPrepared&&!!model&&!!renderer&&!contextFailed&&!renderer.getContext().isContextLost(),clearInput,closeHelp:()=>{$('helpPanel').hidden=true;if($('activationDialog').open)$('activationDialog').close();if($('passportDialog').open)$('passportDialog').close()},setPose:p=>{pose=p;last=performance.now()},resetOrbit:makeOrbit,setMode:chooseMode,announce:message});
$('activationLanding').addEventListener('click',openActivation);$('nearActivation').addEventListener('click',openActivation);$('activationDialog').addEventListener('close',()=>{clearInput();if(orbit)orbit.enabled=mode==='overview';restoreOverviewAfterDialog();mapExperienceTrigger?.focus?.({preventScroll:true});});
$('showPlan').addEventListener('click',()=>{$('fallback').hidden=true;if(layout)chooseMode('plan')});$('staticExit').addEventListener('click',()=>{leave();location.hash='accessibleTour';$('accessibleTour').focus()});
$('enter').addEventListener('click',e=>{e.preventDefault();enter()});$('return').addEventListener('click',()=>{leave();location.assign('/');});$('retry').addEventListener('click',()=>retryVenue());
$('venueWelcomeRetry')?.addEventListener('click',e=>{e.preventDefault();retryVenue();});
$('venueWelcomePlan')?.addEventListener('click',e=>{e.preventDefault();if(layout)chooseMode('plan');else{leave();location.hash='accessibleTour';revealStaticTour();}});
$('venueWelcomeExit')?.addEventListener('click',()=>leave());
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{if(!layout)return;if((!resourcesPrepared||contextFailed)&&b.dataset.mode!=='plan'){if(loading){mode=b.dataset.mode;venueLoading.show();}else retryVenue(b.dataset.mode);return;}chooseMode(b.dataset.mode)}));
$('help').addEventListener('click',()=>{$('helpPanel').hidden=!$('helpPanel').hidden;clearInput()});$('closeHelp').addEventListener('click',()=>{$('helpPanel').hidden=true});
window.addEventListener('keydown',e=>{if(!active||$('activationDialog').open||$('passportDialog').open||$('arSoonDialog').open)return;if((venueLoading.state.cover||!$('helpPanel').hidden)&&e.key!=='Escape')return;if(e.key==='Escape'){leave();return;}if(/^(w|a|s|d|arrowup|arrowdown|arrowleft|arrowright)$/i.test(e.key)){e.preventDefault();if(!e.repeat)blockedKeys.delete(e.key.toLowerCase());if(!blockedKeys.has(e.key.toLowerCase()))keys.add(e.key.toLowerCase())}});window.addEventListener('keyup',e=>{keys.delete(e.key.toLowerCase());blockedKeys.delete(e.key.toLowerCase())});window.addEventListener('blur',clearInput);document.addEventListener('visibilitychange',clearInput);window.addEventListener('resize',fit);window.addEventListener('orientationchange',()=>{clearInput();setTimeout(fit,120)});
walkInput=bindWalkInput({canvas,stick:$('walkStick'),thumb:$('stickThumb'),eventRoot:window,enabled:()=>active&&mode==='walk'&&resourcesPrepared&&venueLoading.state.phase==='ready'&&!contextFailed&&!$('passportDialog').open&&!$('activationDialog').open&&!$('arSoonDialog').open&&$('helpPanel').hidden,onLook:(dx,dy)=>{pose=turn(pose,dx,dy)}});
canvas.addEventListener('wheel',e=>{if(mode!=='walk'||!camera||$('activationDialog').open)return;e.preventDefault();camera.fov=THREE.MathUtils.clamp(camera.fov+Math.sign(e.deltaY)*3,40,85);camera.updateProjectionMatrix()},{passive:false});
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();contextFailed=true;clearInput();showFallback('Se interrumpió WebGL. Consulta el plano o reintenta el recorrido.');});
document.addEventListener('pointerdown',e=>{if(active&&view.contains(e.target))heldPointers.set(e.pointerId,e.target)},{capture:true});for(const type of ['pointerup','pointercancel'])document.addEventListener(type,e=>heldPointers.delete(e.pointerId),{capture:true});
window.__one16={get state(){return {active,mode,pose,loaded:resourcesPrepared,webgl:!!renderer,loading:venueLoading.state,input:walkInput?.state,zones:layout?.zones.length,advertising:{defaultStage:defaultStage?.state,placements:adsSpatial?.state||[]}}},wallet:walletExperience,enter,leave,chooseMode,resetToEntrance:entranceReset.reset};

// The entry intent below starts the venue once; the explicit static tour downloads no model.

function revealStaticTour(){if(location.hash==='#accessibleTour'){$('moreInfo').open=true;requestAnimationFrame(()=>$('accessibleTour').scrollIntoView())}}
window.addEventListener('hashchange',revealStaticTour);revealStaticTour();

let passportTap;
canvas.addEventListener('pointerdown',e=>{passportTap={id:e.pointerId,x:e.clientX,y:e.clientY}});
canvas.addEventListener('pointerup',e=>{const tap=passportTap;passportTap=null;if(!tap||tap.id!==e.pointerId||Math.hypot(e.clientX-tap.x,e.clientY-tap.y)>8||!model||!renderer||mode==='plan')return;const rect=canvas.getBoundingClientRect();const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);const hit=ray.intersectObjects(palta?[model,palta.root]:[model],true)[0];for(let object=hit?.object;object;object=object.parent)if(object===palta?.root){palta.toggle();return;}if(hit&&isMainStageSign(hit.object)){location.assign(MAIN_STAGE_ENTRY_URL);return;}if(hit&&isActivationObject(hit.object))openActivation();else if(hit&&isPassportObject(hit.object))worldPassport.open();else if(hit?.object.userData.adsPlacement)location.assign('/ads?placement='+encodeURIComponent(hit.object.userData.adsPlacement))});
canvas.addEventListener('pointercancel',()=>passportTap=null);
$('passportDialog').addEventListener('click',e=>{if(e.target.closest?.('#androidCamera,#androidAR,#iosAR,[slot="ar-button"],[data-passport-webar]')){try{sessionStorage.setItem('one16-ar-return',JSON.stringify({pose,mode,expires:Date.now()+600000}))}catch{}}},{capture:true});




let mapExperienceTrigger,overviewModalState;
function openMapExperience(spot,trigger){clearInput();if(mode==='overview'&&camera&&orbit)overviewModalState={position:camera.position.clone(),quaternion:camera.quaternion.clone(),target:orbit.target.clone(),fov:camera.fov};mapExperienceTrigger=trigger;if(spot.id==='activation'){openActivation();return}if(spot.id==='passport'||spot.id==='passport-stand16'){worldPassport.open();return}$('arSoonTitle').textContent=spot.label+' · próximamente';$('arSoonText').textContent=spot.detail+'. El contenido y la interacción todavía deben definirse.';if(!$('arSoonDialog').open)$('arSoonDialog').showModal();}
function closeArSoon(){$('arSoonDialog').close();clearInput();mapExperienceTrigger?.focus({preventScroll:true})}
$('closeArSoon').addEventListener('click',closeArSoon);$('returnArPlan').addEventListener('click',closeArSoon);$('arSoonDialog').addEventListener('close',()=>{clearInput();mapExperienceTrigger?.focus({preventScroll:true})});
$('passportDialog').addEventListener('close',()=>{if(mapExperienceTrigger?.isConnected)mapExperienceTrigger.focus({preventScroll:true})});
try{const mapLayout=JSON.parse($('embeddedLayout').textContent);for(const map of document.querySelectorAll('.static-map'))renderReviewPlan(map,mapLayout)}catch{}

function restoreOverviewAfterDialog(){if(!overviewModalState||mode!=='overview'||!camera)return;const state=overviewModalState;overviewModalState=null;makeOrbit();camera.position.copy(state.position);camera.quaternion.copy(state.quaternion);camera.fov=state.fov;camera.updateProjectionMatrix();orbit.target.copy(state.target);orbit.enabled=true;orbit.update();}
$('passportDialog').addEventListener('close',restoreOverviewAfterDialog);$('arSoonDialog').addEventListener('close',restoreOverviewAfterDialog);

for(const button of document.querySelectorAll('[data-overview-ar]'))button.addEventListener('click',()=>{const spot=HOTSPOTS.find(h=>h.id===button.dataset.overviewAr);if(spot)openMapExperience(spot,button)});

reviewOverview=createReviewOverview($('reviewNumbers'));
$('reviewNames').innerHTML=reviewLegend();
$('reviewToggle').addEventListener('click',()=>{reviewEnabled=!reviewEnabled;$('reviewToggle').setAttribute('aria-pressed',String(reviewEnabled));$('reviewToggle').textContent=reviewEnabled?'Números: sí':'Números: no';view.classList.toggle('review-enabled',reviewEnabled);if(layout&&mode==='plan')drawPlan();try{const data=JSON.parse($('embeddedLayout').textContent);for(const map of document.querySelectorAll('.static-map'))renderReviewPlan(map,data)}catch{}updateReview(performance.now());});
$('overviewTop').addEventListener('click',overhead);$('overviewCenter').addEventListener('click',recenter);$('miniMapFull').addEventListener('click',()=>chooseMode('plan'));

$('toggleZones').addEventListener('click',()=>{const open=view.classList.toggle('zones-open');$('toggleZones').setAttribute('aria-expanded',String(open));clearInput()});

bindAndroidLaunch({links:[$('androidCamera'),$('androidAR')],status:$('androidLaunchStatus'),fallbackNotice:$('androidFallbackNotice'),search:location.search,eventRoot:document,documentRef:document});
$('checkArAsset').addEventListener('click',async()=>{$('checkArAsset').disabled=true;$('assetCheckStatus').textContent='Comprobando el archivo público…';try{const r=await checkPassportAsset();$('assetCheckStatus').textContent=`GLB completo: ${r.bytes.toLocaleString()} bytes · ${r.type}. Archivo accesible; esto no verifica la cámara ni ARCore.`}catch(e){$('assetCheckStatus').textContent='No se pudo descargar el modelo: '+e.message}finally{$('checkArAsset').disabled=false}});
if(new URLSearchParams(location.search).get('ar_fallback')==='1')worldPassport.open();

// Resolve static access, saved AR pose, Passport return and entrance exactly once.
if(new URLSearchParams(location.search).get('publisher')==='1'&&typeof window.__adsPublisherAck==='function')void enter().then(()=>{chooseMode('overview');if(!model||!camera||!orbit)return;const box=new THREE.Box3().setFromObject(model),sphere=box.getBoundingSphere(new THREE.Sphere()),distance=sphere.radius/Math.sin(camera.fov*Math.PI/360);camera.position.copy(sphere.center).add(new THREE.Vector3(0,.7,1).normalize().multiplyScalar(distance*1.1));orbit.target.copy(sphere.center);orbit.update();}).catch(()=>{});
else if(initialIntent.kind==='static'){venueLoading.choosePlan();document.dispatchEvent(new CustomEvent('one16-plan'));$('landingProgress').textContent=venueLanguage==='es'?'Recorrido 2D disponible · el modelo se carga al entrar al 3D.':'2D tour available · the model loads when you enter 3D.';}
else enter();
