import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {floorReviewPosition} from '../dist/walk-floor-numbers.mjs';import {REVIEW_SECTIONS} from '../dist/review-map.mjs';import {shortenLayout} from '../dist/short-corridor.mjs';import {canStand,floorHeight} from '../dist/navigation.mjs';
const l=shortenLayout(JSON.parse(fs.readFileSync(new URL('../dist/assets/layout.json',import.meta.url))));
test('floor reference numbers have walkable locations and follow actual floor height',()=>{for(const s of REVIEW_SECTIONS){const p=floorReviewPosition(s,l);assert.ok(canStand(p.x,p.z,l),String(s.id));assert.ok(Math.hypot(p.x-s.x,p.z-s.z)<=3.001);assert.equal(p.y,floorHeight(p.x,p.z,l)+.035);}});

test('the stair reference fits one tread beside the activation light route',()=>{
 const p=floorReviewPosition(REVIEW_SECTIONS.find(s=>s.id===7),{...l,activationRoute:[{x:0,z:25},{x:2.9,z:-7.9}]});
 assert.equal(p.size,.3);assert.ok(p.x-p.size/2>.2);
 const tread=l.surfaces.find(s=>p.z>=Math.min(...s.polygon.map(v=>v[1]))&&p.z<Math.max(...s.polygon.map(v=>v[1])));
 assert.ok(tread);const zs=tread.polygon.map(v=>v[1]);assert.ok(p.z-p.size/2>=Math.min(...zs));assert.ok(p.z+p.size/2<=Math.max(...zs));
});
