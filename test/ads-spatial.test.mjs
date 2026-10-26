import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../dist/vendor/three/build/three.module.js';
import { createAdsSurface, bindAdsSurface, createDefaultStageLoop, createAdsSpatialController } from '../dist/ads-spatial.mjs';
const activeState = {placementId:'main_stage_screen',status:'active',version:9,bytes:new Uint8Array([1]),mimeType:'image/png',active:{revisionId:'r1',manifestHash:'a'.repeat(64),imageHash:'b'.repeat(64)}};
function venue() {const model=new T.Group();const backdrop=new T.Mesh(new T.BoxGeometry(10,4,.2),new T.MeshBasicMaterial());backdrop.name='Yellow_event_backdrop';backdrop.position.set(0,2,-20);model.add(backdrop,new T.Mesh(new T.BoxGeometry(10,.1,40),new T.MeshBasicMaterial()));return model;}
test('advertising surfaces attach to the actual stage and require configured central geometry',()=>{
 const model=venue(),stage=createAdsSurface(T,model,{id:'main_stage_screen'});assert.equal(stage.parent,model);assert.equal(stage.visible,false);assert.ok(Math.abs(stage.geometry.parameters.width/stage.geometry.parameters.height-16/9)<.0001);assert.ok(stage.position.z>-19.9);
 assert.equal(createAdsSurface(T,model,{id:'venue_center_banner'}),null);
 const banner=createAdsSurface(T,model,{id:'venue_center_banner',transform:{position:[0,5,-15],width:8,height:2,rotation:[0,.2,0]}});assert.deepEqual(banner.position.toArray(),[0,5,-15]);assert.equal(banner.geometry.parameters.width,8);
 assert.equal(createAdsSurface(T,model,{id:'venue_center_banner',transform:{position:[0,5,-15],width:3,height:2}}),null);
});
test('only a decoded matching texture replaces host content and frame acknowledgement matches its revision',async()=>{
 const model=venue(),mesh=createAdsSurface(T,model,{id:'main_stage_screen'}),host={visible:true},acks=[];
 const binding=bindAdsSurface(T,mesh,{hostSurface:host,decodeImage:async()=>({width:1600,height:900}),onApplied:value=>acks.push(value)});
 await binding.update(activeState);assert.equal(host.visible,false);assert.equal(mesh.visible,true);assert.equal(acks.length,0);
 binding.afterFrame(12345);assert.deepEqual(acks,[{placementId:'main_stage_screen',version:9,revisionId:'r1',manifestHash:'a'.repeat(64),imageHash:'b'.repeat(64),frameAt:12345}]);
 await binding.update({status:'neutral'});assert.equal(host.visible,true);assert.equal(mesh.visible,false);assert.equal(mesh.material.map,null);binding.afterFrame(13000);assert.equal(acks.length,1);binding.dispose();assert.equal(model.getObjectByName('main_stage_screen'),undefined);
});
test('a stale pending decode cannot revive a replaced or suspended advertisement',async()=>{
 let finish;const mesh=createAdsSurface(T,venue(),{id:'main_stage_screen'}),host={visible:true};
 const binding=bindAdsSurface(T,mesh,{hostSurface:host,decodeImage:()=>new Promise(resolve=>{finish=resolve;})});
 const pending=binding.update(activeState);await binding.update({status:'neutral'});finish({width:1600,height:900});await pending;assert.equal(mesh.visible,false);assert.equal(host.visible,true);
});
test('wrong-ratio output fails closed without stretching or replacing the main-stage default',async()=>{
 const host={visible:true},mesh=createAdsSurface(T,venue(),{id:'main_stage_screen'});const binding=bindAdsSurface(T,mesh,{hostSurface:host,decodeImage:async()=>({width:100,height:100})});await binding.update(activeState);assert.equal(host.visible,true);assert.equal(mesh.visible,false);
});
test('main-stage background is a muted looping inline VideoTexture independent of advertising API',()=>{
 const attributes=new Map();let plays=0,pauses=0;const video={setAttribute:(key,value)=>attributes.set(key,value),removeAttribute(){},play(){plays++;return Promise.resolve();},pause(){pauses++;},load(){}};
 const model=venue(),stage=createDefaultStageLoop(T,model,{documentRef:{createElement:name=>{assert.equal(name,'video');return video;}}});
 assert.equal(video.src,'/assets/main-stage-default.mp4');assert.equal(video.muted,true);assert.equal(video.autoplay,true);assert.equal(video.playsInline,true);assert.equal(video.loop,true);assert.equal(stage.mesh.material.map.isVideoTexture,true);assert.equal(stage.mesh.visible,true);assert.equal(plays,1);stage.pause();stage.play();assert.equal(pauses,1);assert.equal(plays,2);stage.dispose();assert.equal(model.getObjectByName('Main stage default loop'),undefined);
});
function xrFixture(){
 const session=new EventTarget();session.visibilityState='visible';session.reference=new EventTarget();session.requestReferenceSpace=async()=>({});session.requestHitTestSource=async()=>({cancel(){}});session.end=async()=>session.dispatchEvent(new Event('end'));
 let loop=null;const renderer={xr:{enabled:false,setReferenceSpaceType(){},async setSession(){},getReferenceSpace:()=>session.reference},setAnimationLoop:callback=>{loop=callback;},render(){}};
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(),object=new T.Group(),states=[];object.add(new T.Mesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial()));scene.add(object);
 const controller=createAdsSpatialController({THREE:T,renderer,scene,camera,object,uiRoot:{},requestSession:()=>Promise.resolve(session),onState:state=>states.push(state)});
 const pose=(x,y,z)=>new T.Matrix4().makeTranslation(x,y,z).toArray();
 const frame=(tracking=true)=>({getViewerPose:()=>tracking?{transform:{matrix:pose(0,1.6,1)}}:null,getHitTestResults:()=>[{getPose:()=>({transform:{matrix:pose(0,0,-1)}})}]});
 return{session,renderer,scene,object,states,controller,step(tracking=true){loop(100,frame(tracking));}};
}
test('AR places a device-local surface once, hides on tracking loss and restores parent on exit',async()=>{
 const f=xrFixture();await f.controller.start();f.step();assert.equal(f.states.at(-1).canPlace,true);assert.equal(f.controller.place(),true);const placed=f.controller.placed;f.step(false);assert.equal(f.scene.getObjectByName('Advertisement local AR anchor').visible,false);f.step();assert.deepEqual(f.controller.placed,placed);assert.equal(f.scene.getObjectByName('Advertisement local AR anchor').visible,true);f.controller.dispose();assert.equal(f.object.parent,f.scene);assert.equal(f.scene.getObjectByName('Advertisement local AR anchor'),undefined);
});
