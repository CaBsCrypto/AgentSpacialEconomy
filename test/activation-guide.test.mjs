import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {floorHeight,canStand,insidePolygon} from '../dist/navigation.mjs';
import {sampleActivationRoute,createActivationGuide} from '../dist/activation-guide.mjs';

function fixture(){
 const layout={
  walkable:[[[-8,-12],[8,-12],[8,0],[-8,0]],[[-3,0],[3,0],[3,25.5],[-3,25.5]]],
  obstacles:[{minX:2.45,maxX:3.35,minZ:-9.6,maxZ:-8.8}],
  surfaces:[],spawn:{x:0,z:25},
  activation:{position:{x:2.9,y:0,z:-9.2},approach:{x:2.9,z:-7.9,yaw:0,pitch:-.12}},
  // This data is already transformed to the shortened entrance corridor.
  activationRoute:[{x:0,z:25},{x:0,z:19},{x:0,z:6},{x:0,z:2.45},{x:0,z:0},{x:0,z:-1},{x:2.4,z:-3.6},{x:2.9,z:-5.8},{x:2.9,z:-7.9}],
 };
 for(let k=0;k<7;k++){
  const low=(6-k)*.35,high=(7-k)*.35;
  layout.surfaces.push({polygon:[[-.96,low],[.96,low],[.96,high],[-.96,high]],baseY:-1.05+(k+1)*.15});
 }
 layout.surfaces.push({polygon:[[-3,0],[3,0],[3,25.5],[-3,25.5]],baseY:-1.05});
 return layout;
}
const close=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const colors=mesh=>Array.from(mesh.instanceColor.array);

test('pure route starts at the shortened spawn, follows actual floor levels and ends at approach',()=>{
 const layout=fixture(),unchanged=structuredClone(layout),points=sampleActivationRoute(layout);
 assert.ok(points.length>55);assert.deepEqual(layout,unchanged);
 assert.deepEqual([points[0].x,points[0].z],[0,25]);
 assert.deepEqual([points.at(-1).x,points.at(-1).z],[2.9,-7.9]);
 for(const point of points){
  close(point.surfaceY,floorHeight(point.x,point.z,layout));
  close(point.y,point.surfaceY+.025);
  assert.ok(canStand(point.x,point.z,layout));
  assert.ok(Math.hypot(point.x-2.9,point.z+9.2)>=.6);
 }
 for(let i=1;i<points.length;i++)assert.ok(points[i].distance>points[i-1].distance,'Duplicate dot at a route corner');
});

test('dots are at most .55m apart and become denser across all seven stair treads',()=>{
 const points=sampleActivationRoute(fixture());
 const treadHeights=new Set(points.filter(p=>p.z>0&&p.z<2.45).map(p=>(p.y-.025).toFixed(2)));
 assert.equal(treadHeights.size,7);
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],gap=b.distance-a.distance;
  assert.ok(gap<=.5500001);
  if(a.z>=0&&a.z<=2.45&&b.z>=0&&b.z<=2.45)assert.ok(gap<=.2200001);
  assert.ok(Math.abs(a.y-b.y)<=.151,'Guide interpolated or skipped a stair level');
 }
});

test('crossing a thin obstacle between otherwise legal dots fails closed',()=>{
 const layout=fixture();layout.obstacles.push({minX:-.2,maxX:.2,minZ:9.05,maxZ:9.1});
 assert.deepEqual(sampleActivationRoute(layout),[]);
});

test('endpoint uses approach rather than kiosk base and malformed routes draw nothing',()=>{
 const layout=fixture();layout.activationRoute.at(-1).z=-9.2;
 assert.deepEqual(sampleActivationRoute(layout).at(-1).z,-7.9);
 assert.deepEqual(sampleActivationRoute({}),[]);
 const invalid=fixture();invalid.activationRoute[2].x=NaN;
 assert.deepEqual(sampleActivationRoute(invalid),[]);
 const missing=fixture();delete missing.activation.approach;
 assert.deepEqual(sampleActivationRoute(missing),[]);
});

test('two instanced unlit layers use floor-aligned matrices without per-dot lights or shadows',()=>{
 const guide=createActivationGuide(THREE,fixture(),{reducedMotion:{matches:false}});
 assert.equal(guide.root.children.length,2);
 assert.ok(guide.root.children.every(mesh=>mesh.isInstancedMesh&&mesh.count===guide.points.length));
 let lights=0;guide.root.traverse(object=>{if(object.isLight)lights++;});assert.equal(lights,0);
 for(const mesh of guide.root.children){assert.equal(mesh.castShadow,false);assert.equal(mesh.receiveShadow,false);assert.ok(mesh.material.isMeshBasicMaterial);}
 const [halo,core]=guide.root.children,matrix=new THREE.Matrix4(),up=new THREE.Vector3(0,0,1);
 halo.getMatrixAt(0,matrix);up.applyMatrix4(new THREE.Matrix4().extractRotation(matrix));close(up.y,1);
 close(matrix.elements[13],guide.points[0].y,1e-6);
 core.getMatrixAt(0,matrix);close(matrix.elements[13],guide.points[0].y+.002,1e-6);
 const before=colors(core);for(let i=0;i<6;i++)guide.update(.1);assert.notDeepEqual(colors(core),before,'Directional brightness never advanced');
 const brightest=values=>[0,1,2,3].reduce((a,b)=>values[b*3]>values[a*3]?b:a,0);
 assert.equal(brightest(before),0);assert.ok(brightest(colors(core))>0,'Brightness wave travels away from the approach');
 guide.dispose();
});

test('reduced motion is static, supports live preference changes, and dispose is idempotent',()=>{
 const motion={matches:true},guide=createActivationGuide(THREE,fixture(),{reducedMotion:motion});
 const [halo,core]=guide.root.children;
 const initial=colors(core),version=core.instanceColor.version;guide.update(10);
 assert.deepEqual(colors(core),initial);assert.equal(core.instanceColor.version,version);
 const first=new THREE.Color(),last=new THREE.Color();core.getColorAt(0,first);core.getColorAt(core.count-1,last);assert.deepEqual(first,last);
 motion.matches=false;guide.update(.1);assert.notDeepEqual(colors(core),initial);
 motion.matches=true;guide.update(.1);const still=colors(core);guide.update(.1);assert.deepEqual(colors(core),still);
 const disposed={geometry:0,material:0};
 for(const mesh of [halo,core]){mesh.geometry.addEventListener('dispose',()=>disposed.geometry++);mesh.material.addEventListener('dispose',()=>disposed.material++);}
 const scene=new THREE.Scene();scene.add(guide.root);guide.dispose();guide.dispose();guide.update(.1);
 assert.deepEqual(disposed,{geometry:2,material:2});assert.equal(guide.root.parent,null);assert.equal(guide.root.children.length,0);
});

function finishedFixture(){
 const layout=fixture();
 layout.floorFinishes=[
  {polygon:[[-.9,2.45],[.9,2.45],[.9,25.5],[-.9,25.5]],topY:-1.02},
  {polygon:[[-1.1,-2.2],[1.1,-2.2],[1.1,0],[-1.1,0]],topY:.024},
  {polygon:[[-1.7,-6.05],[1.7,-6.05],[1.7,-3.95],[-1.7,-3.95]],topY:.028},
 ];
 return layout;
}

test('dot surface follows the highest containing floor finish without changing the walking floor',()=>{
 const layout=finishedFixture();
 // Cross the check-in mat in this data fixture as well as the runner/landing.
 layout.activationRoute=[...layout.activationRoute.slice(0,6),{x:0,z:-6.2},{x:2.9,z:-7.9}];
 const before=structuredClone(layout),points=sampleActivationRoute(layout);
 assert.ok(points.length>55);assert.deepEqual(layout,before);
 for(const point of points){
  const walking=floorHeight(point.x,point.z,layout);
  const finishes=layout.floorFinishes.filter(f=>insidePolygon(point.x,point.z,f.polygon));
  const expected=Math.max(walking,...finishes.map(f=>f.topY));
  close(point.surfaceY,expected);close(point.y,expected+.025);
 }
 for(const [topY,walkingY] of [[-1.02,-1.05],[.024,0],[.028,0]]){
  const onFinish=points.filter(p=>p.surfaceY===topY);assert.ok(onFinish.length>0,`Finish ${topY} never sampled`);
  for(const p of onFinish){close(floorHeight(p.x,p.z,layout),walkingY);close(p.y-topY,.025);}
 }
 const overlapping=structuredClone(layout);
 overlapping.floorFinishes.push({polygon:[[-1.7,-6.05],[1.7,-6.05],[1.7,-3.95],[-1.7,-3.95]],topY:.018});
 assert.deepEqual(sampleActivationRoute(overlapping),points,'A lower overlapping finish lowered the dots');
});

test('floor finishes preserve route spacing, all seven steps and rendering point contracts',()=>{
 const layout=finishedFixture(),bare=structuredClone(layout);delete bare.floorFinishes;
 const points=sampleActivationRoute(layout),walkingPoints=sampleActivationRoute(bare);
 assert.deepEqual(points.map(({x,z,distance,stairs})=>({x,z,distance,stairs})),walkingPoints.map(({x,z,distance,stairs})=>({x,z,distance,stairs})));
 const treads=points.filter(p=>p.z>0&&p.z<2.45);
 assert.equal(new Set(treads.map(p=>p.surfaceY.toFixed(2))).size,7);
 for(const point of treads){close(point.surfaceY,floorHeight(point.x,point.z,layout));close(point.y,point.surfaceY+.025);}
 const guide=createActivationGuide(THREE,layout),matrix=new THREE.Matrix4();
 assert.deepEqual(guide.points,points);assert.equal(guide.root.children.length,2);
 for(const [index,point] of guide.points.entries()){
  guide.root.children[0].getMatrixAt(index,matrix);close(matrix.elements[13],point.surfaceY+.025,1e-6);
 }
 guide.dispose();
 const invalid=finishedFixture();invalid.floorFinishes.push({polygon:null,topY:50},{polygon:[[0,NaN],[1,0],[0,1]],topY:3},{polygon:[[-2,-2],[2,-2],[2,2]],topY:NaN});
 assert.deepEqual(sampleActivationRoute(invalid),sampleActivationRoute(finishedFixture()));
});
