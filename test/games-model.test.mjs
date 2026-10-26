import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {canStand} from '../src/navigation.mjs';

// Execute the actual construction code with a recording geometry sink. Blender
// export/render QA remains separate; no generated model is changed by this test.
const python=String.raw`
import sys,json,types,math
sys.path.insert(0,'model')
import games
class Obj(dict):
 def __init__(self):super().__init__();self.rotation_euler=types.SimpleNamespace(z=0);self.location=(0,0,0)
class Curve:
 def __init__(self):self.materials=[]
class Geo:
 all=[]
 def __init__(self,name):self.name=name;self.boxes=[];self.rods=[];self.ellipsoids=[];self.closed=False;Geo.all.append(self)
 def box(self,c,s,m):self.boxes.append([c,s,m])
 def rod(self,a,b,r,m,n=8):self.rods.append([a,b,r,m,n])
 def ellipsoid(self,c,s,m):self.ellipsoids.append([c,s,m])
 def finish(self):self.closed=True;return Obj()
sofas=[]
def sofa(name,center,**kw):
 sofas.append({'name':name,'center':center,'width':kw['width'],'angle':kw['angle']});return Obj()
sys.modules['furniture']=types.SimpleNamespace(build_sofa=sofa)
sys.modules['bpy']=types.SimpleNamespace(data=types.SimpleNamespace(curves=types.SimpleNamespace(new=lambda *a:Curve()),objects=types.SimpleNamespace(new=lambda *a:Obj())),context=types.SimpleNamespace(collection=types.SimpleNamespace(objects=types.SimpleNamespace(link=lambda *a:None))))
materials=['black','white','steel'];names=list(materials)
def mat(name,color,**kw):names.append(name);materials.append(name);return len(materials)-1
layout={'zones':[],'obstacles':[]}
games.build_games(layout,Geo,materials,mat,None,{'black':0,'white':1,'steel':2})
print(json.dumps({'layout':layout,'groups':[g.__dict__ for g in Geo.all],'materials':names,'sofas':sofas,'patterns':[games.tile_segments(i) for i in range(12)]}))
`;
const recorded=JSON.parse(execFileSync(process.env.PYTHON||'python',['-c',python],{cwd:new URL('..',import.meta.url),encoding:'utf8',maxBuffer:4*1024*1024}));
const {layout,groups,materials,sofas,patterns}=recorded;
const spec=layout.games,arcade=groups.find(g=>g.name.includes('eighteen reaction'));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('screen mounts on the shared wall, rotated giant keyboard sits in front, and sofa faces both displays',()=>{
 assert.deepEqual(spec.screen.normal,[1,0,0]);assert.equal(spec.screen.floorStand,false);
 assert.ok(spec.keyboard.center[0]>spec.screen.center[0]);close(spec.keyboard.center[1],spec.screen.center[1]);close(spec.keyboard.angle,Math.PI/2);
 assert.ok(spec.sofa.center[0]>spec.keyboard.center[0]);
 assert.ok(spec.sofa.center[1]>spec.screen.center[1]&&spec.sofa.center[1]<spec.grid.center[1]);
 close(Math.sin(sofas[0].angle),-1);close(-Math.cos(sofas[0].angle),0);
 const keyboard=layout.obstacles.find(o=>o.part==='giant-keyboard');
 close(keyboard.maxZ-keyboard.minZ,3.35);close(keyboard.maxX-keyboard.minX,1.10);
 const screen=groups.find(g=>g.name.includes('fixed against'));
 assert.equal(screen.rods.length,0,'Screen has a floor support rod');
 assert.ok(screen.boxes.every(([center])=>center[2]>1),'Screen has a floor pedestal');
});

test('reaction tabletop has eighteen short plungers in opposing 1-3-5 triangles and a separate center start',()=>{
 assert.equal(spec.arcade.buttons.length,18);assert.equal(spec.arcade.joystickCount,0);
 for(const player of ['blue','red']){
  const own=spec.arcade.buttons.filter(b=>b.player===player);
  assert.deepEqual([1,2,3].map(row=>own.filter(b=>b.row===row).length),[1,3,5]);
  const distances=[1,2,3].map(row=>Math.abs(own.find(b=>b.row===row).center[0]-spec.arcade.center[0]));
  assert.ok(distances[0]>distances[1]&&distances[1]>distances[2],'Five buttons must be closest to center');
 }
 for(const button of spec.arcade.buttons){
  const [x,y]=button.center;
  const cap=arcade.rods.find(([a,b,r])=>Math.abs(a[0]-x)<1e-9&&Math.abs(a[1]-y)<1e-9&&a[2]===.977&&b[2]===1.025&&r===.05);
  assert.ok(cap,`Missing short cap ${button.id}`);
 }
 assert.equal(arcade.ellipsoids.length,0,'Joystick balls reintroduced');
 assert.equal(spec.arcade.start.label,'START');assert.deepEqual(spec.arcade.start.center.slice(0,2),spec.arcade.center.slice(0,2));
});

test('blue654 and red255 use seven-segment geometry on the tabletop with two separate LED bars',()=>{
 assert.deepEqual(spec.arcade.scores.map(s=>[s.player,s.value]),[['blue','654'],['red','255']]);
 for(const score of spec.arcade.scores){
  assert.deepEqual(score.normal,[0,0,1]);assert.ok(score.center[2]>spec.arcade.topHeight);
  const material=materials.indexOf(`Arcade LED ${score.player} score`);
  const segments=arcade.boxes.filter(([, ,m])=>m===material);
  assert.ok(segments.length>=15,`Missing ${score.player} segments`);
  assert.ok(segments.every(([c,s])=>c[2]>spec.arcade.topHeight&&s[2]<.01),'Scores moved onto cabinet front');
 }
 assert.equal(spec.arcade.ledBars.length,2);
 assert.ok(spec.arcade.ledBars[0].center[0]<spec.arcade.start.center[0]);
 assert.ok(spec.arcade.ledBars[1].center[0]>spec.arcade.start.center[0]);
 assert.ok(spec.arcade.topView.camera[2]>spec.arcade.topView.target[2]+2);
});

test('four by three light panel contains twelve bounded distinct line patterns',()=>{
 assert.equal(spec.grid.columns*spec.grid.rows,12);
 assert.equal(new Set(spec.grid.patterns).size,12);
 assert.equal(new Set(patterns.map(p=>JSON.stringify(p))).size,12);
 for(const pattern of patterns){assert.ok(pattern.length>=4);for(const line of pattern)for(const point of line)assert.ok(point.every(v=>Math.abs(v)<=.4600001));}
 const panel=groups.find(g=>g.name.includes('distinct patterned'));
 assert.ok(panel.rods.length>100,'Panel patterns were replaced by solid blocks');
});

test('stable game review metadata, colliders and viewpoint survive the revised layout',()=>{
 const zone=layout.zones.find(z=>z.id==='games');assert.equal(zone.reviewSection,21);
 const walking={walkable:[[[-14.8,-19],[-6.5,-19],[-6.5,-8],[-14.8,-8]]],obstacles:layout.obstacles};
 assert.ok(canStand(zone.view.x,zone.view.z,walking));
 for(const part of ['giant-keyboard','reaction-arcade','wall-facing-sofa','coffee-table']){
  const collider=layout.obstacles.find(o=>o.part===part);assert.ok(collider);
  assert.equal(canStand((collider.minX+collider.maxX)/2,(collider.minZ+collider.maxZ)/2,walking),false);
 }
 assert.ok(groups.every(g=>g.closed),'A Geo mesh was never finished');
 assert.match(spec.dimensionsStatus,/Estimated/);
});
