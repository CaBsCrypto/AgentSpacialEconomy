"""Eight exhibition positions on both faces of four observed black dividers.

Dimensions and spacing are visual estimates from the October 26 walkthrough.
The existing Passport target remains on the reverse of Trustless/Grantfox.
"""
import math
import os
import bpy
from mathutils import Vector, Matrix
from appearance import graphic_plane


def build_stands(layout):
    solids = []
    def mat(name, color, metal=0, rough=.7, emit=0):
        material = bpy.data.materials.new('Stands ' + name)
        material.diffuse_color = (*color, 1)
        material.use_nodes = True
        shader = material.node_tree.nodes['Principled BSDF']
        shader.inputs['Base Color'].default_value = (*color, 1)
        shader.inputs['Roughness'].default_value = rough
        shader.inputs['Metallic'].default_value = metal
        if emit:
            shader.inputs['Emission Color'].default_value = (*color, 1)
            shader.inputs['Emission Strength'].default_value = emit
        return material
    black = mat('matte black painted partitions', (.022,.026,.028))
    white = mat('white table tops', (.82,.82,.78))
    wood = mat('natural timber legs', (.48,.34,.20))
    yellow = mat('yellow painted desk lamps', (.95,.72,.025), rough=.5)
    screen = mat('neutral demonstration screen', (.09,.13,.16), rough=.35, emit=.15)
    lettering = mat('white lettering', (.83,.85,.83))
    metal = mat('dark metal chair frames', (.07,.08,.08), metal=.45, rough=.42)
    def box(name, center, size, material):
        bpy.ops.mesh.primitive_cube_add(size=1, location=center)
        obj = bpy.context.object
        obj.name = 'Stands ' + name
        obj.dimensions = size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.data.materials.append(material)
        solids.append(obj)
        return obj
    def rod(name, a, b, radius, material, vertices=12):
        direction = Vector(b)-Vector(a)
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=direction.length, location=(Vector(a)+Vector(b))/2)
        obj=bpy.context.object
        obj.name='Stands '+name
        obj.rotation_euler=direction.to_track_quat('Z','Y').to_euler()
        obj.data.materials.append(material)
        solids.append(obj)
        return obj
    def text(body, center, size, reverse=False, vertical=False, name=None):
        curve=bpy.data.curves.new(body,'FONT')
        curve.body=body;curve.size=size;curve.align_x='CENTER';curve.align_y='CENTER'
        curve.extrude=.001;curve.resolution_u=2
        obj=bpy.data.objects.new(name or 'Stands label '+body,curve)
        bpy.context.collection.objects.link(obj);obj.location=center
        rotation=Matrix.Rotation(math.pi/2,4,'X')
        if reverse:rotation=Matrix.Rotation(math.pi,4,'Z')@rotation
        if vertical:rotation=rotation@Matrix.Rotation(-math.pi/2,4,'Z')
        obj.rotation_euler=rotation.to_euler()
        curve.materials.append(lettering)
        return obj
    def obstacle(x,y,w,d):
        layout['obstacles'].append({'minX':round(x-w/2,3),'maxX':round(x+w/2,3),'minZ':round(-y-d/2,3),'maxZ':round(-y+d/2,3)})
    # Looking toward the stage: front and rear brands of the same divider.
    brands = {
        (-1,0): [('DRIPS','booth-drips'),('GUAVA','booth-guava')],
        (1,0): [('Trustless Work / Grantfox','booth-grantfox-trustless'),('Stellar Passport','booth-passport')],
        (-1,1): [('DeFindex / Soroswap','booth-defindex-soroswap'),('THE AHA COMPANY','booth-aha')],
        (1,1): [('57BLOCKS','booth-57blocks'),('OpenZeppelin','booth-openzeppelin')],
    }
    positions=[]
    for side in [-1,1]:
        x=side*3.65
        for row,py in enumerate([27.8,32.0]):
            panel=box('black double sided brand divider',(x,py,1.45),(2.9,.10,2.9),black)
            panel['row']=row+1;panel['side']='left' if side<0 else 'right'
            panel['reference']='VID_20261026_021119922: eight positions around four dividers'
            obstacle(x,py,2.9,.16)
            for face,(label,key) in enumerate(brands[(side,row)]):
                reverse=face==1
                facing='+Y' if reverse else '-Y'
                direction=1 if reverse else -1
                ty=([29.9,33.6] if reverse else [26.5,30.7])[row]
                # Narrow vertical brand at the aisle-side edge and event footer.
                graphic_plane('Stands repeated event footer '+key,'booth-footer',(x,py+direction*.057,.31),2.82,.43,facing)
                sx=x-side*1.28
                text(label,(sx,py+direction*.066,1.82),.13 if len(label)<16 else .095,reverse,True)
                if side==1 and row==0 and not reverse:
                    # Stable names are used by the Passport regression tests.
                    text('Trustless Work',(x,py-.064,1.22),.14,name='Stands label Trustless Work')
                    text('Grantfox',(x,py-.064,1.01),.14,name='Stands label Grantfox')
                box('white demonstration desk '+key,(x,ty,.76),(1.95,.75,.06),white)
                for dx in [-.83,.83]:
                    for dy in [-.27,.27]:
                        rod('tapered timber desk leg',(x+dx,ty+dy,.02),(x+dx*.92,ty+dy*.92,.73),.027,wood)
                obstacle(x,ty,2.02,.75)
                # Printed tabletop visible from visitor height; shared editable art.
                printed=graphic_plane('Stands printed tabletop '+key,key,(x,ty,.793),1.84,.64,facing)
                printed.rotation_euler.x=math.pi/2 if reverse else -math.pi/2
                # Monitor faces the visitor, with generic content rather than private screens.
                my=ty-direction*.14
                box('monitor dark bezel',(x+.34,my,1.15),(.60,.055,.38),black)
                box('neutral monitor face',(x+.34,my+direction*.032,1.15),(.55,.008,.33),screen)
                rod('monitor stem',(x+.34,my,.79),(x+.34,my,.99),.021,metal)
                box('monitor foot',(x+.34,my,.801),(.25,.20,.025),black)
                # Observed bell base, thin stem and domed circular yellow shade.
                lx=x-.61
                bpy.ops.mesh.primitive_cone_add(vertices=20, radius1=.09, radius2=.055, depth=.18, location=(lx,ty,.88))
                base=bpy.context.object;base.name='Stands yellow bell lamp base';base.data.materials.append(yellow);solids.append(base)
                rod('yellow lamp stem',(lx,ty,.96),(lx,ty,1.23),.011,yellow)
                bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=1, location=(lx,ty,1.24))
                shade=bpy.context.object;shade.name='Stands yellow dome lamp shade';shade.scale=(.115,.115,.045)
                bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
                shade.data.materials.append(yellow);solids.append(shade)
                # A small unoccupied chair on the inner side of its desk.
                cy=ty-direction*.50
                cx=x+side*.55
                box('dark chair seat',(cx,cy,.46),(.40,.38,.05),black)
                box('dark chair back',(cx,cy-direction*.15,.70),(.40,.055,.34),black)
                for dx in [-.16,.16]:
                    for dy in [-.14,.14]:rod('chair leg',(cx+dx,cy+dy,.02),(cx+dx,cy+dy,.44),.016,metal)
                obstacle(cx,cy,.47,.45)
                positions.append({'brand':label,'graphic':key,'side':'left' if side<0 else 'right','row':row+1,'face':'stage' if reverse else 'arrival','table':{'x':x,'z':-ty}})
    # Keep draw calls bounded by joining opaque solids by shared material.
    material_groups=[(material,[obj for obj in solids if obj.data.materials[0]==material]) for material in [black,white,wood,yellow,screen,metal]]
    for material,group in material_groups:
        bpy.ops.object.select_all(action='DESELECT')
        for obj in group:obj.select_set(True)
        if group:
            bpy.context.view_layer.objects.active=group[0]
            bpy.ops.object.join()
            group[0].name='Stands observed double sided corridor '+material.name
    target=os.path.join(os.path.dirname(os.path.dirname(__file__)),'dist','assets','passport-target.png')
    if os.path.isfile(target):
        image=bpy.data.images.load(target,check_existing=True)
        image.pack()
        material=bpy.data.materials.new('PassportStand target artwork');material.use_nodes=True
        shader=material.node_tree.nodes.get('Principled BSDF');shader.inputs['Roughness'].default_value=1
        texture=material.node_tree.nodes.new('ShaderNodeTexImage');texture.image=image
        material.node_tree.links.new(texture.outputs['Color'],shader.inputs['Base Color'])
        # Original target placement and dimensions stay stable.
        mesh=bpy.data.meshes.new('PassportStand reverse poster mesh')
        mesh.from_pydata([(3.8,27.858,.73),(2.6,27.858,.73),(2.6,27.858,2.17),(3.8,27.858,2.17)],[],[(0,1,2,3)]);mesh.update()
        uv=mesh.uv_layers.new(name='UVMap')
        for loop,coord in zip(mesh.loops,[(0,0),(1,0),(1,1),(0,1)]):uv.data[loop.index].uv=coord
        poster=bpy.data.objects.new('PassportStand target panel',mesh);bpy.context.collection.objects.link(poster);mesh.materials.append(material)
        poster['experienceId']='passport-stand16';poster['url']='./passport-ar.html';poster['reviewSection']=16
    # Nested functional station takes classification priority over the corridor.
    layout['zones'].append({'id':'passport-stand16','label':'Stellar Passport · stand 16','polygon':[[2.4,-29.40],[4,-29.40],[4,-28.10],[2.4,-28.10]],'view':{'x':3.2,'z':-29.15,'yaw':math.pi,'pitch':0},'status':'Passport image-tracking demo on reverse of Trustless Work / Grantfox.'})
    layout['zones'].append({'id':'stands','label':'Exposición · ocho puestos','polygon':[[-5.2,-34.1],[5.2,-34.1],[5.2,-25],[-5.2,-25]],'view':{'x':0,'z':-25.3,'yaw':0},'evidence':'VID_20261026_021119922: four double-sided dividers, eight positions, estimated dimensions.'})
    for zone in layout['zones']:
        if zone['id']=='cafe':
            zone['label']='Zona central · mesas / builders'
            zone['polygon']=[[xx,max(zz,-25)] for xx,zz in zone['polygon']]
        if zone['id']=='auditorium':
            zone['polygon']=[[-5,-42],[5,-42],[5,-34.15],[-5,-34.15]]
            zone['view']={'x':0,'z':-34.5,'yaw':0}
    layout['exhibition']={'dividerCount':4,'positionCount':8,'aisleWidth':4.4,'dimensionsStatus':'Estimated from narrated video','positions':positions}
    layout['standsRoute']=[{'x':3,'z':-7},{'x':5.8,'z':-14},{'x':5.8,'z':-23},{'x':0,'z':-23},{'x':0,'z':-25},{'x':0,'z':-34.5},{'x':0,'z':-39}]
