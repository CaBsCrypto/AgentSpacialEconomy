"""Video-grounded games corner: wall screen, giant keyboard and reaction table.

The topology and control counts come from the owner's October 26 clips. Metric
positions remain estimates. Scores reproduce one visible instant, not live play.
This module imports Blender only when building, so its contract can be checked
without starting Blender or rewriting generated assets.
"""
from __future__ import annotations
import math

REFERENCE_CLIPS = ['VID_20261026_021305476.mp4', 'VID_20261026_021331223.mp4', 'VID_20261026_021339259.mp4']
PATTERNS = ['diagonal-weave', 'cross-lattice', 'diamonds', 'scallops', 'chevrons', 'petals', 'honeycomb', 'concentric-arcs', 'diagonal-bands', 'starburst', 'waves', 'stone-cells']


def games_spec():
    """Single construction contract, shared by geometry, collisions and QA."""
    ax, ay = -12.1, 17.25
    buttons=[]
    # A reaction game has short plungers, not joysticks. The five-button row
    # points toward the central start button; the single button is outermost.
    for player,sign,color in [('blue',-1,'blue'),('red',1,'red')]:
        for row,count in enumerate([1,3,5]):
            x=ax+sign*(.70-row*.20)
            for index in range(count):
                y=ay+(index-(count-1)/2)*.177
                buttons.append({'id':f'{player}-{row+1}-{index+1}', 'player':player, 'row':row+1, 'rowCount':count, 'center':[round(x,4),round(y,4),1.015], 'color':color})
    return {
        'coordinateSystem':'Blender Z-up; viewer converts (x,y,z) to (x,z,-y)',
        'dimensionsStatus':'Estimated from narrated video; not field measured',
        'referenceClips':list(REFERENCE_CLIPS),
        'screen':{'center':[-14.78,10.2,1.9], 'size':[.12,2.55,1.42], 'normal':[1,0,0], 'mountedTo':'left masonry wall', 'floorStand':False},
        'keyboard':{'center':[-13.45,10.2,.76], 'width':3.25, 'depth':.99, 'angle':math.pi/2},
        'sofa':{'center':[-11.5,12.55,0], 'width':2.05, 'angle':-math.pi/2, 'front':[-1,0,0], 'looksToward':[-14.78,12.55,.7]},
        'table':{'center':[-12.85,13.2,.44], 'size':[.70,1.80,.055]},
        'grid':{'center':[-14.67,14.9,1.48], 'normal':[1,0,0], 'columns':4, 'rows':3, 'patterns':list(PATTERNS), 'patternStatus':'Twelve distinct reconstructed motifs; exact individual designs estimated'},
        'arcade':{'center':[ax,ay,.45], 'topHeight':.94, 'topSize':[1.80,1.12], 'buttons':buttons, 'buttonType':'short illuminated plunger', 'joystickCount':0,
                  'start':{'center':[ax,ay,1.015], 'label':'START', 'color':'amber'},
                  'scoreLocation':'horizontal tabletop along the same long edge', 'scores':[{'player':'blue','value':'654','center':[ax-.13,ay+.456,.948],'normal':[0,0,1]}, {'player':'red','value':'255','center':[ax+.13,ay+.456,.948],'normal':[0,0,1]}],
                  'scoreStatus':'Recorded visual reference from 021339259 at 8.5 s; not live scoring',
                  'ledBars':[{'center':[ax-.16,ay,.952],'player':'blue'}, {'center':[ax+.16,ay,.952],'player':'red'}],
                  'topView':{'camera':[ax,ay,4.8], 'target':[ax,ay,.94], 'orthographicSpan':2.2}},
        'zone':{'id':'games','label':'Juegos · teclado gigante y arcade','polygon':[[-14.5,-18.8],[-6.8,-18.8],[-6.8,-8.4],[-14.5,-8.4]], 'view':{'x':-7.7,'z':-9.3,'yaw':1.42,'pitch':-.12}, 'reviewSection':21},
    }


def tile_segments(index):
    """Twelve bounded, distinct line motifs on a normalized square tile."""
    lines=[]
    def line(a,b):
        # Tiny margins keep neighboring patterns visually separate.
        if all(abs(v)<=.46 for v in (*a,*b)):lines.append((a,b))
    def ring(radius,segments=12,phase=0):
        for k in range(segments):
            a,b=phase+k*math.tau/segments,phase+(k+1)*math.tau/segments
            line((radius*math.cos(a),radius*math.sin(a)),(radius*math.cos(b),radius*math.sin(b)))
    if index==0:
        for off in [-.32,-.16,0,.16,.32]:line((-.44,off-.10),(.44,off+.10))
        for off in [-.3,0,.3]:line((off-.1,-.44),(off+.1,.44))
    elif index==1:
        for off in [-.3,0,.3]:line((-.44,off),(.44,off));line((off,-.44),(off,.44))
        line((-.44,-.44),(.44,.44));line((-.44,.44),(.44,-.44))
    elif index==2:
        for r in [.15,.30,.44]:
            points=[(0,r),(r,0),(0,-r),(-r,0)]
            for k in range(4):line(points[k],points[(k+1)%4])
    elif index==3:
        for y in [-.34,0,.34]:
            for x in [-.24,.24]:
                for k in range(6):
                    a,b=k*math.pi/6,(k+1)*math.pi/6
                    line((x+.20*math.cos(a),y+.12*math.sin(a)),(x+.20*math.cos(b),y+.12*math.sin(b)))
    elif index==4:
        for y in [-.3,0,.3]:
            points=[(-.44,y+.08),(-.22,y-.08),(0,y+.08),(.22,y-.08),(.44,y+.08)]
            for a,b in zip(points,points[1:]):line(a,b)
    elif index==5:
        ring(.10,12)
        for k in range(8):
            a=k*math.pi/4
            line((.1*math.cos(a),.1*math.sin(a)),(.43*math.cos(a+.17),.43*math.sin(a+.17)))
            line((.43*math.cos(a+.17),.43*math.sin(a+.17)),(.1*math.cos(a+.34),.1*math.sin(a+.34)))
    elif index==6:
        for cx,cy in [(-.23,-.23),(.23,-.23),(0,.12)]:
            for k in range(6):
                a,b=k*math.pi/3,(k+1)*math.pi/3
                line((cx+.21*math.cos(a),cy+.21*math.sin(a)),(cx+.21*math.cos(b),cy+.21*math.sin(b)))
    elif index==7:
        for r in [.13,.25,.37,.44]:
            for k in range(8):
                a,b=k*math.pi/8,(k+1)*math.pi/8
                line((r*math.cos(a),r*math.sin(a)-.18),(r*math.cos(b),r*math.sin(b)-.18))
    elif index==8:
        for off in [-.30,-.10,.10,.30]:line((-.44,off-.13),(.44,off+.13))
    elif index==9:
        for k in range(16):
            a=k*math.tau/16;line((.10*math.cos(a),.10*math.sin(a)),(.44*math.cos(a),.44*math.sin(a)))
        ring(.22,16)
    elif index==10:
        for y in [-.28,0,.28]:
            points=[(-.44+k*.11,y+.06*math.sin(k*math.pi/2)) for k in range(9)]
            for a,b in zip(points,points[1:]):line(a,b)
    else:
        for cx,cy,r in [(-.23,-.22,.16),(.15,-.24,.19),(-.2,.19,.21),(.22,.18,.18)]:
            for k in range(7):
                a,b=k*math.tau/7,(k+1)*math.tau/7
                line((cx+r*math.cos(a),cy+r*math.sin(a)),(cx+r*math.cos(b),cy+r*math.sin(b)))
    return lines


def build_games(layout, Geo, materials, make_material, graphic_plane, palette):
    """Build the corner, close its Geo meshes and register a stable review zone."""
    import bpy
    from furniture import build_sofa
    spec=games_spec();groups=[]
    black,white,steel=palette['black'],palette['white'],palette['steel']
    cabinet=make_material('Games painted dark cabinet',(.025,.028,.030),metal=.25,rough=.5)
    keycap=make_material('Games keyboard off white keycaps',(.87,.88,.84),rough=.55)
    ink=make_material('Games screen and printed dark ink',(.025,.029,.031),rough=.7)
    purple=make_material('Games purple printed tabletop',(.24,.018,.18),rough=.38)
    motif=make_material('Games pale purple hexagon print',(.60,.20,.47),rough=.7)
    led={name:make_material('Arcade LED '+name,color,rough=.3,emit=1.5) for name,color in [('cyan',(.03,.65,1)),('magenta',(.9,.025,.35)),('amber',(1,.30,.015)),('white',(.8,.87,1)),('blue score',(.015,.12,1)),('red score',(1,.015,.025))]}
    def group(name):
        geo=Geo(name);groups.append(geo);return geo
    def block(name,x,y,w,d):
        layout['obstacles'].append({'part':name,'minX':round(x-w/2,4),'maxX':round(x+w/2,4),'minZ':round(-y-d/2,4),'maxZ':round(-y+d/2,4)})
    def text(body,center,size,material,angle=0):
        curve=bpy.data.curves.new(body,'FONT');curve.body=body;curve.size=size;curve.align_x='CENTER';curve.align_y='CENTER';curve.extrude=.0003;curve.resolution_u=1;curve.materials.append(materials[material])
        obj=bpy.data.objects.new('Games top lettering '+body,curve);bpy.context.collection.objects.link(obj);obj.location=center;obj.rotation_euler.z=angle
        return obj
    # Keyboard local width runs along the wall after a +90 degree turn.
    keyboard=group('Games giant keyboard aligned with left wall')
    kx,ky,_=spec['keyboard']['center']
    def kp(u,v,z):return (kx-v,ky+u,z)
    def kb(u,v,z,w,d,h,material):keyboard.box(kp(u,v,z),(d,w,h),material)
    kb(0,0,.76,3.25,.99,.16,white)
    for u in [-1.3,1.3]:
        keyboard.rod(kp(u,-.32,.02),kp(u,.32,.67),.045,cabinet)
        keyboard.rod(kp(u,.32,.02),kp(u,-.32,.67),.045,cabinet)
    for row,keys in enumerate(['1234567890','QWERTYUIOP','ASDFGHJKL','ZXCVBNM']):
        for col,key in enumerate(keys):
            u=-1.43+col*.205+(row%2)*.07;v=.32-row*.185
            kb(u,v,.874,.18,.157,.065,keycap)
            text(key,kp(u,v,.910),.055,ink,math.pi/2)
    kb(-.1,-.405,.874,1.18,.145,.065,keycap)
    for col in range(4):
        for row in range(4):kb(.89+col*.17,.30-row*.18,.874,.145,.15,.065,keycap)
    block('giant-keyboard',kx,ky,1.10,3.35)
    screen=group('Games screen fixed against left masonry wall')
    sx,sy,sz=spec['screen']['center']
    screen.box((sx,sy,sz),(.12,2.55,1.42),cabinet)
    screen.box((sx+.066,sy,sz),(.012,2.4,1.29),ink)
    for dy in [-.7,.7]:screen.box((-14.88,sy+dy,sz),(.08,.10,.35),cabinet)
    block('wall-screen',sx,sy,.25,2.65)
    # The seat faces the shared wall at the midpoint of screen and light grid.
    sofa_spec=spec['sofa']
    root=build_sofa('Games padded sofa facing screen and grid',tuple(sofa_spec['center']),width=sofa_spec['width'],material=materials[black],angle=sofa_spec['angle'])
    root['reference']='021305476 at12-16s;021339259 at13.8-17.2s; owner requested wall-facing orientation'
    root['games_part']='wall-facing-sofa';root['front_world']=sofa_spec['front']
    block('wall-facing-sofa',-11.5,12.55,1.07,2.12)
    chill=group('Games coffee table and black beanbags')
    tx,ty,tz=spec['table']['center'];chill.box((tx,ty,tz),tuple(spec['table']['size']),white)
    for dx in [-.25,.25]:
        for dy in [-.78,.78]:chill.rod((tx+dx,ty+dy,.02),(tx+dx,ty+dy,tz-.03),.022,steel)
    block('coffee-table',tx,ty,.76,1.86)
    for x,y in [(-13.65,16),(-10.15,17.65)]:
        chill.ellipsoid((x,y,.34),(.57,.58,.35),black);chill.ellipsoid((x,y+.18,.64),(.44,.44,.48),black);block('black-beanbag',x,y,1.18,1.2)
    # 4x3 cells retain separate geometric patterns, not uniform colored blocks.
    grid=group('Games four by three distinct patterned luminous panel')
    grid.box((-14.67,14.9,1.48),(.14,1.72,1.45),cabinet)
    grid.box((-14.62,14.9,.36),(.25,1.60,.65),cabinet)
    for row in range(3):
        for col in range(4):
            index=row*4+col;y=14.27+col*.42;z=.99+row*.43
            grid.box((-14.58,y,z),(.025,.35,.35),led[['cyan','magenta','white'][(row+col)%3]])
            for (u0,v0),(u1,v1) in tile_segments(index):
                grid.rod((-14.563,y+u0*.35,z+v0*.35),(-14.563,y+u1*.35,z+v1*.35),.0028,ink,5)
    block('patterned-light-grid',-14.62,14.9,.30,1.8)
    # Reaction table: low plunger caps, not sticks or joystick balls.
    arcade=group('Games arcade eighteen reaction plungers and hexagon tabletop')
    ax,ay,_=spec['arcade']['center']
    arcade.box((ax,ay,.49),(1.65,1.0,.70),cabinet)
    arcade.box((ax,ay,.90),(1.80,1.12,.08),purple)
    for dx in [-.82,.82]:
        for dy in [-.50,.50]:
            arcade.rod((ax+dx,ay+dy,.03),(ax+dx,ay+dy,.88),.055,cabinet,12)
            arcade.rod((ax+dx,ay+dy,.19),(ax+dx,ay+dy,.82),.022,led['cyan' if dx<0 else 'magenta'],10)
    for dy in [-.56,.56]:arcade.rod((ax-.89,ay+dy,.943),(ax+.89,ay+dy,.943),.010,led['cyan'],8)
    for dx in [-.90,.90]:arcade.rod((ax+dx,ay-.55,.943),(ax+dx,ay+.55,.943),.010,led['magenta'],8)
    for ix in range(8):
        for iy in range(4):
            cx=ax-.79+ix*.22;cy=ay-.43+iy*.27+(ix%2)*.06
            for k in range(6):
                a,b=k*math.pi/3,(k+1)*math.pi/3
                arcade.rod((cx+.086*math.cos(a),cy+.086*math.sin(a),.944),(cx+.086*math.cos(b),cy+.086*math.sin(b),.944),.0023,motif,4)
    for b in spec['arcade']['buttons']:
        x,y,_=b['center'];ring=led['cyan' if b['player']=='blue' else 'magenta']
        arcade.rod((x,y,.944),(x,y,.978),.065,ring,20)
        arcade.rod((x,y,.977),(x,y,1.025),.050,ink,24)
        # A few active caps reproduce the visual state without simulating play.
        if b['row']==2:arcade.rod((x,y,1.025),(x,y,1.029),.046,led['white' if b['player']=='blue' else 'amber'],24)
    arcade.rod((ax,ay,.944),(ax,ay,.99),.080,cabinet,24)
    arcade.rod((ax,ay,.99),(ax,ay,1.035),.064,led['amber'],24)
    text('START',(ax,ay,1.038),.029,white)
    for bar in spec['arcade']['ledBars']:
        x,y,z=bar['center']
        for k in range(9):
            arcade.rod((x,y-.275+k*.06875,z),(x,y-.275+k*.06875,z+.007),.012,led['cyan' if bar['player']=='blue' else 'amber'],12)
    # Actual seven-segment geometry sits horizontally on the tabletop.
    glyphs={'0':'ab cdef'.replace(' ',''),'1':'bc','2':'abdeg','3':'abcdg','4':'bcfg','5':'acdfg','6':'acdefg','7':'abc','8':'abcdefg','9':'abcdfg'}
    segments={'a':(0,.044,.043,.008),'b':(.025,.024,.008,.033),'c':(.025,-.024,.008,.033),'d':(0,-.044,.043,.008),'e':(-.025,-.024,.008,.033),'f':(-.025,.024,.008,.033),'g':(0,0,.043,.008)}
    for score in spec['arcade']['scores']:
        x,y,z=score['center'];arcade.box((x,y,z),(.205,.152,.009),ink)
        for index,digit in enumerate(score['value']):
            cx=x+(index-1)*.067
            for segment in glyphs[digit]:
                dx,dy,w,h=segments[segment]
                arcade.box((cx+dx,y+dy,z+.007),(w,h,.003),led[score['player']+' score'])
    block('reaction-arcade',ax,ay,1.90,1.24)
    for g in groups:
        obj=g.finish();obj['games_part']=g.name;obj['reference']='; '.join(REFERENCE_CLIPS);obj['dimensions_status']=spec['dimensionsStatus']
    zone=dict(spec['zone']);zone['evidence']='October26 narrated games footage; topology observed, dimensions estimated.'
    existing=next((z for z in layout['zones'] if z['id']=='games'),None)
    if existing:existing.update(zone)
    else:layout['zones'].append(zone)
    layout['games']=spec
    return layout
