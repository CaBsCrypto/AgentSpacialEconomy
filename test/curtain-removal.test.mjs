import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {canStand} from '../src/navigation.mjs';
const layout=JSON.parse(fs.readFileSync(new URL('../dist/assets/layout.json',import.meta.url)));
test('the removed black curtain no longer blocks crossing between the work tables and stands',async()=>{
 const bytes=fs.readFileSync(new URL('../dist/assets/one16.glb',import.meta.url)),loader=new GLTFLoader();
 loader.register(()=>({name:'curtain-qa-textures',loadTexture:()=>Promise.resolve(new T.Texture())}));
 const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 scene.updateMatrixWorld(true);
 for(const z of [-34,-36]){
  assert.ok(canStand(-5.6,z,layout),'Obsolete curtain collision remains');
  const ray=new T.Raycaster(new T.Vector3(-6.4,1.5,z),new T.Vector3(1,0,0),0,1.4);
  assert.equal(ray.intersectObject(scene,true).length,0,'Curtain-height geometry remains in the cleared passage');
 }
});

