import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PASSPORT_STAND} from '../dist/passport-stand.mjs';
import {buildReviewSvg} from '../dist/review-map.mjs';
import {shortenLayout} from '../dist/short-corridor.mjs';
// GLB/layout keep authoring coordinates. Embedded navigation applies this once.
const root=fileURLToPath(new URL('../',import.meta.url));
const cleanLabel=value=>String(value).replace(/\s*·\s*stand\s+16\b/gi,'');
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const layout=shortenLayout(JSON.parse(fs.readFileSync(path.join(root,'dist/assets/layout.json'),'utf8')));
if(!layout.zones.some(z=>z.id===PASSPORT_STAND.id))layout.zones.push({id:PASSPORT_STAND.id,label:'Stellar Passport · escanear cartel',polygon:[[2,-29.40],[4,-29.40],[4,-28.10],[2,-28.10]],view:{...PASSPORT_STAND.view}});
for(const zone of layout.zones)zone.label=cleanLabel(zone.label);
const index=path.join(root,'dist/index.html'),svg=buildReviewSvg(layout,{guidedTourState:{phase:'entry'}}),seen=new Set();
const places=layout.zones.filter(z=>!seen.has(z.id)&&seen.add(z.id)).map(z=>'<li>'+esc(z.label)+'</li>').join('');
let source=fs.readFileSync(index,'utf8');
source=source.replace(/<div class="static-map">[\s\S]*?<\/div><ul>[\s\S]*?<\/ul>/,'<div class="static-map">'+svg+'</div><ul>'+places+'</ul>');
source=source.replace(/<div id="plan" hidden>[\s\S]*?<\/div>/,'<div id="plan" hidden>'+svg+'<p>Plano aproximado del recinto</p></div>');
source=source.replace(/(<script id="embeddedLayout" type="application\/json">)[\s\S]*?(<\/script>)/,(_,a,b)=>a+JSON.stringify(layout)+b);
source=source.replace(/<button\b[^>]*\bid="reviewToggle"[^>]*>[\s\S]*?<\/button>/g,'').replace(/<div\b[^>]*\bid="(?:reviewNumbers|reviewNames)"[^>]*>[\s\S]*?<\/div>/g,'');
source=source.replace(/class="review-enabled"/g,'').replace(/Mapa local numerado/g,'Mapa local').replace(/Passport · stand 16/g,'Stellar Passport');
// Only presentation text and human-readable attributes are normalized.
// Script/style bodies, stable IDs, hrefs and ?passport=stand16 stay byte-for-byte.
const publicLabel=value=>value
 .replace(/\bONE16\s*\/\s*STAND\s*16\b/gi,'ONE16 / STELLAR PASSPORT')
 .replace(/(?<![A-Za-z0-9_?=&-])stand\s*16\b/gi,'Stellar Passport');
source=source.replace(/(<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<[^>]+>)|([^<]+)/gi,(whole,tag,text)=>{
 if(text!==undefined)return publicLabel(text);
 if(/^<(?:script|style)\b/i.test(tag))return tag;
 return tag.replace(/(\b(?:aria-label|title|alt)\s*=\s*)(["'])(.*?)\2/gi,(_,attribute,quote,value)=>attribute+quote+publicLabel(value)+quote);
});
fs.writeFileSync(index,source);
