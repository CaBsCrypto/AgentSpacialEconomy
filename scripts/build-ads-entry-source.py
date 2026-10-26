"""Reproducible source QR matrix and A5 PDF for the main-stage entry.
Run with the bundled Python (ReportLab/Pillow) after build-ads-entry.mjs --artwork-only.
No wallet, browser or network access is used.
"""
from pathlib import Path
import json,sys
from reportlab.graphics.barcode import qrencoder
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
ROOT=Path(__file__).resolve().parents[1]
URL='https://agenticreality.space/ads?placement=main_stage_screen'
source=ROOT/'media/ads-entry';source.mkdir(parents=True,exist_ok=True)
q=qrencoder.QRCode(version=None,errorCorrectLevel=qrencoder.QRErrorCorrectLevel.M);q.addData(URL);q.make();n=q.getModuleCount()
matrix=[[1 if q.isDark(y,x) else 0 for x in range(n)] for y in range(n)]
(source/'main-stage-entry.json').write_text(json.dumps({'url':URL,'placementId':'main_stage_screen','nfcRecordType':'NDEF URI','errorCorrection':'M','quietModules':4,'matrix':matrix},indent=2)+'\n',encoding='utf-8')
if '--matrix-only' not in sys.argv:
 image=ROOT/'dist/assets/main-stage-ads-poster.png'
 if not image.exists():raise SystemExit('Run node scripts/build-ads-entry.mjs --artwork-only first')
 pdf=canvas.Canvas(str(source/'main-stage-ads-poster-a5.pdf'),pagesize=(148*mm,210*mm),pageCompression=1,invariant=1)
 pdf.setTitle('Main stage - QR y NFC - piloto Stellar Testnet');pdf.setAuthor('Agentic Reality')
 pdf.drawImage(str(image),0,0,width=148*mm,height=210*mm)
 pdf.linkURL(URL,(0,0,148*mm,210*mm),relative=0,thickness=0)
 pdf.showPage();pdf.save()
 print('Generated one-page A5 source PDF; QR and NFC use the exact same URL.')
else:print('Generated deterministic QR source matrix.')
