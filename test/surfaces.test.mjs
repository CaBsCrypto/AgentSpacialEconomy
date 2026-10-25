import {test} from 'node:test';import assert from 'node:assert/strict';import {floorHeight,walk} from '../src/navigation.mjs';
const poly=[[-2,-6],[2,-6],[2,6],[-2,6]],ramp={walkable:[poly],surfaces:[{polygon:poly,baseY:.6,originZ:0,slopeZ:-.1}]};
test('camera floor height follows ramp in both directions',()=>{assert.equal(floorHeight(0,-5,ramp),1.1);assert.ok(Math.abs(floorHeight(0,5,ramp)-.1)<1e-9);let p={x:0,z:5,yaw:0};for(let i=0;i<80;i++)p=walk(p,{forward:1},.05,ramp);assert.ok(p.z<0);const high=floorHeight(p.x,p.z,ramp);for(let i=0;i<80;i++)p=walk(p,{forward:-1},.05,ramp);assert.ok(Math.abs(p.z-5)<1e-8);assert.ok(floorHeight(p.x,p.z,ramp)<high);});
test('unmodeled drop cannot be stepped off',()=>{const l={walkable:[poly],surfaces:[{polygon:[[-2,-6],[2,-6],[2,0],[-2,0]],baseY:1}]};let p={x:0,z:.3,yaw:0};for(let i=0;i<100;i++)p=walk(p,{forward:1},.05,l);assert.ok(p.z>=0);});
test('legacy floor retains zero height',()=>assert.equal(floorHeight(0,0,{walkable:[poly]}),0));
