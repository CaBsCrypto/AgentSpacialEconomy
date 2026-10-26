"""Small standalone exhibition export for label/UV/material QA; never saves the venue blend."""
import bpy,json,os,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'model'))
from stands import build_stands
args=sys.argv[sys.argv.index('--')+1:]
if len(args)!=1:raise RuntimeError('Pass a temporary output directory after --')
out=Path(args[0]);out.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
layout={'zones':[],'obstacles':[]}
build_stands(layout)
(out/'layout.json').write_text(json.dumps(layout,indent=2),encoding='utf-8')
bpy.ops.export_scene.gltf(filepath=str(out/'stand-labels.glb'),export_format='GLB',export_apply=True,export_extras=True,export_cameras=False,export_lights=False)
print('STAND_LABEL_QA',str(out/'stand-labels.glb'))
