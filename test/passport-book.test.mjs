import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from '../dist/vendor/ar-three/build/three.module.js';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {createPassportBook,loadPassportWatermark} from '../dist/passport-book.mjs';

globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:861,height:1123,close(){}});
import {PASSPORT_CONTENT as content} from '../dist/passport-content.mjs';
async function load(){const bytes=fs.readFileSync(new URL('../dist/assets/passport.glb',import.meta.url));return(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'')).scene;}
function canvases(){const made=[];return{made,createCanvas(){const calls=[],context={fillRect(){},strokeRect(){},fillText(text,x,y){calls.push({text,x,y,font:this.font,alpha:this.globalAlpha??1});},drawImage(image,x,y,width,height){calls.push({image,x,y,width,height,alpha:this.globalAlpha??1});},measureText(text){return{width:text.length*parseFloat(this.font.match(/\d+(?:\.\d+)?px/)?.[0]||'60')*.48};}};const canvas={width:0,height:0,calls,getContext(){return context;}};made.push(canvas);return canvas;}};}
function vertexWorld(mesh,index=0){return new T.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,index).applyMatrix4(mesh.matrixWorld);}
const close=(a,b)=>assert.ok(a.distanceTo(b)<1e-6,`${a.toArray()} ≠ ${b.toArray()}`);

test('real supplied GLB remains centered, upright, normalized and unchanged when closed',async()=>{
 const asset=await load();asset.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(asset),center=bounds.getCenter(new T.Vector3()),width=bounds.getSize(new T.Vector3()).x;
 const cover=asset.children.find(o=>o.name.startsWith('Passport_exact_supplied_front')),sourceTexture=cover.material.map,sourceGeometry=cover.geometry;
 const expected=vertexWorld(cover).sub(center).applyAxisAngle(new T.Vector3(1,0,0),Math.PI/2).multiplyScalar(1/width);
 const fake=canvases(),book=createPassportBook(T,asset,{content,createCanvas:()=>fake.createCanvas()});
 close(vertexWorld(cover),expected);assert.equal(cover.material.map,sourceTexture);assert.equal(cover.geometry,sourceGeometry);
 const normalized=new T.Box3().setFromObject(book.object);close(normalized.getCenter(new T.Vector3()),new T.Vector3());assert.ok(Math.abs(normalized.getSize(new T.Vector3()).x-1)<1e-6);
 const normal=new T.Vector3(0,1,0).transformDirection(cover.matrixWorld);assert.ok(normal.z>.999);assert.equal(book.page,0);assert.equal(book.openness,0);
 book.dispose();
});

test('cover rotates around the spine and turning a leaf reveals the second page',async()=>{
 const fake=canvases(),book=createPassportBook(T,await load(),{content,createCanvas:()=>fake.createCanvas()});
 const hinge=book.object.getObjectByName('Passport front cover hinge'),leaf=book.object.getObjectByName('Passport turning information leaf'),page1=book.object.getObjectByName('Passport information page 1'),page2=book.object.getObjectByName('Passport information page 2');
 const hingeBefore=hinge.getWorldPosition(new T.Vector3()),leafBefore=page1.getWorldPosition(new T.Vector3());
 book.setPage(1);assert.equal(book.openness,0);for(let i=0;i<60;i++)book.update(1/60);
 assert.equal(book.openness,1);close(hinge.getWorldPosition(new T.Vector3()),hingeBefore);assert.equal(leaf.rotation.z,0);
 const openBounds=new T.Box3().setFromObject(book.object);assert.ok(openBounds.min.x< -1.4&&openBounds.max.x<=.501);assert.ok(page2.getWorldPosition(new T.Vector3()).x>0);
 book.setPage(2);for(let i=0;i<40;i++)book.update(1/60);assert.equal(book.page,2);assert.equal(leaf.rotation.z,Math.PI);assert.ok(page1.getWorldPosition(new T.Vector3()).x<leafBefore.x-.5);
 book.setPage(0);for(let i=0;i<80;i++)book.update(1/60);assert.equal(book.openness,0);assert.equal(leaf.rotation.z,0);book.dispose();
});

test('reduced motion and immediate page changes settle without advancing frames',async()=>{
 const fake=canvases(),book=createPassportBook(T,await load(),{content,createCanvas:()=>fake.createCanvas(),reducedMotion:true});book.setPage(2);assert.equal(book.openness,1);assert.equal(book.object.getObjectByName('Passport turning information leaf').rotation.z,Math.PI);book.setPage(0);assert.equal(book.openness,0);assert.throws(()=>book.setPage(3),RangeError);book.dispose();
 const other=createPassportBook(T,await load(),{content,createCanvas:()=>fake.createCanvas()});other.setPage(1,{immediate:true});assert.equal(other.openness,1);other.update(NaN);other.update(-1);assert.equal(other.openness,1);other.dispose();
});

test('two legible page textures contain the supplied copy and dispose without touching GLB resources',async()=>{
 const asset=await load(),originalParts=asset.children.map(part=>({part,parent:part.parent,position:part.position.clone()})),fake=canvases();let originalDisposals=0;
 asset.traverse(o=>{o.geometry?.addEventListener('dispose',()=>originalDisposals++);for(const material of Array.isArray(o.material)?o.material:[o.material]){material?.addEventListener('dispose',()=>originalDisposals++);material?.map?.addEventListener('dispose',()=>originalDisposals++);}});
 const book=createPassportBook(T,asset,{content,createCanvas:()=>fake.createCanvas()});assert.equal(fake.made.length,2);
 for(const [index,canvas] of fake.made.entries()){assert.equal(canvas.width,1024);assert.equal(canvas.height,1340);const text=canvas.calls.map(call=>call.text).join(' ');assert.ok(text.includes(content.pages[index===0?1:0].title));assert.ok(canvas.calls.filter(call=>call.font.startsWith('400 ')).every(call=>parseFloat(call.font.match(/\d+px/)[0])>=76),'real configured copy uses a mobile-readable body size');assert.ok(canvas.calls.every(call=>call.y>=0&&call.y<canvas.height));}
 const owned=new Set();book.object.traverse(o=>{if(o.name.startsWith('Passport information')||o.name==='Passport inside front cover'){owned.add(o.geometry);for(const material of Array.isArray(o.material)?o.material:[o.material]){owned.add(material);if(material.map)owned.add(material.map);}}});
 let disposed=0;for(const resource of owned)resource.addEventListener('dispose',()=>disposed++);
 book.setPage(2,{immediate:true});book.dispose();book.dispose();assert.equal(disposed,owned.size);assert.equal(originalDisposals,0);
 for(const saved of originalParts){assert.equal(saved.part.parent,saved.parent);close(saved.part.position,saved.position);}assert.equal(book.object.getObjectByName('Passport turning information leaf'),undefined);assert.equal(book.object.getObjectByName('Passport information page 2'),undefined);
});


test('the cover hides the copy until opened and each turn exposes the intended information page',async()=>{
 const fake=canvases(),book=createPassportBook(T,await load(),{content,createCanvas:()=>fake.createCanvas()});
 const front=()=>new T.Raycaster(new T.Vector3(0,0,2),new T.Vector3(0,0,-1)).intersectObject(book.object,true)[0].object.name;
 assert.ok(front().startsWith('Passport_exact_supplied_front'));
 book.setPage(1,{immediate:true});assert.equal(front(),'Passport information page 1');
 book.setPage(2,{immediate:true});assert.equal(front(),'Passport information page 2');book.dispose();
});


test('both information sheets use the original emblem at low opacity and restore full text opacity',async()=>{
 const image={source:'original passport-emblem.svg'},fake=canvases(),book=createPassportBook(T,await load(),{content,watermarkImage:image,createCanvas:()=>fake.createCanvas()});
 for(const canvas of fake.made){
  const stamps=canvas.calls.filter(call=>call.image);assert.equal(stamps.length,1);assert.deepEqual(stamps[0],{image,x:230,y:500,width:560,height:554,alpha:.10});
  const text=canvas.calls.filter(call=>Object.hasOwn(call,'text'));assert.ok(text.every(call=>call.alpha===1));
  const stampIndex=canvas.calls.indexOf(stamps[0]);assert.ok(canvas.calls.slice(stampIndex+1).some(call=>call.font.includes('88px')));
 }
 book.dispose();
});

test('watermark image loader resolves on load and treats missing or stalled artwork as optional',async()=>{
 let image;const ready=loadPassportWatermark({imageFactory:()=>image={},timeoutMs:1000});assert.equal(image.src,'./assets/passport-emblem.svg');assert.equal(image.decoding,'async');image.onload();assert.equal(await ready,image);assert.equal(image.onload,null);assert.equal(image.onerror,null);
 const missing=loadPassportWatermark({imageFactory:()=>image={},timeoutMs:1000});image.onerror();assert.equal(await missing,null);
 assert.equal(await loadPassportWatermark({imageFactory:()=>({}),timeoutMs:1}),null);
 assert.equal(await loadPassportWatermark({imageFactory(){throw Error('No image support');}}),null);
 const cached={complete:true,naturalWidth:100};assert.equal(await loadPassportWatermark({imageFactory:()=>cached}),cached);
});


test('a late watermark updates only the existing page textures and is ignored after disposal',async()=>{
 const asset=await load(),fake=canvases(),book=createPassportBook(T,asset,{content,createCanvas:()=>fake.createCanvas()});
 const cover=asset.getObjectByName('Passport_exact_supplied_front_·_illustrative_Bronze_III_1,275_'),coverTexture=cover.material.map,coverGeometry=cover.geometry,coverVertex=vertexWorld(cover),coverVersion=coverTexture.version;
 const pages=[1,2].map(index=>book.object.getObjectByName(`Passport information page ${index}`));
 const before=pages.map(page=>({page,geometry:page.geometry,material:page.material,texture:page.material.map,version:page.material.map.version,canvas:page.material.map.image}));
 assert.ok(fake.made.every(canvas=>!canvas.calls.some(call=>call.image)));
 const image={source:'late original emblem'};assert.equal(book.setWatermarkImage(image),true);assert.equal(fake.made.length,2);
 for(const saved of before){assert.equal(saved.page.geometry,saved.geometry);assert.equal(saved.page.material,saved.material);assert.equal(saved.page.material.map,saved.texture);assert.equal(saved.texture.image,saved.canvas);assert.equal(saved.texture.version,saved.version+1);assert.equal(saved.canvas.calls.filter(call=>call.image).length,1);assert.equal(saved.canvas.calls.find(call=>call.image).image,image);}
 assert.equal(cover.material.map,coverTexture);assert.equal(coverTexture.version,coverVersion);assert.equal(cover.geometry,coverGeometry);close(vertexWorld(cover),coverVertex);
 book.dispose();const calls=fake.made.map(canvas=>canvas.calls.length),versions=before.map(saved=>saved.texture.version);
 assert.equal(book.setWatermarkImage({source:'arrived after close'}),false);assert.equal(fake.made.length,2);assert.deepEqual(fake.made.map(canvas=>canvas.calls.length),calls);assert.deepEqual(before.map(saved=>saved.texture.version),versions);
});
