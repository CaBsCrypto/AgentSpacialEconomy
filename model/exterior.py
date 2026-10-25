"""Observed exterior topology; all local dimensions and exterior stair count estimated."""
import bpy, math, json
from mathutils import Vector

def build_exterior(layout):
 def mat(n,c):
  m=bpy.data.materials.new('Exterior '+n);m.diffuse_color=(*c,1);m.use_nodes=True;m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(*c,1);m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.82;return m
 concrete=mat('weathered concrete',(.36,.35,.31));white=mat('pale facade',(.78,.78,.71));dark=mat('dark timber',(.09,.075,.05));wood=mat('guardrail wood',(.28,.19,.10));yellow=mat('banner yellow',(.97,.78,.015));black=mat('ink',(.012,.015,.014));gray=mat('grey doors',(.48,.52,.52));red=mat('panic bar red',(.65,.025,.018));light=mat('illustration white',(.88,.88,.77));green=mat('door safety green',(.04,.24,.13))
 def box(n,c,s,m,rot=0):
  bpy.ops.mesh.primitive_cube_add(size=1,location=c);o=bpy.context.object;o.name='Exterior '+n;o.dimensions=s;o.rotation_euler.z=rot;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m);return o
 def rod(n,a,b,r,m):
  d=Vector(b)-Vector(a);bpy.ops.mesh.primitive_cylinder_add(vertices=8,radius=r,depth=d.length,location=(Vector(a)+Vector(b))/2);o=bpy.context.object;o.name='Exterior '+n;o.rotation_euler=d.to_track_quat('Z','Y').to_euler();o.data.materials.append(m)
 def text(t,x,y,z,size,m=black):
  c=bpy.data.curves.new(t,'FONT');c.body=t;c.size=size;c.align_x='CENTER';c.extrude=.001;c.resolution_u=2;o=bpy.data.objects.new('Exterior '+t,c);bpy.context.collection.objects.link(o);o.location=(x,y,z);o.rotation_euler=(math.pi/2,0,0);c.materials.append(m)
 def poly(n,pts,m):
  me=bpy.data.meshes.new(n);me.from_pydata(pts,[],[tuple(range(len(pts)))]);me.materials.append(m);o=bpy.data.objects.new('Exterior '+n,me);bpy.context.collection.objects.link(o)
 def rect(x0,x1,z0,z1):return [[x0,z0],[x1,z0],[x1,z1],[x0,z1]]
 def surface(p,h):return {'polygon':p,'baseY':h,'originX':0,'originZ':0,'slopeX':0,'slopeZ':0}
 # Ground apron and wall around real doorway; no floor height discontinuity.
 box('forecourt',( -.5,-36,-1.15),(15,8,.20),concrete)
 box('service cover',(2,-35,-1.043),(1.2,.85,.014),gray)
 for x in [-4.6,4.6]:box('white doorway wing',(x,-31.98,1.8),(4.8,.24,5.7),white)
 box('white lintel',(0,-31.98,3.30),(4.4,.24,2.70),white)
 box('yellow threshold',(0,-31.3,-1.041),(4.35,1.4,.018),yellow)
 # Open door leaves project outward; red horizontal panic hardware.
 for side in [-1,1]:
  ang=-side*.65;cx=side*3.03;cy=-32.63
  box('outward open grey door',(cx,cy,.30),(2.1,.09,2.7),gray,ang)
  box('red panic bar',(cx,cy-.065,.24),(1.8,.07,.055),red,ang)
  box('green safety plate',(cx,cy-.07,1.24),(.12,.012,.14),green,ang)
  layout['obstacles'].append({'minX':cx-.85,'maxX':cx+.85,'minZ':32.15,'maxZ':33.4})
 # Banner proportion/typography directly based on inspected video; graphic strip interpretive.
 box('welcome banner',(0,-32.13,3.6),(6.15,.035,2.95),yellow)
 box('illustrated left strip',(-2.43,-32.156,3.6),(1.28,.014,2.95),black)
 text('Hack Meridian',-.65,-32.18,4.76,.17);text('Stellar',2.03,-32.18,4.76,.14)
 text('WELCOME,',.42,-32.18,4.12,.48);text('BUILDERS.',.42,-32.18,3.61,.52)
 text('What happens next starts with you',.45,-32.18,3.12,.145)
 text('OCTOBER 25–26 · LISBON',.45,-32.18,2.47,.14)
 # Schematic Lisbon tram and sun, not a copied photograph or invented partner marks.
 box('tram outline',(-2.43,-32.18,3.38),(.91,.018,1.05),light)
 box('tram yellow',(-2.43,-32.195,3.34),(.82,.018,.80),yellow)
 for x in [-2.68,-2.22]:box('tram window',(x,-32.21,3.54),(.32,.014,.34),black)
 for x in [-2.73,-2.13]:rod('tram wheel',(x,-32.23,2.86),(x,-32.25,2.86),.115,black)
 for i in range(12):
  a=i*math.tau/12;rod('sun ray',(-2.43+.28*math.cos(a),-32.2,4.47+.28*math.sin(a)),(-2.43+.43*math.cos(a),-32.2,4.47+.43*math.sin(a)),.018,yellow)
 rod('sun',(-2.43,-32.19,4.47),(-2.43,-32.22,4.47),.23,yellow)
 for i in range(11):
  z=2.3+i*.25
  poly('banner motif',[(2.8,-32.18,z),(2.91,-32.18,z+.08),(2.91,-32.18,z+.16),(2.8,-32.18,z+.09),(2.69,-32.18,z+.16),(2.69,-32.18,z+.08)],black)
 for k in range(6):
  x=-2.91+(k%3)*.43;z=2.25+(k//3)*.28;box('city graphic',(x,-32.18,z),(.23,.015,.22),light)
 # Right check-in feather flag and physical pole/base.
 box('flag base',(4.45,-33.0,-1.02),(.65,.65,.06),black)
 rod('flag pole',(4.2,-33,-1.0),(4.2,-33,2.5),.018,black)
 poly('check in feather',[(4.2,-33.01,-.2),(4.85,-33.01,.0),(5.03,-33.01,1.9),(4.8,-33.01,2.42),(4.2,-33.01,2.0)],yellow)
 text('Check In',4.6,-33.04,1.14,.14);text('Area',4.6,-33.04,.94,.14);text('←',4.6,-33.04,.49,.31)
 # Raised exterior platform and estimated descending concrete steps.
 box('raised platform',(-6,-45,.04),(4,10,.22),concrete)
 for k in range(8):
  z0=37.2+k*.35;h=-1.05+(k+1)*.15
  box('estimated exterior step %02d'%k,(-6,-(z0+.175),(-1.16+h)/2),(3.6,.35,h+1.16),concrete)
  layout['surfaces'].insert(0,surface(rect(-7.8,-4.2,z0,z0+.35),h))
 # Platform wall, shelter, exposed posts and wood guards. Forecourt remains open toward tracks.
 box('platform wall',(-3.9,-45,2.2),(.20,10,4.5),white)
 for y in [-41,-45,-49]:
  box('closed loading door',(-4.015,y,1.55),(.035,2.4,2.8),gray)
  for x in [-8,-4]:
   box('shelter post',(x,y,2.6),(.17,.17,5.0),dark)
   rod('diagonal brace',(x,y,3.5),(x,y+1.2,4.9),.07,wood)
  box('shelter tie',(-6,y,4.9),(4.4,.17,.17),dark)
 for y in [-40.2,-43,-46,-49.7]:box('guard post',(-8,y,.72),(.14,.14,1.2),wood)
 for h in [.6,1.15]:box('platform wood guard',(-8,-45,h),(.14,10,.15),wood)
 for x in [-7.9,-4.1]:
  for z in [37.2,38.6,40]:
   h=-1.05+(z-37.2)/2.8*1.2;box('stair guard post',(x,-z,h+.55),(.12,.12,1.1),wood)
  rod('stair handrail',(x,-37.2,.05),(x,-40,1.25),.065,wood)
 r=box('roof shelter',(-6,-45,5.02),(4.6,10.4,.12),dark);r.name='roof_exterior_platform'
 r=box('roof entrance canopy',(0,-33.7,5.2),(14,3.8,.13),dark);r.name='roof_exterior_canopy'
 for x in [-6,6]:rod('canopy brace',(x,-32,3.8),(x,-35.3,5.1),.08,dark)
 # Tracks are background only, separated by guard rail and excluded navigation.
 box('railway gravel',(-11,-41,-1.55),(4,25,.25),concrete)
 for y in range(-53,-28):box('track sleeper',(-11,y,-1.38),(2.9,.18,.12),wood)
 for x in [-11.72,-10.28]:box('railway rail',(x,-41,-1.27),(.07,25,.13),gray)
 for y in [-33,-35,-37,-39]:box('forecourt barrier post',(-8.05,y,-.48),(.14,.14,1.15),wood)
 for h in [-.2,-.65]:box('forecourt barrier',(-8.05,-36,h),(.14,8,.14),wood)
 for x in [-7.9,-4.1]:
  layout['obstacles'].append({'minX':x-.10,'maxX':x+.10,'minZ':37.2,'maxZ':40})
 layout['walkable'] += [rect(-8,7,32,40),rect(-8,-4,40,50)]
 layout['surfaces'] += [surface(rect(-8,-4,40,50),.15),surface(rect(-8,7,32,40),-1.05)]
 layout['bounds'].update(maxZ=50)
 layout['spawn']={'x':0,'z':38,'yaw':0,'pitch':.14}
 layout['zones'] += [{'id':'exterior','label':'Exterior · Welcome, Builders.','polygon':rect(-8,7,32,40),'view':{'x':0,'z':38,'yaw':0,'pitch':.14}},{'id':'platform','label':'Andén cubierto · acceso exterior','polygon':rect(-8,-4,40,50),'view':{'x':-6,'z':46,'yaw':0}}]
 layout['exteriorRoute']=[{'x':-6,'z':46},{'x':-6,'z':40.2},{'x':-6,'z':36.8},{'x':0,'z':36.8},{'x':0,'z':31},{'x':0,'z':28}]
 layout['scaleStatus']+=' Exterior platform, banner, forecourt and step dimensions/count are estimated; route topology and sign text observed in private exterior video.'
 return layout
