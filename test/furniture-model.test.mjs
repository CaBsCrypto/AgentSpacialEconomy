import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
const bytes=fs.readFileSync(new URL('../dist/assets/one16.glb',import.meta.url));
const loader=new GLTFLoader();
loader.register(()=>({name:'furniture-qa-images',loadTexture:()=>Promise.resolve(new T.Texture())}));
const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'');
scene.updateMatrixWorld(true);
const lower=[];scene.traverse(o=>{if(o.name.startsWith('Lower_lounge_')&&o.userData.furniture_type)lower.push(o)});
test('lower lounge exports four independent blue padded modules and four round mustard poufs',()=>{
 assert.equal(lower.length,8);
 const sofas=lower.filter(o=>o.userData.back_rake_degrees),poufs=lower.filter(o=>o.userData.furniture_type==='round upholstered pouf');
 assert.equal(sofas.length,4);assert.equal(poufs.length,4);
 for(const root of sofas){
  assert.equal(root.userData.back_rake_degrees,9);assert.equal(root.userData.seat_height_m,.4);
  const box=new T.Box3().setFromObject(root);
  assert.ok(Math.abs(box.min.y+1.05)<.006);
  assert.ok(box.max.y-box.min.y>.80&&box.max.y-box.min.y<.88);
  assert.ok(root.children.length>=5);
  assert.ok(root.children.every(o=>o.isMesh&&o.userData.furniture_part));
  assert.ok(root.children.every(o=>o.material.name==='Petrol blue upholstery'));
  assert.ok(root.children.some(o=>o.geometry.attributes.position.count>80),'Padded surfaces must have curved topology');
 }
 for(const root of poufs){
  const box=new T.Box3().setFromObject(root),size=box.getSize(new T.Vector3());
  assert.ok(Math.abs(size.x-.64)<.006);assert.ok(Math.abs(size.z-.64)<.006);assert.ok(Math.abs(size.y-.44)<.006);
  assert.equal(root.children.length,2,'Independent body and stitched seam');
 }
});
test('side lounge modules stay perpendicular to armchairs below the guardrail',()=>{
 for(const side of ['left','right']){
  const arm=lower.find(o=>o.name==='Lower_lounge_'+side+'_armchair');
  const chaise=lower.find(o=>o.name==='Lower_lounge_'+side+'_L');
  assert.ok(arm&&chaise);
  const a=new T.Vector3(1,0,0).transformDirection(arm.matrixWorld),b=new T.Vector3(1,0,0).transformDirection(chaise.matrixWorld);
  assert.ok(Math.abs(a.dot(b))<1e-6);
  const ap=arm.getWorldPosition(new T.Vector3()),bp=chaise.getWorldPosition(new T.Vector3());
  assert.ok(Math.abs(ap.z-.65)<1e-6);assert.ok(Math.abs(bp.z-4.1)<1e-6);
 }
});


test('padded backs meet the seat cushions without the reviewed open horizontal gap',()=>{
 for(const root of lower.filter(o=>o.userData.back_rake_degrees)){
  const back=root.children.find(o=>o.name.includes('raked_back'));
  assert.ok(back,root.name+' back');
  const backBox=new T.Box3().setFromObject(back);
  for(const seat of root.children.filter(o=>o.name.includes('seat_cushion')||o.name.includes('chaise_cushion'))){
   const seatBox=new T.Box3().setFromObject(seat);
   assert.ok(backBox.min.y<=seatBox.max.y-.02,root.name+' leaves an open seam below its back');
  }
 }
});
