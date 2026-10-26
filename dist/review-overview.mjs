import {resolveReviewSections} from './review-map.mjs';
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

export function separateReviewMarkers(points,width,height,occupied=[]){
 const placed=[],pad=13,step=26,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 return points.map(p=>{
  if(!p.visible)return p;
  let best=null;
  for(const [dx,dy] of offsets){const x=clamp(p.left+dx,pad,Math.max(pad,width-pad)),y=clamp(p.top+dy,pad,Math.max(pad,height-pad));if(occupied.some(r=>x+pad>r.left&&x-pad<r.right&&y+pad>r.top&&y-pad<r.bottom))continue;if(placed.some(q=>Math.hypot(q.x-x,q.y-y)<25))continue;best={x,y};break;}
  // Unavoidably tiny viewports may overlap, but retain numbers rather than disappear.
  if(!best&&occupied.length)return {...p,visible:false};
  best??={x:clamp(p.left,pad,Math.max(pad,width-pad)),y:clamp(p.top,pad,Math.max(pad,height-pad))};placed.push(best);
  return {...p,displayLeft:best.x,displayTop:best.y};
 });
}
/** Compatibility controller: numeric authoring overlays are retired from the product. */
export function createReviewOverview(layer){
 layer.replaceChildren();layer.hidden=true;layer.style.pointerEvents='none';
 return {entries:[],update(){layer.hidden=true;},dispose(){layer.replaceChildren();layer.hidden=true;}};
}
