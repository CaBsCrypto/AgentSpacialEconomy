// Large black/yellow section-9 backdrop, relocated beside the entrance guardrail.
export function moveMerchBackdropCollision(layout){
 for(const b of layout.obstacles){if(Math.abs(b.minX+12.95)<.001&&Math.abs(b.maxX+6.05)<.001&&Math.abs(b.minZ+8.7)<.001&&Math.abs(b.maxZ+8.5)<.001){b.minZ=-.55;b.maxZ=-.35;}}
 return layout;
}
export function moveMerchBackdrop(scene,T){
 if(scene.userData.merchBackdropAdjusted)return;
 scene.updateMatrixWorld(true);const point=new T.Vector3(),normal=new T.Vector3(),meshes=[];
 scene.traverse(o=>{if(o.isMesh&&o.name.startsWith('Entrance'))meshes.push(o);});
 for(const mesh of meshes){
  const original=mesh.geometry.attributes.position,inverse=mesh.matrixWorld.clone().invert(),normalWorld=new T.Matrix3().getNormalMatrix(mesh.matrixWorld),normalLocal=normalWorld.clone().invert();let geometry;
  for(let i=0;i<original.count;i++){
   point.fromBufferAttribute(original,i).applyMatrix4(mesh.matrixWorld);
   if(point.x < -12.86||point.x > -6.14||point.z < -8.67||point.z > -8.49||point.y < -.001||point.y > 3.001)continue;
   geometry??=mesh.geometry.clone();point.x=-19-point.x;point.z=-.45-(point.z+8.6);point.applyMatrix4(inverse);geometry.attributes.position.setXYZ(i,point.x,point.y,point.z);
   const normals=geometry.attributes.normal;if(normals){normal.fromBufferAttribute(normals,i).applyMatrix3(normalWorld);normal.x=-normal.x;normal.z=-normal.z;normal.applyMatrix3(normalLocal).normalize();normals.setXYZ(i,normal.x,normal.y,normal.z);}
  }
  if(geometry){mesh.geometry=geometry;geometry.attributes.position.needsUpdate=true;if(geometry.attributes.normal)geometry.attributes.normal.needsUpdate=true;geometry.computeBoundingBox();geometry.computeBoundingSphere();}
 }
 scene.userData.merchBackdropAdjusted=true;
}
