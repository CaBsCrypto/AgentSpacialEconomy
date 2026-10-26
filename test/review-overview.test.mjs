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
test('retired overview controller clears old references and never recreates numeric badges',()=>{
 const doc={createElement(){throw Error('No review elements may be created');}},layer=new El(doc);layer.children.push('obsolete badge');
 const api=createReviewOverview(layer);assert.deepEqual(api.entries,[]);assert.deepEqual(layer.children,[]);assert.equal(layer.hidden,true);assert.equal(layer.style.pointerEvents,'none');
 for(const visible of [true,false]){api.update({},null,600,600,visible);assert.equal(layer.hidden,true);assert.deepEqual(layer.children,[]);}
 layer.children.push('stale');api.dispose();assert.deepEqual(layer.children,[]);
});

test('labels avoid occupied UI rectangles while keeping the actual world anchor',()=>{
 const occupied=[{left:0,top:0,right:320,bottom:130},{left:180,top:150,right:320,bottom:400}];
 const result=separateReviewMarkers([{left:230,top:180,visible:true},{left:130,top:80,visible:true}],320,400,occupied);
 assert(result.every(p=>p.visible));
 for(const p of result)for(const r of occupied)assert(!(p.displayLeft+13>r.left&&p.displayLeft-13<r.right&&p.displayTop+13>r.top&&p.displayTop-13<r.bottom));
 assert.equal(result[0].left,230);assert.equal(result[0].top,180);
 const covered=separateReviewMarkers([{left:150,top:180,visible:true}],320,400,[{left:0,top:0,right:320,bottom:400}]);
 assert.equal(covered[0].visible,false);
});
