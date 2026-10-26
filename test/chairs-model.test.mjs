import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const bundled='C:/Users/cabs_/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const python=process.env.PYTHON||(fs.existsSync(bundled)?bundled:(process.platform==='win32'?'python':'python3'));
const program=String.raw`import sys,json,math,types
from collections import Counter,defaultdict,deque
sys.path.insert(0,sys.argv[1])
import chairs
g=chairs.chair_geometry()
assert chairs.chair_geometry() is g
edges=Counter();adjacency=defaultdict(set);material_vertices=defaultdict(set)
for face,material in zip(g["faces"],g["materialIndices"]):
 assert len(face)>=3 and len(set(face))==len(face)
 for a,b in zip(face,face[1:]+face[:1]):
  edges[tuple(sorted((a,b)))]+=1;adjacency[a].add(b);adjacency[b].add(a)
  material_vertices[material].update((a,b))
assert set(edges.values())=={2}
assert all(all(math.isfinite(x) for x in vertex) for vertex in g["vertices"])
assert len(g["loopNormals"])==sum(map(len,g["faces"]))
assert all(abs(sum(x*x for x in normal)-1)<1e-6 for normal in g["loopNormals"])
bounds=g["bounds"];size=[hi-lo for lo,hi in zip(bounds["min"],bounds["max"])]
assert size[0]<=.52 and size[1]<=.60 and bounds["max"][2]<=.88
assert abs(bounds["min"][2])<1e-9
assert abs(bounds["min"][0]+bounds["max"][0])<1e-9
assert abs(bounds["min"][1]+bounds["max"][1])<1e-9
assert .85<bounds["max"][2]<.87
assert len(g["vertices"])<1500
assert set(g["materialIndices"])=={0,1}
# Upholstery remains physically joined through an explicit lumbar connector.
remaining=set(material_vertices[0]);components=[]
while remaining:
 seed=next(iter(remaining));seen={seed};queue=deque([seed])
 while queue:
  for other in adjacency[queue.popleft()]:
   if other in remaining and other not in seen:seen.add(other);queue.append(other)
 remaining-=seen
 vs=[g["vertices"][i] for i in seen]
 components.append({"min":[min(p[a] for p in vs) for a in range(3)],"max":[max(p[a] for p in vs) for a in range(3)]})
assert len(components)==3
seat,connector,back=sorted(components,key=lambda c:c["max"][2])
assert abs(seat["max"][2]-.46)<.002
def overlaps(a,b):return all(min(a["max"][i],b["max"][i])-max(a["min"][i],b["min"][i])>.005 for i in range(3))
assert overlaps(seat,connector) and overlaps(connector,back)
for xsign in [-1,1]:
 for ysign in [-1,1]:
  planted=[g["vertices"][i] for i in material_vertices[1] if g["vertices"][i][0]*xsign>.20 and g["vertices"][i][1]*ysign>.20 and abs(g["vertices"][i][2])<1e-9]
  assert planted,(xsign,ysign)
# A tiny Blender data stand-in checks actual builder/cache code, not a duplicate.
class FakeObject(dict):
 def __init__(self,name,data):
  super().__init__();self.name=name;self.data=data;self.location=(0,0,0);self.rotation_euler=types.SimpleNamespace(z=0);self.parent=None
class Mesh(dict):
 def __init__(self,name):super().__init__();self.name=name;self.materials=[];self.polygons=[];self.custom_normals=None
 def from_pydata(self,vertices,edges,faces):self.vertices=vertices;self.faces=faces;self.polygons=[types.SimpleNamespace(material_index=0,use_smooth=False) for f in faces]
 def update(self):pass
 def normals_split_custom_set(self,values):self.custom_normals=values
class Meshes(dict):
 def new(self,name):
  mesh=Mesh(name);self[name]=mesh;return mesh
class Objects:
 def __init__(self):self.created=[]
 def new(self,name,data):o=FakeObject(name,data);self.created.append(o);return o
class Material:
 def __init__(self,name,pointer):self.name=name;self.pointer=pointer
 def as_pointer(self):return self.pointer
meshes=Meshes();objects=Objects();linked=[]
sys.modules["bpy"]=types.SimpleNamespace(data=types.SimpleNamespace(meshes=meshes,objects=objects),context=types.SimpleNamespace(collection=types.SimpleNamespace(objects=types.SimpleNamespace(link=linked.append))))
black,steel,cream=Material("black",1),Material("steel",2),Material("cream",3)
roots=[chairs.build_chair("chair "+str(i),(i,2,0),black,steel,math.pi/2) for i in range(126)]
instances=[o for o in objects.created if o.data is not None]
assert len(roots)==126 and len(instances)==126
assert len({id(o.data) for o in instances})==1
assert all(r["role"]=="venue-chair" and r["isFurniture"] for r in roots)
assert all(r.rotation_euler.z==math.pi/2 for r in roots)
assert all(o.parent is roots[i] for i,o in enumerate(instances))
assert len(instances[0].data.materials)==2
assert len(instances[0].data.custom_normals)==len(g["loopNormals"])
chairs.build_chair("cream",(0,0,0),cream,steel)
assert len(meshes)==2
print(json.dumps({"vertices":len(g["vertices"]),"faces":len(g["faces"]),"bounds":bounds,"manifold":True,"normalCount":len(g["loopNormals"]),"seatHeight":seat["max"][2],"upholsteryContinuous":True,"plantedFeet":4,"roots":len(roots),"sharedMeshesFor126":1,"materialsPerMesh":2}))
`;
let cached;
const verified=()=>cached??=JSON.parse(execFileSync(python,['-B','-c',program,path.join(root,'model')],{encoding:'utf8',windowsHide:true}));
test('event chair has finite closed geometry, unit normals, human proportions and planted feet',()=>{
 const result=verified();
 assert.equal(result.manifold,true);assert.equal(result.plantedFeet,4);
 assert(result.vertices<1500);assert(result.normalCount>result.vertices);
 assert(Math.abs(result.seatHeight-.46)<.002);
 assert(result.bounds.max[2]<=.88&&result.bounds.min[2]===0);
});
test('seat and curved back meet through a solid lumbar connector',()=>{
 const result=verified();
 assert.equal(result.upholsteryContinuous,true);
});
test('126 chair roots reuse one two-material mesh instead of repeated bevel geometry',()=>{
 const result=verified();
 assert.equal(result.roots,126);assert.equal(result.sharedMeshesFor126,1);
 assert.equal(result.materialsPerMesh,2);
});

