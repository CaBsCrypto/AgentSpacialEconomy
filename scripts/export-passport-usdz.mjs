// Offline export adapter: the one known JPEG is decoded by Pillow losslessly to PNG.
// No GPU/browser capability is simulated or claimed. Unsupported canvas ops fail.
import fs from 'node:fs';import assert from 'node:assert/strict';import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';import {USDZExporter} from 'three/examples/jsm/exporters/USDZExporter.js';
const root='/workspace/shared/one16-passport/',jpeg=fs.readFileSync(root+'reference.jpg'),png=fs.readFileSync(root+'reference-lossless.png');
globalThis.self=globalThis;globalThis.ImageBitmap=class {constructor(){this.width=861;this.height=1123}};
globalThis.createImageBitmap=async blob=>{assert.deepEqual(Buffer.from(await blob.arrayBuffer()),jpeg);return new ImageBitmap()};
globalThis.document={createElement(type){
 assert.equal(type,'canvas');
 return {width:0,height:0,
  getContext(){return {
   translate(){throw Error('Unexpected texture translate')},
   scale(){throw Error('Unexpected texture flip')},
   drawImage(image,x,y,w,h){assert.equal(w,861);assert.equal(h,1123);assert.equal(x,0);assert.equal(y,0)}
  }},
  toBlob(done,type){assert.equal(type,'image/png');done(new Blob([png],{type}))}
 };
}};
const b=fs.readFileSync(root+'passport.glb');const gltf=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');gltf.scene.updateMatrixWorld(true);
const result=await new USDZExporter().parseAsync(gltf.scene,{quickLookCompatible:true,maxTextureSize:2048});fs.writeFileSync(root+'passport.usdz',result);console.log({usdzBytes:result.length});
