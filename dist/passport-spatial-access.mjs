/** Capability checks never request an immersive session or launch a native viewer. */
export async function detectPassportSpatialSupport({navigatorRef=globalThis.navigator,documentRef=globalThis.document,secure=globalThis.isSecureContext}={}){
 if(!secure)return {kind:'unavailable',reason:'insecure-context'};
 try{if(await navigatorRef?.xr?.isSessionSupported?.('immersive-ar'))return {kind:'webxr'};}catch{}
 const ua=navigatorRef?.userAgent||'',ios=/iPad|iPhone|iPod/i.test(ua)||(navigatorRef?.platform==='MacIntel'&&navigatorRef?.maxTouchPoints>1);
 if(ios){
  try{if(documentRef?.createElement('a').relList?.supports?.('ar'))return {kind:'quick-look'};}catch{}
  return {kind:'unavailable',reason:'quick-look-not-supported'};
 }
 if(/Android/i.test(ua))return {kind:'scene-viewer',reason:'native-viewer-not-verified'};
 return {kind:'unavailable',reason:'unsupported-browser'};
}

/** Native viewers are real, synchronous anchor activations in the top-level document. */
export function mountPassportNativeAccess(host,{kind,onLaunch=()=>{},documentRef=host.ownerDocument,locationRef=documentRef.location||globalThis.location}={}){
 if(!['quick-look','scene-viewer'].includes(kind))return {setPage(){},dispose(){}};
 const root=documentRef.createElement('nav');root.className='passport-native-access';root.setAttribute('aria-label','Passport en tu espacio');
 const link=documentRef.createElement('a'),label='Colocar Passport en mi espacio';
 link.className='passport-native-link';link.setAttribute('aria-label',label);link.setAttribute('data-label','Colocar en mi espacio');
 const model=new URL(kind==='quick-look'?'./assets/passport-spatial.usdz':'./assets/passport-spatial.glb',locationRef.href);
 if(kind==='quick-look'){
  link.rel='ar';link.href=model.href;
 }else{
  const fallback=new URL('./',locationRef.href);fallback.search='passport=stand16&native_fallback=1';fallback.hash='recorrido';
  link.href=`intent://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(model.href)}&mode=ar_only&title=Stellar%20Passport#Intent;scheme=https;package=com.google.ar.core;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(fallback.href)};end;`;
 }
 const image=documentRef.createElement('img');image.src=new URL('./assets/passport-emblem.svg',locationRef.href).href;image.alt='';image.width=16;image.height=16;link.append(image);root.append(link);
 if(new URLSearchParams(locationRef.search||new URL(locationRef.href).search).get('native_fallback')==='1'){
  const note=documentRef.createElement('p');note.className='passport-native-note';note.setAttribute('role','status');note.textContent='El visor AR no se abrió. Puedes seguir explorando en 3D.';root.append(note);
 }
 host.append(root);
 let disposed=false;
 const launch=()=>{if(!disposed&&!root.hidden)onLaunch({kind});};
 link.addEventListener('click',launch);
 return {
  setPage(page){if(!disposed)root.hidden=page!==0;},
  dispose(){if(disposed)return;disposed=true;link.removeEventListener('click',launch);root.remove();}
 };
}
