import {createSpatialPlacement,createSpatialSession} from './spatial-session.mjs';
import {PASSPORT_CONTENT} from './passport-content.mjs';
import {createPassportBook,loadPassportWatermark} from './passport-book.mjs';
import {createPassportReading,bindPassportReading} from './passport-reading.mjs';
const $=id=>document.getElementById(id),placement=createSpatialPlacement();
let T,renderer,scene,camera,book,rig,reticle,sceneReady=null,supported=false,referenceSpace=null;
const reading=createPassportReading({onChange:page=>{rig?.setPage(page===3?0:page);document.body.classList.toggle('reading-complete',page===3);}});
bindPassportReading($('spatialReading'),reading,{onReturn(){sessionController.stop();location.assign('./?passport=return#recorrido');}});
const note=text=>{$('spatialStatus').textContent=text;};
const nativeAllowed=new URLSearchParams(location.search).get('native')!=='0';
const isiOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1),isAndroid=/Android/.test(navigator.userAgent);
$('quickLook').hidden=!nativeAllowed||isAndroid;$('quickLookNote').hidden=!nativeAllowed||isAndroid;$('sceneViewer').hidden=!nativeAllowed||isiOS;
const modelURL=new URL('./assets/passport.glb',location.href).href,fallbackURL=new URL('./passport-space.html?native_fallback=1',location.href).href;
$('sceneViewer').href=`intent://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(modelURL)}&mode=ar_only&title=Stellar%20Passport#Intent;scheme=https;package=com.google.ar.core;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(fallbackURL)};end;`;
function showNative(){if(nativeAllowed)$('nativeChoices').hidden=false;}
function showWelcome(){document.body.classList.remove('spatial-active');$('welcome').hidden=false;$('arControls').hidden=true;$('endAR').hidden=true;book&&(book.visible=false);reticle&&(reticle.visible=false);renderer?.setAnimationLoop(null);reading.close();$('startAR').disabled=!supported||!sceneReady;$('startAR').textContent=supported?'Abrir cámara y colocar Passport':'AR web no disponible en este navegador';}
function errorMessage(error){if(error?.name==='NotAllowedError')return 'No se concedió permiso para iniciar AR. Puedes reintentar desde este botón.';if(error?.name==='NotSupportedError')return 'Este navegador no ofrece AR con controles interactivos. Usa el visor del teléfono o lee el libro dentro de ONE16.';return 'No se pudo iniciar AR. '+(error?.message||'Vuelve a intentar.');}
async function prepareScene(){
 if(sceneReady)return sceneReady;
 sceneReady=(async()=>{
  const [three,loader]=await Promise.all([import('three'),import('three/addons/loaders/GLTFLoader.js')]);T=three;
  const gltf=await new loader.GLTFLoader().loadAsync('./assets/passport.glb');
  const watermarkImage=await loadPassportWatermark();rig=createPassportBook(T,gltf.scene,{content:PASSPORT_CONTENT,watermarkImage,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches});
  rig.setPage(reading.page===3?0:reading.page,{immediate:true});const volume=new T.Group();volume.add(rig.object);volume.scale.setScalar(.20);volume.position.y=.18;
  rig.object.traverse(o=>{if(o.isMesh)for(const material of Array.isArray(o.material)?o.material:[o.material]){material.transparent=true;material.opacity=.94;material.depthWrite=true;}});
  book=new T.Group();book.name='Passport spatial placement';book.add(volume);book.visible=false;
  renderer=new T.WebGLRenderer({antialias:true,alpha:true});renderer.setClearColor(0x000000,0);renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=T.SRGBColorSpace;renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local');$('renderHost').replaceChildren(renderer.domElement);
  scene=new T.Scene();camera=new T.PerspectiveCamera(60,innerWidth/innerHeight,.01,30);scene.add(book,new T.HemisphereLight(0xeaf4ff,0x33404a,2.5));const light=new T.DirectionalLight(0xffedca,2.3);light.position.set(1,3,2);scene.add(light);
  reticle=new T.Mesh(new T.RingGeometry(.06,.078,40).rotateX(-Math.PI/2),new T.MeshBasicMaterial({color:0xe7c47b,transparent:true,opacity:.65}));reticle.matrixAutoUpdate=false;reticle.visible=false;scene.add(reticle);
 })().catch(error=>{sceneReady=null;throw error;});return sceneReady;
}
function placePassport(){
 const world=placement.place();if(!world)return;
 book.position.setFromMatrixPosition(new T.Matrix4().fromArray(world));const viewer=new T.Vector3();renderer.xr.getCamera().getWorldPosition(viewer);book.rotation.y=Math.atan2(viewer.x-book.position.x,viewer.z-book.position.z);book.visible=true;reticle.visible=false;
 $('placeObject').disabled=true;$('rotateObject').disabled=false;$('spatialReading').hidden=false;note('Passport colocado. Tócalo para abrirlo y descubrir sus páginas.');
}
function resetPlacement(){placement.reset();reading.close();rig?.setPage(0,{immediate:true});book.visible=false;reticle.visible=false;$('spatialReading').hidden=true;$('placeObject').disabled=true;$('rotateObject').disabled=true;note('Mueve el celular para encontrar una superficie.');}
function selectPassport(event){
 if(!placement.placed){placePassport();return;}
 try{
  const pose=event.frame?.getPose(event.inputSource.targetRaySpace,referenceSpace);if(!pose)return;
  const matrix=new T.Matrix4().fromArray(pose.transform.matrix),origin=new T.Vector3().setFromMatrixPosition(matrix),direction=new T.Vector3(0,0,-1).transformDirection(matrix);
  book.updateMatrixWorld(true);if(new T.Raycaster(origin,direction).intersectObject(book,true).length)reading.next();
 }catch{note('Usa Abrir libro o Siguiente para leer el Passport.');}
}
async function prepareXR(session,signal){
 let localHit;
 try{
  await renderer.xr.setSession(session);if(signal.aborted)throw signal.reason;
  referenceSpace=renderer.xr.getReferenceSpace();const viewerSpace=await session.requestReferenceSpace('viewer');if(signal.aborted)throw signal.reason;
  localHit=await session.requestHitTestSource({space:viewerSpace});if(signal.aborted)throw signal.reason;
  resetPlacement();session.addEventListener('select',selectPassport);let last=0;
  renderer.setAnimationLoop((time,frame)=>{
   if(!frame||signal.aborted)return;rig.update(last?Math.min((time-last)/1000,.1):0);last=time;
   if(!placement.placed){
    const results=frame.getHitTestResults(localHit),pose=results[0]?.getPose(referenceSpace);placement.offerHit(pose?.transform.matrix);
    reticle.visible=!!placement.hit;$('placeObject').disabled=!placement.hit;
    if(reticle.visible){reticle.matrix.fromArray(placement.hit);if($('spatialStatus').textContent!=='Superficie encontrada. Toca para colocar el Passport.')note('Superficie encontrada. Toca para colocar el Passport.');}
    else if($('spatialStatus').textContent!=='Mueve el celular para encontrar una superficie.')note('Mueve el celular para encontrar una superficie.');
   }
   renderer.render(scene,camera);
  });
  return()=>{try{localHit?.cancel();}catch{}session.removeEventListener('select',selectPassport);referenceSpace=null;renderer.setAnimationLoop(null);placement.reset();book.visible=false;reticle.visible=false;};
 }catch(error){try{localHit?.cancel();}catch{}session.removeEventListener('select',selectPassport);referenceSpace=null;renderer.setAnimationLoop(null);throw error;}
}
const sessionController=createSpatialSession({
 requestSession:()=>navigator.xr.requestSession('immersive-ar',{requiredFeatures:['hit-test','dom-overlay'],optionalFeatures:['local-floor'],domOverlay:{root:$('spatialUI')}}),
 prepareSession:prepareXR,
 onState:({state,error})=>{
  if(state==='requesting'){$('startAR').disabled=true;$('startAR').textContent='Solicitando cámara AR…';$('errorText').hidden=true;}
  if(state==='active'){document.body.classList.add('spatial-active');$('welcome').hidden=true;$('arControls').hidden=false;$('endAR').hidden=false;}
  if(state==='error'){$('errorText').textContent=errorMessage(error);$('errorText').hidden=false;showNative();}
 },onEnd:showWelcome
});
$('startAR').addEventListener('click',()=>{if(supported&&sceneReady)void sessionController.start();});$('endAR').addEventListener('click',()=>sessionController.stop());$('placeObject').addEventListener('click',placePassport);$('resetPlacement').addEventListener('click',resetPlacement);$('rotateObject').addEventListener('click',()=>{if(placement.placed)book.rotation.y+=Math.PI/4;});
$('spatialUI').addEventListener('beforexrselect',event=>{if(event.target.closest?.('button,a,details,.passport-reading'))event.preventDefault();});
window.addEventListener('resize',()=>{if(renderer&&!renderer.xr.isPresenting){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}});
window.addEventListener('pagehide',()=>sessionController.stop());document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')sessionController.stop();});
window.__passportSpatial={get state(){return {session:sessionController.state,page:reading.page,placed:!!placement.placed};}};
if(new URLSearchParams(location.search).get('native_fallback')==='1'){$('errorText').textContent='El visor AR del teléfono no se abrió. Comprueba su compatibilidad o vuelve a ONE16.';$('errorText').hidden=false;}
(async()=>{
 try{supported=!!(window.isSecureContext&&navigator.xr&&await navigator.xr.isSessionSupported('immersive-ar'));if(!supported){showWelcome();showNative();$('supportNote').textContent=isiOS?'Safari en iPhone no ofrece esta sesión WebXR. Abre AR con el visor de Apple y lee las páginas interactivas dentro de ONE16.':'Este navegador no ofrece AR de superficies. Puedes usar el visor compatible del teléfono o leer el Passport en ONE16.';return;}
  $('startAR').textContent='Preparando Passport…';await prepareScene();$('startAR').disabled=false;$('startAR').textContent='Abrir cámara y colocar Passport';$('supportNote').textContent='No se necesita reconocer ninguna imagen. El objeto permanece colocado durante la sesión.';
 }catch(error){$('errorText').textContent='No se pudo preparar el Passport. '+error.message;$('errorText').hidden=false;showNative();$('startAR').disabled=true;}
})();
