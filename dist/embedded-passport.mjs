/** Isolate AR's renderer version while keeping the visitor in the same ONE16 origin. */
export function createEmbeddedPassport(host,{documentRef=host.ownerDocument,origin=documentRef.location?.origin||globalThis.location?.origin||'',onReturn=()=>{},onReady=()=>{},onCameraReady=()=>{},onError=()=>{},onSpatialCapability=()=>{},onReadingPage=()=>{},presentation='embedded',eventRoot=documentRef.defaultView||globalThis.window}={}){
 let frame,listening=false;
 const receive=event=>{
  if(!frame?.contentWindow||event.origin!==origin||event.source!==frame.contentWindow)return;
  if(event.data?.type==='passport-return-world')onReturn();
  else if(event.data?.type==='passport-first-frame')onReady(event.data);
  else if(event.data?.type==='passport-camera-ready')onCameraReady(event.data);
  else if(event.data?.type==='passport-load-error')onError(event.data);
  else if(event.data?.type==='passport-spatial-capability')onSpatialCapability(event.data);
  else if(event.data?.type==='passport-reading-page')onReadingPage(event.data);
 };
 return {
  mount(){
   if(frame)return frame;
   frame=documentRef.createElement('iframe');
   frame.src=presentation==='fullscreen'?'./passport-ar.html?embedded=1&presentation=fullscreen&v=spatial2':'./passport-ar.html?embedded=1&v=book2';
   frame.title='Stellar Passport dentro de ONE16';frame.allow='camera; xr-spatial-tracking; fullscreen';frame.allowFullscreen=true;frame.className='passport-embedded-frame'+(presentation==='fullscreen'?' passport-embedded-fullscreen':'');host.replaceChildren(frame);
   if(eventRoot?.addEventListener){eventRoot.addEventListener('message',receive);listening=true;}
   return frame;
  },
  retry(){if(!frame)return false;try{frame.contentWindow?.postMessage({type:'passport-retry'},origin);return true;}catch{return false;}},
  unmount(){
   if(listening){eventRoot.removeEventListener('message',receive);listening=false;}
   const mounted=frame;frame=null;
   if(mounted){try{mounted.contentWindow?.postMessage({type:'passport-pause'},origin);}catch{}mounted.remove();}
   host.replaceChildren();
  }
 };
}
