import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import * as T from 'three';import{GLTFLoader}from'three/examples/jsm/loaders/GLTFLoader.js';
import{addPassportStand,isPassportStandObject,PASSPORT_STAND}from'../dist/passport-stand.mjs';
const loader={load(url,onLoad){assert.equal(url,'./assets/passport-target.png');onLoad(new T.Texture());}};
test('Passport target faces the reverse of Trustless/Grantfox and is clickable from the rear only',()=>{
 const model=new T.Group(),group=addPassportStand(model,T,{textureLoader:loader});model.updateMatrixWorld(true);
 assert.equal(group.userData.loadState,'ready');assert.equal(group.children.length,1);const panel=group.children[0];assert.equal(panel.geometry.parameters.width,1.2);assert.equal(panel.geometry.parameters.height,1.44);
 const normal=new T.Vector3(0,0,1).transformDirection(panel.matrixWorld);assert.ok(normal.z<-.999);assert.ok(panel.position.z< -27.85,'poster is outside rear surface');
 const rear=new T.Raycaster(new T.Vector3(3.2,1.45,-29.15),new T.Vector3(0,0,1));assert.equal(rear.intersectObject(model,true)[0].object,panel);
 const front=new T.Raycaster(new T.Vector3(3.2,1.45,-26),new T.Vector3(0,0,-1));assert.equal(front.intersectObject(model,true).length,0);
 assert.equal(isPassportStandObject(panel),true);assert.equal(isPassportStandObject({name:'Trustless_Work'}),false);
 assert.equal(addPassportStand(model,T,{textureLoader:loader}),group);assert.equal(model.children.length,1);
});
test('adding stand graphic to real GLB leaves original brand and venue geometry unchanged',async()=>{
 globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
 const bytes=fs.readFileSync(new URL('../dist/assets/one16.glb',import.meta.url));const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'');
 scene.updateMatrixWorld(true);const before=[];scene.traverse(o=>{before.push({o,name:o.name,position:o.position.toArray(),quaternion:o.quaternion.toArray(),geometry:o.geometry,buffer:o.geometry?.attributes.position.array.slice()});});
 const group=addPassportStand(scene,T,{textureLoader:loader});scene.updateMatrixWorld(true);
 for(const b of before){assert.equal(b.o.name,b.name);assert.deepEqual(b.o.position.toArray(),b.position);assert.deepEqual(b.o.quaternion.toArray(),b.quaternion);assert.equal(b.o.geometry,b.geometry);if(b.buffer)assert.deepEqual(b.o.geometry.attributes.position.array,b.buffer);}
 assert.ok(scene.getObjectByName('Stands_label_Trustless_Work'));assert.ok(scene.getObjectByName('Stands_label_Grantfox'));
 const hit=new T.Raycaster(new T.Vector3(PASSPORT_STAND.view.x,1.45,PASSPORT_STAND.view.z),new T.Vector3(0,0,1)).intersectObject(scene,true)[0];assert.ok(isPassportStandObject(hit.object),'rear viewpoint hits poster before original backdrop');assert.equal(group.parent,scene);
});
test('a regenerated source poster is reused without loading a book or duplicating the target',()=>{
 let modelLoads=0,textureLoads=0;
 class UnexpectedLoader{constructor(){modelLoads++;throw Error('book must be loaded only by the experience');}}
 const model=new T.Group(),poster=new T.Mesh();poster.name='PassportStand_target_panel';model.add(poster);
 const options={textureLoader:{load(){textureLoads++;}},GLTFLoader:UnexpectedLoader};
 assert.equal(addPassportStand(model,T,options),poster);assert.equal(addPassportStand(model,T,options),poster);
 assert.equal(model.children.length,1);assert.equal(poster.children.length,0);assert.equal(modelLoads,0);assert.equal(textureLoads,0);
});

test('entering stand16 loads only its poster until the Passport experience is activated',async()=>{
 let modelLoads=0,textureLoads=0;
 class UnexpectedLoader{constructor(){modelLoads++;throw Error('unexpected pre-activation Passport');}}
 const options={textureLoader:{load(url,onLoad){textureLoads++;loader.load(url,onLoad);}},GLTFLoader:UnexpectedLoader};
 const model=new T.Group(),group=addPassportStand(model,T,options);
 await Promise.resolve();
 assert.equal(group.children.length,1);assert.equal(group.children[0].name,'PassportStand scan graphic');assert.equal(group.userData.loadState,'ready');
 assert.equal(group.passportMiniReady,undefined);assert.equal(modelLoads,0);assert.equal(textureLoads,1);
 assert.equal(addPassportStand(model,T,options),group);assert.equal(model.children.length,1);assert.equal(group.children.length,1);assert.equal(modelLoads,0);assert.equal(textureLoads,1);
 model.updateMatrixWorld(true);const rear=new T.Raycaster(new T.Vector3(3.2,1.45,-29.15),new T.Vector3(0,0,1));
 assert.equal(rear.intersectObject(model,true)[0].object,group.children[0],'poster remains the experience entry point');
});

test('a failed poster texture keeps a clickable stand target without adding a book',()=>{
 const model=new T.Group(),group=addPassportStand(model,T,{textureLoader:{load(url,onLoad,onProgress,onError){onError(Error('offline'));}}});
 assert.equal(group.userData.loadState,'error');assert.equal(group.children.length,1);assert.equal(isPassportStandObject(group.children[0]),true);
 model.updateMatrixWorld(true);const rear=new T.Raycaster(new T.Vector3(3.2,1.45,-29.15),new T.Vector3(0,0,1));
 assert.equal(rear.intersectObject(model,true)[0].object,group.children[0]);
});
