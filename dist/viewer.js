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
function loadEngine(){return enginePromise??=Promise.all([import('three'),import('./vendor/three/examples/jsm/loaders/GLTFLoader.js'),import('./vendor/three/examples/jsm/controls/OrbitControls.js')]).then(([three,loader,controls])=>{THREE=three;GLTFLoader=loader.GLTFLoader;OrbitControls=controls.OrbitControls}).catch(e=>{enginePromise=null;throw e})}
import { walk,turn,roomAt,changeMode,floorHeight } from './navigation.mjs?v=2';
import { bindEntranceReset } from './reset-controller.mjs?v=4';
const $=id=>document.getElementById(id), canvas=$('scene'),view=$('viewer');
let scene,camera,renderer,orbit,model,layout,pose,mode='walk',active=false,loading=null,last=0,drag=null,pinch=0,frame=0,contextFailed=false,transferController,transferTimer,overviewHotspots,overviewVector;
let reviewEnabled=true,reviewOverview,lastMini=0,walkInput;
// Bind native iOS preparation before any panel or heavy module can open.
bindQuickLook($('iosAR'),$('iosStatus'));
const keys=new Set(),touch=new Set(),heldPointers=new Map(),blockedKeys=new Set();
function clearInput(){walkInput?.clear();for(const key of keys)blockedKeys.add(key);keys.clear();touch.clear();drag=null;pinch=0;for(const [id,element] of heldPointers){try{if(element.hasPointerCapture?.(id))element.releasePointerCapture(id)}catch{}}heldPointers.clear();}
function makeOrbit(){orbit?.dispose();orbit=new OrbitControls(camera,canvas);orbit.enableDamping=true;orbit.dampingFactor=.08;orbit.rotateSpeed=.45;orbit.zoomSpeed=.65;orbit.panSpeed=.45;orbit.screenSpacePanning=false;orbit.minDistance=8;orbit.maxDistance=150;orbit.minPolarAngle=.04;orbit.maxPolarAngle=Math.PI*.42;orbit.mouseButtons={LEFT:THREE.MOUSE.PAN,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.ROTATE};orbit.touches={ONE:THREE.TOUCH.PAN,TWO:THREE.TOUCH.DOLLY_PAN};}
function overhead(){if(!camera||!orbit||!layout)return;camera.fov=65;camera.updateProjectionMatrix();makeOrbit();const p=overviewPreset(layout.bounds,camera.aspect,camera.fov);orbit.maxDistance=Math.max(150,p.height*1.25);camera.position.set(p.x,p.height,p.z+p.height*.045);orbit.target.set(p.x,0,p.z);orbit.enabled=mode==='overview';orbit.update();}
function recenter(){if(!camera||!orbit||!layout)return;const p=overviewPreset(layout.bounds);camera.position.x+=p.x-orbit.target.x;camera.position.z+=p.z-orbit.target.z;orbit.target.set(p.x,0,p.z);orbit.update();}
function reviewLegend(){return '<details class="review-legend"><summary>Referencias 1–20 · nombres</summary><ol>'+REVIEW_SECTIONS.map(s=>'<li value="'+s.id+'">'+s.label+'</li>').join('')+'</ol><p>Mapeo temporal y aproximado. 11: ubicación provisional.</p></details>'}
function renderReviewPlan(container,data,currentPose){container.innerHTML=buildReviewSvg(data,{pose:currentPose,showNumbers:reviewEnabled})+reviewLegend();enhancePlan(container,data,openMapExperience,{legendOnly:true});}
function updateReview(now=0){$('reviewTools').hidden=mode!=='overview';$('walkMinimap').hidden=!reviewEnabled||mode!=='walk'||!model||contextFailed;$('reviewNames').hidden=!reviewEnabled||mode!=='overview';if(!$('walkMinimap').hidden&&now-lastMini>120){$('miniMapImage').innerHTML=buildReviewSvg(layout,{pose,compact:true});lastMini=now}if(reviewOverview&&camera&&THREE){overviewVector??=new THREE.Vector3();reviewOverview.update(camera,overviewVector,view.clientWidth,view.clientHeight,reviewEnabled&&mode==='overview'&&!contextFailed)}}

function message(s){$('room').textContent=s;if(!active&&$('landingProgress'))$('landingProgress').textContent=s;}
function fit(){if(!renderer)return;const w=view.clientWidth,h=view.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();clearInput();}
function setPose(smooth=false,dt=.016){const eye=floorHeight(pose.x,pose.z,layout)+1.65;camera.position.set(pose.x,smooth?THREE.MathUtils.damp(camera.position.y,eye,16,Math.min(dt,.05)):eye,pose.z);camera.rotation.order='YXZ';camera.rotation.set(pose.pitch,pose.yaw,0);}
function drawPlan(){renderReviewPlan($('plan'),layout,pose)}
function chooseMode(next){clearInput();view.dataset.mode=next;view.classList.remove('zones-open');$('toggleZones').setAttribute('aria-expanded','false');$('overviewHotspots').hidden=next!=='overview';$('overviewArHint').hidden=next!=='overview';if(next==='plan')$('fallback').hidden=true;mode=next;if(model)model.traverse(o=>{if(o.name.startsWith('roof'))o.visible=next==='walk'});pose=changeMode(pose,next);$('plan').hidden=next!=='plan';canvas.hidden=next==='plan';document.querySelector('.touch-controls').hidden=next!=='walk';if(orbit)orbit.enabled=next==='overview';document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===next)));if(next==='walk'&&camera){camera.fov=65;camera.updateProjectionMatrix();setPose();}else if(next==='overview'&&camera){overhead();}else drawPlan();message(next==='walk'?'Arrastra para mirar · WASD / flechas para caminar':next==='overview'?'Arrastra para desplazar · rueda / pellizco: zoom · botón derecho: orbitar':'Plano de orientación · posición actual en azul');}
async function initialize(){
 if(model&&renderer)return;
 if(loading)return loading;
 loading=(async()=>{
  $('fallback').hidden=true;view.classList.remove('no-webgl');message('Cargando el espacio…');
  layout??=JSON.parse($('embeddedLayout').textContent);pose??={...layout.spawn,mode};$('restart').disabled=false;
  buildZones();overviewHotspots??=createOverviewHotspots($('overviewHotspots'),layout,openMapExperience);drawPlan();$('plan').hidden=false;canvas.hidden=true;message('Preparando motor 3D… El plano ya está disponible.');
  const engine=withTimeout(loadEngine(),15000,'El motor 3D tardó demasiado');
  transferController=new AbortController();transferTimer=setTimeout(()=>transferController.abort(),30000);
  const pendingBytes=fetchModel({fetcher:url=>fetch(url,{signal:transferController.signal}),onProgress:({loaded,total})=>message(`Preparando experiencia: ${Math.min(100,Math.round(loaded/total*100))}% · ${(loaded/1000000).toFixed(1)} MB`)});pendingBytes.catch(()=>{});
  await engine;
  try{renderer??=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});}catch(e){showFallback('WebGL no está disponible en este navegador. Puedes consultar el plano interpretativo.');throw e;}
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,matchMedia('(pointer: coarse)').matches?1.25:1.7));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
  scene=new THREE.Scene();scene.background=new THREE.Color('#d7dcdd');scene.add(new THREE.HemisphereLight(0xe7efff,0x7e6a4a,2.4));const sun=new THREE.DirectionalLight(0xfff2d2,2.6);sun.position.set(-20,22,8);scene.add(sun);const fill=new THREE.DirectionalLight(0xffffff,1.2);fill.position.set(15,14,-30);scene.add(fill);
  camera=new THREE.PerspectiveCamera(65,1,.06,400);makeOrbit();
  const bytes=await pendingBytes;message('Preparando geometría 3D…');await new Promise(resolve=>requestAnimationFrame(resolve));const gltf=await new GLTFLoader().parseAsync(bytes,'./assets/');model=gltf.scene;scene.add(model);$('zones').querySelectorAll('button').forEach(b=>b.disabled=false);model.traverse(o=>{if(o.isMesh){o.frustumCulled=true;}});fit();chooseMode('walk');$('fallback').hidden=true;if(!active)$('landingProgress').textContent='Experiencia preparada · entra cuando quieras';
 })().catch(e=>{transferController?.abort();showFallback('No se pudo iniciar el recorrido 3D. El plano sigue disponible; puedes reintentar sin salir.');console.error('ONE16 initialization',e);throw e}).finally(()=>{clearTimeout(transferTimer);loading=null});return loading;
}
function showFallback(text){clearInput();view.dataset.mode='plan';view.classList.remove('zones-open');$('toggleZones').setAttribute('aria-expanded','false');$('overviewHotspots').hidden=true;$('overviewArHint').hidden=true;mode='plan';view.classList.add('no-webgl');document.querySelector('.touch-controls').hidden=true;$('zones').querySelectorAll('button').forEach(b=>b.disabled=!b.dataset.info);$('fallback').hidden=false;$('fallbackMessage').textContent=text;message('3D no disponible · no se simula movimiento');if(layout)drawPlan();$('plan').hidden=false;canvas.hidden=true;$('retry').disabled=false;}
function openActivation(){clearInput();if(!$('activationDialog').open)$('activationDialog').showModal();}
function buildZones(){if($('zones').children.length)return;layout.zones.forEach((z,i)=>{const b=document.createElement('button');b.textContent=z.label;b.addEventListener('click',()=>{if(!model)return;pose={...pose,...z.view,pitch:0};chooseMode('walk');message(z.label+' · Vista seleccionada');});$('zones').append(b);if(z.id==='passport'){const link=document.createElement('button');link.dataset.info='true';link.textContent='Inspeccionar Passport · AR';link.className='passport-link';link.addEventListener('click',()=>worldPassport.open());$('zones').append(link);}if(z.id==='activation'){const info=document.createElement('button');info.textContent='ℹ Ver propuesta de activación';info.dataset.info='true';info.addEventListener('click',openActivation);$('zones').append(info);}});}
async function enter(){active=true;view.hidden=false;document.body.style.overflow='hidden';history.replaceState(null,'','#recorrido');$('return').focus();try{await initialize();}catch{}if(!active)return;fit();if(!frame){last=performance.now();frame=requestAnimationFrame(loop);}}
function leave(){active=false;clearInput();view.hidden=true;document.body.style.overflow='';history.replaceState(null,'',location.pathname);$('enter').focus();if(frame)cancelAnimationFrame(frame);frame=0;}
function loop(now){frame=0;if(!active)return;let dt=(now-last)/1000;last=now;if(model&&renderer&&!renderer.getContext().isContextLost()){if(mode==='walk'&&!$('passportDialog').open&&!$('arSoonDialog').open){const analog=walkInput?.input??{forward:0,right:0};const f=analog.forward+Number(keys.has('w')||keys.has('arrowup')||touch.has('forward'))-Number(keys.has('s')||keys.has('arrowdown')||touch.has('back')),r=analog.right+Number(keys.has('d')||keys.has('arrowright')||touch.has('right'))-Number(keys.has('a')||keys.has('arrowleft')||touch.has('left'));pose=walk(pose,{forward:f,right:r},dt,layout);setPose(true,dt);if(f||r){const id=roomAt(pose,layout.zones),z=layout.zones.find(z=>z.id===id);message(z?.label??'Circulación');}}else if(mode==='overview'&&!$('passportDialog').open&&!$('arSoonDialog').open){orbit.update();clampOverview(camera,orbit,layout.bounds);}$('nearPassport').hidden=mode!=='walk'||Math.hypot(pose.x-8.7,pose.z+3)>3; if(mode!=='plan')renderer.render(scene,camera);if(overviewHotspots){overviewVector??=new THREE.Vector3();overviewHotspots.update(camera,overviewVector,view.clientWidth,view.clientHeight,mode==='overview'&&!contextFailed);}}updateReview(now);frame=requestAnimationFrame(loop);}
const worldPassport=bindWorldPassport({dialog:$('passportDialog'),openButtons:[$('nearPassport'),$('passportFromActivation')],closeButton:$('closePassport'),clearInput,loadPanel:()=>import('./passport.mjs?v=4')});
async function approachPassport(e){e?.preventDefault();if($('activationDialog').open)$('activationDialog').close();if($('passportDialog').open)$('passportDialog').close();if(!active)await enter();const target=layout?.zones.find(z=>z.id==='passport');if(target){pose={...pose,...target.view};chooseMode(model&&!contextFailed?'walk':'plan')}worldPassport.open();}
$('passportLaunch').addEventListener('click',approachPassport);$('passportFromInfo').addEventListener('click',approachPassport);
const entranceReset=bindEntranceReset($('restart'),{getLayout:()=>layout,isWalkReady:()=>!!model&&!!renderer&&!contextFailed&&!renderer.getContext().isContextLost(),clearInput,closeHelp:()=>{$('helpPanel').hidden=true;if($('activationDialog').open)$('activationDialog').close();if($('passportDialog').open)$('passportDialog').close()},setPose:p=>{pose=p;last=performance.now()},resetOrbit:makeOrbit,setMode:chooseMode,announce:message});
$('activationLanding').addEventListener('click',openActivation);$('closeActivation').addEventListener('click',()=>{$('activationDialog').close();clearInput()});$('activationDialog').addEventListener('close',clearInput);$('activationReset').addEventListener('click',async()=>{$('activationDialog').close();if(!active)await enter();entranceReset.reset()});
$('showPlan').addEventListener('click',()=>{$('fallback').hidden=true;if(layout)chooseMode('plan')});$('staticExit').addEventListener('click',()=>{leave();location.hash='accessibleTour';$('accessibleTour').focus()});
$('enter').addEventListener('click',e=>{e.preventDefault();enter()});$('return').addEventListener('click',leave);$('retry').addEventListener('click',async()=>{if(loading)return;$('retry').disabled=true;try{if(contextFailed||renderer?.getContext().isContextLost()){renderer.dispose();renderer=null;model=null;contextFailed=false;}await initialize();$('fallback').hidden=true;$('zones').querySelectorAll('button').forEach(b=>b.disabled=false);chooseMode('walk');}catch{}});
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{if(!layout)return;if((!model||contextFailed)&&b.dataset.mode!=='plan'){showFallback('El modo 3D necesita WebGL. Puedes reintentar o consultar el plano.');return;}chooseMode(b.dataset.mode)}));
$('help').addEventListener('click',()=>{$('helpPanel').hidden=!$('helpPanel').hidden;clearInput()});$('closeHelp').addEventListener('click',()=>{$('helpPanel').hidden=true});
window.addEventListener('keydown',e=>{if(!active||$('activationDialog').open||$('passportDialog').open||$('arSoonDialog').open)return;if(!$('helpPanel').hidden&&e.key!=='Escape')return;if(e.key==='Escape'){leave();return;}if(/^(w|a|s|d|arrowup|arrowdown|arrowleft|arrowright)$/i.test(e.key)){e.preventDefault();if(!e.repeat)blockedKeys.delete(e.key.toLowerCase());if(!blockedKeys.has(e.key.toLowerCase()))keys.add(e.key.toLowerCase())}});window.addEventListener('keyup',e=>{keys.delete(e.key.toLowerCase());blockedKeys.delete(e.key.toLowerCase())});window.addEventListener('blur',clearInput);document.addEventListener('visibilitychange',clearInput);window.addEventListener('resize',fit);window.addEventListener('orientationchange',()=>{clearInput();setTimeout(fit,120)});
walkInput=bindWalkInput({canvas,stick:$('walkStick'),thumb:$('stickThumb'),eventRoot:window,enabled:()=>active&&mode==='walk'&&!!model&&!contextFailed&&!$('passportDialog').open&&!$('activationDialog').open&&!$('arSoonDialog').open&&$('helpPanel').hidden,onLook:(dx,dy)=>{pose=turn(pose,dx,dy)}});
canvas.addEventListener('wheel',e=>{if(mode!=='walk'||!camera)return;e.preventDefault();camera.fov=THREE.MathUtils.clamp(camera.fov+Math.sign(e.deltaY)*3,40,85);camera.updateProjectionMatrix()},{passive:false});
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();contextFailed=true;clearInput();showFallback('Se interrumpió WebGL. Consulta el plano o reintenta el recorrido.');});
document.addEventListener('pointerdown',e=>{if(active&&view.contains(e.target))heldPointers.set(e.pointerId,e.target)},{capture:true});for(const type of ['pointerup','pointercancel'])document.addEventListener(type,e=>heldPointers.delete(e.pointerId),{capture:true});
window.__one16={get state(){return {active,mode,pose,loaded:!!model,webgl:!!renderer,input:walkInput?.state,zones:layout?.zones.length}},enter,leave,chooseMode,resetToEntrance:entranceReset.reset};

// Begin preparation immediately without hiding the landing or requesting camera/audio.
initialize().catch(()=>{if(!active)$('landingProgress').textContent='3D no disponible aquí · el plano y las imágenes siguen disponibles'});

function revealStaticTour(){if(location.hash==='#accessibleTour'){$('moreInfo').open=true;requestAnimationFrame(()=>$('accessibleTour').scrollIntoView())}}
window.addEventListener('hashchange',revealStaticTour);revealStaticTour();

let passportTap;
canvas.addEventListener('pointerdown',e=>{passportTap={id:e.pointerId,x:e.clientX,y:e.clientY}});
canvas.addEventListener('pointerup',e=>{const tap=passportTap;passportTap=null;if(!tap||tap.id!==e.pointerId||Math.hypot(e.clientX-tap.x,e.clientY-tap.y)>8||!model||!renderer||mode==='plan')return;const rect=canvas.getBoundingClientRect();const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);const hit=ray.intersectObject(model,true)[0];if(hit&&isPassportObject(hit.object))worldPassport.open()});
canvas.addEventListener('pointercancel',()=>passportTap=null);
$('passportDialog').addEventListener('click',e=>{if(e.target.closest?.('#androidAR,#iosAR,[slot="ar-button"]')){try{sessionStorage.setItem('one16-ar-return',JSON.stringify({pose,mode,expires:Date.now()+600000}))}catch{}}},{capture:true});
try{const saved=JSON.parse(sessionStorage.getItem('one16-ar-return')||'null');if(location.hash==='#recorrido'&&saved?.expires>Date.now()){sessionStorage.removeItem('one16-ar-return');enter().then(()=>{if(layout){pose=saved.pose;chooseMode(model&&!contextFailed?saved.mode:'plan');worldPassport.open()}})}}catch{}

$('passportFromActivation').addEventListener('click',()=>{if($('activationDialog').open)$('activationDialog').close()});

let mapExperienceTrigger,overviewModalState;
function openMapExperience(spot,trigger){clearInput();if(mode==='overview'&&camera&&orbit)overviewModalState={position:camera.position.clone(),quaternion:camera.quaternion.clone(),target:orbit.target.clone(),fov:camera.fov};mapExperienceTrigger=trigger;if(spot.id==='passport'){worldPassport.open();return}$('arSoonTitle').textContent=spot.label+' · próximamente';$('arSoonText').textContent=spot.detail+'. El contenido y la interacción todavía deben definirse.';if(!$('arSoonDialog').open)$('arSoonDialog').showModal();}
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
