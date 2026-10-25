import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {REVIEW_SECTIONS,buildReviewSvg} from '../dist/review-map.mjs';
const layout=JSON.parse(fs.readFileSync(new URL('../dist/assets/layout.json',import.meta.url)));
test('review registry has stable ordered IDs 1,4–20 and known world coordinates',()=>{
 assert.deepEqual(REVIEW_SECTIONS.map(s=>s.id),[1,...Array.from({length:17},(_,i)=>i+4)]);
 assert.deepEqual(REVIEW_SECTIONS.find(s=>s.id===11),{id:11,label:'Passport · PROVISIONAL',x:8.7,z:-3,provisional:true});
 assert.equal(REVIEW_SECTIONS[0].z,38);assert.equal(REVIEW_SECTIONS.find(s=>s.id===18).z,-43);assert(Object.isFrozen(REVIEW_SECTIONS));assert(REVIEW_SECTIONS.every(Object.isFrozen));
});
test('both full and compact maps include all18 informational pins, actual floor and obstacles',()=>{
 for(const compact of [false,true]){const svg=buildReviewSvg(layout,{compact});assert.equal((svg.match(/data-review-number=/g)||[]).length,18);for(const s of REVIEW_SECTIONS)assert(svg.includes(`data-review-number="${s.id}" data-review-id="${s.id}" data-world-x="${s.x}" data-world-z="${s.z}"`));assert(svg.includes('<polygon'));assert(svg.includes('aria-label="Mapa de revisión'));assert(!svg.includes('<button'));assert(!svg.includes('onclick'));assert(!svg.includes('tabindex'));}
});
test('pose points negative Z/up at yaw0; yawπ/2 rotates left; invalid pose cannot inject markup',()=>{
 assert(buildReviewSvg(layout,{pose:{x:0,z:38,yaw:0}}).includes('rotate(0)'));
 assert(buildReviewSvg(layout,{pose:{x:0,z:38,yaw:Math.PI/2}}).includes('rotate(-90)'));
 assert(!buildReviewSvg(layout,{pose:{x:'"><script>alert(1)</script>',z:38,yaw:0}}).includes('data-review-pose'));
 assert(!buildReviewSvg(layout,{pose:{x:0,z:NaN,yaw:Infinity}}).includes('data-review-pose'));
});
test('nearby entries have world-anchored leaders and malformed geometry is ignored',()=>{
 const svg=buildReviewSvg({walkable:[[['<svg>',0],[0,0],[1,1]]],obstacles:[{minX:NaN}]});assert(!svg.includes('NaN'));assert(!svg.includes('<svg>'));assert(svg.includes('data-world-x="8.7"'));assert(svg.includes('<path d="M'));assert.equal((svg.match(/data-review-number=/g)||[]).length,18);
});

test('compact is local pose-centered viewBox with24x32world span, full staysglobal; numbers optional',()=>{
 const pose={x:7,z:-4,yaw:0},full=buildReviewSvg(layout,{pose}),compact=buildReviewSvg(layout,{pose,compact:true});
 const box=s=>s.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
 assert.deepEqual(box(full),[0,0,800,1200]);const b=box(compact);assert(Math.abs(b[2]/b[3]-.75)<.001);assert(b[2]<800&&b[3]<1200);
 const coords=compact.match(/data-review-pose="true" transform="translate\(([-.0-9]+) ([-.0-9]+)\)"/);assert(Math.abs(b[0]+b[2]/2-Number(coords[1]))<.02);assert(Math.abs(b[1]+b[3]/2-Number(coords[2]))<.02);
 assert.equal((compact.match(/data-review-id=/g)||[]).length,18);assert(!buildReviewSvg(layout,{showNumbers:false}).includes('data-review-number'));assert(buildReviewSvg(layout,{showNumbers:false,pose}).includes('data-review-pose'));
});
