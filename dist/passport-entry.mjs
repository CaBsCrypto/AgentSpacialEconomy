import {getWorldWallet} from './world-wallet.mjs?v=1';
import {createEmbeddedPassport} from './embedded-passport.mjs?v=spatial2';
import {mountPassportNativeAccess} from './passport-spatial-access.mjs?v=spatial2';

/** A single loading curtain gives way to the real camera and then the first 3D frame. */
export function mountPassportEntry({documentRef=globalThis.document,onReturn=()=>{},createEmbedded=createEmbeddedPassport,createNative=mountPassportNativeAccess,timer=globalThis.setTimeout,clearTimer=globalThis.clearTimeout}={}){
 const root=documentRef.getElementById('passportDirect'),host=documentRef.getElementById('passportDirectFrame'),curtain=documentRef.getElementById('passportDirectCurtain'),cover=documentRef.getElementById('passportDirectCover'),status=documentRef.getElementById('passportDirectStatus'),retry=documentRef.getElementById('passportDirectRetry');
 if(!root||!host||!curtain||!cover||!status||!retry)throw Error('No se pudo preparar el acceso al Passport.');
 const reducedMotion=!!documentRef.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 let returning=false,revealed=false,fadeTimer,nativeAccess=null,nativeKind=null,capability=null,readingPage=0;
 const syncNative=()=>{
  const kind=!returning&&revealed&&['quick-look','scene-viewer'].includes(capability)?capability:null;
  if(!kind){nativeAccess?.dispose();nativeAccess=null;nativeKind=null;return;}
  if(nativeKind!==kind){nativeAccess?.dispose();nativeKind=kind;nativeAccess=createNative(root,{kind,documentRef,onLaunch(){root.dataset.nativeOpened='true';}});}
  nativeAccess.setPage(readingPage);
 };
 const showCurtain=text=>{clearTimer(fadeTimer);curtain.classList.remove('is-revealing','camera-ready');root.dataset.ready='false';root.dataset.error='false';curtain.hidden=false;cover.hidden=false;status.textContent=text;retry.hidden=true;if(!curtain.isConnected)root.append(curtain);};
 const controller=createEmbedded(host,{
  presentation:'fullscreen',documentRef,
  onSpatialCapability(payload){capability=payload.kind;syncNative();},
  onReadingPage(payload){if(Number.isInteger(payload.page)&&payload.page>=0&&payload.page<=3){readingPage=payload.page;syncNative();}},
  onCameraReady(){root.dataset.cameraReadyMs=String(Math.round(performance.now()));if(!returning&&!revealed)curtain.classList.add('camera-ready');},
  onReady(){
   if(returning||revealed)return;root.dataset.firstFrameMs=String(Math.round(performance.now()));revealed=true;root.dataset.ready='true';root.dataset.error='false';retry.hidden=true;syncNative();
   curtain.classList.add('is-revealing');
   if(reducedMotion)curtain.remove();else fadeTimer=timer(()=>curtain.remove(),120);
   getWorldWallet(documentRef).afterFirstFrame();
  },
  onError(){
   if(returning)return;revealed=false;syncNative();clearTimer(fadeTimer);curtain.classList.remove('is-revealing');root.dataset.error='true';root.dataset.ready='false';
   status.textContent='No se pudo cargar el Passport.';retry.hidden=false;if(!curtain.isConnected)root.append(curtain);
  },
  onReturn(){
   if(returning)return;returning=true;syncNative();showCurtain('Preparando ONE16…');controller.unmount();
   Promise.resolve().then(onReturn).catch(()=>{root.dataset.error='true';status.textContent='No se pudo abrir ONE16. Recarga la página para volver a intentar.';});
  }
 });
 const onRetry=()=>{root.dataset.error='false';status.textContent='Preparando Passport…';retry.hidden=true;controller.retry();};
 retry.addEventListener('click',onRetry);
 const styles=documentRef.createElement('link');styles.rel='stylesheet';styles.href='./passport-entry.css?v=spatial2';documentRef.head.append(styles);
 try{const observer=new PerformanceObserver(list=>{for(const item of list.getEntries())if(item.name==='first-contentful-paint'){root.dataset.contentfulPaintMs=String(Math.round(item.startTime));observer.disconnect();}});observer.observe({type:'paint',buffered:true});}catch{}
 controller.mount();
 return {unmount(){nativeAccess?.dispose();nativeAccess=null;clearTimer(fadeTimer);retry.removeEventListener('click',onRetry);controller.unmount();},retry:()=>controller.retry()};
}
