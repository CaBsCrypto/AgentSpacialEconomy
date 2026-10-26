"""Proposed physical kiosk. Concept Testnet only; no transaction or live endpoint.
Blender Z-up, local front is -Y. Approximate dimensions: 0.8 x 0.65 x 1.93 m.
"""
import bpy,math
from mathutils import Vector

def build_totem(origin=(2.6,5.6,0),angle=0):
 before=set(bpy.data.objects)
 def mat(name,c,metal=0,rough=.6,emit=0):
  m=bpy.data.materials.get(name)
  if m:return m
  m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
  if emit:p.inputs['Emission Color'].default_value=(*c,1);p.inputs['Emission Strength'].default_value=emit
  return m
 navy=mat('Activation kiosk • charcoal',(.015,.024,.032),.2,.37);screen=mat('Activation kiosk • dark display',(.006,.019,.028),0,.25,.12);cyan=mat('Activation kiosk • pale cyan',(.40,.76,.86),.15,.35);white=mat('Activation kiosk • screen white',(.8,.9,.95),0,.5,.3);muted=mat('Activation kiosk • secondary text',(.34,.52,.59),0,.5,.2);silver=mat('Activation kiosk • satin steel',(.32,.38,.40),.7,.35)
 def box(name,loc,size,m,bevel=.015):
  bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m)
  if bevel:
   mod=o.modifiers.new('Manufactured edge radius','BEVEL');mod.width=bevel;mod.segments=3;o.modifiers.new('Corner normals','WEIGHTED_NORMAL')
  return o
 def text(name,body,x,z,size,m,y=-.111):
  c=bpy.data.curves.new(name,'FONT');c.body=body;c.size=size;c.align_x='CENTER';c.align_y='CENTER';c.extrude=.0006;c.resolution_u=4;o=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(o);o.location=(x,y,z);o.rotation_euler=(math.pi/2,0,0);o.data.materials.append(m);return o
 # Stable broad base, pedestal and gently rounded portrait screen body.
 box('ActivationTotem / proposed weighted base',(0,0,.035),(.80,.65,.07),navy,.025)
 box('ActivationTotem / foot trim',(0,-.01,.077),(.62,.49,.014),silver,.008)
 box('ActivationTotem / pedestal',(0,.015,.56),(.32,.25,.98),navy,.035)
 box('ActivationTotem / pedestal light seam',(0,-.118,.57),(.035,.012,.73),cyan,.005)
 box('ActivationTotem / portrait housing',(0,0,1.38),(.72,.21,1.10),navy,.035)
 box('ActivationTotem / inset display',(0,-.109,1.4),(.64,.008,.98),screen,.015)
 box('ActivationTotem / cyan header accent',(0,-.116,1.845),(.52,.007,.018),cyan,.003)
 text('ActivationTotem / Activación','ACTIVACION',0,1.76,.064,white,y=-.119)
 text('ActivationTotem / Stellar','Stellar',0,1.645,.12,white,y=-.119)
 box('ActivationTotem / testnet pill',(0,-.119,1.50),(.46,.007,.077),cyan,.015)
 text('ActivationTotem / concept label','TESTNET',0,1.5,.035,navy,y=-.124)
 text('ActivationTotem / test assets','USDC de prueba',0,1.365,.044,white,y=-.119)
 text('ActivationTotem / flow note','Toca para activar',0,1.20,.040,muted,y=-.119)
 text('ActivationTotem / no real value','SIN VALOR REAL',0,1.08,.035,white,y=-.119)
 text('ActivationTotem / demo notice','Activa tu wallet · Obtén USDC',0,1.015,.023,muted,y=-.119)
 # Base front plaque remains legible from the arrival approach.
 box('ActivationTotem / proposal plaque',(0,-.145,.30),(.29,.012,.15),cyan,.007)
 text('ActivationTotem / proposal','EMPIEZA AQUI',0,.30,.034,navy,y=-.154)
 root=bpy.data.objects.new('ActivationTotem • Activación Stellar / propuesta Testnet',None);bpy.context.collection.objects.link(root)
 for o in set(bpy.data.objects)-before:
  if o!=root:o.parent=root
 root.location=origin;root.rotation_euler.z=angle;root['status']='Proposed kiosk, not an existing physical installation';root['network']='Testnet wallet UI; no automatic transaction';root['approximate_dimensions_m']='0.80 x 0.65 base; 1.93 height';root['placement']='Arrival right, before the buffet; front faces the authored walking approach'
 return root
