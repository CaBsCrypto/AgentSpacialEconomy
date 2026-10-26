/** Camera lifecycle, independent from the renderer so real cancellation races can be tested. */
export function createARSession({createAdapter,onState=()=>{}}){
 let adapter=null,pending=null,abortController=null,generation=0,state='idle',error=null;
 const emit=next=>{state=next;onState({state,error,busy:!!pending});};
 const cleanup=a=>{try{a?.stop();}catch{}};
 const api={
  get state(){return state;},get busy(){return !!pending;},
  start(){
   if(pending)return pending;if(adapter)return Promise.resolve(true);
   const token=++generation,runAbort=new AbortController();abortController=runAbort;error=null;
   const task=Promise.resolve().then(async()=>{
    let local;
    try{
     if(token!==generation)return false;
     emit('loading');
     local=await createAdapter({signal:runAbort.signal,found:()=>{if(token===generation&&adapter===local&&['searching','tracking'].includes(state))emit('tracking');},lost:()=>{if(token===generation&&adapter===local&&state==='tracking')emit('searching');}});
     if(token!==generation){cleanup(local);return false;}
     adapter=local;emit('requesting');await local.start();
     if(token!==generation){cleanup(local);return false;}
     emit('searching');return true;
    }catch(e){cleanup(local);if(token===generation){adapter=null;error=e;emit('error');}return false;}
   }).finally(()=>{
    // A canceled permission request may resolve after a new session has started.
    // Only the current request owns the busy flag and state notification.
    if(pending===task){pending=null;onState({state,error,busy:false});}
   });
   pending=task;return task;
  },
  stop(reason='paused'){
   ++generation;const current=adapter,currentAbort=abortController;adapter=null;pending=null;abortController=null;
   currentAbort?.abort();cleanup(current);error=null;emit(reason);
  },
 };
 return api;
}
/** Bounded, abortable asset prefetch, including response-body download. */
export async function fetchAssetBytes(url,{signal,fetcher=fetch,timeoutMs=20000,timer=setTimeout,clearTimer=clearTimeout}={}){
 const controller=new AbortController(),abort=()=>controller.abort(signal.reason);
 if(signal?.aborted)throw signal.reason;
 signal?.addEventListener('abort',abort,{once:true});
 const timeout=timer(()=>controller.abort(new DOMException('El recurso tardó demasiado. Revisa tu conexión y vuelve a intentar.','TimeoutError')),timeoutMs);
 try{const response=await fetcher(url,{signal:controller.signal});if(!response.ok)throw Error('No se pudo descargar '+url+' (HTTP '+response.status+').');return await response.arrayBuffer();}
 finally{clearTimer(timeout);signal?.removeEventListener('abort',abort);}
}
export function createPassportTransform(){
 let yaw=0,pitch=0,scale=1;
 return {get value(){return {yaw,pitch,scale};},drag(dx,dy){yaw+=dx*.008;pitch=Math.max(-.8,Math.min(.8,pitch+dy*.006));return this.value;},pinch(ratio){if(Number.isFinite(ratio)&&ratio>0)scale=Math.max(.6,Math.min(2.4,scale*ratio));return this.value;},reset(){yaw=pitch=0;scale=1;return this.value;}};
}
export function stopMediaTracks(video){const stream=video?.srcObject;for(const track of stream?.getTracks?.()||[]){try{track.stop();}catch{}}if(video){try{video.pause();}catch{}video.srcObject=null;}}
