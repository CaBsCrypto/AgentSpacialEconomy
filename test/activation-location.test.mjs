import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {canStand,floorHeight,insidePolygon,roomAt,walk} from '../dist/navigation.mjs';
import {corridorZ,shortenLayout} from '../dist/short-corridor.mjs';
import {prepareVenueModel} from '../dist/venue-model.mjs';
import {PALTA_DEFAULTS,paltaObstacle} from '../dist/palta-reveal.mjs';
import {isActivationObject} from '../dist/world-wallet.mjs';

const layoutPath=process.env.ACTIVATION_QA_LAYOUT||fileURLToPath(new URL('../dist/assets/layout.json',import.meta.url));
const modelPath=process.env.ACTIVATION_QA_GLB||fileURLToPath(new URL('../dist/assets/one16.glb',import.meta.url));
const raw=JSON.parse(fs.readFileSync(layoutPath));
const withOptionalPalta=layout=>({...layout,obstacles:[...layout.obstacles,...(PALTA_DEFAULTS.floorCollision?[paltaObstacle(PALTA_DEFAULTS.position,PALTA_DEFAULTS.obstacleHalfSize,PALTA_DEFAULTS.scale)]:[])]});

function checkRoute(layout,route){
 assert(route.length>=2,'persist the complete walking approach, not a destination teleport');
 assert.deepEqual([route[0].x,route[0].z],[layout.spawn.x,layout.spawn.z]);
 const destination=layout.activation.approach;
 assert.deepEqual([route.at(-1).x,route.at(-1).z],[destination.x,destination.z]);
 let pose={...layout.spawn},steps=0;
 for(const target of route.slice(1)){
  const distance=Math.hypot(target.x-pose.x,target.z-pose.z),count=Math.ceil(distance/.04),start={...pose};
  for(let i=0;i<=count;i++){
   const x=start.x+(target.x-start.x)*i/count,z=start.z+(target.z-start.z)*i/count;
   assert(canStand(x,z,layout),`route crosses a collider or floor edge at ${x.toFixed(3)},${z.toFixed(3)}`);
  }
  let budget=Math.ceil(distance/.1)+10;
  while(Math.hypot(target.x-pose.x,target.z-pose.z)>1e-5&&budget-->0){
   const remaining=Math.hypot(target.x-pose.x,target.z-pose.z);
   const yaw=Math.atan2(-(target.x-pose.x),-(target.z-pose.z));
   const next=walk({...pose,yaw},{forward:1},Math.min(.05,remaining/2.2),layout);
   assert(Math.hypot(next.x-pose.x,next.z-pose.z)>1e-7,'walking is stuck on the route');
   assert(Math.abs(floorHeight(next.x,next.z,layout)-floorHeight(pose.x,pose.z,layout))<=.25+1e-8,'route skips a stair riser');
   pose=next;steps++;
  }
  assert(Math.hypot(target.x-pose.x,target.z-pose.z)<1e-5,'walking cannot reach the next route point');
 }
 assert(steps>100,'exercise continuous travel from the entrance');
 assert.equal(roomAt(pose,layout.zones),'activation');
}

test('relocated activation approach is free and independent of buffet, skills and the optional tabletop Palta',()=>{
 assert.deepEqual(raw.activation.position,{x:2.6,y:0,z:-5.6});
 assert.deepEqual(raw.activation.approach,{x:2.6,z:-4.3,yaw:0,pitch:-.12});
 assert.equal(PALTA_DEFAULTS.tableId,'booth-defindex-soroswap');
 assert.equal(PALTA_DEFAULTS.floorCollision,false);
 for(const source of [raw,shortenLayout(raw)]){
  const layout=withOptionalPalta(source),activation=layout.zones.find(z=>z.id==='activation'),buffet=layout.zones.find(z=>z.id==='buffet'),skills=layout.zones.find(z=>z.id==='skills');
  assert.deepEqual(activation.view,layout.activation.approach);
  assert(canStand(activation.view.x,activation.view.z,layout));
  assert.equal(roomAt(activation.view,layout.zones),'activation');
  assert.equal(roomAt(buffet.view,layout.zones),'buffet');
  assert(!insidePolygon(buffet.view.x,buffet.view.z,activation.polygon));
  assert.equal(Math.min(...skills.polygon.map(p=>p[0])),3.6);
  assert(canStand(7,-4,layout),'obsolete kiosk collider remains at the old location');
 }
});

test('persisted raw and shortened entrance routes walk past the stairs and check-in to the kiosk',()=>{
 checkRoute(withOptionalPalta(raw),raw.activationRoute);
 const runtime=shortenLayout(raw);
 const route=raw.activationRoute.map(p=>({...p,z:corridorZ(p.z)}));
 checkRoute(withOptionalPalta(runtime),route);
});

test('the actual GLB kiosk matches its metadata and receives the approach camera ray before other venue geometry',async()=>{
 const bytes=fs.readFileSync(modelPath),loader=new GLTFLoader();
 loader.register(()=>({name:'activation-qa-textures',loadTexture:()=>Promise.resolve(new T.Texture())}));
 const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const model=prepareVenueModel(gltf.scene,T);model.updateMatrixWorld(true);
 const bounds=new T.Box3();let meshes=0;
 model.traverse(object=>{if(object.isMesh&&isActivationObject(object)){bounds.expandByObject(object);meshes++;}});
 assert(meshes>5,'actual exported activation meshes are missing');
 const center=bounds.getCenter(new T.Vector3()),position=raw.activation.position;
 assert(Math.abs(center.x-position.x)<.03&&Math.abs(center.z-position.z)<.03,'GLB kiosk and activation metadata disagree');
 assert(bounds.max.y-bounds.min.y>1.85&&bounds.max.y-bounds.min.y<2.05);
 const approach=raw.activation.approach;
 const origin=new T.Vector3(approach.x,floorHeight(approach.x,approach.z,raw)+1.65,approach.z);
 const direction=new T.Vector3(0,0,-1).applyEuler(new T.Euler(approach.pitch,approach.yaw,0,'YXZ'));
 const hit=new T.Raycaster(origin,direction).intersectObject(model,true)[0];
 assert(hit&&isActivationObject(hit.object),'the visitor camera ray does not reach the relocated kiosk first');
});
