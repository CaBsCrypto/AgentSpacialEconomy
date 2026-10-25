import bpy,os
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(__file__));OUT=ROOT+'/dist/assets';bpy.ops.wm.open_mainfile(filepath=ROOT+'/model/one16-editable.blend');m=bpy.data.materials.get('River glazing pale blue');m.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value=.22;m.diffuse_color=(*m.diffuse_color[:3],.22)
if hasattr(m,'surface_render_method'):m.surface_render_method='DITHERED'
if hasattr(m,'blend_method'):m.blend_method='BLEND'
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/model/one16-editable.blend');bpy.ops.export_scene.gltf(filepath=OUT+'/one16.glb',export_format='GLB',export_apply=True,export_cameras=False,export_lights=False,export_extras=True)
s=bpy.context.scene;s.render.image_settings.file_format='JPEG';s.render.image_settings.quality=90;s.render.filepath=OUT+'/hero-final.jpg';bpy.ops.render.render(write_still=True)
bpy.data.objects['roof • removable pitched timber and skylights'].hide_render=True;c=s.camera;c.location=(40,-12,43);c.rotation_euler=(Vector((0,25,0))-c.location).to_track_quat('-Z','Y').to_euler();c.data.type='ORTHO';c.data.ortho_scale=68;s.render.filepath=OUT+'/overview-final.jpg';bpy.ops.render.render(write_still=True)
os.replace(OUT+'/hero-final.jpg',OUT+'/hero.jpg');os.replace(OUT+'/overview-final.jpg',OUT+'/overview.jpg');print('GLASS FINAL READY')
