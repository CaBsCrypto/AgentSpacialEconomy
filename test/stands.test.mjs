import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import{walk,canStand,roomAt}from'../src/navigation.mjs';
const l=JSON.parse(fs.readFileSync(new URL('../dist/assets/layout.json',import.meta.url)));
test('central approach through paired stands reaches auditorium and stage and reverses',()=>{let p={x:0,z:-25,yaw:0,pitch:0};assert.ok(canStand(p.x,p.z,l));for(let i=0;i<250;i++)p=walk(p,{forward:1},.025,l);assert.ok(p.z<-38);for(let i=0;i<250;i++)p=walk(p,{forward:-1},.025,l);assert.ok(Math.abs(p.z+25)<1e-7)});
test('stand and auditorium viewpoints are distinct, clear, and correctly labeled',()=>{const s=l.zones.find(z=>z.id==='stands'),a=l.zones.find(z=>z.id==='auditorium');assert.ok(s);assert.ok(canStand(s.view.x,s.view.z,l));assert.equal(roomAt(s.view,l.zones),'stands');assert.equal(roomAt(a.view,l.zones),'auditorium');assert.ok(a.view.z<s.view.z)});
test('proposed Passport display belongs to its tabletop and approach takes priority over the parent stands zone',()=>{
 const p=l.zones.find(z=>z.id==='passport'),display=l.passportDisplay,table=l.exhibition.positions.find(p=>p.graphic==='booth-passport').table;
 assert.equal(display.tableId,'booth-passport');assert.equal(display.support,'tabletop');
 assert.equal(display.position.x,table.x);assert(Math.abs(display.position.z-table.z)<table.depth/2);
 assert(display.bookWidth>=.30&&display.bookWidth<=.40);assert.equal(display.scale,3.8);
 assert.deepEqual(p.view,display.approach);assert(canStand(p.view.x,p.view.z,l));assert.equal(roomAt(p.view,l.zones),'passport');
 assert(l.zones.indexOf(p)<l.zones.findIndex(z=>z.id==='stands'));assert.match(p.status,/Proposed|provisional/i);
 assert(canStand(8.7,-3,l),'obsolete entry-hall Passport pedestal still blocks circulation');
});

test('wider dividers retain the central aisle, all eight desks and individual staff-chair clearances',()=>{
 assert.equal(l.exhibition.dividerWidth,3.6);assert.equal(l.exhibition.dividerInnerEdge,2.2);assert.equal(l.exhibition.aisleWidth,4.4);
 assert.equal(l.exhibition.positions.length,8);
 for(const p of l.exhibition.positions){assert.equal(Math.abs(p.table.x),4);assert.equal(p.table.width,1.95);assert.equal(p.chair.width,.54);assert.equal(p.chair.depth,.62);assert(Math.abs(p.chair.z-p.table.z)-p.chair.depth/2-p.table.depth/2>.08);}
});
