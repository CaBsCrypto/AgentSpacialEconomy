"""Large proposed tabletop Passport display, retaining the supplied cover art."""
import bpy,os,math
from mathutils import Vector


def build_passport_display(layout):
    positions=layout.get('exhibition',{}).get('positions',[])
    station=next((position for position in positions if position.get('graphic')=='booth-passport'),None)
    if station is None:
        raise ValueError('Build the exhibition before placing its Passport tabletop display')
    table=station['table'];x=table['x'];table_y=-table['z'];top=table.get('top',.79)
    # The visitor-facing print stays clear; the book takes the rear hardware band.
    book_y=table_y-.21;book_scale=3.8
    path=os.path.join(os.path.dirname(__file__),'passport-component.blend')
    with bpy.data.libraries.load(path,link=False) as (src,dst):dst.objects=list(src.objects)
    root=bpy.data.objects.new('Passport proposed AR display',None);bpy.context.collection.objects.link(root)
    root.rotation_euler=(math.radians(60),0,math.pi);root.scale=(book_scale,)*3
    for obj in dst.objects:
        bpy.context.collection.objects.link(obj);obj.parent=root
    bpy.context.view_layer.update()
    corners=[obj.matrix_world@Vector(corner) for obj in dst.objects if obj.type=='MESH' for corner in obj.bound_box]
    if not corners:raise ValueError('Passport source component contains no book meshes')
    bottom=min(point.z for point in corners)
    plinth_height=.05
    root.location=(x,book_y,top+plinth_height-bottom)
    root['support']='tabletop';root['tableId']='booth-passport';root['displayScale']=book_scale
    root['experienceId']='passport';root['front']='Visitor stage side (+Y Blender / -Z Three)'
    bpy.context.view_layer.update()
    corners=[obj.matrix_world@Vector(corner) for obj in dst.objects if obj.type=='MESH' for corner in obj.bound_box]
    lo=[min(point[axis] for point in corners) for axis in range(3)];hi=[max(point[axis] for point in corners) for axis in range(3)]
    material=bpy.data.materials.new('Passport pedestal navy');material.diffuse_color=(.025,.055,.12,1);material.use_nodes=True
    material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=material.diffuse_color
    material.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.72
    bpy.ops.mesh.primitive_cube_add(size=1,location=(x,book_y,top+plinth_height/2))
    plinth=bpy.context.object;plinth.name='Passport proposed tabletop plinth';plinth.dimensions=(.46,.32,plinth_height)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);plinth.data.materials.append(material)
    modifier=plinth.modifiers.new('Small display edge radius','BEVEL');modifier.width=.008;modifier.segments=3
    plinth['support']='tabletop';plinth['tableId']='booth-passport'
    # The existing desk supplies floor collision; no obsolete entry-hall pedestal.
    zone={'id':'passport','label':'Passport · demostración AR en mesa Stellar Passport',
          'polygon':[[3.6,-30.25],[5.6,-30.25],[5.6,-29.45],[3.6,-29.45]],
          'view':{'x':4.1,'z':-29.9,'yaw':math.pi,'pitch':-.2},
          'status':'Proposed AR demonstration on the Stellar Passport table; not an observed installation or account.'}
    layout['zones'][:]=[existing for existing in layout['zones'] if existing.get('id')!='passport']
    parent_index=next((i for i,existing in enumerate(layout['zones']) if existing.get('id')=='stands'),len(layout['zones']))
    layout['zones'].insert(parent_index,zone)
    layout['passportDisplay']={'tableId':'booth-passport','support':'tabletop','scale':book_scale,
        'position':{'x':x,'y':root.location.z,'z':-book_y},'approach':dict(zone['view']),
        'bookBounds':{'minX':lo[0],'maxX':hi[0],'minY':lo[2],'maxY':hi[2],'minZ':-hi[1],'maxZ':-lo[1]},
        'bookWidth':hi[0]-lo[0],'tabletopHeight':top,'plinthSize':[.46,plinth_height,.32]}
    return root
