import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {moveMerchBackdrop,moveMerchBackdropCollision} from '../dist/merch-backdrop.mjs';

const close=(a,b)=>assert.ok(Math.abs(a-b)<.00002,`${a} != ${b}`);
const selected=p=>p.x>=-12.86&&p.x<=-6.14&&p.y>=-.001&&p.y<=3.001&&p.z>=-8.67&&p.z<=-8.49;

test('real venue moves only striped Merch backdrop, preserving clothes, counter and vertical sign',async()=>{
 // Geometry-only parse: no image decoding or rendering claim.
 globalThis.self=globalThis;
 globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
 const bytes=fs.readFileSync(new URL('../dist/assets/one16.glb',import.meta.url));
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'');
 const scene=gltf.scene;scene.updateMatrixWorld(true);
 const transforms=[],snapshots=[];
 scene.traverse(o=>{
  transforms.push({object:o,position:o.position.clone(),quaternion:o.quaternion.clone(),scale:o.scale.clone()});
  if(o.isMesh)snapshots.push({mesh:o,matrix:o.matrixWorld.clone(),position:o.geometry.attributes.position.array.slice(),normal:o.geometry.attributes.normal?.array.slice()});
 });
 moveMerchBackdrop(scene,T);
 const point=new T.Vector3(),normal=new T.Vector3(),expected=new T.Vector3();let moved=0;
 for(const {mesh,matrix,position,normal:originalNormal} of snapshots){
  const actual=mesh.geometry.attributes.position.array,actualNormal=mesh.geometry.attributes.normal?.array;
  const inverse=matrix.clone().invert(),normalWorld=new T.Matrix3().getNormalMatrix(matrix),normalLocal=normalWorld.clone().invert();
  for(let i=0;i<position.length;i+=3){
   point.fromArray(position,i).applyMatrix4(matrix);
   if(mesh.name.startsWith('Entrance')&&selected(point)){
    moved++;expected.set(-19-point.x,point.y,-.45-(point.z+8.6)).applyMatrix4(inverse);
    close(actual[i],expected.x);close(actual[i+1],expected.y);close(actual[i+2],expected.z);
    if(originalNormal){normal.fromArray(originalNormal,i).applyMatrix3(normalWorld);normal.x=-normal.x;normal.z=-normal.z;normal.applyMatrix3(normalLocal).normalize();close(actualNormal[i],normal.x);close(actualNormal[i+1],normal.y);close(actualNormal[i+2],normal.z);}
   }else{
    assert.equal(actual[i],position[i]);assert.equal(actual[i+1],position[i+1]);assert.equal(actual[i+2],position[i+2]);
    if(originalNormal){assert.equal(actualNormal[i],originalNormal[i]);assert.equal(actualNormal[i+1],originalNormal[i+1]);assert.equal(actualNormal[i+2],originalNormal[i+2]);}
   }
  }
 }
 assert.equal(moved,2844);
 for(const {object,position,quaternion,scale} of transforms){assert.deepEqual(object.position.toArray(),position.toArray());assert.deepEqual(object.quaternion.toArray(),quaternion.toArray());assert.deepEqual(object.scale.toArray(),scale.toArray());}
 for(const name of ['Merch','Hack_Meridian'])close(scene.getObjectByName(name).position.z,-5.25);
 const once=snapshots.map(({mesh})=>mesh.geometry.attributes.position.array.slice());
 moveMerchBackdrop(scene,T);
 snapshots.forEach(({mesh},i)=>assert.deepEqual(mesh.geometry.attributes.position.array,once[i]));
});

test('backdrop collision follows moved panel; vertical sign and all other obstacles stay fixed',()=>{
 const source=JSON.parse(fs.readFileSync(new URL('../dist/assets/layout.json',import.meta.url)));
 const layout=structuredClone(source);
 const index=source.obstacles.findIndex(b=>Math.abs(b.minX+12.95)<.001&&Math.abs(b.maxX+6.05)<.001&&Math.abs(b.minZ+8.7)<.001);
 assert.ok(index>=0);
 moveMerchBackdropCollision(layout);
 close(layout.obstacles[index].minZ,-.55);close(layout.obstacles[index].maxZ,-.35);
 close(layout.obstacles[index].minX,-12.95);close(layout.obstacles[index].maxX,-6.05);
 layout.obstacles.forEach((b,i)=>{if(i!==index)assert.deepEqual(b,source.obstacles[i]);});
 const vertical=layout.obstacles.find(b=>Math.abs(b.minX+5.99)<.001&&Math.abs(b.maxX+5.21)<.001);
 close(vertical.minZ,-5.4);close(vertical.maxZ,-5.2);
 const once=structuredClone(layout);moveMerchBackdropCollision(layout);assert.deepEqual(layout,once);
});

