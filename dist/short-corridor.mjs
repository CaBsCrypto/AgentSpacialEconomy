import {moveMerchBackdropCollision} from './merch-backdrop.mjs';
// Preserve the lounge and stairs; halve the entrance corridor and move its exterior.
export const corridorZ=z=>z<=6?z:z<32?6+(z-6)/2:z-13;
export function shortenLayout(source){
 const l=structuredClone(source),poly=p=>p.map(([x,z])=>[x,corridorZ(z)]);
 l.walkable=l.walkable.map(poly);
 for(const s of l.surfaces){s.polygon=poly(s.polygon);s.originZ=corridorZ(s.originZ);}
 for(const b of l.obstacles){const c=(b.minZ+b.maxZ)/2,d=corridorZ(c)-c;if(b.maxZ-b.minZ<6){b.minZ+=d;b.maxZ+=d;}else{b.minZ=corridorZ(b.minZ);b.maxZ=corridorZ(b.maxZ);}}
 for(const z of l.zones){z.polygon=poly(z.polygon);z.view.z=corridorZ(z.view.z);}
 l.spawn.z=corridorZ(l.spawn.z);l.bounds.maxZ=corridorZ(l.bounds.maxZ);
 for(const key of ['exteriorRoute','standsRoute'])for(const p of l[key]||[])p.z=corridorZ(p.z);
 return moveMerchBackdropCollision(l);
}
export function shortenScene(scene,T){
 scene.updateMatrixWorld(true);const p=new T.Vector3(),n=new T.Vector3();
 scene.traverse(o=>{
  if(!o.isMesh)return;
  const source=o.geometry.attributes.position;let min=Infinity,max=-Infinity;
  for(let i=0;i<source.count;i++){p.fromBufferAttribute(source,i).applyMatrix4(o.matrixWorld);min=Math.min(min,p.z);max=Math.max(max,p.z);}
  if(max<=6)return;
  const g=o.geometry=o.geometry.clone(),a=g.attributes.position,b=g.attributes.normal,inv=o.matrixWorld.clone().invert(),rigid=max-min<6,c=(min+max)/2,d=corridorZ(c)-c;
  const nw=new T.Matrix3().getNormalMatrix(o.matrixWorld),nl=nw.clone().invert();
  for(let i=0;i<a.count;i++){
   p.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);const z=p.z;p.z=rigid?z+d:corridorZ(z);p.applyMatrix4(inv);a.setXYZ(i,p.x,p.y,p.z);
   if(b&&!rigid&&z>6&&z<32){n.fromBufferAttribute(b,i).applyMatrix3(nw);n.z*=2;n.applyMatrix3(nl).normalize();b.setXYZ(i,n.x,n.y,n.z);}
  }
  a.needsUpdate=true;if(b)b.needsUpdate=true;g.computeBoundingBox();g.computeBoundingSphere();
 });
}
