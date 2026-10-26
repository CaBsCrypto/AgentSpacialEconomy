"""Furniture and visitor zones reconstructed from the narrated October 26 clips.

Coordinates and local dimensions are estimates. Graphics contain no attendee
images, names, badges or personal messages; cameras and games are visual props.
"""
import math
import bpy


def rect(x0, x1, y0, y1):
    """Blender floor bounds to the viewer's X/Z polygon."""
    return [[x0, -y1], [x1, -y1], [x1, -y0], [x0, -y0]]


def rotated_box(geo, center, size, material, angle=0):
    start = len(geo.v)
    geo.box(center, size, material)
    if angle:
        cx, cy, _ = center
        c, s = math.cos(angle), math.sin(angle)
        for i in range(start, len(geo.v)):
            x, y, z = geo.v[i]
            dx, dy = x - cx, y - cy
            geo.v[i] = (cx + c * dx - s * dy, cy + s * dx + c * dy, z)


def sofa(geo, x, y, material, floor=0, width=2.1, angle=0, chaise=False):
    """Padded modular sofa, with distinct seat, back, arms and optional return."""
    c, s = math.cos(angle), math.sin(angle)
    def part(dx, dy, z, size):
        rotated_box(geo, (x + c * dx - s * dy, y + s * dx + c * dy, floor + z), size, material, angle)
    part(0, 0, .22, (width, .88, .28))
    cushions = 2 if width < 2.5 else 3
    for k in range(cushions):
        part(-width / 2 + (k + .5) * width / cushions, -.04, .40, (width / cushions - .035, .74, .16))
    part(0, .35, .72, (width, .20, .72))
    for side in [-1, 1]:
        part(side * (width / 2 - .08), 0, .57, (.16, .88, .49))
    if chaise:
        part(width / 2 - .40, -.56, .25, (.80, 1.03, .33))
        part(width / 2 - .40, -.56, .45, (.77, 1.01, .13))


def build_lower_lounge(geo, block, blue, yellow, low):
    """Two blue modules and two mustard stools on each side of the route."""
    for side in [-1, 1]:
        angle = -side * math.pi / 2
        sofa(geo, side * 4.95, -4.10, blue, low, 2.35, angle, True)
        block(side * 4.95, -4.10, .98, 2.45)
        block(side * 4.39, -4.10 - side * .775, 1.03, .82)
        sofa(geo, side * 4.95, -1.65, blue, low, 1.50, angle)
        block(side * 4.95, -1.65, .98, 1.6)
        for y in [-4.90, -1.65]:
            x = side * 3.25
            geo.rod((x, y, low + .03), (x, y, low + .47), .32, yellow, 24)
            block(x, y, .66, .66)


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
    def letters(body, center, size, material=white, angle=0):
        curve = bpy.data.curves.new(body, 'FONT')
        curve.body, curve.size = body, size
        curve.align_x, curve.align_y = 'CENTER', 'CENTER'
        curve.extrude, curve.resolution_u = .001, 2
        obj = bpy.data.objects.new('Experience lettering ' + body, curve)
        bpy.context.collection.objects.link(obj)
        obj.location = center
        obj.rotation_euler = (math.pi/2, 0, angle)
        curve.materials.append(materials[material])
        return obj
    def zone(id, label, bounds, view, review):
        layout['zones'].append({'id': id, 'label': label, 'polygon': rect(*bounds), 'view': view, 'reviewSection': review, 'evidence': 'October 26 narrated walkthrough; local scale and position estimated.'})
    def table(g, x, y, w=1.25, d=.65, h=.45):
        g.box((x, y, h), (w, d, .055), white)
        for dx in [-w/2+.10, w/2-.10]:
            for dy in [-d/2+.08, d/2-.08]:
                g.rod((x+dx, y+dy, .02), (x+dx, y+dy, h-.03), .023, steel)
        block(x, y, w+.06, d+.06)
    def bean(g, x, y):
        g.ellipsoid((x, y, .34), (.57, .58, .35), black)
        g.ellipsoid((x, y+.18, .64), (.44, .44, .48), black)
        block(x, y, 1.18, 1.20)
    def tripod(g, x, y, height=1.45, radius=.42):
        for k in range(3):
            a = k * math.tau / 3
            g.rod((x+radius*math.cos(a), y+radius*math.sin(a), .03), (x, y, height), .023, black)
        block(x, y, radius*2+.10, radius*2+.10)

    # Three to four human steps of keyboard width, rather than a laptop prop.
    games = group('Games giant keyboard, screen and chill furniture')
    keycap = make_material('Keyboard white keycaps', (.87, .88, .84), rough=.55)
    keylegend = make_material('Keyboard printed legends', (.09, .105, .10), rough=.85)
    x, y = -11.65, 10.1
    games.box((x, y, .76), (3.25, .99, .16), white)
    for dx in [-1.3, 1.3]:
        games.rod((x+dx, y-.32, .02), (x+dx, y+.32, .67), .045, black)
        games.rod((x+dx, y+.32, .02), (x+dx, y-.32, .67), .045, black)
    rows = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']
    for row, keys in enumerate(rows):
        for col, key in enumerate(keys):
            xx = x - 1.43 + col*.205 + (row%2)*.07
            yy = y + .32 - row*.185
            games.box((xx, yy, .874), (.18, .157, .065), keycap)
            # Top-facing lettering stays readable in an overhead inspection.
            curve = bpy.data.curves.new('Key '+key, 'FONT');curve.body=key;curve.size=.055;curve.align_x='CENTER';curve.align_y='CENTER';curve.resolution_u=1
            obj=bpy.data.objects.new('Giant keyboard key '+key,curve);bpy.context.collection.objects.link(obj);obj.location=(xx,yy,.910);curve.materials.append(materials[keylegend])
    games.box((x-.1, y-.405, .874), (1.18, .145, .065), keycap)
    for col in range(4):
        for row in range(4):
            games.box((x+.89+col*.17, y+.30-row*.18, .874), (.145, .15, .065), keycap)
    games.box((x, y+.95, 1.85), (2.55, .12, 1.42), black)
    games.box((x, y+.875, 1.85), (2.40, .015, 1.29), keylegend)
    games.rod((x, y+.95, .02), (x, y+.95, 1.18), .06, black)
    games.box((x, y+.95, .035), (1.0, .65, .07), black)
    block(x,y,3.35,1.10);block(x,y+.95,2.66,.24)
    sofa(games,-11.6,13.25,black,width=2.05);block(-11.6,13.25,2.15,.98)
    table(games,-11.6,14.55)
    bean(games,-13.55,15.5)
    bean(games,-10.15,17.65)

    # Button table, with distinct independently animated emissive materials.
    arcade = group('Games arcade controls and RGB cabinet')
    led_indices = [make_material('Arcade LED '+name, color, rough=.35, emit=1.65) for name,color in [('cyan',(.03,.65,1)),('magenta',(.9,.025,.35)),('amber',(1,.20,.015)),('white',(.75,.85,1))]]
    ax, ay = -12.1,17.25
    arcade.box((ax,ay,.45),(1.65,1.02,.84),black)
    arcade.box((ax,ay,.90),(1.76,1.12,.08),blue)
    for dx in [-.82,.82]:
        for dy in [-.50,.50]:
            arcade.rod((ax+dx,ay+dy,.12),(ax+dx,ay+dy,.88),.028,led_indices[0 if dx<0 else 1],8)
    for dy in [-.565,.565]:
        arcade.rod((ax-.87,ay+dy,.925),(ax+.87,ay+dy,.925),.012,led_indices[0 if dy<0 else 1],6)
    for dx in [-.88,.88]:arcade.rod((ax+dx,ay-.56,.925),(ax+dx,ay+.56,.925),.012,led_indices[2],6)
    for side in [-1,1]:
        for k in range(3):
            xx=ax+side*.43+(k-1)*.20
            arcade.rod((xx,ay+side*.28,.94),(xx,ay+side*.28,.99),.063,led_indices[2 if side>0 else 3],16)
        for k in range(3):
            xx=ax+side*.43+(k-1)*.20
            arcade.rod((xx,ay+side*.05,.94),(xx,ay+side*.05,1.12),.018,black,8)
            arcade.ellipsoid((xx,ay+side*.05,1.14),(.047,.047,.047),black)
    arcade.box((ax,ay-.575,.75),(.63,.018,.18),black)
    letters('125 : 255',(ax,ay-.59,.75),.10,led_indices[0])
    block(ax,ay,1.86,1.23)
    grid = group('Games luminous four by three wall grid')
    grid.box((-14.67,14.9,1.48),(.14,1.72,1.45),black)
    for col in range(4):
        for row in range(3):
            grid.box((-14.58,14.27+col*.42,.99+row*.43),(.025,.35,.35),led_indices[(row+col)%4])
    block(-14.62,14.9,.25,1.8)
    zone('games','Juegos · teclado gigante y arcade',(-14.5,-6.8,8.4,18.8),{'x':-9.2,'z':-12,'yaw':.9},21)

    # A public-safe skills selection board: only categories, blank cards and dots.
    skills = group('Skills board mobile whiteboard and wheels')
    sx,sy=5.8,9.5
    skills.box((sx,sy,1.36),(1.45,.07,1.80),white)
    for dx in [-.72,.72]:
        skills.rod((sx+dx,sy,.12),(sx+dx,sy,2.28),.025,steel)
        skills.rod((sx+dx,sy-.35,.10),(sx+dx,sy+.35,.10),.028,steel)
        for dy in [-.35,.35]:skills.ellipsoid((sx+dx,sy+dy,.06),(.055,.035,.055),black)
    graphic_plane('Skills board categories','skills-board',(sx,sy-.041,1.40),1.31,1.65)
    block(sx,sy,1.55,.82)
    zone('skills','Skills board · forma tu equipo',(3.6,7.2,7.2,10.4),{'x':4.3,'z':-8,'yaw':0},22)

    # Neighboring Energy Corner and photo booth, on the right side of the hall.
    energy = group('Energy Corner goal, mesh net and football')
    graphic_plane('Energy Corner branded backdrop','energy-banner',(14.71,28.5,1.6),4.6,2.7,facing='-X')
    goal_x,goal_y=13.78,28.5
    for dy in [-1.1,1.1]:
        energy.rod((goal_x,goal_y+dy,.03),(goal_x,goal_y+dy,1.10),.035,white,12)
        energy.rod((goal_x,goal_y+dy,.03),(14.35,goal_y+dy,.03),.028,white,10)
        energy.rod((goal_x,goal_y+dy,1.1),(14.35,goal_y+dy,.85),.025,white,10)
    energy.rod((goal_x,goal_y-1.1,1.10),(goal_x,goal_y+1.1,1.10),.035,white,12)
    for k in range(17):
        yy=goal_y-1.1+k*.1375
        energy.rod((14.35,yy,.03),(14.35,yy,.85),.004,white,4)
    for k in range(7):
        zz=.03+k*.137
        energy.rod((14.35,goal_y-1.1,zz),(14.35,goal_y+1.1,zz),.004,white,4)
    for dy in [-1.1,1.1]:
        for k in range(7):
            zz=.03+k*.137
            energy.rod((goal_x,goal_y+dy,zz),(14.35,goal_y+dy,zz*.75),.004,white,4)
    energy.ellipsoid((12.65,28.1,.15),(.15,.15,.15),white)
    for a in [0,math.pi/2,math.pi,math.pi*1.5]:energy.ellipsoid((12.65+.135*math.cos(a),28.1+.135*math.sin(a),.15),(.03,.03,.065),black)
    block(14.07,goal_y,.85,2.35)
    zone('energy','Energy Corner · fútbol',(10.4,14.6,25.4,31),{'x':11,'z':-28.5,'yaw':-math.pi/2},23)

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

    # Existing grey multipane room gains a real doorway and a content setup.
    content=group('Content Hub blue sofas, tables and proposed content light')
    for yy in [17.0,22.0]:
        sofa(content,13.9,yy,blue,width=2.10,angle=-math.pi/2)
        block(13.9,yy,1.03,2.20)
        content.rod((12.2,yy+.35,.03),(12.2,yy+.35,.45),.28,yellow,24)
        block(12.2,yy+.35,.60,.60)
    table(content,12.0,19.65,1.30,.70,.43)
    table(content,13.7,24.0,.70,.65,.56)
    ring_mat=make_material('Content practical soft white light',(.87,.91,1),rough=.4,emit=1.5)
    tripod(content,10.9,21.25,1.50,.32)
    # Ring is a polygonal open circle in the Y/Z plane, facing the sofa.
    for k in range(32):
        a,b=k*math.tau/32,(k+1)*math.tau/32
        content.rod((10.9,21.25+.24*math.cos(a),1.70+.24*math.sin(a)),(10.9,21.25+.24*math.cos(b),1.70+.24*math.sin(b)),.025,ring_mat,6)
    content.box((10.9,21.25,1.65),(.06,.09,.18),black)
    label=letters('Content Hub',(9.92,15.50,2.15),.18,yellow,-math.pi/2)
    label['experienceId']='content-hub'
    zone('content-hub','Content Hub · sala acristalada',(10.25,14.6,12,25),{'x':11.6,'z':-14,'yaw':-.25},25)
    layout['contentHubEntrance']={'x':10,'z':-13.65,'width':2.2,'status':'Approximate doorway; content light is a requested visual addition.'}

    # Trim only zone classification regions; the observed floor remains connected.
    updates={
        'merch':((-13,-5,1,7.9),None,None),
        'buffet':((-4.8,3.3,6.5,14.2),None,None),
        'hack':((-14.5,-5.5,19.5,39.5),{'x':-6,'z':-21,'yaw':.5},None),
        'river':((10.3,14.7,7.4,11.3),None,'Ventanas · costado río'),
        'photo':((6.2,14.6,37.5,44.5),{'x':10,'z':-38,'yaw':0},'Photocall · chill zone'),
    }
    for z in layout['zones']:
        if z['id'] in updates:
            bounds,view,label=updates[z['id']]
            z['polygon']=rect(*bounds)
            if view:z['view']=view
            if label:z['label']=label
    layout['scaleStatus']+=' October 26 games, skills, Energy Corner, photobooth, photocall and Content Hub reconstructed from narrated clips; placements and dimensions estimated.'
    for g in groups:
        obj=g.finish()
        obj['reference']='Narrated October 26 walkthrough; approximate reconstruction.'
    return layout
