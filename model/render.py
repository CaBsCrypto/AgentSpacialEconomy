import bpy,os
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(__file__));OUT=ROOT+'/dist/assets';bpy.ops.wm.open_mainfile(filepath=ROOT+'/model/one16-editable.blend');s=bpy.context.scene;s.cycles.use_denoising=False;s.cycles.samples=32;s.render.image_settings.file_format='JPEG';s.render.image_settings.quality=90;s.render.filepath=OUT+'/hero.jpg';bpy.ops.render.render(write_still=True)
bpy.data.objects['roof • removable pitched timber and skylights'].hide_render=True;c=s.camera;c.location=(40,-12,43);c.rotation_euler=(Vector((0,25,0))-c.location).to_track_quat('-Z','Y').to_euler();c.data.type='ORTHO';c.data.ortho_scale=68;s.render.filepath=OUT+'/overview.jpg';bpy.ops.render.render(write_still=True)
