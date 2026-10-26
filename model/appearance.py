"""Shared glTF-compatible PBR images and video-informed graphic planes.
Generate inputs with scripts/generate-venue-appearance.py before using Blender.
"""
from pathlib import Path
import json
import bpy
from mathutils import Vector

TEXTURES=Path(__file__).resolve().parent/"textures"
_MANIFEST=None

def manifest():
    global _MANIFEST
    if _MANIFEST is None:
        source=TEXTURES/"manifest.json"
        if not source.is_file():raise FileNotFoundError("Run scripts/generate-venue-appearance.py before rebuilding the venue")
        _MANIFEST=json.loads(source.read_text(encoding="utf-8"))
    return _MANIFEST

def image(relative,noncolor=False):
    path=TEXTURES/relative
    if not path.is_file():raise FileNotFoundError(str(path))
    name=relative.replace("/"," • ")
    item=bpy.data.images.get(name)
    if item is None:
        item=bpy.data.images.load(str(path),check_existing=True);item.name=name
        if noncolor:item.colorspace_settings.name="Non-Color"
        item.pack()
    return item

def graphic_material(key):
    data=manifest()["graphics"].get(key)
    if data is None:raise KeyError("Unknown venue graphic: "+key)
    name="Venue graphic • "+key;material=bpy.data.materials.get(name)
    if material:return material
    material=bpy.data.materials.new(name);material.use_nodes=True
    p=material.node_tree.nodes.get("Principled BSDF");p.inputs["Base Color"].default_value=(1,1,1,1);p.inputs["Roughness"].default_value=.83
    node=material.node_tree.nodes.new("ShaderNodeTexImage");node.image=image(data["color"]);node.interpolation="Linear";node.extension="EXTEND";node.label="Editable source: "+data["source"]
    material.node_tree.links.new(node.outputs["Color"],p.inputs["Base Color"])
    material["graphic_key"]=key;material["source_svg"]=data["source"]
    return material

def graphic_plane(name,key,center,width,height,facing="-Y"):
    """Vertical Z-up plane, centered at center. Facing: -Y, +Y, -X or +X."""
    axes={"-Y":(1,0,0),"+Y":(-1,0,0),"-X":(0,-1,0),"+X":(0,1,0)}
    if facing not in axes:raise ValueError("facing must be -Y, +Y, -X or +X")
    right=Vector(axes[facing])*width*.5;up=Vector((0,0,height*.5))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata([tuple(v) for v in [-right-up,right-up,right+up,-right+up]],[],[(0,1,2,3)]);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);obj.location=center
    uv=mesh.uv_layers.new(name="UVMap")
    for loop,value in zip(mesh.loops,[(0,0),(1,0),(1,1),(0,1)]):uv.data[loop.index].uv=value
    mesh.materials.append(graphic_material(key));obj["graphic_key"]=key;obj["source_svg"]=manifest()["graphics"][key]["source"]
    return obj

def kind_for_material(name):
    key=name.lower()
    if key.startswith("venue graphic") or any(s in key for s in ["glaz","glass","mirror","emiss","lens","glow","screen","daylight","motif","light furniture"]):return None
    if any(s in key for s in ["painted","graphite","steel","aluminium","metal","oxidised","sliding door","furniture frame"]):return "painted-metal"
    if any(s in key for s in ["masonry","stone","concrete","chalk"]):return "masonry"
    if any(s in key for s in ["upholstery","textile","fabric","cloth","rug","carpet","runner","beanbag","sofa","lounge stool"]):return "textile"
    if any(s in key for s in ["timber","wood"]):return "wood"
    return None

def metric_uv(obj):
    """Stable meter-based box projection, only for meshes without existing UVs."""
    mesh=obj.data
    if mesh.uv_layers:return
    uv=mesh.uv_layers.new(name="UVMap");world=obj.matrix_world
    normal_matrix=world.to_3x3().inverted_safe().transposed()
    for polygon in mesh.polygons:
        normal=normal_matrix@polygon.normal;dominant=max(range(3),key=lambda i:abs(normal[i]));a,b={0:(1,2),1:(0,2),2:(0,1)}[dominant]
        for li in polygon.loop_indices:
            point=world@mesh.vertices[mesh.loops[li].vertex_index].co;uv.data[li].uv=(point[a],point[b])

def apply_appearance():
    """Apply maps after geometry creation; preserve supplied image artwork."""
    data=manifest()["materials"];changed=[]
    for material in bpy.data.materials:
        kind=kind_for_material(material.name)
        if kind is None or material.get("venue_pbr"):continue
        material.use_nodes=True;nodes=material.node_tree.nodes;links=material.node_tree.links;p=nodes.get("Principled BSDF")
        if p is None or p.inputs["Base Color"].is_linked:continue
        # Blender 4.3 glTF recognizes the current RGBA Mix node, not legacy MixRGB.
        tint=tuple(p.inputs["Base Color"].default_value)
        color=nodes.new("ShaderNodeTexImage");color.image=image(data[kind]["color"]);color.label="Shared "+kind+" color"
        multiply=nodes.new("ShaderNodeMix");multiply.data_type="RGBA";multiply.blend_type="MULTIPLY";multiply.inputs[0].default_value=1
        color_inputs=[socket for socket in multiply.inputs if socket.type=="RGBA"]
        color_output=next(socket for socket in multiply.outputs if socket.type=="RGBA")
        color_inputs[1].default_value=tint
        links.new(color.outputs["Color"],color_inputs[0]);links.new(color_output,p.inputs["Base Color"])
        roughness=nodes.new("ShaderNodeTexImage");roughness.image=image(data[kind]["roughness"],True);links.new(roughness.outputs["Color"],p.inputs["Roughness"])
        normal=nodes.new("ShaderNodeTexImage");normal.image=image(data[kind]["normal"],True)
        convert=nodes.new("ShaderNodeNormalMap");convert.inputs["Strength"].default_value=.38
        links.new(normal.outputs["Color"],convert.inputs["Color"]);links.new(convert.outputs["Normal"],p.inputs["Normal"])
        for node in [color,roughness,normal]:node.extension="REPEAT"
        material["venue_pbr"]=kind;changed.append(material.name)
    for obj in bpy.data.objects:
        if obj.type=="MESH" and any(slot.material and slot.material.get("venue_pbr") for slot in obj.material_slots):metric_uv(obj)
    print("APPEARANCE_APPLIED",len(changed),"materials")
    return changed

