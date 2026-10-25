"""Video-informed stage component. All dimensions are adjustable estimates.
Blender Z up; audience/front is negative Y; no attendee or footage textures.
"""
import bpy, math
from mathutils import Vector, Matrix

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
    glow=mat('Stage • warm uplight',(.8,.9,1),0,.25,2)
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
    text('HackMeridian identity','Hack\nMeridian',(flank/2,back-.05,2.26),.5,charcoal)
    text('Stellar identity','STELLAR',(flank/2,back-.052,1.52),.14,charcoal)
    # Observed repeating backdrop marks, represented only by truthful event name,
    # never invented sponsor logos or blurry extracted personal information.
    for row in [0,1,2,3]:
        z=.65+row*.91
        for col in range(5):
            x=-width/2+flank+.45+col*(width-flank-.9)/4
            if abs(x-flank/2)<1.3 and 1.3<z<2.9:continue
            text('Small event-name repeat','HackMeridian',(x,back-.052,z),.085,charcoal)
    # Abstract architectural line pattern inspired by visible blue/yellow flank;
    # intentionally not a claim to reproduce the original illustration artwork.
    left=-width/2
    for k in range(6):
        z=.42+k*.59
        for a,b in [((left+.08,back-.056,z),(left+flank-.08,back-.056,z)),((left+.1,back-.056,z),(left+flank*.65,back-.056,z+.43)),((left+flank*.65,back-.056,z+.43),(left+flank-.08,back-.056,z+.12))]:rod('Flank abstract yellow strokes',a,b,.018,yellow,6)
        rod('Flank architectural pale stroke',(left+flank*.2,back-.06,z+.08),(left+flank*.2,back-.06,z+.42),.015,pale,6)
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
    for i in range(7):
        x=-width*.43+i*width*.86/6
        box('Uplight base',(x,back-.4,h+.055),(.19,.21,.1),charcoal,.018)
        a=(x,back-.38,h+.14);b=(x,back-.31,h+.23)
        rod('Uplight barrel',a,b,.075,charcoal,12);rod('Uplight lens',b,(x,back-.305,h+.235),.064,glow,12)
    # Tall black event banner observed beside stage approach.
    bx=-width/2-.66
    box('Move banner weighted base',(bx,.55,.045),(.8,.6,.09),charcoal,.018)
    box('Move banner',(bx,.65,1.95),(.74,.05,3.8),charcoal,.012)
    move=text('Move banner lettering','Move',(bx,.618,2.15),.55,yellow)
    move.rotation_euler=(Matrix.Rotation(math.pi/2,4,'X') @ Matrix.Rotation(-math.pi/2,4,'Z')).to_euler()
    text('Move banner small event','HACKMERIDIAN',(bx,.617,.48),.078,yellow)
    # Loudspeaker visible near banner; recessed grille and slender port seams.
    box('PA loudspeaker cabinet',(bx+.05,-.06,.5),(.55,.42,1),charcoal,.035)
    grille=mat('Stage • speaker grille',(.065,.07,.067),.25,.75)
    box('PA speaker grille',(bx+.05,-.278,.53),(.44,.012,.77),grille,.02)
    for z in [.22,.3,.38,.46,.54,.62,.7,.78,.86]:box('PA grille horizontal detail',(bx+.05,-.288,z),(.4,.005,.007),charcoal)
    root=bpy.data.objects.new('HackMeridian stage • estimated dimensions',None);bpy.context.collection.objects.link(root)
    for obj in set(bpy.data.objects)-before:
        if obj!=root:obj.parent=root
    root.location=origin;root['reference']='Private walkthrough 01:35 and 01:45';root['dimensions_status']='Estimated from video; not field measured';root['estimated_width_m']=width;root['estimated_depth_m']=depth
    return root

if __name__=='__main__':
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    build_stage()
    print('STAGE_BUILD_OK',len(bpy.data.objects))
