import {createSpatialSession} from './spatial-session.mjs';
import {createWorldPassportPlacement} from './passport-world-placement.mjs';

/** Own a real immersive AR session. Only placement or reference-space reset changes the book's world matrix. */
export function createPassportSpatialController({T,renderer,scene,camera,object,uiRoot,onState=()=>{},onTap=()=>{},onEnd=()=>{},requestSession=()=>navigator.xr.requestSession('immersive-ar',{requiredFeatures:['hit-test','dom-overlay'],optionalFeatures:['local-floor'],domOverlay:{root:uiRoot}})}={}){
 const placement=createWorldPassportPlacement(T),ray=new T.Raycaster();let run=null,disposed=false,state='preview',signature='';
 const emit=(next,error=null)=>{state=next;const value={state,error,placed:!!placement.placed,canPlace:!!placement.hit&&!placement.placed&&!!run?.viewer};const key=next+':'+value.placed+':'+value.canPlace+':'+(error?.message||'');if(key!==signature){signature=key;onState(value);}};
 function restore(local){
  local.session.removeEventListener('select',local.select);local.session.removeEventListener('visibilitychange',local.visibility);local.reference?.removeEventListener('reset',local.reset);
  try{local.hitSource?.cancel();}catch{}
  if(run===local){renderer.setAnimationLoop(null);for(const [material,initial]of local.materials){material.opacity=initial.opacity;material.transparent=initial.transparent;material.needsUpdate=true;}if(object.parent===local.anchor){local.parent.add(object);object.position.copy(local.position);object.quaternion.copy(local.quaternion);object.scale.copy(local.scale);}run=null;placement.reset();}
  local.anchor?.removeFromParent();local.reticle?.removeFromParent();local.reticle?.geometry.dispose();local.reticle?.material.dispose();
 }
 function place(){
  if(!run?.viewer)return false;const matrix=placement.place(run.viewer.transform.matrix);if(!matrix)return false;
  run.anchor.matrix.fromArray(matrix);run.anchor.matrixWorldNeedsUpdate=true;run.anchor.visible=true;run.reticle.visible=false;emit('placed');return true;
 }
 async function prepare(session,signal){
  const local={session,parent:object.parent,position:object.position.clone(),quaternion:object.quaternion.clone(),scale:object.scale.clone(),viewer:null,anchor:null,reticle:null,reference:null,hitSource:null,select:null,visibility:null,reset:null,materials:new Map()};
  try{
   renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local');await renderer.xr.setSession(session);if(signal.aborted)throw signal.reason;
   local.reference=renderer.xr.getReferenceSpace();const viewerSpace=await session.requestReferenceSpace('viewer');if(signal.aborted)throw signal.reason;
   local.hitSource=await session.requestHitTestSource({space:viewerSpace});if(signal.aborted)throw signal.reason;
   placement.reset();local.anchor=new T.Group();local.anchor.name='Passport fixed world anchor';local.anchor.matrixAutoUpdate=false;local.anchor.visible=false;
   local.reticle=new T.Mesh(new T.RingGeometry(.055,.072,40).rotateX(-Math.PI/2),new T.MeshBasicMaterial({color:0xe7c47b,transparent:true,opacity:.65}));local.reticle.matrixAutoUpdate=false;local.reticle.visible=false;
   object.traverse(node=>{if(!node.isMesh)return;for(const material of Array.isArray(node.material)?node.material:[node.material]){if(local.materials.has(material))continue;local.materials.set(material,{opacity:material.opacity,transparent:material.transparent});material.opacity*=.94;material.transparent=true;material.needsUpdate=true;}});scene.add(local.anchor,local.reticle);local.anchor.add(object);object.position.set(0,0,0);object.quaternion.identity();object.scale.setScalar(.20/.62);run=local;
   local.select=event=>{
    if(!placement.placed){place();return;}
    try{const pose=event.frame?.getPose(event.inputSource.targetRaySpace,local.reference);if(!pose)return;const matrix=new T.Matrix4().fromArray(pose.transform.matrix);ray.ray.origin.setFromMatrixPosition(matrix);ray.ray.direction.set(0,0,-1).transformDirection(matrix);local.anchor.updateMatrixWorld(true);if(ray.intersectObject(object,true).length)onTap();}catch{}
   };
   local.visibility=()=>{if(session.visibilityState==='hidden')controller.stop();};
   local.reset=event=>{local.viewer=null;if(placement.rebase(event.transform?.matrix)){local.anchor.matrix.fromArray(placement.placed);local.anchor.matrixWorldNeedsUpdate=true;local.anchor.visible=false;}else local.anchor.visible=false;local.reticle.visible=false;emit('tracking-lost');};
   session.addEventListener('select',local.select);session.addEventListener('visibilitychange',local.visibility);local.reference.addEventListener('reset',local.reset);
   let last=0;renderer.setAnimationLoop((time,frame)=>{
    if(!frame||signal.aborted||run!==local)return;
    const pose=frame.getViewerPose(local.reference),tracking=!!pose&&!pose.emulatedPosition&&session.visibilityState!=='visible-blurred';
    local.viewer=tracking?pose:null;
    if(!tracking){local.anchor.visible=false;local.reticle.visible=false;emit('tracking-lost');}
    else if(placement.placed){local.anchor.visible=true;local.reticle.visible=false;emit('placed');}
    else{
     const hits=frame.getHitTestResults(local.hitSource),hit=hits.map(h=>h.getPose(local.reference)).find(p=>p?.transform?.matrix?.[5]>=.75);
     placement.offerHit(hit?.transform.matrix);local.reticle.visible=!!placement.hit;if(local.reticle.visible){local.reticle.matrix.fromArray(placement.hit);local.reticle.matrixWorldNeedsUpdate=true;}emit(local.reticle.visible?'surface-found':'searching');
    }
    if(last&&tracking)onFrame?.(Math.min((time-last)/1000,.1));last=time;renderer.render(scene,camera);
   });
   return()=>restore(local);
  }catch(error){restore(local);throw error;}
 }
 let onFrame=null;
 const controller=createSpatialSession({requestSession,prepareSession:prepare,onState:value=>{if(value.state==='requesting')emit('requesting');else if(value.state==='active')emit('searching');else if(value.state==='error')emit('error',value.error);},onEnd(){if(!disposed){if(state!=='error')emit('preview');onEnd();}}});
 return {
  get state(){return state;},get busy(){return controller.busy||!!controller.session;},get placed(){return placement.placed;},
  start(){if(disposed)return Promise.resolve(false);signature='';return controller.start();},
  stop(){if(controller.busy||controller.session)controller.stop();},
  place,
  reposition(){if(!run)return;placement.reset();run.anchor.visible=false;run.reticle.visible=false;run.viewer=null;emit('searching');},
  setAnimationCallback(callback){onFrame=callback;},
  dispose(){if(disposed)return;disposed=true;if(controller.busy||controller.session)controller.stop();if(run)restore(run);}
 };
}
