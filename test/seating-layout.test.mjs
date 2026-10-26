import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {Box3,Matrix4,Quaternion,Vector3} from 'three';
import {canStand,floorHeight} from '../src/navigation.mjs';

// Record the actual placement functions without running Blender or exporting a
// model. Generated-layout navigation is also checked after the next model build.
const python=String.raw`
import ast,json,math,types
source=ast.parse(open('model/build_venue.py',encoding='utf-8').read())
names={'seating_bounds','seating_proximity','chair','table','build_hack_seating','build_auditorium_seating','build_cafe_seating'}
nodes=[n for n in source.body if isinstance(n,ast.FunctionDef) and n.name in names or isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='seating' for t in n.targets)]
class Sink:
 def __init__(self):self.tops=[];self.legs=[]
 def box(self,center,size,material):self.tops.append({'center':center,'size':size,'material':material})
 def rod(self,a,b,r,material):self.legs.append({'a':a,'b':b,'radius':r,'material':material})
chairs=[]
def shared_chair(name,**kw):chairs.append(dict(name=name,**kw));return {}
furn=Sink();env={'math':math,'furn':furn,'obstacles':[],'build_chair':shared_chair,'M':['black','white','steel','cream','silver','wood'],'black':0,'white':1,'steel':2,'cream':3,'silver':4,'wood':[5]*7}
exec(compile(ast.Module(body=nodes,type_ignores=[]),'model/build_venue.py','exec'),env)
for key in ['build_hack_seating','build_auditorium_seating','build_cafe_seating']:env[key]()
print(json.dumps({'seating':env['seating'],'obstacles':env['obstacles'],'sharedChairs':chairs,'tops':furn.tops,'legs':furn.legs}))
`;
const recorded=JSON.parse(execFileSync(process.env.PYTHON||'python',['-c',python],{cwd:new URL('..',import.meta.url),encoding:'utf8',maxBuffer:2*1024*1024}));
const {seating,obstacles,sharedChairs,tops,legs}=recorded;
const parts=[...seating.tables,...seating.chairs];
const close=(a,b,epsilon=1e-8)=>assert.ok(Math.abs(a-b)<=epsilon,`${a} != ${b}`);
const overlap=(a,b)=>Math.min(a.maxX,b.maxX)-Math.max(a.minX,b.minX)>1e-6&&Math.min(a.maxZ,b.maxZ)-Math.max(a.minZ,b.minZ)>1e-6;
const sameBox=(a,b)=>['minX','maxX','minZ','maxZ'].every(k=>Math.abs(a[k]-b[k])<1e-6);
const bounds=(x,y,w,d)=>({minX:x-w/2,maxX:x+w/2,minZ:-y-d/2,maxZ:-y+d/2});
const legacy=[];
for(const x of [-12,-8])for(const y of [20,24,28,32,36])legacy.push(bounds(x,y,2.4,1),bounds(x,y,2.7,2.25));
for(const [x,y] of [[3,17],[0,21],[3,25],[-2,17]])legacy.push(bounds(x,y,1.8,1.8));
for(const x of [-2.75,2.75])legacy.push(bounds(x,38.3,2.4,7.5));
// This source revision removes the curtain, including its former collision.
legacy.push(bounds(-5.6,33.8,.35,8));
const generated=JSON.parse(fs.readFileSync(new URL('../dist/assets/layout.json',import.meta.url)));
const neighbours=generated.obstacles.filter(o=>!o.seatingId&&!legacy.some(b=>sameBox(o,b)));
const navigation={...generated,obstacles:[...neighbours,...obstacles]};

test('main seating has bounded shared chairs and complete table associations',()=>{
 assert.equal(seating.tables.length,14);assert.equal(seating.chairs.length,118);
 assert.equal(seating.tables.filter(t=>t.area==='hack').length,10);assert.equal(seating.tables.filter(t=>t.area==='cafe').length,4);
 assert.deepEqual(['hack','auditorium','cafe'].map(area=>seating.chairs.filter(c=>c.area===area).length),[60,42,16]);
 assert.equal(new Set(parts.map(p=>p.id)).size,parts.length);assert.equal(sharedChairs.length,seating.chairs.length);
 for(const [index,chair] of seating.chairs.entries()){
  const shared=sharedChairs[index];assert.equal(shared.name,`Seating ${chair.id}`);
  assert.deepEqual(shared.center,[chair.center.x,-chair.center.z,0]);close(shared.angle,chair.angle);
  assert.equal(shared.frame_material,'steel');assert.equal(shared.material,chair.area==='cafe'?'cream':'black');
  close(chair.envelope.maxY,.88);close(chair.seatHeight,.46);
  const rotated=Math.abs(Math.sin(chair.angle))>.5;
  close(chair.envelope.maxX-chair.envelope.minX,rotated?.60:.52);close(chair.envelope.maxZ-chair.envelope.minZ,rotated?.52:.60);
  close(chair.collider.maxX-chair.collider.minX,rotated?.62:.54);close(chair.collider.maxZ-chair.collider.minZ,rotated?.54:.62);
 }
 for(const table of seating.tables){
  assert.equal(table.chairIds.length,table.area==='hack'?6:4);
  for(const id of table.chairIds)assert.equal(seating.chairs.find(c=>c.id===id)?.tableId,table.id);
 }
});

test('tables, chair envelopes and individual colliders never interpenetrate',()=>{
 for(let i=0;i<parts.length;i++)for(let j=i+1;j<parts.length;j++){
  assert.ok(!overlap(parts[i].envelope,parts[j].envelope),`${parts[i].id} geometry overlaps ${parts[j].id}`);
  assert.ok(!overlap(parts[i].collider,parts[j].collider),`${parts[i].id} collision overlaps ${parts[j].id}`);
 }
 for(const part of parts){
  assert.ok(obstacles.some(o=>o.seatingId===part.id&&sameBox(o,part.collider)),`Missing collision ${part.id}`);
  close(part.proximityBounds.minX,part.collider.minX-.24);close(part.proximityBounds.maxZ,part.collider.maxZ+.24);
 }
});

test('every chair faces its table with useful clearance, and cafe side chairs face inward',()=>{
 for(const chair of seating.chairs.filter(c=>c.tableId)){
  const table=seating.tables.find(t=>t.id===chair.tableId),dx=table.center.x-chair.center.x,dz=table.center.z-chair.center.z;
  assert.ok((dx*chair.front.x+dz*chair.front.z)/Math.hypot(dx,dz)>.75,`${chair.id} faces away from table`);
  const gap=Math.max(table.collider.minX-chair.collider.maxX,chair.collider.minX-table.collider.maxX,table.collider.minZ-chair.collider.maxZ,chair.collider.minZ-table.collider.maxZ);
  assert.ok(gap>=.1899,`${chair.id} insufficient table clearance ${gap}`);
 }
 for(const chair of seating.chairs.filter(c=>c.area==='cafe')){
  const table=seating.tables.find(t=>t.id===chair.tableId);
  close((table.center.x-chair.center.x)*chair.front.z-(table.center.z-chair.center.z)*chair.front.x,0);
 }
});

test('tables have four slender legs within the footprint beneath each top',()=>{
 assert.equal(tops.length,14);assert.equal(legs.length,56);
 for(const [i,table] of seating.tables.entries()){
  const top=tops[i];close(top.center[2],table.topCenterHeight);close(top.size[2],.055);close(table.topHeight,table.envelope.maxY);
  for(const leg of legs.slice(i*4,i*4+4)){
   const [x,y,z]=leg.a;close(z,.03);close(leg.b[2],table.undersideHeight);
   assert.ok(x-leg.radius>table.collider.minX&&x+leg.radius<table.collider.maxX);
   assert.ok(-y-leg.radius>table.collider.minZ&&-y+leg.radius<table.collider.maxZ);
  }
 }
});

test('new seating avoids architectural columns, stands and surrounding furniture',()=>{
 for(const part of parts)for(const neighbour of neighbours)assert.ok(!overlap(part.collider,neighbour),`${part.id} overlaps neighbouring obstacle ${JSON.stringify(neighbour)}`);
});

test('stand route and auditorium central aisle remain clear with a visitor radius',()=>{
 const routes=[generated.standsRoute||[],[{x:0,z:-24},{x:0,z:-39}]];
 for(const route of routes)for(let i=1;i<route.length;i++){
  const a=route[i-1],b=route[i],n=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.05);
  for(let k=0;k<=n;k++){
   const x=a.x+(b.x-a.x)*k/n,z=a.z+(b.z-a.z)*k/n;
   assert.ok(canStand(x,z,navigation),`Route blocked at ${x}, ${z}`);
  }
 }
});

test('all venue views remain clear and connected with individual seating collisions',()=>{
 const step=.25,round=x=>Math.round(x/step),start=[round(navigation.spawn.x),round(navigation.spawn.z)],todo=[start],seen=new Set([start.join(',')]);
 for(let k=0;k<todo.length;k++){
  const [x,z]=todo[k];
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
   const a=x+dx,b=z+dz,key=`${a},${b}`;
   if(!seen.has(key)&&canStand(a*step,b*step,navigation)&&Math.abs(floorHeight(a*step,b*step,navigation)-floorHeight(x*step,z*step,navigation))<=.25001){seen.add(key);todo.push([a,b]);}
  }
 }
 for(const zone of navigation.zones){
  assert.ok(canStand(zone.view.x,zone.view.z,navigation),`Occupied viewpoint ${zone.id}`);
  assert.ok(seen.has([round(zone.view.x),round(zone.view.z)].join(',')),`Disconnected viewpoint ${zone.id}`);
 }
});

test('exported seating metadata and collisions match the reviewed source placements',{skip:!generated.seating},()=>{
 assert.deepEqual(generated.seating,seating);
 const actual=generated.obstacles.filter(o=>o.seatingId);
 assert.deepEqual(actual,obstacles);
 for(const old of legacy)assert.ok(!generated.obstacles.some(o=>!o.seatingId&&sameBox(o,old)),`Legacy seating/curtain collision retained ${JSON.stringify(old)}`);
});

test('real exported chair meshes stay planted inside their conservative geometry and collision envelopes',{skip:!generated.seating},()=>{
 const bytes=fs.readFileSync(new URL('../dist/assets/one16.glb',import.meta.url));
 assert.equal(bytes.readUInt32LE(0),0x46546c67);
 const document=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
 const parents=new Map(),worlds=new Map();
 for(const [i,node] of document.nodes.entries())for(const child of node.children||[])parents.set(child,i);
 function world(i){
  if(worlds.has(i))return worlds.get(i);
  const node=document.nodes[i],local=node.matrix?new Matrix4().fromArray(node.matrix):new Matrix4().compose(new Vector3(...(node.translation||[0,0,0])),new Quaternion(...(node.rotation||[0,0,0,1])),new Vector3(...(node.scale||[1,1,1])));
  const result=parents.has(i)?world(parents.get(i)).clone().multiply(local):local;worlds.set(i,result);return result;
 }
 function meshBounds(i,box=new Box3()){
  const node=document.nodes[i];
  if(node.mesh!==undefined)for(const primitive of document.meshes[node.mesh].primitives){
   const accessor=document.accessors[primitive.attributes.POSITION];
   box.union(new Box3(new Vector3(...accessor.min),new Vector3(...accessor.max)).applyMatrix4(world(i)));
  }
  for(const child of node.children||[])meshBounds(child,box);
  return box;
 }
 const chairNodes=document.nodes.map((node,i)=>({node,i})).filter(({node})=>generated.seating.chairs.some(c=>c.id===node.extras?.seatingId));
 assert.equal(chairNodes.length,118);
 for(const {node,i} of chairNodes){
  const spec=generated.seating.chairs.find(c=>c.id===node.extras.seatingId),box=meshBounds(i),epsilon=1e-5;
  assert.ok(!box.isEmpty(),`No actual mesh for ${spec.id}`);
  assert.ok(box.min.y>=-epsilon&&box.min.y<.002,`${spec.id} feet float or penetrate the floor: ${box.min.y}`);
  assert.ok(box.max.y<=spec.envelope.maxY+epsilon&&box.max.y>.84,`${spec.id} height exceeds envelope: ${box.max.y}`);
  for(const bound of [spec.envelope,spec.collider]){
   assert.ok(box.min.x>=bound.minX-epsilon&&box.max.x<=bound.maxX+epsilon&&box.min.z>=bound.minZ-epsilon&&box.max.z<=bound.maxZ+epsilon,`${spec.id} actual geometry exceeds recorded bounds`);
  }
 }
});
