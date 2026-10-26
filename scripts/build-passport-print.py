"""Generate separate QR + A3 print from the canonical unchanged tracking image."""
from pathlib import Path
import argparse,json,sys
from PIL import Image,ImageDraw
from reportlab.graphics.barcode import qrencoder
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from urllib.parse import urlparse
ROOT=Path(__file__).resolve().parents[1];assets=ROOT/'dist/assets'
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('origin',help='Public HTTPS origin serving ONE16')
parser.add_argument('--stable',action='store_true',help='Use a stable deployed URL instead of a temporary tunnel')
args=parser.parse_args()
base=args.origin.rstrip('/')
if urlparse(base).scheme!='https' or not urlparse(base).netloc:raise ValueError('Supply the public HTTPS origin')
url=base+'/passport-station.html'
q=qrencoder.QRCode(version=None,errorCorrectLevel=qrencoder.QRErrorCorrectLevel.M);q.addData(url);q.make();n=q.getModuleCount();quiet=4;size=(n+2*quiet)*12
im=Image.new('RGB',(size,size),'white');d=ImageDraw.Draw(im)
for y in range(n):
 for x in range(n):
  if q.isDark(y,x):d.rectangle(((x+quiet)*12,(y+quiet)*12,(x+quiet+1)*12-1,(y+quiet+1)*12-1),fill='#091b32')
im.save(assets/'passport-qr.png')
rects=''.join(f'<rect x="{x+quiet}" y="{y+quiet}" width="1" height="1"/>' for y in range(n) for x in range(n) if q.isDark(y,x))
(assets/'passport-qr.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n+8} {n+8}"><rect width="100%" height="100%" fill="white"/><g fill="#091b32">{rects}</g></svg>',encoding='utf-8')
(assets/'passport-access.json').write_text(json.dumps({'url':url,'origin':base,'temporary':not args.stable,'immersiveUrl':base+'/?passport=stand16#recorrido','arUrl':base+'/passport-space.html','nfcRecordType':'NDEF URI','note':'This QR opens the Passport station with two choices.' if args.stable else 'This QR expires when the local HTTPS tunnel stops.'},indent=2),encoding='utf-8')
pdfmetrics.registerFont(TTFont('Segoe','C:/Windows/Fonts/segoeui.ttf'));pdfmetrics.registerFont(TTFont('SegoeBold','C:/Windows/Fonts/segoeuib.ttf'))
pdf=canvas.Canvas(str(assets/'passport-poster-a3.pdf'),pagesize=(297*mm,420*mm));pdf.setTitle('Stellar Passport AR - lamina A3 de prueba')
pdf.setFillColorRGB(.035,.106,.196);pdf.rect(0,0,297*mm,420*mm,fill=1,stroke=0)
pdf.setFillColorRGB(.91,.77,.48);pdf.setFont('SegoeBold',17);pdf.drawString(28.5*mm,398*mm,'STELLAR PASSPORT / AR')
pdf.setFont('Segoe',10);pdf.setFillColorRGB(.9,.94,.96);pdf.drawString(28.5*mm,389*mm,'Stand 16 · reverso Trustless Work / Grantfox · ONE16')
pdf.drawImage(str(assets/'passport-target.png'),28.5*mm,90*mm,width=240*mm,height=288*mm)
pdf.drawImage(str(assets/'passport-qr.png'),28.5*mm,24*mm,width=50*mm,height=50*mm)
pdf.setFillColorRGB(.91,.77,.48);pdf.setFont('SegoeBold',13);pdf.drawString(87*mm,66*mm,'1  Escanea el QR en tu celular')
pdf.setFillColorRGB(.9,.94,.96);pdf.setFont('Segoe',11);pdf.drawString(87*mm,55*mm,'2  Elige entrar a ONE16 o ver Passport en AR')
pdf.drawString(87*mm,45*mm,'3  En AR, colócalo una vez en una superficie')
qr_note='QR / NFC: la misma URL de acceso.' if args.stable else 'QR temporal de prueba.'
pdf.setFont('Segoe',8);pdf.drawString(28.5*mm,16*mm,qr_note+' Imprimir A3 al 100 %, en papel mate, sin recortar la gráfica.')
pdf.setFont('Segoe',7);pdf.drawString(28.5*mm,10*mm,url)
pdf.showPage();pdf.save();print(url)
