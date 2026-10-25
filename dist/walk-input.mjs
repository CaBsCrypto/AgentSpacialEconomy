/** Analog thumbstick and look own distinct pointer IDs; no camera permission needed. */
export function stickVector(dx,dy,radius=48,deadzone=.14){const length=Math.hypot(dx,dy),magnitude=Math.min(1,length/radius);if(magnitude<=deadzone)return{forward:0,right:0,thumbX:dx,thumbY:dy};const strength=(magnitude-deadzone)/(1-deadzone),scale=Math.min(length,radius)/Math.max(length,1);return{forward:-dy/length*strength,right:dx/length*strength,thumbX:dx*scale,thumbY:dy*scale}}
export function bindWalkInput({canvas,stick,thumb,enabled,onLook,eventRoot,radius=48}){
 let movement=null,look=null,axis={forward:0,right:0};const cleanups=[];
 const listen=(el,type,fn)=>{el.addEventListener(type,fn,{passive:false});cleanups.push(()=>el.removeEventListener(type,fn))};
 const capture=(el,id)=>{try{el.setPointerCapture(id)}catch{}};
 const releaseCapture=(el,id)=>{try{if(el.hasPointerCapture?.(id))el.releasePointerCapture(id)}catch{}};
 const paint=(x=0,y=0)=>{thumb.style.transform=`translate(${x}px,${y}px)`;stick.classList.toggle('is-held',!!movement);stick.setAttribute('aria-pressed',String(!!movement))};
 const update=e=>{const v=stickVector(e.clientX-movement.x,e.clientY-movement.y,radius);axis={forward:v.forward,right:v.right};paint(v.thumbX,v.thumbY)};
 const release=id=>{if(movement?.id===id){movement=null;axis={forward:0,right:0};paint();releaseCapture(stick,id)}if(look?.id===id){look=null;releaseCapture(canvas,id)}};
 listen(stick,'pointerdown',e=>{if(!enabled()||movement)return;e.preventDefault();const r=stick.getBoundingClientRect();movement={id:e.pointerId,x:r.left+r.width/2,y:r.top+r.height/2};capture(stick,e.pointerId);update(e)});
 listen(stick,'pointermove',e=>{if(!enabled()||movement?.id!==e.pointerId)return;e.preventDefault();update(e)});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(stick,type,e=>release(e.pointerId));
 listen(canvas,'pointerdown',e=>{if(!enabled()||look)return;e.preventDefault();look={id:e.pointerId,x:e.clientX,y:e.clientY};capture(canvas,e.pointerId)});
 listen(canvas,'pointermove',e=>{if(!enabled()||look?.id!==e.pointerId)return;e.preventDefault();onLook(e.clientX-look.x,e.clientY-look.y);look.x=e.clientX;look.y=e.clientY});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(canvas,type,e=>release(e.pointerId));
 if(eventRoot){for(const type of ['pointerup','pointercancel'])listen(eventRoot,type,e=>release(e.pointerId));listen(eventRoot,'blur',()=>clear())}
 const clear=()=>{const ids=[...(movement?[movement.id]:[]),...(look?[look.id]:[])];for(const id of ids)release(id)};
 return{clear,dispose(){clear();for(const fn of cleanups)fn()},get input(){if(!enabled()){clear();return{forward:0,right:0}}return{...axis}},get state(){return{movementPointer:movement?.id??null,lookPointer:look?.id??null,...axis}}};
}
