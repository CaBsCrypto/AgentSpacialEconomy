import {REVIEW_SECTIONS} from './review-map.mjs';
const floorY=s=>s.id===2?.15:s.id===3?-.45:s.id<=6?-1.05:s.id===7?-.45:0;
/** Uses the supplied real THREE.Vector3 and camera, never a schematic projection. */
export function projectReviewPoint(section,camera,vector,width,height){
 vector.set(section.x,floorY(section)+.08,section.z).project(camera);
 const left=(vector.x+1)*width/2,top=(1-vector.y)*height/2;
 return {left,top,visible:Number.isFinite(left)&&Number.isFinite(top)&&Number.isFinite(vector.z)&&vector.z>=-1&&vector.z<=1&&left>=0&&left<=width&&top>=0&&top<=height};
}
/** Nearest available24px grid slot. A crowded viewport never silently drops an on-screen ID. */
 const offsets=[[0,0]];
 for(let r=1;r<=12;r++){for(let x=-r;x<=r;x++){offsets.push([x*26,-r*26],[x*26,r*26]);}for(let y=-r+1;y<r;y++)offsets.push([-r*26,y*26],[r*26,y*26]);}
 offsets.sort((a,b)=>Math.hypot(...a)-Math.hypot(...b));

export function separateReviewMarkers(points,width,height){
 const placed=[],pad=13,step=26,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 return points.map(p=>{
  if(!p.visible)return p;
  let best=null;
  for(const [dx,dy] of offsets){const x=clamp(p.left+dx,pad,Math.max(pad,width-pad)),y=clamp(p.top+dy,pad,Math.max(pad,height-pad));if(placed.some(q=>Math.hypot(q.x-x,q.y-y)<25))continue;best={x,y};break;}
  // Unavoidably tiny viewports may overlap, but retain numbers rather than disappear.
  best??={x:clamp(p.left,pad,Math.max(pad,width-pad)),y:clamp(p.top,pad,Math.max(pad,height-pad))};placed.push(best);
  return {...p,displayLeft:best.x,displayTop:best.y};
 });
}
export function createReviewOverview(layer){
 const doc=layer.ownerDocument;layer.replaceChildren();layer.style.pointerEvents='none';
 const entries=REVIEW_SECTIONS.map(section=>{
  const badge=doc.createElement('span'),leader=doc.createElement('span'),anchor=doc.createElement('span');
  badge.className='review-overview-number';badge.dataset.reviewId=String(section.id);badge.dataset.reviewNumber=String(section.id);badge.textContent=String(section.id);badge.title=`${section.id}. ${section.label}`;badge.setAttribute('aria-label',badge.title);
  badge.style.cssText='position:absolute;display:grid;place-items:center;width:24px;height:24px;box-sizing:border-box;transform:translate(-50%,-50%);border-radius:50%;background:#f5da72;color:#111b25;border:1.5px solid #132536;font:750 12px/1 system-ui,sans-serif;pointer-events:none;user-select:none;';
  if(section.provisional){badge.style.background='#18283a';badge.style.color='#f5da72';badge.style.border='1.5px dashed #f5da72';}
  leader.className='review-overview-leader';anchor.className='review-overview-anchor';
  for(const e of [leader,anchor]){e.dataset.reviewId=String(section.id);e.setAttribute('aria-hidden','true');}
  leader.style.cssText='position:absolute;height:1px;background:#f5da72;transform-origin:0 50%;pointer-events:none;';
  anchor.style.cssText='position:absolute;width:4px;height:4px;border-radius:50%;background:#f5da72;transform:translate(-50%,-50%);pointer-events:none;';
  layer.append(leader,anchor,badge);return {section,badge,leader,anchor};
 });
 return {entries,update(camera,vector,width,height,visible){
  layer.hidden=!visible;if(!visible)return;
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0){layer.hidden=true;return;}
  camera.updateMatrixWorld();
  const points=separateReviewMarkers(entries.map(e=>projectReviewPoint(e.section,camera,vector,width,height)),width,height);
  entries.forEach(({badge,leader,anchor},i)=>{
   const p=points[i];badge.hidden=leader.hidden=anchor.hidden=!p.visible;
   // Inline display must agree with hidden; explicit grid otherwise overrides browser [hidden].
   badge.style.display=p.visible?'grid':'none';leader.style.display=anchor.style.display=p.visible?'block':'none';
   if(!p.visible)return;
   badge.style.left=`${p.displayLeft}px`;badge.style.top=`${p.displayTop}px`;anchor.style.left=leader.style.left=`${p.left}px`;anchor.style.top=leader.style.top=`${p.top}px`;
   const dx=p.displayLeft-p.left,dy=p.displayTop-p.top;leader.style.width=`${Math.hypot(dx,dy)}px`;leader.style.transform=`rotate(${Math.atan2(dy,dx)}rad)`;leader.style.display=anchor.style.display=Math.hypot(dx,dy)>1?'block':'none';
  });
 }};
}
