import test from 'node:test';import assert from 'node:assert/strict';import{PerspectiveCamera,Vector3}from'three';
import{projectReviewPoint,separateReviewMarkers,createReviewOverview}from'../dist/review-overview.mjs';
test('review markers use actual camera projection and retain edge points',()=>{
 const camera=new PerspectiveCamera(60,1,.1,200);camera.position.set(0,50,0);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const p=projectReviewPoint({id:18,x:0,z:0},camera,new Vector3(),400,400);assert(p.visible);assert(Math.abs(p.left-200)<.01);assert(Math.abs(p.top-200)<.1);
 const q=projectReviewPoint({id:18,x:10000,z:0},camera,new Vector3(),400,400);assert.equal(q.visible,false);
});
test('20 coincident labels separate with24px clearance, anchors preserved and none discarded',()=>{
 const points=Array.from({length:20},()=>({left:150,top:180,visible:true}));const out=separateReviewMarkers(points,320,400);assert.equal(out.filter(p=>p.visible).length,20);
 for(let i=0;i<out.length;i++){assert.equal(out[i].left,150);for(let j=0;j<i;j++)assert(Math.hypot(out[i].displayLeft-out[j].displayLeft,out[i].displayTop-out[j].displayTop)>=25);}
});
class El{constructor(doc){this.ownerDocument=doc;this.style={};this.dataset={};this.children=[];}replaceChildren(){this.children=[];}append(...e){this.children.push(...e);}setAttribute(k,v){this[k]=v;}}
test('overview module makes20 noninteractive spans with stable IDs and leader elements',()=>{
 const doc={createElement(tag){assert.equal(tag,'span');return new El(doc);}},layer=new El(doc),api=createReviewOverview(layer);assert.equal(api.entries.length,20);assert.equal(layer.children.length,60);assert.equal(layer.style.pointerEvents,'none');assert.deepEqual(api.entries.map(e=>e.badge.dataset.reviewId),Array.from({length:20},(_,i)=>String(i+1)));
 const camera=new PerspectiveCamera(60,1,.1,300);camera.position.set(0,110,0);camera.lookAt(0,0,0);api.update(camera,new Vector3(),600,600,true);assert.equal(layer.hidden,false);assert(api.entries.every(e=>!e.badge.hidden));assert(api.entries[10].badge.title.includes('PROVISIONAL'));
 api.update(camera,new Vector3(),600,600,false);assert.equal(layer.hidden,true);api.update(camera,new Vector3(),0,600,true);assert.equal(layer.hidden,true);
});
