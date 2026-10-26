"""Half-length accessible recording room reconstructed from the review."""
import math
import bpy
from furniture import build_sofa, build_pouf

def build_content_hub(layout, Geo, materials, make_material, palette):
    black, white = palette['black'], palette['white']
    blue, yellow, steel = palette['blue'], palette['yellow'], palette['steel']
    props = Geo('Content Hub tables, recording focus and four linear luminaires')
    def block(x,y,w,d):
        layout['obstacles'].append({'minX':round(x-w/2,3),'maxX':round(x+w/2,3),'minZ':round(-y-d/2,3),'maxZ':round(-y+d/2,3)})
    build_sofa('Content Hub side sofa', (13.9,16.25,0), 2.1, materials[blue], -math.pi/2)
    block(13.9,16.25,1.04,2.2)
    build_sofa('Content Hub near sofa', (12.25,12.08,0), 2.1, materials[blue], math.pi)
    block(12.25,12.08,2.2,1.04)
    build_pouf('Content Hub mustard pouf', (13.45,14,0), materials[yellow], .60,.44)
    block(13.45,14,.64,.64)
    props.box((12.15,15.50,.43),(1.15,.62,.055),white)
    for dx in [-.46,.46]:
        for dy in [-.23,.23]:
            props.rod((12.15+dx,15.5+dy,.02),(12.15+dx,15.5+dy,.40),.023,steel)
    block(12.15,15.5,1.21,.68)
    light = make_material('Content practical soft white light',(.87,.91,1),rough=.4,emit=1.5)
    for k in range(3):
        a=k*math.tau/3
        props.rod((10.85+.30*math.cos(a),16.90+.30*math.sin(a),.03),(10.85,16.90,1.5),.023,black)
    block(10.85,16.9,.70,.70)
    for k in range(32):
        a,b=k*math.tau/32,(k+1)*math.tau/32
        props.rod((10.85,16.9+.24*math.cos(a),1.70+.24*math.sin(a)),(10.85,16.9+.24*math.cos(b),1.70+.24*math.sin(b)),.025,light,6)
    props.box((10.85,16.90,1.65),(.06,.09,.18),black)
    for x in [11.25,13.55]:
        for y in [13.0,16.35]:
            props.box((x,y,3.68),(.12,2.1,.07),black)
            props.box((x,y,3.638),(.085,2.02,.018),light)
    props.finish()
    layout['zones'].append({'id':'content-hub','label':'Content Hub · sala acristalada','polygon':[[10.25,-18.05],[14.6,-18.05],[14.6,-11.45],[10.25,-11.45]],'view':{'x':11.6,'z':-13.9,'yaw':-.75,'pitch':-.18},'reviewSection':25,'evidence':'October 26 narrated walkthrough; dimensions estimated; owner requested two bodies.'})
    layout['contentHubEntrance']={'x':10,'z':-13.65,'width':2.2,'status':'Estimated doorway retained; four bodies reduced to two.'}
    layout['contentHub']={'bodies':2,'length':6.6,'width':4.85,'minY':11.45,'maxY':18.05,'linearLuminaires':4,'softLights':[{'x':11.6,'y':2.75,'z':-13.3},{'x':12.9,'y':2.75,'z':-16.3}]}
