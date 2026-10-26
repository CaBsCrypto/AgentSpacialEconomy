import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../dist/vendor/ar-three/build/three.module.js';
import {createPassportSpatialController} from '../dist/passport-spatial-controller.mjs';

const pose=(x=0,y=0,z=0,yaw=0)=>new T.Matrix4().makeRotationY(yaw).setPosition(x,y,z).toArray();
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} differs from ${b}`);
const matrixNear=(a,b)=>{for(let i=0;i<16;i++)near(a[i],b[i]);};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
class Session extends EventTarget{
 visibilityState='visible';ends=0;reference=new EventTarget();viewerSpace=new EventTarget();hitRequests=0;referenceRequests=0;hitCancels=0;ended=false;
 async requestReferenceSpace(type){this.referenceRequests++;assert.equal(type,'viewer');return this.viewerSpace;}
 async requestHitTestSource({space}){this.hitRequests++;assert.equal(space,this.viewerSpace);return{cancel:()=>this.hitCancels++};}
 end(){this.ends++;if(!this.ended){this.ended=true;this.dispatchEvent(new Event('end'));}return Promise.resolve();}
}
function setup({requestSession}={}){
 const session=new Session(),scene=new T.Scene(),camera=new T.PerspectiveCamera(60,390/844,.01,20),parent=new T.Group(),object=new T.Group();parent.name='Passport preview parent';parent.position.x=2;scene.add(parent);parent.add(object);object.add(new T.Mesh(new T.BoxGeometry(.62,.62*1123/861,.015),new T.MeshBasicMaterial()));object.position.set(.2,.1,-.3);object.rotation.set(.1,.2,.3);object.scale.set(1.1,1.2,.9);
 const original={position:object.position.clone(),quaternion:object.quaternion.clone(),scale:object.scale.clone()},states=[];let loop=null,time=0,renders=0,setSessions=0,taps=0,ends=0,hitReads=0;
 const renderer={xr:{enabled:false,setReferenceSpaceType(type){assert.equal(type,'local');},async setSession(value){setSessions++;assert.equal(value,session);},getReferenceSpace(){return session.reference;}},setAnimationLoop(callback){loop=callback;},render(){renders++;scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);}};
 const controller=createPassportSpatialController({T,renderer,scene,camera,object,uiRoot:{},requestSession:requestSession||(()=>session),onState:value=>states.push(value),onTap:()=>taps++,onEnd:()=>ends++});
 const step=({viewer=pose(0,.98,1),hits=[pose(0,.8,-1)],emulated=false}={})=>{
  assert.equal(typeof loop,'function','an XR frame loop is installed');if(viewer){camera.matrix.fromArray(viewer).decompose(camera.position,camera.quaternion,camera.scale);camera.updateMatrixWorld(true);}
  const frame={getViewerPose(reference){assert.equal(reference,session.reference);return viewer?{transform:{matrix:new Float32Array(viewer)},emulatedPosition:emulated}:null;},getHitTestResults(){hitReads++;return hits.map(matrix=>({getPose(reference){assert.equal(reference,session.reference);return{transform:{matrix:new Float32Array(matrix)}};}}));}};
  time+=16;loop(time,frame);return frame;
 };
 const anchor=()=>scene.getObjectByName('Passport fixed world anchor');
 const reticle=()=>scene.children.find(child=>child.geometry?.type==='RingGeometry');
 return{session,scene,camera,parent,object,original,states,renderer,controller,step,anchor,reticle,get loop(){return loop;},get renders(){return renders;},get setSessions(){return setSessions;},get taps(){return taps;},get ends(){return ends;},get hitReads(){return hitReads;}};
}
function resetEvent(matrix){const event=new Event('reset');if(matrix)event.transform={matrix:new Float32Array(matrix)};return event;}
function selectEvent(matrix){const event=new Event('select');event.inputSource={targetRaySpace:{}};event.frame={getPose(){return{transform:{matrix:new Float32Array(matrix)}};}};return event;}

test('start requests the immersive session synchronously inside the initiating gesture',async()=>{
 const grant=deferred();let activeGesture=true,requests=0;const harness=setup({requestSession(){requests++;assert.equal(activeGesture,true);return grant.promise;}});
 const pending=harness.controller.start();assert.equal(requests,1);assert.equal(harness.setSessions,0);activeGesture=false;grant.resolve(harness.session);assert.equal(await pending,true);assert.equal(harness.setSessions,1);assert.equal(harness.session.hitRequests,1);harness.controller.dispose();
});

test('placing produces an upright twenty-centimeter object fixed while the camera turns, walks and loses hits',async()=>{
 const h=setup();await h.controller.start();h.step();assert.equal(h.controller.state,'surface-found');assert.equal(h.states.at(-1).canPlace,true);assert.equal(h.controller.place(),true);h.scene.updateMatrixWorld(true);
 const original=h.object.matrixWorld.clone(),anchor=h.anchor(),position=new T.Vector3().setFromMatrixPosition(original),up=new T.Vector3(0,1,0).transformDirection(original);near(position.x,0);near(position.y,.98);near(position.z,-1);near(up.y,1);near(new T.Box3().setFromObject(h.object).getSize(new T.Vector3()).x,.20);
 const hitReads=h.hitReads;h.step({viewer:pose(0,.98,1,Math.PI),hits:[]});h.step({viewer:pose(1,.98,1,.4),hits:[pose(5,3,8)]});matrixNear(h.object.matrixWorld.toArray(),original.toArray());assert.equal(anchor.visible,true);assert.equal(h.hitReads,hitReads,'surface hits stop controlling the placed object');assert.equal(h.controller.place(),false);assert.ok(h.renders>=3);h.controller.dispose();
});

test('temporary tracking loss hides the object and restores the same pose without a new surface',async()=>{
 const h=setup();await h.controller.start();h.step();h.controller.place();const placed=h.controller.placed;
 h.step({viewer:null,hits:[]});assert.equal(h.controller.state,'tracking-lost');assert.equal(h.anchor().visible,false);assert.equal(h.reticle().visible,false);matrixNear(h.controller.placed,placed);assert.equal(h.controller.place(),false);
 h.step({viewer:pose(1,.98,1),hits:[],emulated:true});assert.equal(h.anchor().visible,false);matrixNear(h.controller.placed,placed);
 h.step({viewer:pose(1,.98,1),hits:[]});assert.equal(h.controller.state,'placed');assert.equal(h.anchor().visible,true);matrixNear(h.controller.placed,placed);h.controller.dispose();
});

test('reference reset rebases the book before rendering and preserves its physical camera-relative pose',async()=>{
 const h=setup();await h.controller.start();const oldViewer=new T.Matrix4().fromArray(pose(0,.98,1));h.step({viewer:oldViewer.toArray()});h.controller.place();h.scene.updateMatrixWorld(true);const before=oldViewer.clone().invert().multiply(h.object.matrixWorld);
 const origin=new T.Matrix4().makeRotationY(Math.PI/2).setPosition(10,0,0);h.session.reference.dispatchEvent(resetEvent(origin.toArray()));assert.equal(h.anchor().visible,false);assert.equal(h.controller.state,'tracking-lost');
 const newViewer=origin.clone().invert().multiply(oldViewer);h.step({viewer:newViewer.toArray(),hits:[]});const after=newViewer.clone().invert().multiply(h.object.matrixWorld);matrixNear(after.toArray(),before.toArray());assert.equal(h.anchor().visible,true);
 h.session.reference.dispatchEvent(resetEvent(null));assert.equal(h.controller.placed,null);assert.equal(h.anchor().visible,false);h.step({viewer:pose(),hits:[]});assert.equal(h.controller.place(),false);h.controller.dispose();
});

test('repositioning discards the old hit and requires a new tracked surface',async()=>{
 const h=setup();await h.controller.start();h.step();h.controller.place();h.controller.reposition();assert.equal(h.controller.placed,null);assert.equal(h.anchor().visible,false);assert.equal(h.controller.place(),false);
 h.step({hits:[]});assert.equal(h.controller.state,'searching');assert.equal(h.states.at(-1).canPlace,false);assert.equal(h.controller.place(),false);
 const vertical=new T.Matrix4().makeRotationX(Math.PI/2).setPosition(2,.8,-1).toArray();h.step({hits:[vertical]});assert.equal(h.controller.place(),false);
 h.step({hits:[pose(2,.7,-2)]});assert.equal(h.controller.place(),true);near(h.controller.placed[12],2);near(h.controller.placed[13],.88);near(h.controller.placed[14],-2);h.controller.dispose();
});

test('ending a session restores the exact preview transform and disposes surface resources once',async()=>{
 const h=setup();await h.controller.start();h.step();h.controller.place();const reticle=h.reticle();let geometries=0,materials=0;reticle.geometry.addEventListener('dispose',()=>geometries++);reticle.material.addEventListener('dispose',()=>materials++);
 await h.session.end();assert.equal(h.controller.state,'preview');assert.equal(h.controller.placed,null);assert.equal(h.object.parent,h.parent);assert.deepEqual(h.object.position.toArray(),h.original.position.toArray());assert.deepEqual(h.object.quaternion.toArray(),h.original.quaternion.toArray());assert.deepEqual(h.object.scale.toArray(),h.original.scale.toArray());assert.equal(h.anchor(),undefined);assert.equal(h.reticle(),undefined);assert.equal(h.loop,null);assert.equal(h.session.hitCancels,1);assert.equal(geometries,1);assert.equal(materials,1);assert.equal(h.ends,1);
 h.controller.stop();h.controller.dispose();assert.equal(h.session.hitCancels,1);assert.equal(geometries,1);assert.equal(materials,1);
});

test('canceling a pending permission request ends a late grant without initializing XR or touching the preview',async()=>{
 const grant=deferred(),h=setup({requestSession:()=>grant.promise});const pending=h.controller.start();h.controller.stop();grant.resolve(h.session);assert.equal(await pending,false);assert.equal(h.session.ends,1);assert.equal(h.setSessions,0);assert.equal(h.session.referenceRequests,0);assert.equal(h.session.hitRequests,0);assert.equal(h.loop,null);assert.equal(h.renders,0);assert.equal(h.object.parent,h.parent);assert.deepEqual(h.object.position.toArray(),h.original.position.toArray());assert.equal(h.anchor(),undefined);h.controller.dispose();
});

test('XR selection opens information only when its ray intersects the placed book',async()=>{
 const h=setup();await h.controller.start();h.step();h.session.dispatchEvent(selectEvent(pose(0,.98,1)));assert.ok(h.controller.placed);assert.equal(h.taps,0);
 h.session.dispatchEvent(selectEvent(pose(0,.98,1)));assert.equal(h.taps,1);h.session.dispatchEvent(selectEvent(pose(5,.98,1)));assert.equal(h.taps,1);h.controller.dispose();
});
