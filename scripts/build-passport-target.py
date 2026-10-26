"""Rebuild the canonical tracking artwork without changing the supplied Passport cover."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import random,hashlib,json
ROOT=Path(__file__).resolve().parents[1];ASSETS=ROOT/'dist/assets'
W,H=1000,1200
im=Image.new('RGB',(W,H),'#091b32');d=ImageDraw.Draw(im)
navy='#091b32';gold='#e7c47b';muted='#9bb1c3';white='#f3f1e7';cyan='#62d1cf'
def font(size,bold=False):return ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf' if bold else 'C:/Windows/Fonts/segoeui.ttf',size)
def text(p,t,size=20,fill=white,bold=False):d.text(p,t,font=font(size,bold),fill=fill)
# Fixed, asymmetric architectural details give the tracker distributed features.
r=random.Random(1616)
for side,(x0,x1) in enumerate([(42,233),(767,958)]):
 for k in range(9):
  x=r.randint(x0,x1);y=310+k*77+r.randint(-15,15);radius=r.choice([3,5,7]);d.ellipse((x-radius,y-radius,x+radius,y+radius),outline=gold,width=2)
  if k>0:d.line((last[0],last[1],x,y),fill='#35536c',width=3)
  if k%3==0:d.line((x+12,y,x+36,y-18,x+65,y-18),fill=cyan,width=2)
  last=(x,y)
for k in range(5):
 x=42+k*25;d.line((x,41,x,67+k*13),fill=gold,width=3)
d.rectangle((24,24,975,1175),outline=gold,width=2)
d.rectangle((40,40,959,1159),outline='#27445c',width=1)
text((214,47),'ONE16 / LISBOA',22,muted,True)
text((817,47),'16',27,gold,True)
d.line((64,139,184,139),fill=cyan,width=5)
text((64,161),'STELLAR',36,gold,True)
text((58,199),'Passport',104,white,True)
text((65,329),'EXPLORA TU EXPERIENCIA ESPACIAL',23,muted,True)
cover=Image.open(ASSETS/'passport-cover.jpg').convert('RGB');cover.thumbnail((428,558),Image.Resampling.LANCZOS)
x=(W-cover.width)//2;y=398
d.rounded_rectangle((x-14,y-14,x+cover.width+14,y+cover.height+14),radius=9,fill='#172e47',outline='#587289',width=2)
im.paste(cover,(x,y));d=ImageDraw.Draw(im)
text((65,1003),'ACTIVA TU PASSPORT',33,gold,True)
text((65,1055),'Escanea el QR o acerca tu celular al NFC.',24,white)
text((65,1105),'DEMO INTERACTIVA',19,muted,True)
text((729,1105),'ESPACIO / 01',19,cyan,True)
# Different corner fiducials improve feature distribution without inventing a logo.
for x,y,n in [(74,412,3),(908,412,4),(80,903,5),(904,968,2)]:
 for j in range(n):d.rectangle((x+j*9,y-j*5,x+j*9+4,y-j*5+20),fill=gold)
p=ASSETS/'passport-target.png';im.save(p,optimize=True)
meta={'width':W,'height':H,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'source':'passport-cover.jpg','print':'Use the whole image unchanged; QR goes outside its bounds.'}
(ASSETS/'passport-target.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
print(json.dumps(meta))
