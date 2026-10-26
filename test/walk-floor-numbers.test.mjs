import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {floorReviewPosition} from '../dist/walk-floor-numbers.mjs';import {REVIEW_SECTIONS} from '../dist/review-map.mjs';import {shortenLayout} from '../dist/short-corridor.mjs';import {canStand,floorHeight} from '../dist/navigation.mjs';
const l=shortenLayout(JSON.parse(fs.readFileSync(new URL('../dist/assets/layout.json',import.meta.url))));
test('floor reference numbers have walkable locations and follow actual floor height',()=>{for(const s of REVIEW_SECTIONS){const p=floorReviewPosition(s,l);assert.ok(canStand(p.x,p.z,l),String(s.id));assert.ok(Math.hypot(p.x-s.x,p.z-s.z)<=3.001);assert.equal(p.y,floorHeight(p.x,p.z,l)+.035);}});
