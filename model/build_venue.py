import bpy,math,random,json,os,sys
from mathutils import Vector, Matrix
sys.path.insert(0,os.path.dirname(__file__))
from stage import build_stage
from totem import build_totem
from exterior import build_exterior
from passport import build_passport_display
from stands import build_stands
from experience_zones import build_experience_zones
from furniture import build_lower_lounge
from appearance import apply_appearance, graphic_plane
random.seed(16)
ROOT=os.path.dirname(os.path.dirname(__file__)); OUT=os.environ.get('ONE16_BUILD_DIR',ROOT+'/dist/assets');os.makedirs(OUT,exist_ok=True)
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
stone=[mat('Corridor weathered masonry '+str(i),(.22+i*.025,.205+i*.022,.15+i*.020)) for i in range(7)]
runner=mat('Entrance vivid yellow runner',(.93,.86,.015));rust=mat('Old rust red sliding doors',(.28,.095,.055));metalrust=mat('Door oxidised braces',(.16,.085,.055),.3,.8);rope=mat('Natural rope handrails',(.49,.43,.29));merchlime=mat('Merch graphic yellow green',(.65,.72,.16));mirror=mat('Merch mirror panels',(.48,.53,.54),.94,.14)
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
for y in [12+i*1.1 for i in range(6)]:
 # Two missing bays form the observed walk-in Content Hub doorway.
 if 12.8<y<14.4:continue
 shell.box((10,y,2.0),(.075,1.06,3.5),glass);shell.box((9.94,y,.5),(.13,1.1,1),structure)
 for z in [1.1,1.8,2.5,3.2,3.75]:shell.box((9.9,y,z),(.12,1.1,.055),structure)
 shell.box((9.9,y-.54,2),(.13,.055,3.6),structure)
block(10,12,.2,1.1);block(10,16.4,.2,3.3)
# End glazing closes the shortened two-body room without changing its doorway.
shell.box((12.4,18.05,2),(4.85,.075,3.5),glass)
for xx in [10,11.2,12.4,13.6,14.8]:shell.box((xx,18.05,2),(.055,.13,3.6),structure)
for zz in [1.1,1.8,2.5,3.2,3.75]:shell.box((12.4,18.05,zz),(4.85,.12,.055),structure)
block(12.4,18.05,4.85,.20)
roof.box((12.4,14.75,3.86),(4.85,6.6,.10),structure)
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
# V2: Actual supplemental footage shows a low enclosed loading passage,
# a sunken lounge, seven yellow stairs UP to the hall, and merch on arrival LEFT.
# All dimensions below are visual estimates, not measured architecture.
low=-1.05;corr_y0=-32;corr_y1=-6
entrance=Geo('Entrance • weathered loading corridor, umbrellas and yellow stairs')
# Low stone floor and runner: geometrically separate annex, no overlapping hall slab.
entrance.box((0,-19,low-.10),(4.5,26,.2),stone[2]);entrance.box((0,-3,low-.10),(12,6,.2),black)
entrance.box((0,-17.225,low+.015),(1.8,29.55,.03),runner)
# Weathered walls: articulated stone courses, irregular patches, loading ledges.
for side in [-1,1]:
 x=side*2.3
 entrance.box((x,-19,1.77),(.3,26,5.64),stone[3])
 for row in range(2):
  z=low+.28+row*.56
  for col in range(26):
   y=-31.5+col+(row%2)*.25
   entrance.box((x-side*.17,y,z),(.035,.94+random.uniform(-.12,.04),.51),random.choice(stone))
 entrance.box((side*2.06,-19,.08),(.36,26,.18),stone[1]);block(side*2.08,-19,.28,26)
 entrance.rod((side*1.99,-32,.20),(side*1.99,-6,.20),.045,steel)
 # Irregular low floor blocks visible either side of yellow runner.
 for k in range(38):
  yy=-31.7+k*.68;entrance.box((side*(1.23+random.random()*.46),yy,low+.025),(.27+random.random()*.22,.45,.05),random.choice(stone))
 # Rust-red sliding loading doors with metal diagonal braces and upper tracks.
 for yy in [-26,-16,-8.2]:
  entrance.box((side*2.105,yy,1.99),(.065,2.65,3.35),rust)
  entrance.box((side*2.055,yy,3.78),(.11,3.2,.10),steel)
  for off in [-1.29,0,1.29]:entrance.rod((side*2.05,yy+off,.32),(side*2.05,yy+off,3.65),.027,metalrust)
  entrance.rod((side*2.04,yy-1.27,.35),(side*2.04,yy+1.27,3.62),.025,metalrust)
  entrance.rod((side*2.04,yy+1.27,.35),(side*2.04,yy-1.27,3.62),.025,metalrust)
 # Repeated tiny floor lanterns, not screens or personal objects.
 for yy in [-30,-26,-22,-18,-14,-10,-6.3]:
  entrance.box((side*1.7,yy,low+.11),(.14,.14,.22),black)
  entrance.box((side*1.7,yy-.073,low+.12),(.07,.008,.13),glow)
# Dark industrial overhead structure and continuous corrugated roof.
for yy in [-32,-27,-22,-17,-12,-6]:
 entrance.rod((-2.3,yy,4.45),(2.3,yy,4.45),.1,structure)
 for side in [-1,1]:entrance.rod((side*2.25,yy,3.65),(side*1.3,yy,4.45),.065,structure)
for yy in [corr_y0+.13+i*.26 for i in range(100)]:roof.box((0,yy,4.56),(4.7,.24,.06),roofmat)
for yy in [-30,-25,-20,-15,-10]:
 entrance.rod((0,yy,4.38),(0,yy,4.25),.18,black,16)
 entrance.ellipsoid((0,yy,4.20),(.16,.16,.08),glow)
# Real umbrellas, not flattened yellow lamps: domed eight-panel canopies and ribs.
def umbrella(x,y,z,color):
 n=len(entrance.v);N=8;entrance.v.append((x,y,z+.25))
 for k in range(N):
  a=k*2*math.pi/N;entrance.v.append((x+.51*math.cos(a),y+.51*math.sin(a),z))
 for k in range(N):
  entrance.face((n,n+1+k,n+1+(k+1)%N),color);entrance.face((n+1+(k+1)%N,n+1+k,n),color)
  a=k*2*math.pi/N;entrance.rod((x,y,z+.245),(x+.51*math.cos(a),y+.51*math.sin(a),z-.007),.008,steel,5)
 entrance.rod((x,y,z+.26),(x,y,z-.27),.012,steel,6)
 entrance.rod((x,y,z+.27),(x,y,4.5),.003,steel,4)
for row,yy in enumerate([-24,-21.7,-19.4,-17.1,-14.8,-12.5,-10.2,-7.9]):
 for col,xx in enumerate([-.95,0,.95]):umbrella(xx,yy+(col%2)*.52,3.65+(row%2)*.18,runner if (row+col)%3 else black)
# Roof and steel ties continue over the lower lounge; no open-sky gap.
for yy in [-5.85+i*.30 for i in range(20)]:roof.box((0,yy,4.56),(12,.29,.08),roofmat)
for yy in [-6,-3,0]:
 entrance.rod((-6,yy,4.45),(6,yy,4.45),.10,structure)
 for xx in [-5.9,5.9]:entrance.rod((xx,yy,2.7),(xx,yy,4.45),.09,structure)
# Low lounge is OUTSIDE the original main slab; upper hall edge is guarded.
build_lower_lounge(block,M[blue],M[yellow],low)
for side in [-1,1]:
 # Guarding upper level left/right of stair aperture. Lower lounge not a fallthrough.
 entrance.box((side*3.55,0,-.52),(4.9,.14,1.05),black);block(side*3.55,0,4.9,.2)
 for xx in [side*(1.1+k*.95) for k in range(6)]:entrance.box((xx,0,.50),(.11,.11,1.0),structure)
 entrance.box((side*3.55,0,.95),(4.9,.12,.14),structure);entrance.box((side*3.55,0,.48),(4.9,.10,.10),structure)
 for xx in [side*(1.1+k*.95) for k in range(5)]:
  entrance.rod((xx,0,.16),(xx+side*.95,0,.85),.036,structure)
 # Low lounge side wall closes annex; modeled footprint only, not external facade claim.
 entrance.box((side*6,-3,.5),(.15,6,3.1),wall)
# Seven physically modeled stair treads. Surface metadata matches every rise.
for k in range(7):
 yy=-2.45+(k+.5)*.35;top=low+(k+1)*.15
 entrance.box((0,yy,(low-.08+top)/2),(1.8,.35,top-low+.08),runner)
 # Small contrasting tread nose.
 entrance.box((0,yy-.165,top+.006),(1.81,.018,.012),yellow)
for side in [-1,1]:
 for yy in [-2.45,-1.225,0]:
  h=low+max(0,min(1,(yy+2.45)/2.45))*1.05
  entrance.box((side*1.03,yy,h+.54),(.09,.09,1.08),structure)
 # Rope handrails follow elevation, with sag between uprights.
 for zoffset in [.55,1.02]:
  for seg in range(2):
   ya=-2.45+seg*1.225;yb=ya+1.225
   points=[]
   for k in range(9):
    t=k/8;yy=ya+(yb-ya)*t;h=low+(yy+2.45)/2.45*1.05
    points.append((side*1.03,yy,h+zoffset-.10*math.sin(math.pi*t)))
   for a,b in zip(points,points[1:]):entrance.rod(a,b,.025,rope,8)
 # Thin rail collision blocks lateral stair exits, but not the floor surface.
 block(side*1.04,-1.225,.12,2.45)
# Upper landing/check-in on hall floor, straight ahead. Original buffet remains farther on.
entrance.box((0,1.1,.012),(2.2,2.2,.024),runner)
entrance.box((0,5,.014),(3.4,2.1,.028),runner)
entrance.box((0,6.1,.5),(3.3,.65,1),black);entrance.box((0,6.1,1.02),(3.4,.74,.05),white);block(0,6.1,3.4,.8)
for xx in [-.85,.85]:entrance.box((xx,6.7,1.55),(1.7,.1,3.1),black if xx<0 else runner)
entrance.box((0,2.3,3.65),(3.4,.05,.7),runner)
# LEFT-of-arrival merch: pale garments on wheeled black racks, dark apparel,
# mirrored/patterned backdrop, folded stock and tall black/yellow Merch banner.
# Keep the source panel at y8.6: merch-backdrop.mjs relocates this exact
# geometry and collision to the arrival guardrail at runtime, once only.
for k in range(6):
 xx=-6.7-k*1.12
 entrance.box((xx,8.6,1.5),(1.10,.12,3.0),merchlime if k%2 else mirror)
 if k%2:
  for row in range(5):
   for col in range(3):
    x=xx-.35+col*.35;z=.3+row*.55
    entrance.rod((x-.10,8.525,z+.10),(x,8.525,z),.025,black,5);entrance.rod((x,8.525,z),(x+.10,8.525,z+.10),.025,black,5)
block(-9.5,8.6,6.9,.2)
def garment(x,y,color):
 # T-shirt silhouette, safe generic apparel without copying illegible marks.
 outline=[(-.12,1.65),(-.28,1.60),(-.47,1.40),(-.32,1.26),(-.23,1.38),(-.23,.80),(.23,.80),(.23,1.38),(.32,1.26),(.47,1.40),(.28,1.60),(.12,1.65)]
 n=len(entrance.v)
 for yy in [y-.018,y+.018]:entrance.v.extend([(x+dx,yy,z) for dx,z in outline])
 N=len(outline);entrance.face(tuple(n+k for k in range(N-1,-1,-1)),color);entrance.face(tuple(n+N+k for k in range(N)),color)
 for k in range(N):entrance.face((n+k,n+(k+1)%N,n+N+(k+1)%N,n+N+k),color)
 for a,b in [((x-.28,y,1.55),(x,y,1.73)),((x,y,1.73),(x+.28,y,1.55)),((x-.28,y,1.55),(x+.28,y,1.55))]:entrance.rod(a,b,.009,black,6)
 entrance.rod((x,y,1.73),(x,y,1.82),.009,black,6)
def rack(x,y,color):
 for yy in [y-.85,y+.85]:
  entrance.rod((x,yy,.06),(x,yy,1.9),.025,black)
  entrance.rod((x-.46,yy,.07),(x+.46,yy,.07),.025,black)
  for dx in [-.4,.4]:entrance.ellipsoid((x+dx,yy,.045),(.055,.035,.045),black)
 entrance.rod((x,y-.85,1.9),(x,y+.85,1.9),.025,black)
 for yy in [y-.65+k*.22 for k in range(7)]:garment(x,yy,color)
 block(x,y,1.05,1.95)
rack(-10.5,4.5,white);rack(-8.0,5.5,black)
entrance.box((-6.3,7.5,.47),(1.25,.8,.94),gray);entrance.box((-6.3,7.5,.96),(1.35,.9,.05),white);block(-6.3,7.5,1.35,.9)
for k in range(5):entrance.box((-6.5,7.4,1.01+k*.035),(.42,.40,.03),white)
entrance.box((-5.6,5.3,1.65),(.65,.08,3.3),black);block(-5.6,5.3,.78,.2)
entrance.box((-5.6,5.3,.025),(.85,.5,.05),black)

# Buffet black cloth drapes, plates and curved drink urns.
for y in [9,13]:
 furn.box((-1,y,.4),(2.8,.9,.8),black);block(-1,y,2.8,.9)
 for dx in [-.9,-.3,.3,.9]:furn.rod((-1+dx,y,.81),(-1+dx,y,.84),.16,white,20)
 furn.rod((-1,y+.1,.85),(-1,y+.1,1.21),.12,silver,16)
# Blue counter and yellow flag near window side
furn.box((11.6,7,.52),(2.2,.8,1.04),blue);furn.box((11.6,7,1.06),(2.3,.9,.06),white);block(11.6,7,2.3,.9)
furn.rod((13.4,7,0),(13.4,7,3.1),.025,steel);furn.ellipsoid((13.65,7,2.25),(.34,.035,.95),yellow)
# The narrated games, Energy Corner, photo booth and photocall are built
# as separate recognizable groups after the shared architecture.
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
for y in [35+i*1.1 for i in range(7)]:
 for x in [-3.5,-2.75,-2,2,2.75,3.5]:chair(x,y,math.pi)
for x in [-2.75,2.75]:block(x,38.3,2.4,7.5)
stage=build_stage(origin=(0,43,0),width=8,depth=3.4);block(0,44.7,9,3.8);block(-4.65,43.8,1,1.8)
# Proposed activation kiosk: visual Testnet concept, not an existing installation.
build_totem(origin=(7,4,0));block(7,4,1.2,1.2)
# Casual return area with timber-topped cafe tables / four slender chairs.
for x,y in [(3,17),(0,21),(3,25),(-2,17)]:
 furn.box((x,y,.74),(1.2,1.2,.07),wood[4]);block(x,y,1.8,1.8)
 for dx,dy,a in [(0,-.85,math.pi),(0,.85,0),(-.85,0,-math.pi/2),(.85,0,math.pi/2)]:chair(x+dx,y+dy,a,cream)
for g in [floor,shell,roof,furn,entrance]:g.finish()
# Labels are reconstructed lettering, not video screenshots.
def text(body,loc,size=.25,rot=(math.pi/2,0,0),color=yellow):
 c=bpy.data.curves.new(body,'FONT');c.body=body;c.size=size;c.align_x='CENTER';c.extrude=.001;c.resolution_u=3;o=bpy.data.objects.new(body,c);bpy.context.collection.objects.link(o);o.location=loc;o.rotation_euler=rot;o.data.materials.append(M[color]);return o
text('Merch',(-5.6,5.25,1.7),.56,color=runner).rotation_euler=(Matrix.Rotation(math.pi/2,4,'X') @ Matrix.Rotation(-math.pi/2,4,'Z')).to_euler()
text('Hack Meridian',(-5.6,5.25,3.05),.10,color=runner)
for k,label in enumerate(['Main Stage','Luggage Storage','Rest Area','Merch Area  <','Scale Area','Restrooms','Genesis Area']):
 yy=-2.45+k*.35-.008;top=-1.05+(k+1)*.15
 text(label,(0,yy,top-.10),.095,color=black)
text('HACKMERIDIAN',(11.6,6.58,.55),.18,color=white)
# Model semantics / public-safe evidence metadata.
bpy.context.scene['scope']='Observed route reconstruction, approximate geometry; not a measured survey or full 3200 m² footprint.'
bpy.context.scene['reference']='Private user video inspected through timestamped frames 00:00–02:51. No raw footage or personal imagery embedded.'
# Named zones; Three converts Blender y into -z.
def zone(id,label,x,y,w,d,vx,vy,yaw=0):return {'id':id,'label':label,'polygon':[[x-w/2,-y-d/2],[x+w/2,-y-d/2],[x+w/2,-y+d/2],[x-w/2,-y+d/2]],'view':{'x':vx,'z':-vy,'yaw':yaw}}
surfaces=[]
for k in range(7):
 z0=(6-k)*.35;z1=(7-k)*.35
 surfaces.append({'polygon':[[-.96,z0],[.96,z0],[.96,z1],[-.96,z1]],'baseY':-1.05+(k+1)*.15,'originX':0,'originZ':0,'slopeX':0,'slopeZ':0})
surfaces.append({'polygon':[[-6,0],[6,0],[6,6],[-6,6]],'baseY':-1.05,'originX':0,'originZ':0,'slopeX':0,'slopeZ':0})
surfaces.append({'polygon':[[-2.2,6],[2.2,6],[2.2,32],[-2.2,32]],'baseY':-1.05,'originX':0,'originZ':0,'slopeX':0,'slopeZ':0})
layout={'scaleStatus':'All local dimensions and inter-zone distances are estimated from imagery; official 3200 m² venue area is not the modeled footprint. Entrance corridor length, width and seven 0.15 m step rises are visual estimates.','surfaces':surfaces,'walkable':[[[-14.8,-49.8],[14.8,-49.8],[14.8,0],[-14.8,0]],[[-6,0],[6,0],[6,6],[-6,6]],[[-2.2,6],[2.2,6],[2.2,32],[-2.2,32]]],'obstacles':obstacles,'bounds':{'minX':-15,'maxX':15,'minZ':-50,'maxZ':32},'spawn':{'x':0,'z':28,'yaw':0,'pitch':0},'zones':[zone('entrance','Pasillo amarillo · paraguas',0,-19,4.4,26,0,-28,0),zone('arrival','Escalera · check-in',0,-1,5,10,0,-4,0),zone('merch','Merch · a la izquierda',-9,5,8,8,-5.3,3.5,1.5708),zone('buffet','Buffet · encuentro',0,10,10,10,3,7,.6),zone('river','Ventanas · sala acristalada',12.4,19,5,24,12,10,0),zone('photo','Photo lounge · encuentro',10,38,9,13,7,33,-.5),zone('stage','Escenario · HackMeridian',0,43,11,12,0,39,0),zone('hack','Mesas de trabajo',-10,28,9,23,-6,19,.5),zone('auditorium','Auditorio',0,34,10,12,0,29,0),zone('cafe','Zona social',0,21,12,13,5,18,.8)]}
layout['zones'].append({'id': 'activation', 'label': 'Activación Stellar · concepto Testnet', 'polygon': [[5, -6.5], [8, -6.5], [8, -0.8], [5, -0.8]], 'view': {'x': 5.8, 'z': -1.4, 'yaw': -0.418}, 'status': 'Proposed Testnet concept; not installed'})
build_exterior(layout)
build_passport_display(layout)
build_stands(layout)
build_experience_zones(layout,Geo,M,mat,graphic_plane,{'black':black,'white':white,'yellow':yellow,'blue':blue,'steel':steel,'wood':wood[4]})
graphic_plane('Check-in overhead observed sign','checkin-sign',(0,2.265,3.65),3.4,.7)
graphic_plane('Check-in Made to Move branded backdrop','checkin-backdrop',(0,6.639,1.55),3.4,3.1)
apply_appearance()
open(OUT+'/layout.json','w',encoding='utf-8').write(json.dumps(layout,indent=2,ensure_ascii=False))
# Lighting and cameras. Render only non-sensitive reconstructed geometry.
world=bpy.data.worlds.new('Lisbon daylight');bpy.context.scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.55,.65,.72,1);world.node_tree.nodes['Background'].inputs[1].default_value=.35
for y in [8,24,40]:
 d=bpy.data.lights.new('River daylight','AREA');o=bpy.data.objects.new('River daylight',d);bpy.context.collection.objects.link(o);o.location=(14,y,4);d.energy=1100;d.shape='DISK';d.size=10;o.rotation_euler=(0,math.pi/2,0)
for x in [-10,0,10]:
 for y in [8,24,40]:
  d=bpy.data.lights.new('Skylight','AREA');o=bpy.data.objects.new('Skylight',d);bpy.context.collection.objects.link(o);o.location=(x,y,6.5);d.energy=650;d.size=7
for yy in [-29,-23,-17,-11,-4]:
 d=bpy.data.lights.new('Entrance overhead practical','AREA');o=bpy.data.objects.new('Entrance overhead practical',d);bpy.context.collection.objects.link(o);o.location=(0,yy,4.1);d.energy=180;d.size=1.5
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=64;scene.cycles.use_denoising=False;scene.render.resolution_x=1600;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
camdata=bpy.data.cameras.new('Editorial camera');cam=bpy.data.objects.new('Editorial camera',camdata);bpy.context.collection.objects.link(cam);scene.camera=cam
def point(loc,target):cam.location=loc;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
point((8.7,24,2.1),(1,42,2.7));camdata.lens=25
# Apply modifiers and export; text retained as curves in .blend, converted by exporter.
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.environ.get('ONE16_BUILD_DIR',ROOT+'/model'),'one16-editable.blend'),relative_remap=False)
bpy.ops.export_scene.gltf(filepath=OUT+'/one16.glb',export_format='GLB',export_apply=True,export_cameras=False,export_lights=False,export_extras=True)
print('ONE16 V2 MODEL READY',len(bpy.data.objects),os.path.getsize(OUT+'/one16.glb'))
