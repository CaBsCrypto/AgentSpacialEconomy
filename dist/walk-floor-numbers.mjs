import {resolveReviewSections} from './review-map.mjs';
import {floorHeight,canStand,insidePolygon} from './navigation.mjs';
// Keep each floor label in its section, moving it out from under furniture when needed.
export function floorReviewPosition(section,layout){
 // Keep reference 7 on one tread, beside the luminous center line.
 if(section.id===7&&layout.activationRoute?.length){
  const tread=layout.surfaces.find(s=>insidePolygon(section.x,section.z,s.polygon));
  if(tread){const xs=tread.polygon.map(p=>p[0]),zs=tread.polygon.map(p=>p[1]),x=Math.min(...xs)+(Math.max(...xs)-Math.min(...xs))*.8125,z=(Math.min(...zs)+Math.max(...zs))/2;return{x,y:floorHeight(x,z,layout)+.035,z,size:.30};}
 }
 const candidates=[[section.x,section.z]];
 for(let r=.5;r<=3;r+=.5)for(let i=0;i<16;i++){const a=i*Math.PI/8;candidates.push([section.x+Math.cos(a)*r,section.z+Math.sin(a)*r]);}
 const [x,z]=candidates.find(([x,z])=>canStand(x,z,layout))||candidates[0];
 return {x,y:floorHeight(x,z,layout)+.035,z};
}
export function createWalkFloorNumbers(THREE,layout){
 const group=new THREE.Group();group.name='Walk review floor numbers';
 for(const section of resolveReviewSections(layout)){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const ctx=canvas.getContext('2d');ctx.beginPath();ctx.arc(128,128,116,0,Math.PI*2);ctx.fillStyle=section.provisional?'#18283a':'#f5da72';ctx.fill();ctx.strokeStyle='#132536';ctx.lineWidth=10;ctx.stroke();
  ctx.fillStyle=section.provisional?'#f5da72':'#111b25';ctx.font='bold 136px system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(section.id),128,136);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const p=floorReviewPosition(section,layout);
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(p.size??1.45,p.size??1.45),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,side:THREE.DoubleSide}));
  mesh.rotation.x=-Math.PI/2;mesh.position.set(p.x,p.y,p.z);mesh.name=`Floor reference ${section.id} · ${section.label}`;mesh.userData.reviewId=section.id;group.add(mesh);
 }
 return group;
}
