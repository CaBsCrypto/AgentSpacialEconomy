import {stopMediaTracks} from './ar-session.mjs';
/** A live camera preview; object placement is screen-relative and needs no visual target. */
export function createCameraPreview({requestStream=()=>navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'environment',width:{ideal:1280},height:{ideal:720}}}),createVideo=()=>document.createElement('video'),onState=()=>{},timeoutMs=20000}={}){
 let generation=0,pending=null,video=null,abort=null,state='idle',lastError=null;
 const emit=(next,error=null)=>{state=next;lastError=error;onState({state,error,busy:!!pending,video});};
 const clean=v=>{stopMediaTracks(v);v?.remove?.();};
 return {
  get state(){return state},get video(){return video},get busy(){return !!pending},
  start(){
   if(pending)return pending;if(state==='ready'&&video)return Promise.resolve(video);
   const token=++generation,controller=new AbortController();abort=controller;
   const task=Promise.resolve().then(async()=>{
    if(token!==generation)return null;emit('requesting');let stream,local;
    try{
     stream=await requestStream();if(token!==generation){for(const t of stream.getTracks())t.stop();return null;}
     local=createVideo();video=local;local.autoplay=true;local.muted=true;local.playsInline=true;local.setAttribute?.('playsinline','');
     await playCameraVideo(local,stream,{signal:controller.signal,timeoutMs});
     if(token!==generation){clean(local);return null;}emit('ready');return local;
    }catch(error){clean(local);if(!local)for(const t of stream?.getTracks?.()||[])t.stop();if(token===generation){video=null;emit('error',error);}return null;}
   }).finally(()=>{if(pending===task){pending=null;onState({state,error:lastError,busy:false,video});}});
   pending=task;return task;
  },
  stop(reason='paused'){++generation;pending=null;abort?.abort();abort=null;clean(video);video=null;emit(reason);}
 };
}
export function playCameraVideo(video,stream,{signal,timeoutMs=20000}={}){
 return new Promise((resolve,reject)=>{
  let settled=false,timer;
  const cleanup=()=>{clearTimeout(timer);video.removeEventListener('loadedmetadata',ready);video.removeEventListener('error',failed);signal?.removeEventListener('abort',canceled);};
  const finish=(error)=>{if(settled)return;settled=true;cleanup();error?reject(error):resolve(video);};
  const ready=async()=>{try{await video.play();if(signal?.aborted)throw signal.reason;finish();}catch(e){finish(e)}};
  const failed=()=>finish(Error('No se pudo leer el video de la cámara.'));
  const canceled=()=>finish(signal.reason||new DOMException('Cancelado','AbortError'));
  if(signal?.aborted){canceled();return;}
  video.addEventListener('loadedmetadata',ready,{once:true});video.addEventListener('error',failed,{once:true});signal?.addEventListener('abort',canceled,{once:true});
  timer=setTimeout(()=>finish(Error('La cámara tardó demasiado en mostrar video. Vuelve a intentar.')),timeoutMs);
  video.srcObject=stream;if(video.readyState>=1)void ready();
 });
}
