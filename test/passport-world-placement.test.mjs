import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from '../dist/vendor/ar-three/build/three.module.js';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {createPassportBook} from '../dist/passport-book.mjs';
import {createWorldPassportPlacement} from '../dist/passport-world-placement.mjs';

globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:861,height:1123,close(){}});
const pose=(x=0,y=0,z=0,yaw=0)=>new T.Matrix4().makeRotationY(yaw).setPosition(x,y,z).toArray();
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} differs from ${b}`);
const matrixNear=(a,b)=>{assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)near(a[i],b[i]);};
const worldPosition=matrix=>new T.Vector3().setFromMatrixPosition(new T.Matrix4().fromArray(matrix));
const canvas=()=>({getContext:()=>({fillRect(){},strokeRect(){},fillText(){},measureText(text){return{width:text.length*30};}})});
async function realBook(){const bytes=fs.readFileSync(new URL('../dist/assets/passport.glb',import.meta.url)),{scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');return createPassportBook(T,scene,{createCanvas:canvas});}
function visible(camera,world){camera.updateMatrixWorld(true);world.updateMatrixWorld(true);const frustum=new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));return frustum.intersectsBox(new T.Box3().setFromObject(world));}

test('placing on a tilted surface keeps the book upright and faces the initial viewer once',()=>{
 const placement=createWorldPassportPlacement(T),surface=new T.Matrix4().makeRotationX(.25).setPosition(2,.8,-3).toArray(),viewer=pose(3,1.5,-1);
 placement.offerHit(surface);const matrix=placement.place(viewer),position=worldPosition(matrix);near(position.x,2);near(position.y,.98);near(position.z,-3);
 const transform=new T.Matrix4().fromArray(matrix),up=new T.Vector3(0,1,0).transformDirection(transform),front=new T.Vector3(0,0,1).transformDirection(transform),towardViewer=new T.Vector3(1,0,2).normalize(),scale=new T.Vector3();transform.decompose(new T.Vector3(),new T.Quaternion(),scale);
 near(up.dot(new T.Vector3(0,1,0)),1);near(front.dot(towardViewer),1);near(scale.x,1);near(scale.y,1);near(scale.z,1);
 assert.equal(placement.place(pose(-10,2,4)),null);matrixNear(placement.placed,matrix);
});

test('the real Passport leaves the camera frustum when looking away and returns to the same world point',async()=>{
 const placement=createWorldPassportPlacement(T);placement.offerHit(pose(0,.8,-1));const fixed=placement.place(pose(0,.98,1)),rig=await realBook(),world=new T.Group();world.matrixAutoUpdate=false;world.matrix.fromArray(fixed);rig.object.scale.setScalar(.2);world.add(rig.object);
 const camera=new T.PerspectiveCamera(60,390/844,.01,20);camera.position.set(0,.98,1);assert.equal(visible(camera,world),true);
 const bookPosition=world.getWorldPosition(new T.Vector3()).clone();camera.rotation.y=Math.PI;placement.offerHit(null);placement.offerHit(pose(5,.8,5));assert.equal(visible(camera,world),false);matrixNear(placement.placed,fixed);
 camera.rotation.y=0;assert.equal(visible(camera,world),true);near(world.getWorldPosition(new T.Vector3()).distanceTo(bookPosition),0);rig.dispose();
});

test('walking one meter creates real parallax while the cover retains its original heading',async()=>{
 const placement=createWorldPassportPlacement(T);placement.offerHit(pose(0,.8,-1));const fixed=placement.place(pose(0,.98,1)),rig=await realBook(),world=new T.Group();world.matrixAutoUpdate=false;world.matrix.fromArray(fixed);rig.object.scale.setScalar(.2);world.add(rig.object);world.updateMatrixWorld(true);
 const cover=rig.object.getObjectByName('Passport_exact_supplied_front_·_illustrative_Bronze_III_1,275_'),initialNormal=new T.Vector3(0,1,0).transformDirection(cover.matrixWorld);
 const camera=new T.PerspectiveCamera(60,390/844,.01,20);camera.position.set(0,.98,1);camera.updateMatrixWorld(true);const center=world.getWorldPosition(new T.Vector3()),initialScreen=center.clone().project(camera),initialDistance=camera.position.distanceTo(center);
 camera.position.x+=1;camera.updateMatrixWorld(true);const movedScreen=center.clone().project(camera);assert.ok(Math.abs(movedScreen.x-initialScreen.x)>1);assert.ok(camera.position.distanceTo(center)>initialDistance);
 assert.equal(placement.place(camera.matrixWorld.toArray()),null);placement.offerHit(pose(1,.8,-1));matrixNear(placement.placed,fixed);world.updateMatrixWorld(true);const finalNormal=new T.Vector3(0,1,0).transformDirection(cover.matrixWorld);near(finalNormal.distanceTo(initialNormal),0);
 const towardViewer=camera.position.clone().sub(center);towardViewer.y=0;towardViewer.normalize();assert.ok(finalNormal.dot(towardViewer)<.95,'the cover does not billboard toward the moving camera');rig.dispose();
});

test('hit and placement matrices are owned copies, including typed arrays and repeated calls',()=>{
 const placement=createWorldPassportPlacement(T),source=new Float32Array(pose(1,.5,-2));placement.offerHit(source);source[12]=99;const hit=placement.hit;hit[12]=88;near(placement.hit[12],1);
 const viewer=new Float32Array(pose(1,1,0)),placed=placement.place(viewer);placed[12]=77;const exposed=placement.placed;exposed[14]=66;near(placement.placed[12],1);near(placement.placed[14],-2);
 placement.offerHit(null);near(placement.placed[12],1);placement.reset();assert.equal(placement.hit,null);assert.equal(placement.placed,null);assert.equal(placement.place(viewer),null);
});

test('invalid hit, viewer and reset matrices cannot place a corrupt transform',()=>{
 const placement=createWorldPassportPlacement(T),nan=pose();nan[12]=NaN;const scaled=pose();scaled[0]=2;const reflected=pose();reflected[0]=-1;const perspective=pose();perspective[3]=.5;
 for(const invalid of [null,[],new Array(16).fill(0),nan,scaled,reflected,perspective,pose().map(String)]){placement.offerHit(invalid);assert.equal(placement.hit,null);assert.equal(placement.place(pose()),null);}
 placement.offerHit(pose(1,0,-1));assert.equal(placement.place(nan),null);assert.equal(placement.placed,null);assert.ok(placement.place(pose(0,1,0)).every(Number.isFinite));
 assert.equal(placement.rebase(nan),false);assert.equal(placement.placed,null);assert.equal(placement.hit,null);
});

test('reference-space reset preserves physical position and viewing direction using the inverse delta',()=>{
 const placement=createWorldPassportPlacement(T),oldViewer=new T.Matrix4().fromArray(pose(4,1.6,2,.3));placement.offerHit(pose(2,1,-3));const oldBook=new T.Matrix4().fromArray(placement.place(oldViewer.toArray())),before=oldViewer.clone().invert().multiply(oldBook);
 const newOriginInOld=new T.Matrix4().makeRotationY(Math.PI/2).setPosition(10,0,0),oldToNew=newOriginInOld.clone().invert();assert.equal(placement.rebase(newOriginInOld.toArray()),true);
 const moved=worldPosition(placement.placed);near(moved.x,3);near(moved.y,1.18);near(moved.z,-8);
 const newViewer=oldToNew.clone().multiply(oldViewer),newBook=new T.Matrix4().fromArray(placement.placed),after=newViewer.clone().invert().multiply(newBook);matrixNear(after.toArray(),before.toArray());
 assert.equal(placement.rebase(null),false);assert.equal(placement.placed,null);assert.equal(placement.hit,null);
});

test('a reset rebases a pending hit before placement and missing transforms demand a new surface',()=>{
 const placement=createWorldPassportPlacement(T);placement.offerHit(pose(2,1,-3));assert.equal(placement.rebase(pose(10,0,0,Math.PI/2)),false);near(placement.hit[12],3);near(placement.hit[14],-8);
 assert.ok(placement.place(pose(3,2,-6)));placement.reset();placement.offerHit(pose());assert.equal(placement.rebase(null),false);assert.equal(placement.hit,null);assert.equal(placement.place(pose()),null);
});
