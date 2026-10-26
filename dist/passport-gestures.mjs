/** Distinguish a tap on the Passport from rotation, pinch, and canceled pointer sequences. */
export function bindPassportGestures(surface,{transform,onTap=()=>{},onTransform=()=>{},isPaused=()=>false}={}){
 const pointers=new Map();let pinch=0,total=0,multiTouch=false,canceled=false,disposed=false;
 const distance=()=>{const points=[...pointers.values()];return points.length===2?Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y):0;};
 const capture=id=>{try{surface.setPointerCapture?.(id);}catch{}};
 const release=id=>{try{surface.releasePointerCapture?.(id);}catch{}};
 const down=event=>{
  if(disposed||isPaused()||pointers.has(event.pointerId)||(typeof event.button==='number'&&event.button!==0))return;
  event.preventDefault();
  if(!pointers.size){total=0;multiTouch=false;canceled=false;}
  pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(pointers.size>1)multiTouch=true;
  pinch=distance();capture(event.pointerId);
 };
 const move=event=>{
  const previous=pointers.get(event.pointerId);if(disposed||!previous)return;
  if(isPaused()){canceled=true;return;}
  event.preventDefault();const dx=event.clientX-previous.x,dy=event.clientY-previous.y;
  total+=Math.hypot(dx,dy);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(pointers.size===2){const next=distance();if(pinch>0&&next>0)transform.pinch(next/pinch);pinch=next;}
  else if(pointers.size===1)transform.drag(dx,dy);
  else return;
  onTransform();
 };
 const up=event=>{
  const previous=pointers.get(event.pointerId);if(disposed||!previous)return;
  if(event.type!=='pointerup')canceled=true;
  if(Number.isFinite(event.clientX)&&Number.isFinite(event.clientY))total+=Math.hypot(event.clientX-previous.x,event.clientY-previous.y);
  const tap=event.type==='pointerup'&&pointers.size===1&&!multiTouch&&!canceled&&!isPaused()&&total<8;
  pointers.delete(event.pointerId);pinch=distance();release(event.pointerId);
  if(tap)onTap(event);
 };
 surface.addEventListener('pointerdown',down);surface.addEventListener('pointermove',move);
 for(const type of ['pointerup','pointercancel','lostpointercapture'])surface.addEventListener(type,up);
 return()=>{
  if(disposed)return;disposed=true;
  surface.removeEventListener('pointerdown',down);surface.removeEventListener('pointermove',move);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])surface.removeEventListener(type,up);
  for(const id of pointers.keys())release(id);
  pointers.clear();pinch=total=0;multiTouch=canceled=false;
 };
}
