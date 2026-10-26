"""Video-informed stage component. All dimensions are adjustable estimates.
Blender Z up; audience/front is negative Y; no attendee or footage textures.
"""
import bpy, math
from mathutils import Vector
from appearance import graphic_plane

def build_stage(origin=(0,0,0), width=8, depth=3.4):
    before=set(bpy.data.objects)
    def mat(name,c,metal=0,rough=.6,emission=0):
        m=bpy.data.materials.get(name)
        if m:return m
        m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True
        p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
        if emission:
            p.inputs['Emission Color'].default_value=(*c,1);p.inputs['Emission Strength'].default_value=emission
        return m
    charcoal=mat('Stage • charcoal',(.025,.028,.027),.1,.62)
    yellow=mat('Stage • warm Meridian yellow',(.95,.72,.085),0,.78)
    blue=mat('Stage • illustrated flank blue',(.09,.25,.46),0,.8)
    silver=mat('Stage • aluminium',(.59,.63,.66),.8,.3)
    pale=mat('Stage • pale motif',(.82,.84,.72),0,.7)
    glow=mat('Stage • green lens',(.38,1,.018),0,.24,2.5)
    def box(name,loc,size,m,bevel=0):
        bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m)
        if bevel:
            mod=o.modifiers.new('Soft manufactured edges','BEVEL');mod.width=bevel;mod.segments=2;o.modifiers.new('Corner normals','WEIGHTED_NORMAL')
        return o
    def rod(name,a,b,r,m,vertices=8):
        a,b=Vector(a),Vector(b);d=b-a;bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=d.length,location=(a+b)/2);o=bpy.context.object;o.name=name;o.rotation_euler=d.to_track_quat('Z','Y').to_euler();o.data.materials.append(m);return o
    def text(name,body,loc,size,m,rotation=(math.pi/2,0,0),align='CENTER'):
        c=bpy.data.curves.new(name,'FONT');c.body=body;c.size=size;c.align_x=align;c.align_y='CENTER';c.extrude=.001;c.resolution_u=4;o=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(o);o.location=loc;o.rotation_euler=rotation;o.data.materials.append(m);return o
    h=.27;back=depth-.15;top=4.25;flank=width*.14
    box('Low dark stage platform',(0,depth/2,h/2),(width,depth,h),charcoal,.018)
    # Fine horizontal apron reveal, visible in reference as a shallow dark riser.
    box('Platform apron seam',(0,-.007,h*.38),(width,.016,.018),charcoal)
    box('Yellow event backdrop',(flank/2,back,2.17), (width-flank,.07,3.8),yellow,.01)
    box('Illustrated side panel',(-width/2+flank/2,back-.01,2.17),(flank,.075,3.8),blue,.01)
    # Video 022050141: image-backed event repeat and Lisbon/tram illustration.
    # Six millimeters forward of the solid backing prevents coplanar z-fighting.
    graphic_plane('Stage event graphic','stage-backdrop',(flank/2,back-.041,2.17),width-flank,3.8)
    graphic_plane('Stage illustrated graphic','stage-flank',(-width/2+flank/2,back-.06,2.17),flank,3.8)
    # Square-section lighting trusses with four chords and diagonal webbing.
    tx=width/2+.12;ty=back;g=.22
    for x in [-tx,tx]:
        for dx in [-g/2,g/2]:
            for dy in [-g/2,g/2]:rod('Truss upright chord',(x+dx,ty+dy,.02),(x+dx,ty+dy,top),.022,silver)
        for z in [i*.35 for i in range(12)]:
            for dy in [-g/2,g/2]:rod('Truss upright diagonal',(x-g/2,ty+dy,z),(x+g/2,ty+dy,min(z+.35,top)),.012,silver)
        box('Truss foot',(x,ty,.025),(.52,.5,.05),charcoal)
    for dy in [-g/2,g/2]:
        for dz in [-g/2,g/2]:rod('Top truss chord',(-tx,ty+dy,top+dz),(tx,ty+dy,top+dz),.022,silver)
        n=math.ceil(width/.45)
        for i in range(n):
            x=-tx+i*2*tx/n;nx=-tx+(i+1)*2*tx/n
            rod('Top truss diagonal',(x,ty+dy,top-g/2),(nx,ty+dy,top+g/2),.012,silver)
    # Four green moving heads are clearly visible in the new reference.
    # Smaller unlit PAR housings sit between them; counts remain estimated.
    for i,ratio in enumerate([-.43,-.145,.18,.43]):
        x=width*ratio
        box('Green moving head base '+str(i+1),(x,back-.44,h+.065),(.31,.26,.13),charcoal,.025)
        for dx in [-.12,.12]:
            rod('Moving head yoke',(x+dx,back-.44,h+.12),(x+dx,back-.44,h+.30),.028,charcoal)
        a=(x,back-.40,h+.25);b=(x,back-.49,h+.40)
        rod('Moving green head barrel',a,b,.12,charcoal,16)
        rod('Green stage lens',b,(x,back-.494,h+.407),.105,glow,16)
    for ratio in [-.31,-.03,.07,.31]:
        x=width*ratio
        box('Small PAR foot',(x,back-.40,h+.025),(.19,.16,.05),charcoal,.012)
        rod('Small dark PAR housing',(x,back-.39,h+.09),(x,back-.43,h+.19),.077,charcoal,12)
    # Matching tall Made to Move towers frame both sides of the stage.
    for side in [-1,1]:
        bx=side*(width/2+.66)
        box('Move banner weighted base',(bx,.55,.045),(.8,.6,.09),charcoal,.018)
        box('Move banner left' if side<0 else 'Move banner right',(bx,.65,1.95),(.74,.05,3.8),charcoal,.012)
        graphic_plane('Made to Move tower graphic','move-banner',(bx,.618,1.95),.74,3.8)
    # Transparent lectern at audience-left, as seen in the new stage clip.
    acrylic=mat('Stage • clear acrylic',(.72,.84,.84),0,.16)
    shader=acrylic.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Alpha'].default_value=.28
    if 'Transmission Weight' in shader.inputs:shader.inputs['Transmission Weight'].default_value=.40
    acrylic.diffuse_color=(*acrylic.diffuse_color[:3],.28)
    if hasattr(acrylic,'surface_render_method'):acrylic.surface_render_method='DITHERED'
    if hasattr(acrylic,'blend_method'):acrylic.blend_method='BLEND'
    lx=-width*.34;ly=.88
    box('Lectern foot',(lx,ly,h+.035),(.75,.50,.07),charcoal,.012)
    for dx in [-.20,.20]:
        rod('Lectern thin support',(lx+dx,ly,h+.07),(lx+dx,ly,h+1.02),.018,charcoal,8)
    top_panel=box('Acrylic lectern angled top',(lx,ly,h+1.04),(.78,.53,.018),acrylic,.009)
    top_panel.rotation_euler.x=-.18
    # Speaker retained from the earlier observed reconstruction.
    bx=-width/2-.66
    # Loudspeaker visible near banner; recessed grille and slender port seams.
    box('PA loudspeaker cabinet',(bx+.05,-.06,.5),(.55,.42,1),charcoal,.035)
    grille=mat('Stage • speaker grille',(.065,.07,.067),.25,.75)
    box('PA speaker grille',(bx+.05,-.278,.53),(.44,.012,.77),grille,.02)
    for z in [.22,.3,.38,.46,.54,.62,.7,.78,.86]:box('PA grille horizontal detail',(bx+.05,-.288,z),(.4,.005,.007),charcoal)
    root=bpy.data.objects.new('HackMeridian stage • estimated dimensions',None);bpy.context.collection.objects.link(root)
    for obj in set(bpy.data.objects)-before:
        if obj!=root:obj.parent=root
    root.location=origin;root['reference']='VID_20261026_022050141.mp4; earlier walkthrough 01:35 and 01:45';root['dimensions_status']='Estimated from video; not field measured';root['estimated_width_m']=width;root['estimated_depth_m']=depth
    return root

if __name__=='__main__':
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    build_stage()
    print('STAGE_BUILD_OK',len(bpy.data.objects))
