import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {canStand,floorHeight,roomAt,walk} from '../dist/navigation.mjs';
import {shortenLayout} from '../dist/short-corridor.mjs';
import {prepareVenueModel} from '../dist/venue-model.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const raw=JSON.parse(fs.readFileSync(new URL('../dist/assets/layout.json',import.meta.url)));
const sourceOnly=process.env.FINAL_MODEL_SOURCE_ONLY==='1';
// Evaluate only authored data expressions, without importing bpy or exporting assets.
const inspect=String.raw`import ast,json,math,sys
from pathlib import Path
root=Path(sys.argv[1]);tree=ast.parse((root/'model/build_venue.py').read_text(encoding='utf-8-sig'))
env={'__builtins__':{},'math':math,'layout':{'spawn':json.loads(sys.argv[2])}}
def value(node):return eval(compile(ast.Expression(node),'authored-layout','eval'),env)
def key(node):
 return node.slice.value if isinstance(node,ast.Subscript) and isinstance(node.value,ast.Name) and node.value.id=='layout' and isinstance(node.slice,ast.Constant) else None
out={}
for node in tree.body:
 if isinstance(node,ast.Assign):
  name=key(node.targets[0])
  if name in ['activation','activationRoute','companyRoutes']:out[name]=value(node.value)
 if isinstance(node,ast.Expr) and isinstance(node.value,ast.Call):
  call=node.value
  if isinstance(call.func,ast.Name) and call.func.id=='build_totem':
   out['totemOrigin']=next(value(kw.value) for kw in call.keywords if kw.arg=='origin')
   following=tree.body[tree.body.index(node)+1].value
   out['totemCollider']=[value(arg) for arg in following.args]
  if isinstance(call.func,ast.Attribute) and call.func.attr=='append' and key(call.func.value)=='zones' and call.args and isinstance(call.args[0],ast.Dict):
   zone=value(call.args[0])
   if zone.get('id')=='activation':out['activationZone']=zone
experience=ast.parse((root/'model/experience_zones.py').read_text(encoding='utf-8-sig'))
for node in ast.walk(experience):
 if isinstance(node,ast.Assign) and isinstance(node.targets[0],ast.Name) and node.targets[0].id=='updates':out['buffetBounds']=ast.literal_eval(node.value)['buffet'][0]
palta=ast.parse((root/'model/palta_reveal.py').read_text(encoding='utf-8-sig'))
function=next(node for node in palta.body if isinstance(node,ast.FunctionDef) and node.name=='build')
out['paltaParameters']={arg.arg:ast.literal_eval(default) for arg,default in zip(function.args.args[-len(function.args.defaults):],function.args.defaults)}
print(json.dumps(out,ensure_ascii=True))`;
const authored=JSON.parse(execFileSync('python',['-c',inspect,root,JSON.stringify(raw.spawn)],{encoding:'utf8'}));

function projectedLayout(){
 const layout=structuredClone(raw),old=layout.activation.position;
 layout.obstacles=layout.obstacles.filter(b=>!(Math.abs((b.minX+b.maxX)/2-old.x)<.001&&Math.abs((b.minZ+b.maxZ)/2-old.z)<.001&&Math.abs(b.maxX-b.minX-1.2)<.001));
 const [x,y,w,d]=authored.totemCollider;
 layout.obstacles.push({minX:x-w/2,maxX:x+w/2,minZ:-y-d/2,maxZ:-y+d/2});
 layout.activation=authored.activation;layout.activationRoute=authored.activationRoute;layout.companyRoutes=authored.companyRoutes;
 Object.assign(layout.zones.find(z=>z.id==='activation'),authored.activationZone);
 const [x0,x1,y0,y1]=authored.buffetBounds;
 layout.zones.find(z=>z.id==='buffet').polygon=[[x0,-y1],[x1,-y1],[x1,-y0],[x0,-y0]];
 return layout;
}
function walkPath(layout,points){
 let pose={...points[0],yaw:0,pitch:0};
 for(const target of points.slice(1)){
  const start={...pose},distance=Math.hypot(target.x-pose.x,target.z-pose.z),count=Math.ceil(distance/.04);
  for(let i=0;i<=count;i++){
   const x=start.x+(target.x-start.x)*i/count,z=start.z+(target.z-start.z)*i/count;
   assert(canStand(x,z,layout),`authored route is blocked at ${x.toFixed(3)},${z.toFixed(3)}`);
  }
  let budget=Math.ceil(distance/.1)+10;
  while(Math.hypot(target.x-pose.x,target.z-pose.z)>1e-5&&budget-->0){
   const remaining=Math.hypot(target.x-pose.x,target.z-pose.z),yaw=Math.atan2(-(target.x-pose.x),-(target.z-pose.z));
   const next=walk({...pose,yaw},{forward:1},Math.min(.05,remaining/2.2),layout);
   assert(Math.hypot(next.x-pose.x,next.z-pose.z)>1e-7,'the company route is stuck');
   assert(Math.abs(floorHeight(next.x,next.z,layout)-floorHeight(pose.x,pose.z,layout))<=.25+1e-8);
   pose=next;
  }
  assert(Math.hypot(target.x-pose.x,target.z-pose.z)<1e-5);
 }
 return pose;
}
async function modelAt(path){
 const bytes=fs.readFileSync(path),loader=new GLTFLoader();
 loader.register(()=>({name:'final-model-cpu-images',loadTexture:()=>Promise.resolve(new T.Texture())}));
 return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
}

test('final source keeps the entry kiosk, complete buffet and two named company branches consistent',()=>{
 assert.deepEqual(authored.totemOrigin,[2.6,5.6,0]);assert.deepEqual(authored.totemCollider,[2.6,5.6,1.2,1.2]);
 assert.deepEqual(authored.activation.position,{x:2.6,y:0,z:-5.6});
 assert.deepEqual(authored.activation.approach,{x:2.6,z:-4.3,yaw:0,pitch:-.12});
 assert.deepEqual(authored.activationZone.view,authored.activation.approach);
 assert.deepEqual(authored.activationZone.polygon,[[1.85,-6.5],[3.5,-6.5],[3.5,-4.05],[1.85,-4.05]]);
 assert.deepEqual(authored.buffetBounds,[-4.8,3.3,6.5,14.2]);
 assert.deepEqual(authored.activationRoute.at(-1),{x:2.6,z:-4.3});
 const {trunk,branches}=authored.companyRoutes;
 assert.deepEqual(trunk,[{x:2.6,z:-4.3},{x:4.2,z:-4.3},{x:4.2,z:-12.8},{x:5.8,z:-12.8},{x:5.8,z:-23},{x:0,z:-23},{x:0,z:-29.9}]);
 assert.deepEqual(branches.map(b=>[b.id,b.label]),[['passport','Stellar Passport'],['palta','DeFindex · Soroswap']]);
 for(const branch of branches){assert.deepEqual(branch.points[0],trunk.at(-1));assert.deepEqual(branch.points.at(-1),{x:branch.approach.x,z:branch.approach.z});}
 assert.deepEqual(authored.paltaParameters,{logo_path:null,fruit_height:.75,pedestal_height:.95,pedestal_scale:.875,fruit_scale:1.08});
});

test('the final authored entrance and both company paths walk through current furniture in either corridor representation',()=>{
 const projected=projectedLayout();
 for(const layout of [projected,shortenLayout(projected)]){
  const endpoint=walkPath(layout,layout.activationRoute);assert.equal(roomAt(endpoint,layout.zones),'activation');
  assert.equal(roomAt(layout.zones.find(z=>z.id==='buffet').view,layout.zones),'buffet');
  const {trunk,branches}=layout.companyRoutes;
  for(const branch of branches){const path=[...trunk,...branch.points.slice(1)];walkPath(layout,path);walkPath(layout,[...path].reverse());}
 }
});

test('exported final layout matches the authored kiosk and company route contract',{skip:sourceOnly},()=>{
 assert.deepEqual(raw.activation,authored.activation);assert.deepEqual(raw.activationRoute,authored.activationRoute);assert.deepEqual(raw.companyRoutes,authored.companyRoutes);
 assert.deepEqual(raw.zones.find(z=>z.id==='activation'),authored.activationZone);
});

test('all eight exported faces have horizontal readable headers, with Passport clear of its poster and nearby column',{skip:sourceOnly},async()=>{
 const {scene}=await modelAt(fileURLToPath(new URL('../dist/assets/one16.glb',import.meta.url)));
 const model=prepareVenueModel(scene,T);model.updateMatrixWorld(true);
 const objects=[];model.traverse(object=>{if(object.isMesh&&object.userData.role==='stand-header')objects.push(object)});
 assert.equal(objects.length,10);
 const poster=model.getObjectByName('PassportStand_target_panel'),posterBounds=new T.Box3().setFromObject(poster);
 for(const position of raw.exhibition.positions){
  const expected=position.brand.split(' / ');assert.deepEqual(position.headers.map(header=>header.text),expected);
  for(const header of position.headers){
   const object=objects.find(object=>object.name===T.PropertyBinding.sanitizeNodeName(header.node));assert(object,header.node);
   assert.equal(object.userData.readingDirection,'left-to-right');
   const right=new T.Vector3(1,0,0).transformDirection(object.matrixWorld),up=new T.Vector3(0,0,-1).transformDirection(object.matrixWorld),bounds=new T.Box3().setFromObject(object);
   assert(right.x*(position.face==='arrival'?1:-1)>.999&&up.y>.999,'brand text remains vertical, reversed or mirrored');
   assert(bounds.max.x-bounds.min.x<=3.101&&bounds.min.y>1.87&&bounds.max.y<2.85);
   if(position.graphic==='booth-passport'){assert(bounds.max.x<4.8);assert(bounds.min.y>posterBounds.max.y+.119);}
  }
 }
});

test('authored Palta proportions survive its scale animation and keep the fruit seated on the reduced pedestal',async()=>{
 const path=process.env.FINAL_MODEL_PALTA_GLB||fileURLToPath(new URL('../dist/assets/palta-reveal.glb',import.meta.url));
 const {scene,animations}=await modelAt(path),node=name=>scene.getObjectByName(name);
 const pedestal=node('palta_pedestal'),turntable=node('palta_turntable'),fruit=node('palta_fruit'),proportions=node('palta_reveal').userData.proportions;
 assert.equal(proportions.pedestalScale,.875);assert.equal(proportions.fruitScale,1.08);
 assert.deepEqual(pedestal.scale.toArray(),[.875,.875,.875]);assert(Math.abs(turntable.position.y-.83125)<1e-7);
 assert(fruit.scale.toArray().every(value=>Math.abs(value-.81)<1e-7));
 const names=animations.flatMap(clip=>clip.tracks.map(track=>track.name));
 assert(!names.some(name=>name.startsWith('palta_turntable.')||name.startsWith('palta_pedestal.')));
 const mixer=new T.AnimationMixer(scene),clip=animations.find(clip=>clip.name==='open'),action=mixer.clipAction(clip);
 action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();
 mixer.setTime(.45);assert(fruit.scale.y<.81&&fruit.scale.x>.81,'the authored squash animation no longer uses the enlarged base scale');
 mixer.setTime(clip.duration);scene.updateMatrixWorld(true);
 assert(fruit.scale.toArray().every(value=>Math.abs(value-.81)<1e-6),'animation reset the fruit to its former size');
 const pedestalBounds=new T.Box3().setFromObject(pedestal);assert(Math.abs(pedestalBounds.max.y-turntable.position.y)<1e-6);
 const center=node('palta_medallion').getWorldPosition(new T.Vector3());assert(Math.abs(center.y-2.07865)<1e-5);
});
