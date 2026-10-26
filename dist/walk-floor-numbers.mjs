import {REVIEW_SECTIONS} from './review-map.mjs';
import {floorHeight,canStand} from './navigation.mjs';
// Keep each floor label in its section, moving it out from under furniture when needed.
export function floorReviewPosition(section,layout){
 const candidates=[[section.x,section.z]];
 for(let r=.5;r<=3;r+=.5)for(let i=0;i<16;i++){const a=i*Math.PI/8;candidates.push([section.x+Math.cos(a)*r,section.z+Math.sin(a)*r]);}
 const [x,z]=candidates.find(([x,z])=>canStand(x,z,layout))||candidates[0];
 return {x,y:floorHeight(x,z,layout)+.035,z};
}
export function createWalkFloorNumbers(THREE,layout){
 const group=new THREE.Group();group.name='Walk review floor numbers';
 for(const section of REVIEW_SECTIONS){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const ctx=canvas.getContext('2d');ctx.beginPath();ctx.arc(128,128,116,0,Math.PI*2);ctx.fillStyle=section.provisional?'#18283a':'#f5da72';ctx.fill();ctx.strokeStyle='#132536';ctx.lineWidth=10;ctx.stroke();
  ctx.fillStyle=section.provisional?'#f5da72':'#111b25';ctx.font='bold 136px system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(section.id),128,136);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1.45,1.45),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,side:THREE.DoubleSide}));
  const p=floorReviewPosition(section,layout);mesh.rotation.x=-Math.PI/2;mesh.position.set(p.x,p.y,p.z);mesh.name=`Floor reference ${section.id} · ${section.label}`;mesh.userData.reviewId=section.id;group.add(mesh);
 }
 return group;
}
