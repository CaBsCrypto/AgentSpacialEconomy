"""Observed paired booth corridor; positions and scale approximate, typography only where legible."""
import bpy,math,os
from mathutils import Vector,Matrix

def build_stands(layout):
 made=[]
 def mat(n,c,emit=0):
  m=bpy.data.materials.new('Stands '+n);m.diffuse_color=(*c,1);m.use_nodes=True;p=m.node_tree.nodes['Principled BSDF'];p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=.7
  if emit:p.inputs['Emission Color'].default_value=(*c,1);p.inputs['Emission Strength'].default_value=emit
  return m
 black=mat('matte black partitions',(.022,.026,.028));white=mat('white table tops',(.8,.8,.73));wood=mat('natural timber legs',(.42,.29,.16));yellow=mat('yellow desk lamps',(.95,.7,.015));screen=mat('neutral demonstration screen',(.39,.54,.59),.3);letter=mat('white lettering',(.70,.73,.73));metal=mat('dark chair frames',(.08,.09,.09))
 def box(n,c,s,m):
  bpy.ops.mesh.primitive_cube_add(size=1,location=c);o=bpy.context.object;o.name='Stands '+n;o.dimensions=s;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m);made.append(o)
 def rod(n,a,b,r,m):
  d=Vector(b)-Vector(a);bpy.ops.mesh.primitive_cylinder_add(vertices=8,radius=r,depth=d.length,location=(Vector(a)+Vector(b))/2);o=bpy.context.object;o.name='Stands '+n;o.rotation_euler=d.to_track_quat('Z','Y').to_euler();o.data.materials.append(m);made.append(o)
 def text(t,loc,size,vertical=False):
  c=bpy.data.curves.new(t,'FONT');c.body=t;c.size=size;c.align_x='CENTER';c.extrude=.001;c.resolution_u=2;o=bpy.data.objects.new('Stands label '+t,c);bpy.context.collection.objects.link(o);o.location=loc;o.rotation_euler=(Matrix.Rotation(math.pi/2,4,'X')@Matrix.Rotation(-math.pi/2 if vertical else 0,4,'Z')).to_euler();c.materials.append(letter)
 def obstacle(x,y,w,d):layout['obstacles'].append({'minX':x-w/2,'maxX':x+w/2,'minZ':-y-d/2,'maxZ':-y+d/2})
 for side in [-1,1]:
  x=side*3.2
  for row in range(2):
   ty=26.6+row*3.5;py=ty+1.2
   box('black brand backdrop',(x,py,1.35),(2.6,.10,2.7),black);obstacle(x,py,2.6,.16)
   # Tiny repeated sponsor marks omitted rather than inventing unreadable logos.
   sx=x-side*1.18;box('narrow vertical brand strip',(sx,py-.07,1.35),(.22,.08,2.7),black)
   label='GUAVA' if side==-1 and row==0 else 'THE AHA COMPANY' if side==-1 else 'Trustless Work' if row==0 else None
   if label:text(label,(sx,py-.12,1.6),.15 if row==0 else .12,True)
   if side==1 and row==0:text('Grantfox',(x,py-.065,1.06),.14)
   box('white demonstration desk',(x,ty,.76),(1.9,.75,.06),white)
   for dx in [-.81,.81]:
    for dy in [-.26,.26]:rod('tapered timber desk leg',(x+dx,ty+dy,.02),(x+dx*.92,ty+dy*.92,.73),.027,wood)
   obstacle(x,ty,2.05,.9)
   box('monitor dark bezel',(x+.35,ty+.16,1.12),(.62,.055,.39),black);box('neutral monitor face',(x+.35,ty+.128,1.12),(.57,.008,.34),screen)
   rod('monitor stem',(x+.35,ty+.16,.79),(x+.35,ty+.16,.98),.022,metal);box('monitor foot',(x+.35,ty+.14,.8),(.25,.2,.025),black)
   rod('yellow lamp base',(x-.60,ty,.79),(x-.60,ty,.82),.09,yellow);rod('yellow lamp stem',(x-.60,ty,.82),(x-.60,ty,1.15),.018,yellow);box('yellow lamp shade',(x-.60,ty,1.17),(.17,.14,.055),yellow)
   # One unoccupied demo chair, no people or personal items.
   cy=ty+.65;box('dark chair seat',(x-.55,cy,.46),(.43,.43,.055),black);box('dark chair back',(x-.55,cy+.18,.72),(.43,.06,.38),black)
   for dx in [-.17,.17]:
    for dy in [-.17,.17]:rod('chair leg',(x-.55+dx,cy+dy,0),(x-.55+dx,cy+dy,.44),.018,metal)
   obstacle(x-.55,cy,.55,.5)
 # Consolidate generated solids by material, leaving readable text separate.
 groups=[[o for o in made if o.data.materials[0]==m] for m in [black,white,wood,yellow,screen,metal]]
 for m,group in zip([black,white,wood,yellow,screen,metal],groups):
  bpy.ops.object.select_all(action='DESELECT')
  for o in group:o.select_set(True)
  if group:bpy.context.view_layer.objects.active=group[0];bpy.ops.object.join();group[0].name='Stands observed corridor · '+m.name
 # The approved Passport activation occupies only the reverse of the first
 # right backdrop; the observed Trustless Work / Grantfox front stays intact.
 target=os.path.join(os.path.dirname(os.path.dirname(__file__)),'dist','assets','passport-target.png')
 if os.path.isfile(target):
  image=bpy.data.images.load(target,check_existing=True)
  material=bpy.data.materials.new('PassportStand target artwork');material.use_nodes=True
  shader=material.node_tree.nodes.get('Principled BSDF');shader.inputs['Roughness'].default_value=1
  texture=material.node_tree.nodes.new('ShaderNodeTexImage');texture.image=image
  material.node_tree.links.new(texture.outputs['Color'],shader.inputs['Base Color'])
  mesh=bpy.data.meshes.new('PassportStand reverse poster mesh')
  mesh.from_pydata([(3.8,27.858,.73),(2.6,27.858,.73),(2.6,27.858,2.17),(3.8,27.858,2.17)],[],[(0,1,2,3)]);mesh.update()
  uv=mesh.uv_layers.new(name='UVMap')
  for loop,coord in zip(mesh.loops,[(0,0),(1,0),(1,1),(0,1)]):uv.data[loop.index].uv=coord
  poster=bpy.data.objects.new('PassportStand target panel',mesh);bpy.context.collection.objects.link(poster);mesh.materials.append(material)
  poster['experienceId']='passport-stand16';poster['url']='./passport-ar.html';poster['reviewSection']=16
 layout['zones'].append({'id':'stands','label':'Stands · corredor hacia el escenario','polygon':[[-4.7,-31.6],[4.7,-31.6],[4.7,-25],[-4.7,-25]],'view':{'x':0,'z':-25.3,'yaw':0},'evidence':'Narrated video: paired black booths between central builders/social area and auditorium. Geometry estimated; GUAVA, Trustless Work/Grantfox and THE AHA COMPANY visually legible. Far right booth left unbranded.'})
 for z in layout['zones']:
  if z['id']=='cafe':
   z['label']='Zona central · mesas / builders'
   z['polygon']=[[x,max(zz,-25)] for x,zz in z['polygon']]
  if z['id']=='auditorium':
   z['polygon']=[[x,min(zz,-31.7)] for x,zz in z['polygon']];z['view']={'x':0,'z':-33,'yaw':0}
 layout['zones'].append({'id':'passport-stand16','label':'Stellar Passport · stand 16','polygon':[[2.4,-29.7],[4,-29.7],[4,-27.9],[2.4,-27.9]],'view':{'x':3.2,'z':-29.15,'yaw':math.pi,'pitch':0},'status':'Passport image-tracking demo on the reverse of Trustless Work / Grantfox.'})
 layout['standsRoute']=[{'x':3,'z':-7},{'x':5.8,'z':-14},{'x':5.8,'z':-23},{'x':0,'z':-23},{'x':0,'z':-25},{'x':0,'z':-31},{'x':0,'z':-39}]
