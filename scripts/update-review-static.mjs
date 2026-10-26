import {PASSPORT_STAND} from '../dist/passport-stand.mjs';
import fs from 'node:fs';import{REVIEW_SECTIONS,buildReviewSvg}from'../dist/review-map.mjs';
import{shortenLayout}from'../dist/short-corridor.mjs';
// layout.json and the committed GLB retain their authoring coordinates.
// The viewer and embedded navigation use the same shortened corridor mapping.
const l=shortenLayout(JSON.parse(fs.readFileSync('dist/assets/layout.json')));if(!l.zones.some(z=>z.id===PASSPORT_STAND.id))l.zones.push({id:PASSPORT_STAND.id,label:'Stellar Passport · stand 16',polygon:[[2.4,-29.7],[4,-29.7],[4,-27.9],[2.4,-27.9]],view:{...PASSPORT_STAND.view}});let s=fs.readFileSync('dist/index.html','utf8'),svg=buildReviewSvg(l),legend=REVIEW_SECTIONS.map(x=>`<li><b>${x.id}</b> · ${x.label}</li>`).join('');
s=s.replace(/<div class="static-map">.*?<\/div><ul>.*?<\/ul>/s,`<div class="static-map">${svg}</div><ul>${legend}</ul>`).replace(/<div id="plan" hidden>.*?<\/div>/s,`<div id="plan" hidden>${svg}<p>Plano aproximado · pasillo de entrada acortado</p></div>`).replace(/(<script id="embeddedLayout" type="application\/json">).*?(<\/script>)/s,(_,a,b)=>a+JSON.stringify(l)+b);fs.writeFileSync('dist/index.html',s);
