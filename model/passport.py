"""Proposed passport display, exact supplied artwork; no account integration."""
import bpy,os,math
from mathutils import Vector

def build_passport_display(layout):
 path=os.path.join(os.path.dirname(__file__),'passport-component.blend')
 with bpy.data.libraries.load(path,link=False) as (src,dst):dst.objects=list(src.objects)
 root=bpy.data.objects.new('Passport proposed AR display',None);bpy.context.collection.objects.link(root);root.location=(8.7,3,1.08);root.rotation_euler.x=math.radians(60)
 for o in dst.objects:
  bpy.context.collection.objects.link(o);o.parent=root
 mat=bpy.data.materials.new('Passport pedestal navy');mat.diffuse_color=(.025,.055,.12,1);mat.use_nodes=True;mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=mat.diffuse_color
 bpy.ops.mesh.primitive_cube_add(size=1,location=(8.7,3,.5));o=bpy.context.object;o.name='Passport proposed pedestal';o.dimensions=(.6,.6,1);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat);m=o.modifiers.new('Pedestal softened edges','BEVEL');m.width=.025;m.segments=3
 # Small slanted book rest, no giant model scaling.
 bpy.ops.mesh.primitive_cube_add(size=1,location=(8.7,3.018,1.065));o=bpy.context.object;o.name='Passport display rest';o.dimensions=(.11,.014,.08);o.rotation_euler.x=math.radians(-30);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat)
 white=bpy.data.materials.new('Passport display lettering');white.diffuse_color=(.8,.8,.7,1)
 for t,z,size in [('PASSPORT AR',.80,.055),('Demostracion',.70,.035),('Objeto propuesto',.62,.027)]:
  c=bpy.data.curves.new(t,'FONT');c.body=t;c.align_x='CENTER';c.size=size;c.extrude=.0003;c.resolution_u=2;o=bpy.data.objects.new('Passport '+t,c);bpy.context.collection.objects.link(o);o.location=(8.7,2.695,z);o.rotation_euler=(math.pi/2,0,0);c.materials.append(white)
 layout['obstacles'].append({'minX':8.375,'maxX':9.025,'minZ':-3.325,'maxZ':-2.675})
 layout['zones'].append({'id':'passport','label':'Passport · demostración AR','polygon':[[8,-3.8],[9.5,-3.8],[9.5,-1.0],[8,-1.0]],'view':{'x':8.7,'z':-1.6,'yaw':0,'pitch':-.2},'status':'Proposed AR demonstration; not an observed installation or account.'})
