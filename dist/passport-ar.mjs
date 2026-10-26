import {PASSPORT_CONTENT} from './passport-content.mjs';
import {createPassportTransform,fetchAssetBytes} from './ar-session.mjs';
import {createCameraPreview} from './camera-preview.mjs';
import {createPassportBook,loadPassportWatermark} from './passport-book.mjs';
import {createPassportReading,bindPassportReading} from './passport-reading.mjs';
import {bindPassportGestures} from './passport-gestures.mjs';
import {getInitialPassportRect} from './passport-presentation.mjs';
import {createPassportFirstFrame} from './passport-first-frame.mjs';
import {createPassportSpatialController} from './passport-spatial-controller.mjs';
import {detectPassportSpatialSupport} from './passport-spatial-access.mjs';
const $=id=>document.getElementById(id),transform=createPassportTransform(),params=new URLSearchParams(location.search),embedded=params.get('embedded')==='1',fullscreen=params.get('presentation')==='fullscreen';
let spatialSupport={kind:'checking'},preferredMode='camera',mode='intro',view=null,viewPromise=null,viewGeneration=0,viewAbort=null,enginePromise,paused=false;
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)'),timings={cameraRequested:null,cameraReady:null,firstFrame:null};
const tellParent=data=>{if(embedded)parent.postMessage(data,location.origin);};
function returnToWorld(){suspend({reset:true});if(embedded)tellParent({type:'passport-return-world'});else location.assign('./?passport=return#recorrido');}
const reading=createPassportReading({onChange:page=>{view?.rig.setPage(page===3?0:page);tellParent({type:'passport-reading-page',page});document.body.classList.toggle('reading-complete',page===3);$('liveStatus').textContent=page===3?'Elige cómo continuar':page?'Página '+page+' de 2':'Toca el Passport para abrirlo';}});
bindPassportReading($('readingHost'),reading,{onReturn:returnToWorld});
if(embedded){document.documentElement.classList.add('embedded');$('embeddedTools').hidden=false;}
if(fullscreen){document.documentElement.classList.add('passport-fullscreen');$('returnToWorld').hidden=false;$('embeddedBrand').textContent='ONE16 / PASSPORT';}
function updateSpatialAccess(){
 if(!fullscreen)return;
 $('embedCamera').hidden=spatialSupport.kind!=='webxr';$('embedCamera').disabled=!view||!!view.spatial?.busy||!!view.renderer.xr.isPresenting;$('embedCamera').textContent='Colocar en mi espacio';$('embedCamera').setAttribute('aria-pressed','false');
 const note=spatialSupport.kind==='webxr'?'Vista previa 3D · toca Colocar en mi espacio':spatialSupport.kind==='quick-look'?'Vista previa 3D · usa Colocar en mi espacio para abrir AR de Apple':spatialSupport.kind==='scene-viewer'?'Vista previa 3D · usa el visor AR del teléfono':spatialSupport.kind==='checking'?'Comprobando AR espacial…':'Vista previa 3D · la colocación requiere un celular con AR compatible';
 $('spatialSupportNote').textContent=note;$('spatialSupportNote').hidden=false;
}
function startSpatial(){if(!view||spatialSupport.kind!=='webxr'||view.renderer.xr.isPresenting)return;camera.stop('paused');reading.close();void view.spatial.start();}

function hydrateImages(){for(const image of document.querySelectorAll('img[data-passport-src]')){image.src=image.dataset.passportSrc;delete image.dataset.passportSrc;}}
function setMode(next){
 mode=next;document.body.classList.toggle('camera-mode',next==='camera');document.body.classList.toggle('inspect-mode',next==='inspect');
 $('intro').hidden=$('footer').hidden=next!=='intro';$('inspectStage').hidden=next==='intro';$('arStage').hidden=next!=='camera';$('liveUI').hidden=next==='intro';$('stopCamera').hidden=next!=='camera';$('exitInspect').hidden=next!=='inspect';
 $('embeddedFallback').hidden=true;$('embed3d').setAttribute('aria-pressed',String(next==='inspect'));$('embedCamera').setAttribute('aria-pressed',String(next==='camera'));$('embedCamera').textContent=next==='camera'?'Detener cámara':'Ver con cámara';
 $('trackingNote').textContent=next==='camera'?'Se mantiene frente a la cámara.':'Passport flotante · cámara apagada';$('liveStatus').textContent=next==='camera'?'Preparando cámara…':'Toca el Passport para abrirlo';
 if(next==='intro'&&!embedded)hydrateImages();updateSpatialAccess();
}
function explainError(error){
 if(!window.isSecureContext)return 'La cámara requiere el enlace HTTPS de ONE16.';
 if(!navigator.mediaDevices?.getUserMedia)return 'Abre el enlace en Safari para iPhone o Chrome para Android.';
 if(['NotAllowedError','PermissionDeniedError'].includes(error?.name))return 'No se concedió permiso de cámara. Puedes seguir en 3D y reintentar desde los permisos del sitio.';
 if(['NotFoundError','DevicesNotFoundError'].includes(error?.name))return 'No encontramos una cámara disponible. Puedes seguir explorando el Passport en 3D.';
 if(error?.name==='NotReadableError')return 'Otra aplicación puede estar usando la cámara. Ciérrala y vuelve a intentar.';
 return 'No se pudo abrir la cámara. '+(error?.message||'Puedes seguir usando el Passport en 3D.');
}
const camera=createCameraPreview({createVideo(){const video=document.createElement('video');video.className='passport-camera-video';$('arStage').replaceChildren(video);return video;},onState:({state,busy,error})=>{
 $('startCamera').disabled=busy;$('startCamera').textContent=busy?'Preparando…':'Ver con cámara ↗';
 if(state==='requesting')$('liveStatus').textContent='Permite usar la cámara para continuar.';
 if(state==='ready'){timings.cameraReady??=performance.now();$('liveStatus').textContent='Passport flotante · vista con cámara';$('trackingNote').textContent='Se mantiene frente a la cámara.';tellParent({type:'passport-camera-ready',elapsed:timings.cameraReady});}
 if(state==='error'){const text=explainError(error);$('embeddedError').textContent=text;$('embeddedError').hidden=false;$('errorText').textContent=text;$('errorPanel').hidden=false;if(!paused){preferredMode='inspect';setMode('inspect');}}
}});
function loadEngine(){return enginePromise??=Promise.all([import('three'),import('three/addons/loaders/GLTFLoader.js')]).then(([T,L])=>({T,GLTFLoader:L.GLTFLoader})).catch(e=>{enginePromise=null;throw e;});}
function disposeObject(object){object?.traverse(o=>{o.geometry?.dispose();for(const material of Array.isArray(o.material)?o.material:[o.material]){if(!material)continue;for(const value of Object.values(material))if(value?.isTexture)value.dispose();material.dispose();}});}
function applyTransform(){if(view){const t=transform.value;view.object.rotation.set(t.pitch,t.yaw,0);view.object.scale.setScalar(t.scale);}}
$('reset').addEventListener('click',()=>{transform.reset();applyTransform();});$('returnToWorld').addEventListener('click',returnToWorld);
async function ensureView(){
 if(view)return view;if(viewPromise)return viewPromise;const token=viewGeneration,abort=new AbortController();viewAbort=abort;
 // Camera, model bytes and the isolated engine progress independently. Branding is optional.
 const bytesTask=fetchAssetBytes('./assets/passport.glb',{signal:abort.signal}),engineTask=loadEngine(),watermarkTask=loadPassportWatermark();
 const request=(async()=>{
  let renderer,object,asset,resize,gestures,rig,observer,reveal;
  try{
   const [{T,GLTFLoader},bytes]=await Promise.all([engineTask,bytesTask]);if(token!==viewGeneration)return null;
   const gltf=await new GLTFLoader().parseAsync(bytes,'./assets/');asset=gltf.scene;if(token!==viewGeneration){disposeObject(asset);return null;}
   rig=createPassportBook(T,asset,{content:PASSPORT_CONTENT,reducedMotion:reducedMotion.matches});rig.setPage(reading.page===3?0:reading.page,{immediate:true});
   const base=new T.Group();base.add(rig.object);base.scale.setScalar(.62);object=new T.Group();object.add(base);object.updateMatrixWorld(true);
   let front;asset.traverse(part=>{if((part.name||'').replaceAll('_',' ').toLowerCase().startsWith('passport exact supplied front'))front=part;});
   const frontBounds=new T.Box3().setFromObject(front),frontSize=frontBounds.getSize(new T.Vector3()),frontCenter=frontBounds.getCenter(new T.Vector3());
   renderer=new T.WebGLRenderer({antialias:true,alpha:true});renderer.setClearColor(0x000000,0);renderer.outputColorSpace=T.SRGBColorSpace;renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.domElement.className='passport-object-canvas';$('inspectStage').append(renderer.domElement);
   const scene=new T.Scene(),sceneCamera=new T.PerspectiveCamera(35,1,.01,100);scene.add(object,new T.HemisphereLight(0xe8f3ff,0x263041,2.5));const key=new T.DirectionalLight(0xffedcb,2.2);key.position.set(1,2,4);scene.add(key);
   const bounds=new T.Box3(),center=new T.Vector3();let width=1,height=1,top=80,bottom=140;
   const fit=()=>{
    object.updateMatrixWorld(true);bounds.setFromObject(object);bounds.getCenter(center);
    const availableWidth=Math.max(80,width-(fullscreen?96:24)),availableHeight=Math.max(100,height-top-bottom),tan=Math.tan(sceneCamera.fov*Math.PI/360),open=rig.openness;
    let distance=Math.max(.66*(1+open)*height/(2*tan*availableWidth),.91*height/(2*tan*availableHeight))+.08,desiredY=(top+availableHeight/2)/height,depth=distance;
    if(fullscreen){const rect=getInitialPassportRect(width,height),closedDistance=frontCenter.z+frontSize.x*height/(2*tan*rect.width);distance=closedDistance*(1-open)+distance*open;desiredY=.45*(1-open)+desiredY*open;depth=distance-frontCenter.z*(1-open);}
    const offset=(1-2*desiredY)*depth*tan;sceneCamera.position.set(center.x,center.y-offset,distance);sceneCamera.lookAt(center.x,center.y-offset,0);sceneCamera.updateMatrixWorld();
   };
   resize=()=>{if(view?.spatial?.busy||renderer.xr.isPresenting)return;const rect=$('inspectStage').getBoundingClientRect();if(rect.width<=0||rect.height<=0)return;width=rect.width;height=rect.height;top=fullscreen?66:embedded?82:134;bottom=$('bottomControls').getBoundingClientRect().height+(embedded?18:34);renderer.setSize(width,height,false);sceneCamera.aspect=width/height;sceneCamera.updateProjectionMatrix();fit();};
   resize();window.addEventListener('resize',resize);observer=new ResizeObserver(resize);observer.observe($('bottomControls'));
   gestures=bindPassportGestures(renderer.domElement,{transform,isPaused:()=>paused||!!view?.spatial?.busy,onTransform:applyTransform,onTap:event=>{
    const rect=renderer.domElement.getBoundingClientRect(),ray=new T.Raycaster();sceneCamera.updateMatrixWorld();object.updateMatrixWorld(true);ray.setFromCamera(new T.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),sceneCamera);if(ray.intersectObject(object,true).length)reading.next();
   }});
   reveal=createPassportFirstFrame({onReady:()=>{if(token!==viewGeneration||paused)return;timings.firstFrame??=performance.now();document.body.classList.add('passport-model-ready');tellParent({type:'passport-first-frame',elapsed:timings.firstFrame});}});
   view={renderer,object,resize,gestures,scene,camera:sceneCamera,rig,observer,reveal,spatial:null};applyTransform();let last=0;
   const previewLoop=time=>{if(paused||view?.spatial?.busy)return;rig.update(last?Math.min((time-last)/1000,.1):0);last=time;fit();renderer.render(scene,sceneCamera);reveal.rendered({calls:renderer.info.render.calls,width:renderer.domElement.width,height:renderer.domElement.height,contextLost:renderer.getContext().isContextLost()});};
   view.resumePreview=()=>{last=0;resize();renderer.setAnimationLoop(previewLoop);};
   view.spatial=createPassportSpatialController({T,renderer,scene,camera:sceneCamera,object,uiRoot:$('liveUI'),onTap:()=>reading.next(),onState:state=>{
    const active=['requesting','searching','surface-found','placed','tracking-lost'].includes(state.state);document.body.classList.toggle('spatial-active',active);document.body.dataset.spatialState=state.state;
    $('placeSpatial').disabled=!state.canPlace;$('placeSpatial').hidden=state.placed;$('repositionSpatial').hidden=!state.placed;
    $('spatialNote').textContent=state.state==='requesting'?'Permite iniciar AR para colocar el Passport.':state.state==='placed'?'Passport fijo. Puedes moverte a su alrededor.':state.state==='surface-found'?'Superficie encontrada. Toca Colocar aquí.':state.state==='tracking-lost'?'Recuperando seguimiento. Mueve el celular despacio.':'Apunta a una mesa o al suelo para encontrar una superficie.';
    if(state.state==='error'){$('embeddedError').textContent='No se pudo iniciar AR. '+(state.error?.message||'Vuelve a intentar.');$('embeddedError').hidden=false;if(state.error?.name==='NotSupportedError'&&/Android/.test(navigator.userAgent)){spatialSupport={kind:'scene-viewer'};tellParent({type:'passport-spatial-capability',...spatialSupport});}}
    updateSpatialAccess();
   },onEnd:()=>{document.body.classList.remove('spatial-active');document.body.dataset.spatialState='preview';if(paused||!view)return;if(document.visibilityState==='hidden'){paused=true;disposeView();setMode('intro');return;}const resume=()=>{if(token!==viewGeneration||paused||!view)return;preferredMode='inspect';setMode('inspect');applyTransform();view.resumePreview();};if(renderer.xr.isPresenting){const ended=()=>{renderer.xr.removeEventListener('sessionend',ended);resume();};renderer.xr.addEventListener('sessionend',ended);}else queueMicrotask(resume);}});
   view.spatial.setAnimationCallback(dt=>rig.update(dt));updateSpatialAccess();
   void watermarkTask.then(image=>{if(image&&token===viewGeneration&&view?.rig===rig)rig.setWatermarkImage(image);});
   renderer.setAnimationLoop(previewLoop);return view;
  }catch(error){reveal?.reset();gestures?.();observer?.disconnect();if(resize)window.removeEventListener('resize',resize);renderer?.dispose();renderer?.domElement.remove();rig?.dispose();disposeObject(object||asset);if(token===viewGeneration){$('embeddedError').textContent='No se pudo cargar el Passport. Puedes reintentar.';$('embeddedError').hidden=false;$('startupStatus').textContent=error.message;tellParent({type:'passport-load-error',message:'No se pudo cargar el Passport. Revisa la conexión y reintenta.'});}return null;}
 })().finally(()=>{if(viewPromise===request)viewPromise=null;});viewPromise=request;return request;
}
async function inspectPassport(){preferredMode='inspect';paused=false;camera.stop('paused');setMode('inspect');$('errorPanel').hidden=true;const ready=await ensureView();if(ready&&mode==='inspect'){if(!reading.page)$('liveStatus').textContent='Toca para abrir · arrastra para girar';ready.resize();}}
async function showCamera(){
 preferredMode='camera';paused=false;$('embeddedError').hidden=true;$('errorPanel').hidden=true;
 if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){$('embeddedError').textContent=explainError();$('embeddedError').hidden=false;await inspectPassport();return;}
 setMode('camera');timings.cameraRequested??=performance.now();const pending=camera.start();await ensureView();if(mode!=='camera')return;view?.resize();await pending;
}
$('startCamera').addEventListener('click',showCamera);$('embedCamera').addEventListener('click',()=>{if(fullscreen){startSpatial();return;}if(mode==='camera')void inspectPassport();else void showCamera();});$('stopCamera').addEventListener('click',inspectPassport);$('inspect').addEventListener('click',inspectPassport);$('embed3d').addEventListener('click',()=>{$('embeddedError').hidden=true;void inspectPassport();});
function disposeView(){++viewGeneration;viewAbort?.abort();viewAbort=null;viewPromise=null;document.body.classList.remove('passport-model-ready');if(view){view.spatial?.dispose();view.reveal.reset();view.gestures();view.observer.disconnect();window.removeEventListener('resize',view.resize);view.renderer.setAnimationLoop(null);view.renderer.dispose();view.renderer.domElement.remove();view.rig.dispose();disposeObject(view.object);view=null;}}
function suspend({reset=false}={}){paused=true;camera.stop('paused');disposeView();if(reset)reading.close();setMode('intro');}
$('exitInspect').addEventListener('click',()=>{suspend({reset:true});$('startupStatus').textContent='El Passport está listo para volver a explorar.';});
document.addEventListener('visibilitychange',()=>{if(view?.spatial?.busy)return;if(document.visibilityState==='hidden')suspend();else if(embedded)void (fullscreen||preferredMode!=='camera'?inspectPassport():showCamera());});window.addEventListener('pagehide',()=>suspend());
window.addEventListener('message',event=>{if(!embedded||event.source!==parent||event.origin!==location.origin)return;if(event.data?.type==='passport-pause')suspend({reset:true});if(event.data?.type==='passport-retry')void (preferredMode==='camera'?showCamera():inspectPassport());});
window.__passportAR={get state(){return {mode,page:reading.page,session:camera.state,busy:camera.busy,transform:transform.value,timings:{...timings},modelReady:!!view?.reveal.ready,fullscreen,cameraTracks:[...document.querySelectorAll('#arStage video')].flatMap(v=>v.srcObject?.getTracks?.()||[]).map(t=>({kind:t.kind,readyState:t.readyState})),placement:view?.spatial?.placed?'world-fixed':'preview',spatial:view?.spatial?.state||'preview',spatialSupport:spatialSupport.kind};}};
$('placeSpatial').addEventListener('click',()=>view?.spatial?.place());$('repositionSpatial').addEventListener('click',()=>{reading.close();view?.spatial?.reposition();});$('endSpatial').addEventListener('click',()=>view?.spatial?.stop());
$('liveUI').addEventListener('beforexrselect',event=>{if(event.target.closest?.('button,a,details,.passport-reading'))event.preventDefault();});
if(fullscreen){void detectPassportSpatialSupport().then(support=>{spatialSupport=support;tellParent({type:'passport-spatial-capability',...support});updateSpatialAccess();});void inspectPassport();}else if(embedded)void showCamera();else hydrateImages();
