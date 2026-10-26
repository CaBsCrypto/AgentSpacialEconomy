import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {REVIEW_SECTIONS,resolveReviewSections,buildReviewSvg} from '../dist/review-map.mjs';
const layout=JSON.parse(fs.readFileSync(new URL('../dist/assets/layout.json',import.meta.url)));
const fixture={
 bounds:{minX:-15,maxX:15,minZ:-50,maxZ:27},walkable:[[[-15,-50],[15,-50],[15,27],[-15,27]]],obstacles:[],
 activationRoute:[{x:0,z:25},{x:0,z:0},{x:2.6,z:-4.3}],
 companyRoutes:{trunk:[{x:2.6,z:-4.3},{x:4.2,z:-4.3},{x:0,z:-29.9}],branches:[
  {id:'passport',label:'Stellar Passport',points:[{x:0,z:-29.9},{x:4.1,z:-29.9}]},
  {id:'palta',label:'DeFindex · Soroswap',points:[{x:0,z:-29.9},{x:-4,z:-29.9}]}]}
};
test('legacy evidence registry remains available without producing any numbered map overlay',()=>{
 assert.deepEqual(REVIEW_SECTIONS.map(s=>s.id),[1,...Array.from({length:22},(_,i)=>i+4)]);
 assert(Object.isFrozen(REVIEW_SECTIONS));assert(REVIEW_SECTIONS.every(Object.isFrozen));
 assert.equal(resolveReviewSections({activation:{position:{x:2.6,z:-5.6}}}).find(s=>s.id===10).z,-5.6);
});
test('full and compact product maps never show review references, even when legacy showNumbers is true',()=>{
 for(const compact of [false,true])for(const showNumbers of [undefined,false,true]){
  const svg=buildReviewSvg(layout,{compact,showNumbers});
  assert.doesNotMatch(svg,/data-review-number|data-review-id|referencias|numerado|revisión|stand 16/i);
  assert.match(svg,/aria-label="Plano del recinto"/);assert.match(svg,/<polygon/);
  assert.doesNotMatch(svg,/<button|onclick|tabindex/);
 }
});
test('navigation pose retains the actual yaw and never accepts markup or nonfinite coordinates',()=>{
 const north=buildReviewSvg(layout,{pose:{x:0,z:3,yaw:0}}),west=buildReviewSvg(layout,{pose:{x:0,z:3,yaw:Math.PI/2}});
 assert.match(north,/data-map-pose="true"/);assert.match(north,/rotate\(0\)/);assert.match(west,/rotate\(-90\)/);
 for(const pose of [{x:'"><script>alert(1)</script>',z:3,yaw:0},{x:0,z:NaN,yaw:Infinity}]){
  const svg=buildReviewSvg(layout,{pose});assert.doesNotMatch(svg,/data-map-pose|<script|NaN|Infinity/);
 }
});
test('compact maps remain pose-centered with a24x32 metre span and full maps remain global',()=>{
 const pose={x:7,z:-4,yaw:0},full=buildReviewSvg(layout,{pose}),compact=buildReviewSvg(layout,{pose,compact:true});
 const box=s=>s.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number),b=box(compact);
 assert.deepEqual(box(full),[0,0,800,1200]);assert(Math.abs(b[2]/b[3]-.75)<.001);assert(b[2]<800&&b[3]<1200);
 const coords=compact.match(/data-map-pose="true" data-review-pose="true" transform="translate\(([-.0-9]+) ([-.0-9]+)\)"/);
 assert(Math.abs(b[0]+b[2]/2-Number(coords[1]))<.02);assert(Math.abs(b[1]+b[3]/2-Number(coords[2]))<.02);
});
test('initial and static maps show only the entrance route',()=>{
 for(const guidedTourState of [undefined,{phase:'entry',milestones:{}},{phase:'unexpected'}]){
  const svg=buildReviewSvg(fixture,{guidedTourState});
  assert.match(svg,/data-activation-route="true"/);assert.match(svg,/data-guidance-route="entry"/);
  assert.doesNotMatch(svg,/data-guidance-route="(?:trunk|passport|palta)"/);
 }
});
test('company guidance shows one trunk and both named branches without leaking wallet identity',()=>{
 const guidedTourState={phase:'companies',identity:{address:'PRIVATE_WALLET',fingerprint:'PRIVATE_CONFIG'},milestones:{activated:true,passport:false,palta:false}};
 const svg=buildReviewSvg(fixture,{guidedTourState});
 for(const id of ['trunk','passport','palta'])assert.equal((svg.match(new RegExp('data-guidance-route="'+id+'"','g'))||[]).length,1);
 assert.match(svg,/Stellar Passport/);assert.match(svg,/DeFindex · Soroswap/);
 assert.match(svg,/data-guidance-label="passport"[^>]*text-anchor="start"/);assert.match(svg,/data-guidance-label="palta"[^>]*text-anchor="end"/);
 assert.match(svg,/data-guidance-label="passport"[^>]*font-size="24"/);
 assert.match(buildReviewSvg(fixture,{compact:true,guidedTourState}),/data-guidance-label="passport"[^>]*font-size="12"/);
 assert.doesNotMatch(svg,/data-activation-route|PRIVATE_WALLET|PRIVATE_CONFIG/);
});
test('visited branches are dimmed individually and completed guidance renders no routes',()=>{
 const svg=buildReviewSvg(fixture,{guidedTourState:{phase:'companies',milestones:{passport:true,palta:false}}});
 assert.match(svg,/data-guidance-route="passport" data-route-visited="true"[^>]*stroke-opacity=".28"/);
 assert.match(svg,/data-guidance-route="palta" data-route-visited="false"[^>]*stroke-opacity=".95"/);
 assert.match(svg,/Stellar Passport · visitado/);
 const completed=buildReviewSvg(fixture,{guidedTourState:{phase:'completed',milestones:{passport:true,palta:true}}});
 assert.doesNotMatch(completed,/data-guidance-route|data-activation-route|data-guidance-label/);assert.match(completed,/Recorrido completado/);
});
test('route labels are escaped and malformed or duplicate branches cannot inject markup or corrupt the map',()=>{
 const changed=structuredClone(fixture);changed.companyRoutes.branches[0].label='<script>alert("x")</script>';
 changed.companyRoutes.branches.push(changed.companyRoutes.branches[0],{id:'untrusted',label:'BAD',points:[{x:0,z:0},{x:NaN,z:1}]});
 const svg=buildReviewSvg(changed,{guidedTourState:{phase:'companies'}});
 assert.match(svg,/&lt;script&gt;/);assert.doesNotMatch(svg,/<script|NaN|BAD|Infinity/);
 assert.equal((svg.match(/data-guidance-route="passport"/g)||[]).length,1);
 const malformed=buildReviewSvg({walkable:[[['<svg>',0],[0,0],[1,1]]],obstacles:[{minX:NaN}],spawn:{x:NaN,z:Infinity},activationRoute:[{x:0,z:0},{x:NaN,z:1}]},{compact:true});
 assert.doesNotMatch(malformed,/NaN|Infinity|<svg>|data-guidance-route/);
});
