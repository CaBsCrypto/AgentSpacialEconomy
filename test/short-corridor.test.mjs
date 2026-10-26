import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import * as T from 'three';
import {shortenLayout,shortenScene,corridorZ} from '../dist/short-corridor.mjs';
import {walk,floorHeight,canStand} from '../src/navigation.mjs';
const original=JSON.parse(fs.readFileSync(new URL('../dist/assets/layout.json',import.meta.url))),l=shortenLayout(original);
test('shorter corridor connects relocated entrance to all seven unchanged stairs and back',()=>{
 assert.equal(corridorZ(32)-corridorZ(6),13);assert.equal(l.spawn.z,25);assert.equal(original.spawn.z,38);
 let p={...l.spawn},levels=new Set();
 function segment(z){const distance=Math.abs(z-p.z),n=Math.ceil(distance/.05),dt=distance/n/2.2; p.yaw=z<p.z?0:Math.PI;for(let i=0;i<n;i++){const before=floorHeight(p.x,p.z,l);p=walk(p,{forward:1},dt,l);const after=floorHeight(p.x,p.z,l);assert.ok(Math.abs(after-before)<=.151);levels.add(after.toFixed(2));}assert.ok(Math.abs(p.z-z)<.01);}
 for(const z of [18.5,12.5,4.5,-.5,4.5,12.5,18.5,25])segment(z);
 assert.equal(levels.size,8);assert.ok(canStand(p.x,p.z,l));
});
test('scene compression matches corridor ends and preserves small decoration size',()=>{
 const scene=new T.Scene(),wall=new T.Mesh(new T.BoxGeometry(.2,4,26));wall.position.set(2,1,19);scene.add(wall);
 const decoration=new T.Mesh(new T.BoxGeometry(1,1,1));decoration.position.z=19;scene.add(decoration);shortenScene(scene,T);
 const bounds=new T.Box3().setFromObject(wall);assert.equal(bounds.min.z,6);assert.equal(bounds.max.z,19);
 const small=new T.Box3().setFromObject(decoration);assert.equal(small.max.z-small.min.z,1);assert.equal((small.max.z+small.min.z)/2,12.5);
});
