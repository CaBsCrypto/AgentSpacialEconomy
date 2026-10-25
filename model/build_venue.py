import bpy,math,random,json,os,sys
from mathutils import Vector
sys.path.insert(0,os.path.dirname(__file__))
from stage import build_stage
random.seed(16)
ROOT=os.path.dirname(os.path.dirname(__file__)); OUT=ROOT+'/dist/assets';os.makedirs(OUT,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
M=[]
def mat(name,c,metal=0,rough=.75,emit=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
 if emit:p.inputs['Emission Color'].default_value=(*c,1);p.inputs['Emission Strength'].default_value=emit
 M.append(m);return len(M)-1
wood=[mat('Aged floor timber '+str(i),(.25+i*.018,.225+i*.015,.18+i*.012)) for i in range(7)]
structure=mat('Painted graphite timber',(.17,.19,.18));wall=mat('Warm chalk masonry',(.66,.66,.60));black=mat('Dark textile',(.025,.03,.032));yellow=mat('Meridian mustard',(.95,.7,.06));blue=mat('Petrol blue upholstery',(.035,.19,.29));white=mat('Off white table tops',(.8,.81,.76));steel=mat('Steel rails',(.24,.27,.27),.65,.35);glass=mat('River glazing pale blue',(.61,.77,.81),.1,.23);glow=mat('Daylight skylights',(.78,.85,.9),0,.35,1.8);leaf=mat('Plant green',(.1,.24,.12));roofmat=mat('Old timber roof',(.23,.2,.15));gray=mat('Soft gray upholstery',(.24,.27,.27));cream=mat('Cream lounge stools',(.76,.76,.68));silver=mat('Light furniture frame',(.44,.47,.45),.5,.4)
gmat=M[glass];gmat.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value=.22;gmat.diffuse_color=(*gmat.diffuse_color[:3],.22)
if hasattr(gmat,'surface_render_method'):gmat.surface_render_method='DITHERED'
if hasattr(gmat,'blend_method'):gmat.blend_method='BLEND'
class Geo:
 def __init__(self,name):self.name=name;self.v=[];self.f=[];self.mi=[]
 def face(self,verts,m):self.f.append(verts);self.mi.append(m)
 def box(self,c,s,m):
  x,y,z=c;a,b,d=[v/2 for v in s];n=len(self.v);self.v.extend([(x+dx*a,y+dy*b,z+dz*d) for dx,dy,dz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]);
  for f in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:self.face(tuple(n+i for i in f),m)
 def rod(self,a,b,r,m,n=8):
  a,b=Vector(a),Vector(b);d=(b-a).normalized();u=d.cross(Vector((0,0,1)))
  if u.length<.01:u=d.cross(Vector((0,1,0)))
  u.normalize();v=d.cross(u);i=len(self.v)
  for center in [a,b]:
   for k in range(n):self.v.append(tuple(center+r*(u*math.cos(k*2*math.pi/n)+v*math.sin(k*2*math.pi/n))))
  self.face(tuple(i+k for k in range(n-1,-1,-1)),m);self.face(tuple(i+n+k for k in range(n)),m)
  for k in range(n):self.face((i+k,i+(k+1)%n,i+n+(k+1)%n,i+n+k),m)
 def ellipsoid(self,c,s,m):
  i=len(self.v);rings=7;n=12
  for j in range(rings+1):
   t=math.pi*j/rings
   for k in range(n):
    a=math.pi*2*k/n;self.v.append((c[0]+s[0]*math.sin(t)*math.cos(a),c[1]+s[1]*math.sin(t)*math.sin(a),c[2]+s[2]*math.cos(t)))
  for j in range(rings):
   for k in range(n):self.face((i+j*n+k,i+j*n+(k+1)%n,i+(j+1)*n+(k+1)%n,i+(j+1)*n+k),m)
 def finish(self):
  mesh=bpy.data.meshes.new(self.name);mesh.from_pydata(self.v,[],self.f);mesh.update();o=bpy.data.objects.new(self.name,mesh);bpy.context.collection.objects.link(o)
  for m in M:mesh.materials.append(m)
  for p,m in zip(mesh.polygons,self.mi):p.material_index=m
  return o
floor=Geo('Floor • timber planks and embedded rails');shell=Geo('Architecture • Y braced timber and river windows');roof=Geo('roof • removable pitched timber and skylights');furn=Geo('Furniture • observed event typologies');obstacles=[]
def block(x,y,w,d):obstacles.append({'minX':round(x-w/2,3),'maxX':round(x+w/2,3),'minZ':round(-y-d/2,3),'maxZ':round(-y+d/2,3)})
# Observed portion only: local footprint dimensions are estimated, not the full venue.
W=30;L=50
for ix in range(100):
 x=-15+(ix+.5)*.3
 for iy in range(10):floor.box((x,iy*5+2.5,-.07),(.292,4.985,.14),random.choice(wood))
for x in [7.4,8.8]:floor.box((x,25,.009),(.055,50,.018),steel)
# Perimeter walls, with a bright river-side rhythm. Window count/spacing in this subset is interpretation.
shell.box((-15,25,2.3),(.18,50,4.6),wall);shell.box((0,50,2.3),(30,.18,4.6),wall)
shell.box((15,25,.45),(.18,50,.9),wall)
for y in [1.05+i*1.38 for i in range(36)]:
 shell.box((15,y,2.45),(.04,1.18,2.8),glass)
 for dy in [-.62,0,.62]:shell.box((14.96,y+dy,2.45),(.09,.055,2.9),structure)
 for z in [1.03,1.75,2.45,3.15,3.88]:shell.box((14.95,y,z),(.1,1.3,.05),structure)
for y in [2,8.5,15,21.5,28,34.5,41,47.5]:
 for x in [-15,-5,5,15]:
  shell.box((x,y,2.4),(.22,.24,4.8),structure);block(x,y,.3,.3)
  for dx in [-1.5,1.5]:shell.rod((x,y,3.1),(max(-15,min(15,x+dx)),y,4.8),.085,structure)
 for x in [-10,0,10]:
  shell.rod((x-5,y,4.8),(x,y,6.85),.105,structure);shell.rod((x,y,6.85),(x+5,y,4.8),.105,structure);shell.rod((x-5,y,4.8),(x+5,y,4.8),.095,structure)
  shell.rod((x,y,4.8),(x,y,6.85),.07,structure)
  for dx in [-2.5,2.5]:shell.rod((x,y,4.8),(x+dx,y,5.82),.06,structure)
# Gable panels run over bays, skylights interrupt roof, retained in walk, hidden for plan.
for x in [-10,0,10]:
 for side in [-1,1]:
  for iy in range(50):
   for k in range(5):
    x0=x+side*k;x1=x+side*(k+1);z0=6.93-k*.406;z1=6.93-(k+1)*.406
    n=len(roof.v);roof.v.extend([(x0,iy,z0),(x1,iy,z1),(x1,iy+.995,z1),(x0,iy+.995,z0)])
    mi=glow if iy%7==3 and k==2 else roofmat
    roof.face((n,n+1,n+2,n+3),mi);roof.face((n+3,n+2,n+1,n),mi)
  for k in range(1,5):shell.rod((x+side*k,0,6.87-k*.406),(x+side*k,50,6.87-k*.406),.065,structure)
# Glazed room beside river, partial opening at near end.
for y in [12+i*1.1 for i in range(12)]:
 shell.box((10,y,2.0),(.075,1.06,3.5),glass);shell.box((9.94,y,.5),(.13,1.1,1),structure)
 for z in [1.1,1.8,2.5,3.2,3.75]:shell.box((9.9,y,z),(.12,1.1,.055),structure)
 shell.box((9.9,y-.54,2),(.13,.055,3.6),structure)
block(10,18.05,.2,13.3)
# Small utility functions for identifiable furniture, not box substitutes.
def chair(x,y,angle=0,color=black):
 def p(a,b,z):return (x+a*math.cos(angle)-b*math.sin(angle),y+a*math.sin(angle)+b*math.cos(angle),z)
 furn.ellipsoid(p(0,0,.48),(.25,.24,.045),color);furn.ellipsoid(p(0,.20,.77),(.24,.055,.22),color)
 for a in [-.2,.2]:
  for b in [-.18,.18]:furn.rod(p(a,b,.05),p(a,b,.48),.021,steel)
  furn.rod(p(a,.2,.48),p(a,.22,.88),.019,steel)
def table(x,y,w=2.4,d=.85):
 furn.box((x,y,.76),(w,d,.055),white)
 for a in [-w/2+.12,w/2-.12]:
  for b in [-d/2+.08,d/2-.08]:furn.rod((x+a,y+b,.03),(x+a,y+b,.73),.025,silver)
 block(x,y,w,d)
def stool(x,y,color=cream):furn.rod((x,y,.03),(x,y,.48),.28,color,20);block(x,y,.58,.58)
def bean(x,y,color=yellow):furn.ellipsoid((x,y,.39),(.56,.6,.42),color);furn.ellipsoid((x,y+.21,.62),(.43,.4,.45),color);block(x,y,1.12,1.2)
def loungechair(x,y):
 furn.ellipsoid((x,y,.36),(.48,.45,.18),blue);furn.ellipsoid((x,y+.35,.63),(.49,.15,.43),blue)
 for dx in [-.42,.42]:furn.ellipsoid((x+dx,y,.58),(.11,.48,.19),blue)
 block(x,y,1,.95)
# Yellow elevated ramp and neighboring lounge; no false step traversal.
furn.box((-10,6.5,.23),(1.5,11,.46),yellow);block(-10,6.5,1.65,11.1)
for x in [-10.77,-9.23]:
 for y in [1,3,5,7,9,11,12]:furn.rod((x,y,.45),(x,y,1.35),.035,steel)
 furn.rod((x,1,1.35),(x,12,1.35),.04,steel);furn.rod((x,1,.83),(x,12,.83),.025,steel)
for y in [3,6,9]:loungechair(-12.3,y);stool(-13.5,y+1,yellow)
# Buffet black cloth drapes, plates and curved drink urns.
for y in [9,13]:
 furn.box((-1,y,.4),(2.8,.9,.8),black);block(-1,y,2.8,.9)
 for dx in [-.9,-.3,.3,.9]:furn.rod((-1+dx,y,.81),(-1+dx,y,.84),.16,white,20)
 furn.rod((-1,y+.1,.85),(-1,y+.1,1.21),.12,silver,16)
# Blue counter and yellow flag near window side
furn.box((11.6,7,.52),(2.2,.8,1.04),blue);furn.box((11.6,7,1.06),(2.3,.9,.06),white);block(11.6,7,2.3,.9)
furn.rod((13.4,7,0),(13.4,7,3.1),.025,steel);furn.ellipsoid((13.65,7,2.25),(.34,.035,.95),yellow)
# Window-side standing tables
for y in [28,31,34]:table(13.1,y,1.8,.7)
# Photo backdrop with observed checkerboard color rhythm, safe simplified lettering.
for ix in range(5):
 for iz in range(4):furn.box((9.5+(ix-2)*.62,37, .38+(iz+.5)*.62),(.62,.12,.62),yellow if (ix+iz)%2 else gray)
block(9.5,37,3.3,.2)
for x,y in [(8,34.7),(10,34.5),(12,35.5)]:stool(x,y)
for x,y,c in [(8,40,yellow),(10,40.5,black),(12,40,yellow),(11,43,gray)]:bean(x,y,c)
# Hack tables in parallel strips left bay, with open aisle down their side.
for x in [-12,-8]:
 for y in [20,24,28,32,36]:
  table(x,y,2.4,1)
  for dx in [-.8,0,.8]:
   chair(x+dx,y-.8,math.pi);chair(x+dx,y+.8,0)
  block(x,y,2.7,2.25)
# Curtain screen: partial screen does not close an invented room.
for k in range(46):furn.rod((-5.6,30+k*.17,.02),(-5.6,30+k*.17,3.35),.115,black,8)
block(-5.6,33.8,.35,8)
# Auditorium, both banks leave a broad central aisle.
for y in [32,33.1,34.2,35.3,36.4,37.5,38.6]:
 for x in [-3.5,-2.75,-2,2,2.75,3.5]:chair(x,y,math.pi)
for x in [-2.75,2.75]:block(x,35.3,2.4,7.5)
stage=build_stage(origin=(0,43,0),width=8,depth=3.4);block(0,44.7,9,3.8);block(-4.65,43.8,1,1.8)
# Casual return area with timber-topped cafe tables / four slender chairs.
for x,y in [(3,17),(0,21),(3,25),(-2,17)]:
 furn.box((x,y,.74),(1.2,1.2,.07),wood[4]);block(x,y,1.8,1.8)
 for dx,dy,a in [(0,-.85,math.pi),(0,.85,0),(-.85,0,-math.pi/2),(.85,0,math.pi/2)]:chair(x+dx,y+dy,a,cream)
for g in [floor,shell,roof,furn]:g.finish()
# Labels are reconstructed lettering, not video screenshots.
def text(body,loc,size=.25,rot=(math.pi/2,0,0),color=yellow):
 c=bpy.data.curves.new(body,'FONT');c.body=body;c.size=size;c.align_x='CENTER';c.extrude=.001;c.resolution_u=3;o=bpy.data.objects.new(body,c);bpy.context.collection.objects.link(o);o.location=loc;o.rotation_euler=rot;o.data.materials.append(M[color]);return o
text('HACKMERIDIAN',(11.6,6.58,.55),.18,color=white);text('BUILD / CONNECT / MOVE',(9.5,36.92,1.75),.18,color=white)
# Model semantics / public-safe evidence metadata.
bpy.context.scene['scope']='Observed route reconstruction, approximate geometry; not a measured survey or full 3200 m² footprint.'
bpy.context.scene['reference']='Private user video inspected through timestamped frames 00:00–02:51. No raw footage or personal imagery embedded.'
# Named zones; Three converts Blender y into -z.
def zone(id,label,x,y,w,d,vx,vy,yaw=0):return {'id':id,'label':label,'polygon':[[x-w/2,-y-d/2],[x+w/2,-y-d/2],[x+w/2,-y+d/2],[x-w/2,-y+d/2]],'view':{'x':vx,'z':-vy,'yaw':yaw}}
layout={'scaleStatus':'All local dimensions and inter-zone distances are estimated from imagery; official 3200 m² venue area is not the modeled footprint.','walkable':[[[-14.8,-49.8],[14.8,-49.8],[14.8,-.2],[-14.8,-.2]]],'obstacles':obstacles,'bounds':{'minX':-15,'maxX':15,'minZ':-50,'maxZ':0},'spawn':{'x':-7,'z':-3,'yaw':0,'pitch':0},'zones':[zone('arrival','Rampa amarilla · lounge',-10,6,10,12,-7,3,-.7),zone('buffet','Buffet · encuentro',0,10,10,10,3,7,.6),zone('river','Ventanas · sala acristalada',12.4,19,5,24,12,10,0),zone('photo','Photo lounge · encuentro',10,38,9,13,7,33,-.5),zone('stage','Escenario · HackMeridian',0,43,11,12,0,39,0),zone('hack','Mesas de trabajo',-10,28,9,23,-6,19,.5),zone('auditorium','Auditorio',0,35,10,10,0,29,0),zone('cafe','Zona social',0,21,10,13,5,18,.8)]}
open(OUT+'/layout.json','w').write(json.dumps(layout,indent=2))
# Lighting and cameras. Render only non-sensitive reconstructed geometry.
world=bpy.data.worlds.new('Lisbon daylight');bpy.context.scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.55,.65,.72,1);world.node_tree.nodes['Background'].inputs[1].default_value=.35
for y in [8,24,40]:
 d=bpy.data.lights.new('River daylight','AREA');o=bpy.data.objects.new('River daylight',d);bpy.context.collection.objects.link(o);o.location=(14,y,4);d.energy=1100;d.shape='DISK';d.size=10;o.rotation_euler=(0,math.pi/2,0)
for x in [-10,0,10]:
 for y in [8,24,40]:
  d=bpy.data.lights.new('Skylight','AREA');o=bpy.data.objects.new('Skylight',d);bpy.context.collection.objects.link(o);o.location=(x,y,6.5);d.energy=650;d.size=7
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=64;scene.cycles.use_denoising=False;scene.render.resolution_x=1600;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
camdata=bpy.data.cameras.new('Editorial camera');cam=bpy.data.objects.new('Editorial camera',camdata);bpy.context.collection.objects.link(cam);scene.camera=cam
def point(loc,target):cam.location=loc;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
point((8.7,24,2.1),(1,42,2.7));camdata.lens=25
# Apply modifiers and export; text retained as curves in .blend, converted by exporter.
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/model/one16-editable.blend')
bpy.ops.export_scene.gltf(filepath=OUT+'/one16.glb',export_format='GLB',export_apply=True,export_cameras=False,export_lights=False,export_extras=True)
scene.render.image_settings.file_format='JPEG';scene.render.image_settings.quality=90;scene.render.filepath=OUT+'/hero.jpg';bpy.ops.render.render(write_still=True)
# Dollhouse overview omits roof and outer wall group only for render, never claims measured plan.
bpy.data.objects['roof • removable pitched timber and skylights'].hide_render=True
point((40,-12,43),(0,25,0));camdata.type='ORTHO';camdata.ortho_scale=68;scene.render.filepath=OUT+'/overview.jpg';bpy.ops.render.render(write_still=True)
print('ONE16 MODEL READY',len(bpy.data.objects),os.path.getsize(OUT+'/one16.glb'))
