"""Furniture and visitor zones reconstructed from the narrated October 26 clips.

Coordinates and local dimensions are estimates. Graphics contain no attendee
images, names, badges or personal messages. Cameras are visual props; football
uses a local, reversible interaction.
"""
import math
from games import build_games
from content_hub import build_content_hub
from football import build_football


def rect(x0, x1, y0, y1):
    """Blender floor bounds to the viewer's X/Z polygon."""
    return [[x0, -y1], [x1, -y1], [x1, -y0], [x0, -y0]]


def build_experience_zones(layout, Geo, materials, make_material, graphic_plane, palette):
    """Build observed props, then append collision and semantic metadata."""
    black, white = palette['black'], palette['white']
    yellow, blue = palette['yellow'], palette['blue']
    steel, wood = palette['steel'], palette['wood']
    groups = []
    def group(name):
        g = Geo(name)
        groups.append(g)
        return g
    def block(x, y, w, d):
        layout['obstacles'].append({'minX': round(x-w/2, 3), 'maxX': round(x+w/2, 3), 'minZ': round(-y-d/2, 3), 'maxZ': round(-y+d/2, 3)})
    def zone(id, label, bounds, view, review):
        layout['zones'].append({'id': id, 'label': label, 'polygon': rect(*bounds), 'view': view, 'reviewSection': review, 'evidence': 'October 26 narrated walkthrough; local scale and position estimated.'})
    def bean(g, x, y):
        g.ellipsoid((x, y, .34), (.57, .58, .35), black)
        g.ellipsoid((x, y+.18, .64), (.44, .44, .48), black)
        block(x, y, 1.18, 1.20)
    def tripod(g, x, y, height=1.45, radius=.42):
        for k in range(3):
            a = k * math.tau / 3
            g.rod((x+radius*math.cos(a), y+radius*math.sin(a), .03), (x, y, height), .023, black)
        block(x, y, radius*2+.10, radius*2+.10)

    build_games(layout, Geo, materials, make_material, graphic_plane, palette)

    # Five public-safe team categories on labeled stickers; no attendee details.
    skills = group('Skills board mobile whiteboard and wheels')
    sx,sy=5.8,9.5
    skills.box((sx,sy,1.36),(1.45,.07,1.80),white)
    for dx in [-.72,.72]:
        skills.rod((sx+dx,sy,.12),(sx+dx,sy,2.28),.025,steel)
        skills.rod((sx+dx,sy-.35,.10),(sx+dx,sy+.35,.10),.028,steel)
        for dy in [-.35,.35]:skills.ellipsoid((sx+dx,sy+dy,.06),(.055,.035,.055),black)
    graphic_plane('Skills board categories','skills-board',(sx,sy-.041,1.40),1.31,1.65)
    block(sx,sy,1.55,.82)
    zone('skills','Skills board · forma tu equipo',(3.6,7.2,6.75,10.4),{'x':5.8,'z':-6.9,'yaw':0,'pitch':-.10},22)

    build_football(layout, Geo, materials, graphic_plane, palette)

    booth = group('Photobooth camera box, lens and tripod')
    graphic_plane('Photobooth Made to Move Lisbon mural','lisbon-mural',(14.71,34,1.55),3.2,3.0,facing='-X')
    tripod(booth,11.65,34,1.48,.44)
    booth.box((11.65,34,1.73),(.38,.55,.50),wood)
    booth.box((11.85,34,1.73),(.035,.36,.32),black)
    booth.rod((11.87,34,1.73),(12.02,34,1.73),.105,black,20)
    booth.rod((12.025,34,1.73),(12.04,34,1.73),.076,steel,20)
    booth.box((11.44,34,1.72),(.035,.31,.21),black)
    zone('photobooth','Fotomatón · Made to Move',(9,14.6,31.5,36.5),{'x':10,'z':-34,'yaw':-math.pi/2},24)

    # Eight columns and three rows in the reference artwork, with observed seats.
    photo = group('Photocall black beanbag and two white poufs')
    graphic_plane('Photocall eight by three artwork','photocall',(10.3,43.12,1.52),8,3.0)
    block(10.3,43.15,8.1,.18)
    bean(photo,10.3,41.2)
    for xx in [8.3,12.3]:
        photo.rod((xx,40.6,.03),(xx,40.6,.48),.34,white,24)
        block(xx,40.6,.70,.70)

    build_content_hub(layout, Geo, materials, make_material, palette)

    # Trim only zone classification regions; the observed floor remains connected.
    updates={
        'merch':((-13,-5,1,7.9),None,None),
        'buffet':((-4.8,3.3,6.5,14.2),{'x':3.1,'z':-7.1,'yaw':1.11,'pitch':-.16},'Comidas · buffet'),
        'hack':((-14.5,-5.5,19.5,39.5),{'x':-6,'z':-21,'yaw':.5},None),
        'river':((10.3,14.7,7.4,11.3),None,'Ventanas · costado río'),
        'photo':((6.2,14.6,37.5,44.5),{'x':10,'z':-38,'yaw':0},'Zona de fotos · junto al escenario'),
    }
    for z in layout['zones']:
        if z['id'] in updates:
            bounds,view,label=updates[z['id']]
            z['polygon']=rect(*bounds)
            if view:z['view']=view
            if label:z['label']=label
    # The wallet now sits before the buffet, so the rectangular buffet region stays whole.
    layout['scaleStatus']+=' October 26 games, skills, Energy Corner, photobooth, photocall and Content Hub reconstructed from narrated clips; placements and dimensions estimated.'
    for g in groups:
        obj=g.finish()
        obj['reference']='Narrated October 26 walkthrough; approximate reconstruction.'
    return layout
