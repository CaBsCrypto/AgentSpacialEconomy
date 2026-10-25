import bpy,os,math
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(__file__));OUT=ROOT+'/dist/assets';bpy.ops.wm.open_mainfile(filepath=ROOT+'/model/one16-editable.blend');s=bpy.context.scene;s.cycles.use_denoising=False;s.cycles.samples=32;s.render.resolution_x=1280;s.render.resolution_y=800;s.render.resolution_percentage=100;s.render.image_settings.file_format='JPEG';s.render.image_settings.quality=90;c=s.camera;c.data.type='PERSP'
def view(name,loc,target,lens=24):
 c.location=loc;c.rotation_euler=(Vector(target)-c.location).to_track_quat('-Z','Y').to_euler();c.data.lens=lens;s.render.filepath=OUT+'/'+name+'-v2-final.jpg';bpy.ops.render.render(write_still=True)
view('hero',(0,-28,.62),(0,-1.0,1.0),25)
view('stairs',(0,-7,.65),(0,0,.65),22)
view('merch',(-4.2,3.0,1.7),(-9.3,6.2,1.25),23)
bpy.data.objects['roof • removable pitched timber and skylights'].hide_render=True;c.location=(47,-28,52);c.rotation_euler=(Vector((0,11,0))-c.location).to_track_quat('-Z','Y').to_euler();c.data.type='ORTHO';c.data.ortho_scale=92;s.render.filepath=OUT+'/overview-v2-final.jpg';bpy.ops.render.render(write_still=True)
for name in ['hero','stairs','merch','overview']:os.replace(OUT+'/'+name+'-v2-final.jpg',OUT+'/'+name+'.jpg')
print('V2 RENDERS READY')
