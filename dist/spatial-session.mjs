/** A placement is a world transform, never a function of a QR or image target. */
export function createSpatialPlacement(){
 let hit=null,placed=null;
 const matrix=value=>value&&value.length===16&&Array.from(value).every(Number.isFinite)?Array.from(value):null;
 return {get hit(){return hit?.slice()||null},get placed(){return placed?.slice()||null},offerHit(value){if(placed)return;hit=matrix(value);},place(){if(placed||!hit)return null;placed=hit.slice();return placed.slice();},reset(){hit=placed=null;}};
}
/** Own late grants and all session resources across exit/start races. */
export function createSpatialSession({requestSession,prepareSession,onState=()=>{},onEnd=()=>{}}){
 let current=null,pending=null,generation=0,abort=null,cleanup=null,endListener=null,state='idle',lastError=null;
 const emit=(next,error=null)=>{state=next;lastError=error;onState({state,error,busy:!!pending})};
 const release=()=>{try{cleanup?.()}catch{}cleanup=null;if(current&&endListener)current.removeEventListener('end',endListener);endListener=null;};
 const end=session=>{try{return Promise.resolve(session?.end()).catch(()=>{})}catch{return Promise.resolve()}};
 return {get state(){return state},get session(){return current},get busy(){return !!pending},
  start(){
   if(pending)return pending;if(current)return Promise.resolve(true);
   const token=++generation,controller=new AbortController();abort=controller;
   let requested;try{requested=requestSession()}catch(error){emit('error',error);onEnd();return Promise.resolve(false)}
   const task=(async()=>{let session,resources;try{
    emit('requesting');session=await requested;if(token!==generation){await end(session);return false;}
    current=session;endListener=()=>{if(token!==generation)return;++generation;controller.abort();release();current=null;pending=null;emit('ended');onEnd();};session.addEventListener('end',endListener);
    resources=await prepareSession(session,controller.signal);if(token!==generation){try{resources?.()}catch{}await end(session);return false;}
    cleanup=resources;emit('active');return true;
   }catch(error){try{resources?.()}catch{}if(token===generation){controller.abort();release();current=null;await end(session);emit('error',error);onEnd();}else await end(session);return false;
   }})().finally(()=>{if(pending===task){pending=null;onState({state,busy:false,error:lastError})}});pending=task;return task;
  },
  stop(){++generation;abort?.abort();abort=null;const old=current;release();current=null;pending=null;void end(old);emit('ended');onEnd();}
 };
}
