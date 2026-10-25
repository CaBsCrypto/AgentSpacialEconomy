from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]/'dist';layout=json.loads((root/'assets/layout.json').read_text());b=layout['bounds'];w=b['maxX']-b['minX'];h=b['maxZ']-b['minZ']
svg=f'<svg viewBox="{b["minX"]-2} {b["minZ"]-2} {w+4} {h+4}" role="img" aria-label="Plano aproximado ONE16: entrada, merch a la izquierda, activación a la derecha y escenario">'
for p in layout['walkable']:svg+='<polygon fill="#e8e5d8" stroke="#6a7360" stroke-width=".15" points="'+' '.join(f'{x},{z}' for x,z in p)+'"/>'
for o in layout['obstacles']:svg+=f'<rect fill="#a5ab94" x="{o["minX"]}" y="{o["minZ"]}" width="{o["maxX"]-o["minX"]}" height="{o["maxZ"]-o["minZ"]}"/>'
legend=[]
for i,z in enumerate(layout['zones']):
 x=sum(p[0] for p in z['polygon'])/len(z['polygon']);y=sum(p[1] for p in z['polygon'])/len(z['polygon']);n='A' if z['id']=='activation' else str(i+1)
 svg+=f'<circle cx="{x}" cy="{y}" r="1" fill="#d7ef83" stroke="#172019" stroke-width=".1"/><text x="{x}" y="{y+.3}" text-anchor="middle" fill="#172019" font-size=".8">{n}</text>'
 legend.append(f'<li><b>{n}</b> · {z["label"]}</li>')
svg+='</svg>'
static=f'<section id="accessibleTour" tabindex="-1"><p class="eyebrow">SIN WEBGL / SIN DESCARGAR EL MODELO</p><h2>El espacio también en 2D.</h2><p>Este plano y las imágenes funcionan sin motor 3D. Son vistas estáticas: no simulan caminar. Reconstrucción aproximada, no plano medido.</p><div class="static-grid"><div class="static-map">{svg}</div><ul>{"".join(legend)}</ul></div><div class="static-photos"><figure><img src="./assets/exterior.webp?v=9" loading="lazy" alt="Cartel WELCOME, BUILDERS. sobre la puerta exterior"><figcaption>Cartel exterior · inicio del recorrido</figcaption></figure><figure><img src="./assets/hero.webp?v=6" loading="lazy" alt="Pasillo amarillo de entrada"><figcaption>Ingreso amarillo</figcaption></figure><figure><img src="./assets/merch.webp?v=6" loading="lazy" alt="Merch a la izquierda de la llegada"><figcaption>Merch · izquierda</figcaption></figure><figure><img src="./assets/activation.webp?v=6" loading="lazy" alt="Propuesta de tótem a la derecha"><figcaption>Activación Stellar · propuesta, derecha</figcaption></figure></div><a href="#">↑ Volver a la portada</a></section>'

import re
p=root/'index.html';s=p.read_text()
s=re.sub(r'<section id="accessibleTour".*?(?=<section id="reference">)',lambda m:static,s,flags=re.S)
s=re.sub(r'<div id="plan" hidden>.*?</div>',lambda m:'<div id="plan" hidden>'+svg+'<p>Plano aproximado · sin WebGL</p></div>',s,flags=re.S)
s=re.sub(r'(<script id="embeddedLayout" type="application/json">).*?(</script>)',lambda m:m[1]+json.dumps(layout,separators=(',',':'))+m[2],s,flags=re.S)
p.write_text(s)
print('Rebuilt independent static tour and embedded layout:',len(layout['zones']),'zones')
