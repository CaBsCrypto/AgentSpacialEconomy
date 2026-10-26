import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {canStand, floorHeight, insidePolygon, roomAt, walk} from '../src/navigation.mjs';
import {shortenLayout} from '../dist/short-corridor.mjs';

const original=JSON.parse(fs.readFileSync(new URL('../dist/assets/layout.json',import.meta.url)));
const layout=shortenLayout(original);
const additions=['games','skills','energy','photobooth','content-hub'];

test('all narrated additions have clear viewpoints and classify as their own zone',()=>{
  assert.equal(new Set(layout.zones.map(z=>z.id)).size,layout.zones.length);
  for(const id of additions){
    const zone=layout.zones.find(z=>z.id===id);
    assert.ok(zone,`Missing ${id}`);
    assert.ok(canStand(zone.view.x,zone.view.z,layout),`Blocked ${id} viewpoint`);
    assert.equal(roomAt(zone.view,layout.zones),id);
    assert.match(zone.evidence,/estimated/i);
  }
  assert.deepEqual(additions.map(id=>layout.zones.find(z=>z.id===id).reviewSection),[21,22,23,24,25]);
});

test('new room interiors do not mask existing or neighboring room classifications',()=>{
  for(const id of additions){
    const own=layout.zones.find(z=>z.id===id);
    const xs=own.polygon.map(p=>p[0]),zs=own.polygon.map(p=>p[1]);
    for(let x=Math.min(...xs)+.125;x<Math.max(...xs);x+=.25){
      for(let z=Math.min(...zs)+.125;z<Math.max(...zs);z+=.25){
        if(!insidePolygon(x,z,own.polygon))continue;
        const containing=layout.zones.filter(zone=>insidePolygon(x,z,zone.polygon));
        assert.deepEqual(containing.map(zone=>zone.id),[id],`${id} overlaps at ${x},${z}`);
      }
    }
  }
});

test('the multipane Content Hub has a reversible walking entrance',()=>{
  let state={x:9.25,z:-13.65,yaw:-Math.PI/2,pitch:0};
  assert.ok(canStand(state.x,state.z,layout));
  for(let i=0;i<100;i++)state=walk(state,{forward:1},.01,layout);
  assert.ok(state.x>11.4,`Doorway stopped at x=${state.x}`);
  assert.equal(roomAt(state,layout.zones),'content-hub');
  for(let i=0;i<100;i++)state=walk(state,{forward:-1},.01,layout);
  assert.ok(Math.abs(state.x-9.25)<1e-7);
});

test('physical games, skills board, goal, camera and sofas are collision obstacles',()=>{
  for(const [name,x,z] of [
    ['giant keyboard',-13.45,-10.2],['arcade',-12.1,-17.25],
    ['skills board',5.8,-9.5],['goal',14.07,-28.5],
    ['photobooth tripod',11.65,-34],['Content Hub sofa',13.9,-16.25],
  ])assert.equal(canStand(x,z,layout),false,`${name} allows walking through it`);
});

test('every zone remains connected to the entrance on a 0.25m collision and elevation grid',()=>{
  const step=.25,key=(x,z)=>`${x},${z}`,standable=new Map();
  const minX=Math.floor(layout.bounds.minX/step),maxX=Math.ceil(layout.bounds.maxX/step);
  const minZ=Math.floor(layout.bounds.minZ/step),maxZ=Math.ceil(layout.bounds.maxZ/step);
  for(let ix=minX;ix<=maxX;ix++)for(let iz=minZ;iz<=maxZ;iz++){
    const x=ix*step,z=iz*step;
    if(canStand(x,z,layout))standable.set(key(ix,iz),floorHeight(x,z,layout));
  }
  const start=[Math.round(layout.spawn.x/step),Math.round(layout.spawn.z/step)];
  const queue=[start],visited=new Set([key(...start)]);
  assert.ok(standable.has(key(...start)),'Spawn is blocked');
  for(let i=0;i<queue.length;i++){
    const [ix,iz]=queue[i],height=standable.get(key(ix,iz));
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=ix+dx,nz=iz+dz,k=key(nx,nz),next=standable.get(k);
      if(next===undefined||visited.has(k)||Math.abs(next-height)>.251)continue;
      visited.add(k);queue.push([nx,nz]);
    }
  }
  for(const zone of layout.zones){
    assert.ok(canStand(zone.view.x,zone.view.z,layout),`Blocked ${zone.id} viewpoint`);
    const ix=Math.round(zone.view.x/step),iz=Math.round(zone.view.z/step);
    const nearby=[[0,0],[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>visited.has(key(ix+dx,iz+dz)));
    assert.ok(nearby,`${zone.id} cannot be reached from the entrance`);
  }
});

test('two-body Content Hub frees the former room and retains four practical fixtures',()=>{
  assert.equal(layout.contentHub.bodies,2);
  assert.equal(layout.contentHub.length,6.6);
  assert.equal(layout.contentHub.linearLuminaires,4);
  assert.equal(layout.contentHub.softLights.length,2);
  assert.ok(canStand(12.3,-22,layout),'Former far furniture must be removed');
  assert.notEqual(roomAt({x:12.3,z:-22},layout.zones),'content-hub');
});
test('food viewpoint and photo reference use the reviewed perspectives and labels',()=>{
  const food=layout.zones.find(z=>z.id==='buffet');
  assert.ok(food.view.z < -6.7,'Food view must move past the central check-in panel');
  assert.ok(food.view.yaw > .8,'Oblique food view must expose the counters');
  assert.equal(layout.zones.find(z=>z.id==='photo').label,'Zona de fotos · junto al escenario');
});

test('skills preset centers its board in a portrait-width field of view',()=>{
 const view=layout.zones.find(z=>z.id==='skills').view;
 assert.equal(view.x,5.8);assert.equal(view.yaw,0);
 assert.ok(Math.abs(view.z+9.5)>2.5,'Portrait view must fit the 1.45m board');
 assert.ok(view.pitch<0);
});
