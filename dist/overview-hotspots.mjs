import { hotspotPositions } from './map-hotspots.mjs?v=1';
export function projectOverviewPoint(point,camera,vector,width,height){
 vector.set(point.x,point.height??1.2,point.z).project(camera);
 const left=(vector.x+1)*width/2,top=(1-vector.y)*height/2;
 return{left,top,visible:Number.isFinite(left)&&Number.isFinite(top)&&vector.z>=-1&&vector.z<=1&&left>=22&&left<=width-22&&top>=90&&top<=height-50};
}
export function separateOverviewMarkers(points,width,height,occupied=[]){
 const placed=[];const offsets=[[0,0],[0,-56],[0,56],[-56,0],[56,0],[-56,-56],[56,56],[56,-56],[-56,56],[-112,0],[112,0],[0,112]];
 return points.map(p=>{if(!p.visible)return p;for(const[dx,dy]of offsets){const x=p.left+dx,y=p.top+dy;if(x<24||x>width-24||y<90||y>height-50)continue;if(occupied.some(r=>x+24>r.left&&x-24<r.right&&y+24>r.top&&y-24<r.bottom))continue;if(placed.some(q=>Math.abs(q.x-x)<50&&Math.abs(q.y-y)<50))continue;placed.push({x,y});return{...p,displayLeft:x,displayTop:y}}return{...p,visible:false}});
}
export function createOverviewHotspots(layer,layout,onOpen){
 const positions=hotspotPositions(layout),doc=layer.ownerDocument;
 layer.replaceChildren();const entries=positions.map(spot=>{const button=doc.createElement('button');button.type='button';button.className='ar-map-beacon overview-ar-beacon';button.dataset.arHotspot=spot.id;button.dataset.status=spot.status;button.textContent=spot.mark;button.setAttribute('aria-label',`${spot.label}: ${spot.detail}`);button.title=`${spot.label}: ${spot.detail}`;button.addEventListener('click',()=>onOpen(spot,button));const leader=doc.createElement('span'),anchor=doc.createElement('span');leader.className='overview-ar-leader';anchor.className='overview-ar-anchor';leader.setAttribute('aria-hidden','true');anchor.setAttribute('aria-hidden','true');layer.append(leader,anchor,button);return{spot,button,leader,anchor}});
 return{update(camera,vector,width,height,visible,occupied=[]){layer.hidden=!visible;if(!visible)return;camera.updateMatrixWorld();const points=separateOverviewMarkers(entries.map(({spot})=>projectOverviewPoint(spot,camera,vector,width,height)),width,height,occupied);entries.forEach(({button,leader,anchor},i)=>{const p=points[i];button.hidden=leader.hidden=anchor.hidden=!p.visible;if(p.visible){button.style.left=p.displayLeft+'px';button.style.top=p.displayTop+'px';anchor.style.left=p.left+'px';anchor.style.top=p.top+'px';leader.style.left=p.left+'px';leader.style.top=p.top+'px';const dx=p.displayLeft-p.left,dy=p.displayTop-p.top;leader.style.width=Math.hypot(dx,dy)+'px';leader.style.transform=`rotate(${Math.atan2(dy,dx)}rad)`}})},entries};
}
