"""Deterministic editable venue artwork + PBR maps, reconstructed from private
venue reference videos without embedding footage, faces or workshop writing.
Run with Python, Pillow and numpy. SVGs and this script are editable sources.
"""
from __future__ import annotations
import argparse, hashlib, json, math
from pathlib import Path
from xml.sax.saxutils import escape
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
YELLOW="#f1d41b"; DARK="#171c1c"; WHITE="#f3f1df"
FONTS=[Path("C:/Windows/Fonts/arialbd.ttf"),Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")]

class Canvas:
    """Draw PNG and editable SVG together, with identical geometry."""
    def __init__(self,w,h,bg=DARK):
        self.w,self.h=int(w),int(h);self.image=Image.new("RGB",(self.w,self.h),bg);self.draw=ImageDraw.Draw(self.image)
        self.svg=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">',f'<rect width="100%" height="100%" fill="{bg}"/>']
    def rect(self,box,fill,stroke=None,width=1):
        x,y,xx,yy=map(float,box);self.draw.rectangle((x,y,xx,yy),fill=fill,outline=stroke,width=max(1,int(width)))
        self.svg.append(f'<rect x="{x:g}" y="{y:g}" width="{xx-x:g}" height="{yy-y:g}" fill="{fill or "none"}" stroke="{stroke or "none"}" stroke-width="{width:g}"/>')
    def poly(self,pts,fill,stroke=None,width=1):
        pts=[(float(x),float(y)) for x,y in pts];self.draw.polygon(pts,fill=fill)
        if stroke:self.draw.line(pts+[pts[0]],fill=stroke,width=max(1,int(width)),joint="curve")
        p=" ".join(f"{x:g},{y:g}" for x,y in pts)
        self.svg.append(f'<polygon points="{p}" fill="{fill or "none"}" stroke="{stroke or "none"}" stroke-width="{width:g}"/>')
    def line(self,pts,fill=DARK,width=3):
        pts=[(float(x),float(y)) for x,y in pts];self.draw.line(pts,fill=fill,width=max(1,int(width)),joint="curve")
        p=" ".join(f"{x:g},{y:g}" for x,y in pts)
        self.svg.append(f'<polyline points="{p}" fill="none" stroke="{fill}" stroke-width="{width:g}" stroke-linecap="round" stroke-linejoin="round"/>')
    def ellipse(self,box,fill,stroke=None,width=1):
        x,y,xx,yy=map(float,box);self.draw.ellipse((x,y,xx,yy),fill=fill,outline=stroke,width=max(1,int(width)))
        self.svg.append(f'<ellipse cx="{(x+xx)/2:g}" cy="{(y+yy)/2:g}" rx="{(xx-x)/2:g}" ry="{(yy-y)/2:g}" fill="{fill or "none"}" stroke="{stroke or "none"}" stroke-width="{width:g}"/>')
    def text(self,body,box,fill=DARK,size=60,align="center"):
        x,y,xx,yy=box;font_path=next((p for p in FONTS if p.exists()),None)
        while True:
            font=ImageFont.truetype(str(font_path),max(7,int(size))) if font_path else ImageFont.load_default(size=max(7,int(size)))
            bb=self.draw.multiline_textbbox((0,0),body,font=font,spacing=int(size*.12),align=align)
            if size<=7 or (bb[2]-bb[0]<=xx-x-4 and bb[3]-bb[1]<=yy-y-4):break
            size-=1
        tx=x+((xx-x)-(bb[2]-bb[0]))/2-bb[0] if align=="center" else x-bb[0]
        ty=y+((yy-y)-(bb[3]-bb[1]))/2-bb[1]
        self.draw.multiline_text((tx,ty),body,font=font,fill=fill,spacing=int(size*.12),align=align)
        lines=body.splitlines();step=size*1.12
        for i,line in enumerate(lines):
            lx=x+(xx-x-self.draw.textlength(line,font=font))/2 if align=="center" else x
            ly=y+(yy-y-len(lines)*step)/2+size+i*step
            self.svg.append(f'<text x="{lx:g}" y="{ly:g}" fill="{fill}" font-family="Arial,DejaVu Sans,sans-serif" font-weight="700" font-size="{size:g}">{escape(line)}</text>')
    def vertical(self,body,box,fill=YELLOW,bg=DARK,size=200):
        x,y,xx,yy=map(int,box);part=Canvas(yy-y,xx-x,bg);part.text(body,(0,0,part.w,part.h),fill,size)
        self.image.paste(part.image.rotate(-90,expand=True),(x,y))
        self.svg.append(f'<g transform="translate({xx},{y}) rotate(90)">')
        self.svg.extend(part.svg[1:]);self.svg.append("</g>")
    def save(self,folder,key):
        folder.mkdir(parents=True,exist_ok=True);self.image.save(folder/(key+".png"),optimize=True)
        (folder/(key+".svg")).write_text("\n".join(self.svg+["</svg>"]),encoding="utf-8")

def meridian(c,x,y,s,col=DARK):
    c.poly([(x,y),(x+s*.5,y+s*.29),(x+s,y),(x+s,y+s*.19),(x+s*.5,y+s*.49),(x,y+s*.19)],col)
    c.poly([(x,y+s*.29),(x+s*.32,y+s*.48),(x,y+s*.69)],col)
    c.poly([(x+s,y+s*.29),(x+s*.68,y+s*.48),(x+s,y+s*.69)],col)

def stellar(c,x,y,s,col=DARK):
    c.ellipse((x+s*.16,y,x+s*.84,y+s*.68),None,col,max(2,s*.055))
    c.line([(x,y+s*.44),(x+s,y+s*.1)],col,s*.075);c.line([(x,y+s*.63),(x+s,y+s*.29)],col,s*.075)

def brand(c,x,y,w,h,kind="meridian",col=DARK):
    if kind=="stellar":
        stellar(c,x,y+h*.23,h*.75,col);c.text("Stellar",(x+h*.85,y,x+w,y+h),col,h*.52,"left")
    elif kind=="year":
        stellar(c,x,y+h*.2,h*.65,col);meridian(c,x+h*.68,y+h*.24,h*.63,col);c.text("26",(x+h*1.4,y,x+w,y+h),col,h*.66,"left")
    else:
        meridian(c,x,y+h*.2,h*.8,col);c.text("Hack\nMeridian",(x+h*.95,y,x+w,y+h),col,h*.42,"left")

def flower(c,x,y,r,col=YELLOW):
    for i in range(8):
        a=i*math.pi/4;xx=x+math.cos(a)*r*.57;yy=y+math.sin(a)*r*.57
        c.ellipse((xx-r*.38,yy-r*.38,xx+r*.38,yy+r*.38),col,DARK,max(1,r*.05))
    c.ellipse((x-r*.26,y-r*.26,x+r*.26,y+r*.26),DARK)

def hack_flower(c,x,y,r,col=DARK):
    for i in range(8):
        a=i*math.pi/4
        c.poly([(x+math.cos(a-.19)*r*.34,y+math.sin(a-.19)*r*.34),(x+math.cos(a-.18)*r,y+math.sin(a-.18)*r),(x+math.cos(a+.18)*r,y+math.sin(a+.18)*r),(x+math.cos(a+.19)*r*.34,y+math.sin(a+.19)*r*.34)],col)

def come_move(c,box,col=YELLOW):
    c.text("COME\nMOVE\nWITH\nUS",box,col,(box[3]-box[1])*.26)

def repeated_backdrop(w=2048,h=1280,split=False):
    c=Canvas(w,h,YELLOW)
    if split:c.rect((0,0,w*.5,h),DARK)
    for row in range(7 if split else 4):
        y=h*(.045+row*.132) if split else h*[.045,.18,.73,.865][row]
        for col in range(6):
            x=w*(.035+col*.16)
            brand(c,x,y,w*.135,h*.065,["year","stellar","meridian"][(row+col)%3],YELLOW if split and col<3 else DARK)
    if split:
        c.text("Made to\nMove",(w*.02,h*.75,w*.48,h*.98),YELLOW,h*.19)
        brand(c,w*.55,h*.43,w*.42,h*.13);c.text("2026 LISBON",(w*.68,h*.56,w*.94,h*.6),DARK,h*.027)
    else:
        brand(c,w*.255,h*.405,w*.33,h*.145);c.text("/ 2026\n   LISBON",(w*.595,h*.40,w*.78,h*.56),DARK,h*.065)
    return c

def draw_lisbon(w=1024,h=960,title=True):
    """Authored vector reconstruction of legible illustrated motifs."""
    c=Canvas(w,h,DARK);sx=w/1024;sy=h/1536;rng=np.random.default_rng(20261026)
    for _ in range(110):
        flower(c,float(rng.uniform(15,w-15)),float(rng.uniform(25,h-15)),float(rng.uniform(7,20))*sx,YELLOW if rng.random()>.4 else WHITE)
    if title:c.text("MADE TO MOVE",(w*.025,6,w*.975,h*.105),YELLOW,h*.09)
    sun_y=h*(.23 if title else .12);r=w*.105
    for i in range(20):
        a=i*math.pi/10;c.poly([(w*.5+math.cos(a-.075)*r,sun_y+math.sin(a-.075)*r),(w*.5+math.cos(a)*r*1.47,sun_y+math.sin(a)*r*1.47),(w*.5+math.cos(a+.075)*r,sun_y+math.sin(a+.075)*r)],YELLOW,DARK,3*sx)
    c.ellipse((w*.5-r,sun_y-r,w*.5+r,sun_y+r),YELLOW,DARK,5*sx)
    for ex,ey in [(w*.46,sun_y),(w*.54,sun_y),(w*.5,sun_y-r*.48)]:
        c.ellipse((ex-w*.027,ey-w*.014,ex+w*.027,ey+w*.014),WHITE,DARK,3*sx);c.ellipse((ex-w*.009,ey-w*.013,ex+w*.009,ey+w*.013),DARK)
    c.line([(w*.477,sun_y+r*.42),(w*.523,sun_y+r*.42)],DARK,5*sx)
    for x,flip in [(w*.22,1),(w*.78,-1)]:
        y=sun_y-w*.03;c.poly([(x,y),(x-flip*w*.095,y-w*.058),(x-flip*w*.04,y+w*.024),(x-flip*w*.073,y+w*.074),(x,y+w*.041),(x+flip*w*.05,y+w*.01)],WHITE,DARK,3*sx)
    river_top=h*.36;river_bottom=h*.57;c.rect((w*.06,river_top,w*.94,river_bottom),DARK)
    for j in range(24):
        y=river_top+(river_bottom-river_top)*j/24
        for k in range(4):
            x=w*(.06+k*.23)+(j%2)*w*.025;c.line([(x,y),(x+w*.16,y-3*sy)],WHITE,3*sx)
    bridge_y=h*.365;c.line([(w*.1,bridge_y),(w*.86,bridge_y)],WHITE,10*sx)
    for x in [w*.32,w*.66]:c.rect((x-w*.013,bridge_y-h*.10,x+w*.013,bridge_y+h*.035),WHITE,DARK,3*sx)
    cable=[]
    for i in range(31):
        x=w*(.1+.76*i/30);y=bridge_y-h*.085+h*.065*math.sin(math.pi*i/30);cable.append((x,y));c.line([(x,y),(x,bridge_y)],WHITE,2*sx)
    c.line(cable,WHITE,5*sx)
    for x,y,sz in [(w*.45,h*.47,w*.12),(w*.7,h*.51,w*.10),(w*.23,h*.50,w*.065)]:
        c.poly([(x,y),(x,y-sz),(x+sz*.65,y)],YELLOW,DARK,4*sx);c.poly([(x-sz*.6,y+5*sy),(x+sz*.85,y+5*sy),(x+sz*.5,y+sz*.18),(x-sz*.4,y+sz*.18)],WHITE,DARK,3*sx)
    tx=w*.82;ty=h*.43;c.rect((tx-w*.04,ty-h*.07,tx+w*.04,ty+h*.06),WHITE,DARK,4*sx);c.rect((tx-w*.07,ty-h*.085,tx+w*.07,ty-h*.065),WHITE,DARK,4*sx)
    for dx in [-.055,-.02,.02,.055]:c.rect((tx+w*dx-6*sx,ty-h*.10,tx+w*dx+6*sx,ty-h*.08),WHITE,DARK,2*sx)
    for z in [ty-h*.035,ty+h*.005]:c.rect((tx-8*sx,z-10*sy,tx+8*sx,z+10*sy),DARK)
    for side in [-1,1]:
        for i in range(5):
            bw=w*(.20-.021*i);x=w*.5+side*w*(.42-.072*i);y=h*(.63-.026*i);bh=h*(.23-.019*i);col=YELLOW if i%2==0 else WHITE
            c.rect((x-bw/2,y-bh/2,x+bw/2,y+bh/2),col,DARK,5*sx);c.poly([(x-bw*.58,y-bh/2),(x,y-bh*.68),(x+bw*.58,y-bh/2)],DARK,WHITE,3*sx)
            for wi in [-.25,.25]:
                for row in range(3):
                    wx=x+bw*wi;wy=y-bh*.27+row*bh*.22;c.rect((wx-bw*.075,wy-bh*.055,wx+bw*.075,wy+bh*.055),DARK,WHITE,2*sx)
    tram_x=w*.50;tram_y=h*.735;tw=w*.32;th=h*.20
    c.poly([(w*.10,h*.99),(tram_x-tw*.35,tram_y+th*.5),(tram_x+tw*.35,tram_y+th*.5),(w*.85,h*.99)],WHITE,DARK,5*sx)
    for f in [.33,.66]:c.line([(w*(.1+.75*f),h*.99),(tram_x+tw*(f-.5)*.7,tram_y+th*.45)],DARK,7*sx)
    c.rect((tram_x-tw*.52,tram_y-th*.5,tram_x+tw*.52,tram_y+th*.47),YELLOW,DARK,7*sx);c.rect((tram_x-tw*.45,tram_y-th*.59,tram_x+tw*.45,tram_y-th*.45),WHITE,DARK,5*sx)
    for i in range(3):
        xx=tram_x+tw*(-.34+i*.34);c.rect((xx-tw*.125,tram_y-th*.4,xx+tw*.125,tram_y+th*.015),DARK,WHITE,5*sx)
    c.line([(tram_x-tw*.49,tram_y+th*.08),(tram_x+tw*.49,tram_y+th*.08)],DARK,5*sx);c.ellipse((tram_x-tw*.055,tram_y+th*.22,tram_x+tw*.055,tram_y+th*.31),WHITE,DARK,4*sx)
    for side in [-1,1]:
        x=tram_x+side*tw*.30;c.ellipse((x-13*sx,tram_y+th*.32,x+13*sx,tram_y+th*.40),DARK)
    for x,y,r in [(w*.12,h*.91,w*.09),(w*.86,h*.92,w*.10),(w*.25,h*.97,w*.075)]:flower(c,x,y,r,WHITE)
    fx=w*.76;fy=h*.94;c.ellipse((fx-w*.12,fy-h*.025,fx+w*.08,fy+h*.025),WHITE,DARK,4*sx);c.poly([(fx+w*.07,fy),(fx+w*.15,fy-h*.04),(fx+w*.15,fy+h*.04)],YELLOW,DARK,4*sx);c.ellipse((fx-w*.08,fy-5*sy,fx-w*.066,fy+5*sy),DARK)
    if title:
        c.rect((w*.64,h*.925,w*.985,h*.99),DARK);brand(c,w*.66,h*.935,w*.30,h*.044,col=WHITE)
    return c

def draw_photocall():
    c=Canvas(2048,768,WHITE);cw=256;ch=256
    motifs=["flower","blank","hack","hands","flower","blank","hack","hands","can","come","blank","flower","can","come","blank","flower","hands","hack","blank","blank","hands","hack","blank","blank"]
    for i,motif in enumerate(motifs):
        col=i%8;row=i//8;x=col*cw;y=row*ch;bg=[WHITE,DARK,YELLOW,DARK][(col+row*3)%4];ink=YELLOW if bg==DARK else DARK
        c.rect((x,y,x+cw,y+ch),bg);brand(c,x+10,y+8,cw*.33,22,col=ink)
        if motif=="flower":
            hack_flower(c,x+cw*.5,y+ch*.56,cw*.25,ink)
            for txt,xx,yy in [("A",.35,.22),("C",.65,.22),("H",.17,.43),("K",.83,.43)]:c.text(txt,(x+cw*(xx-.08),y+ch*yy,x+cw*(xx+.08),y+ch*(yy+.1)),ink,23)
        elif motif=="come":come_move(c,(x+15,y+ch*.14,x+cw-15,y+ch*.88),ink)
        elif motif=="hack":
            c.text("Meridian",(x+15,y+ch*.16,x+cw-15,y+ch*.29),ink,21);c.text("Hack",(x+12,y+ch*.25,x+cw-12,y+ch*.82),ink,88)
            for j in range(10):
                xx=x+27+j*20;c.line([(xx,y+ch*.63),(xx,y+ch*.86)],ink,2)
        elif motif=="hands":
            c.text("H A C K",(x+15,y+ch*.12,x+cw-15,y+ch*.26),ink,25)
            for j in range(6):
                xx=x+cw*(.25+(j%3)*.25);yy=y+ch*(.4+(j//3)*.3)
                c.poly([(xx-14,yy+18),(xx-19,yy-4),(xx-8,yy-21),(xx-2,yy-6),(xx+6,yy-25),(xx+13,yy-9),(xx+21,yy-20),(xx+22,yy+3),(xx+9,yy+21)],ink)
        elif motif=="can":
            c.text("H A C K",(x+12,y+ch*.13,x+cw-12,y+ch*.25),ink,23);c.rect((x+cw*.25,y+ch*.34,x+cw*.75,y+ch*.78),WHITE,DARK,4);c.ellipse((x+cw*.25,y+ch*.3,x+cw*.75,y+ch*.4),DARK,WHITE,3);c.line([(x+cw*.27,y+ch*.62),(x+cw*.73,y+ch*.62)],YELLOW,10);meridian(c,x+cw*.40,y+ch*.66,cw*.20,DARK)
    return c

def write_graphics(folder):
    images={};c=Canvas(2048,422,YELLOW);c.text("Check-in & Info Desk",(50,20,1630,265),DARK,160);hack_flower(c,1830,140,90,DARK);brand(c,1710,230,280,55)
    c.rect((0,300,2048,422),DARK)
    for txt,x0,x1 in [("Mentors & Judges",90,1030),("Hackers",1230,1910)]:
        c.text(txt,(x0,310,x1-70,412),YELLOW,70);c.line([(x1-35,328),(x1-35,389)],YELLOW,8);c.line([(x1-58,366),(x1-35,389),(x1-12,366)],YELLOW,8)
    images["checkin-sign"]=c;images["checkin-backdrop"]=repeated_backdrop(1536,1400,True)
    c=Canvas(1536,896,DARK);c.rect((0,0,245,896),YELLOW);c.rect((1291,0,1536,896),YELLOW);come_move(c,(290,55,1246,850),YELLOW)
    for x in [0,1291]:
        c.vertical("Energy Corner",(x+35,155,x+210,695),WHITE,YELLOW,100);brand(c,x+20,20,205,53);c.text("Made to\nMove",(x+20,715,x+225,875),DARK,74)
    images["energy-banner"]=c;images["lisbon-mural"]=draw_lisbon();images["photocall"]=draw_photocall();images["stage-backdrop"]=repeated_backdrop();images["stage-flank"]=draw_lisbon(768,1536,False)
    c=Canvas(512,2048,DARK);brand(c,45,35,425,130,col=YELLOW);c.text("Made to",(30,230,482,430),YELLOW,112);c.vertical("Move",(25,450,487,1780),YELLOW,DARK,450);brand(c,80,1860,350,100,"stellar",YELLOW);images["move-banner"]=c
    c=Canvas(768,1024,"#ecece2");c.rect((8,8,760,1016),"#f4f4e9",DARK,6)
    # Blank sheets and colored shapes preserve visual appearance, not private writing.
    for x,y in [(90,120),(420,180),(145,490),(430,570)]:c.rect((x,y,x+220,y+290),WHITE,"#d0d2c7",3)
    for i in range(21):
        x=95+(i%7)*82;y=190+(i//7)*262;c.ellipse((x,y,x+34,y+34),YELLOW)
    for x,y,col in [(75,92,"#4fa5ce"),(575,130,"#de8641"),(160,750,"#81ba8b"),(510,650,"#edb836")]:c.rect((x,y,x+70,y+78),col)
    images["skills-board"]=c
    labels={"grantfox-trustless":"Grantfox\nTrustless Work","drips":"DRIPS","guava":"GUAVA","passport":"Stellar\nPassport","57blocks":"57BLOCKS","defindex-soroswap":"DeFindex\nSoroswap","aha":"THE AHA\nCOMPANY","openzeppelin":"OpenZeppelin"}
    for key,label in labels.items():
        c=Canvas(1024,1536,DARK);c.text(label,(55,95,969,730),WHITE,175);c.line([(60,1310),(964,1310)],"#4a4c47",2)
        for j in range(3):brand(c,54+j*326,1380,285,70,"meridian" if j%2==0 else "stellar",WHITE)
        images["booth-"+key]=c
    c=Canvas(2048,256,DARK)
    for i in range(6):brand(c,25+i*340,60,295,110,"stellar" if i%2 else "meridian",WHITE)
    images["booth-footer"]=c
    for key,canvas in images.items():canvas.save(folder,key)
    return {key:{"color":f"graphics/{key}.png","source":f"graphics/{key}.svg","width":canvas.w,"height":canvas.h} for key,canvas in images.items()}

def noise(rng,size,small):
    # Integer-frequency waves repeat exactly at the UV tile boundary.
    yy,xx=np.mgrid[0:size,0:size].astype(np.float32)/size
    field=np.zeros((size,size),dtype=np.float32)
    for _ in range(22):
        fx=int(rng.integers(1,small+1));fy=int(rng.integers(0,small+1))
        field+=np.sin(math.tau*(fx*xx+fy*yy)+float(rng.uniform(0,math.tau)))/math.sqrt(fx+fy)
    return (field-field.min())/max(float(field.max()-field.min()),.001)

def write_materials(folder,size):
    folder.mkdir(parents=True,exist_ok=True);rng=np.random.default_rng(16026);yy,xx=np.mgrid[0:size,0:size].astype(np.float32)/size
    low=noise(rng,size,32);fine=noise(rng,size,256);grain=(np.sin(math.tau*(xx*94+np.sin(yy*math.tau)*1.7))*.5+.5)
    wood=.52+.10*low+.11*grain+.06*fine;weave=(np.cos(xx*math.tau*128)*np.cos(yy*math.tau*128)*.5+.5)
    mortar=np.minimum(np.abs(np.sin(yy*math.pi*8)),np.abs(np.sin((xx+(np.floor(yy*8)%2)*.5)*math.pi*4)))
    definitions={"wood":(wood,.69,.16),"masonry":(.70+.14*low+.10*fine-.16*(mortar<.045),.92,.23),"textile":(.72+.08*weave+.09*fine,.90,.16),"painted-metal":(.82+.04*low+.035*fine,.53,.07)}
    manifest={}
    for key,(height,rough,amount) in definitions.items():
        color=np.stack([height*1.03,height*1.01,height*.96],axis=2)
        Image.fromarray(np.uint8(np.clip(color,0,1)*255)).save(folder/(key+"-color.jpg"),quality=87,subsampling=0,optimize=True)
        # Replace only this generator's obsolete lossless runtime color exports.
        obsolete=folder/(key+"-color.png")
        if obsolete.is_file():obsolete.unlink()
        detail_size=max(256,size//2)
        detail=lambda im:im.resize((detail_size,detail_size),Image.Resampling.LANCZOS)
        detail(Image.fromarray(np.uint8(np.clip(rough+(height-height.mean())*.19,.12,1)*255))).save(folder/(key+"-roughness.png"),optimize=True)
        dx=(np.roll(height,-1,axis=1)-np.roll(height,1,axis=1))*amount;dy=(np.roll(height,-1,axis=0)-np.roll(height,1,axis=0))*amount
        normal=np.stack([-dx,-dy,np.ones_like(dx)],axis=2);normal/=np.linalg.norm(normal,axis=2,keepdims=True)
        detail(Image.fromarray(np.uint8(np.clip(normal*.5+.5,0,1)*255))).save(folder/(key+"-normal.png"),optimize=True)
        manifest[key]={"color":f"materials/{key}-color.jpg","roughness":f"materials/{key}-roughness.png","normal":f"materials/{key}-normal.png","colorSize":size,"detailSize":detail_size}
    return manifest

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--output",type=Path,default=ROOT/"model"/"textures");p.add_argument("--size",type=int,default=1024,choices=[512,1024]);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
    graphics=write_graphics(a.output/"graphics");materials=write_materials(a.output/"materials",a.size)
    manifest={"version":1,"generator":"scripts/generate-venue-appearance.py","seed":16026,
        "provenance":"Authored procedural reconstruction from the owner's narrated venue videos, 2026-10-26. No raw footage, attendee likenesses or workshop writing embedded. Observed venue marks identify signage; no affiliation implied.",
        "graphicEvidence":{"checkin":["VID_20261026_021823025.mp4"],"energy":["VID_20261026_021930226.mp4"],"stage":["VID_20261026_022050141.mp4"],"photocall":["VID_20261026_022127885.mp4"],"booths":["VID_20261025_210243989.mp4","VID_20261026_021119922.mp4"],"skills":["VID_20261026_021853331.mp4"]},
        "graphics":graphics,"materials":materials}
    files=sorted(a.output.rglob("*.png"))+sorted(a.output.rglob("*.jpg"))+sorted(a.output.rglob("*.svg"));manifest["sha256"]={str(f.relative_to(a.output)).replace("\\","/"):hashlib.sha256(f.read_bytes()).hexdigest() for f in files}
    (a.output/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"output":str(a.output),"graphics":len(graphics),"materials":len(materials),"files":len(files)}))
if __name__=="__main__":main()

