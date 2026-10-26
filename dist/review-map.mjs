import { corridorZ } from './short-corridor.mjs?v=1';
/** Temporary review coordinates, not a measured venue survey. Informational pins only. */
const sections = [
 [1,'Exterior · cartel',0,38],
 [4,'Puerta de entrada',0,32],[5,'Pasillo amarillo',0,19],[6,'Lounge inferior',0,4.5],
 [7,'Escalera amarilla',0,1.2],[8,'Check-in',0,-6.1],[9,'Merch',-9,-5],
 [10,'Tótem · USDC de prueba',2.9,-9.2],[11,'Passport · mesa Stellar Passport',4,-28.8,'passport'],
 [12,'Comida / buffet',3.1,-7.1,'buffet'],[13,'Centro · mesas / builders',0,-21],
 [14,'Mesas builders · izquierda',-10,-28],[15,'Stands · izquierda',-3.2,-28.8],
 [16,'Stands · derecha',3.2,-28.8],[17,'Auditorio',0,-35],[18,'Escenario',0,-43],
 [19,'Zona de fotos · junto al escenario',10,-38,'photo'],[20,'Ventanas · costado río',12.4,-9,'river'],
 [21,'Juegos · teclado gigante y arcade',-9.2,-12,'games'],
 [22,'Skills board · forma tu equipo',4.3,-8,'skills'],
 [23,'Energy Corner · fútbol',11,-28.5,'energy'],
 [24,'Fotomatón · Made to Move',10,-34,'photobooth'],
 [25,'Content Hub · sala acristalada',11.6,-14,'content-hub']
];
export const REVIEW_SECTIONS=Object.freeze(sections.map(([id,label,x,z,zone])=>Object.freeze({id,label,x,z:corridorZ(z),...(zone?{zone}:{})})));
/** New references follow their named zone view when its geometry is rebuilt. */
export function resolveReviewSections(layout = {}) {
 return REVIEW_SECTIONS.map(section=>{
  if(section.id===10&&Number.isFinite(layout.activation?.position?.x)&&Number.isFinite(layout.activation?.position?.z))return {...section,x:layout.activation.position.x,z:layout.activation.position.z};
  const zone=section.zone&&layout.zones?.find(zone=>zone.id===section.zone);
  return zone&&Number.isFinite(zone.view?.x)&&Number.isFinite(zone.view?.z) ? {...section,x:zone.view.x,z:zone.view.z} : section;
 });
}
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const fmt=n=>Number(n.toFixed(2));
// Screen offsets affect the badge only; every displaced badge has an anchored leader.
const offsets={1:[38,0],3:[-38,0],6:[-30,0],7:[30,0],9:[-27,0],10:[36,-22],11:[64,14],15:[-18,0],16:[18,0]};
export function buildReviewSvg(layout={}, {pose,compact=false,showNumbers=true}={}) {
 const reviewSections=resolveReviewSections(layout);
 const polys=(Array.isArray(layout.walkable)?layout.walkable:[]).filter(p=>Array.isArray(p)&&p.length>=3&&p.every(v=>Array.isArray(v)&&finite(v[0])&&finite(v[1])));
 const all=[...reviewSections.map(s=>[s.x,s.z]),...polys.flat()];
 const minX=Math.min(...all.map(p=>p[0]))-2,maxX=Math.max(...all.map(p=>p[0]))+2;
 const minZ=Math.min(...all.map(p=>p[1]))-3,maxZ=Math.max(...all.map(p=>p[1]))+3;
 const width=800,height=1200,scale=Math.min(600/(maxX-minX),1040/(maxZ-minZ));
 const project=(x,z)=>[fmt(width/2+(x-(minX+maxX)/2)*scale),fmt(80+(z-minZ)*scale)];
 const polygon=p=>p.map(([x,z])=>project(x,z).join(',')).join(' ');
 const floor=polys.map(p=>`<polygon points="${polygon(p)}" fill="#263a48" stroke="#8ca4b3" stroke-width="1.4"/>`).join('');
 const obstacles=(Array.isArray(layout.obstacles)?layout.obstacles:[]).filter(b=>b&&['minX','maxX','minZ','maxZ'].every(k=>finite(b[k]))&&b.maxX>=b.minX&&b.maxZ>=b.minZ).map(b=>{
  const [x,y]=project(b.minX,b.minZ);return `<rect x="${x}" y="${y}" width="${fmt((b.maxX-b.minX)*scale)}" height="${fmt((b.maxZ-b.minZ)*scale)}" rx="1" fill="#73838b" opacity=".65"/>`;
 }).join('');
 const guidePoints=Array.isArray(layout.activationRoute)&&layout.activationRoute.length>1&&layout.activationRoute.every(p=>finite(p.x)&&finite(p.z))?layout.activationRoute:[];
 const guide=guidePoints.length?`<polyline data-activation-route="true" points="${guidePoints.map(p=>project(p.x,p.z).join(',')).join(' ')}" fill="none" stroke="#53edff" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="0.1 ${fmt(.55*scale)}" aria-label="Camino luminoso hasta el tótem de USDC de prueba"/>`:'';
 const posePoint=pose&&finite(pose.x)&&finite(pose.z)&&finite(pose.yaw)?project(pose.x,pose.z):null;
 const pins=reviewSections.map(s=>{
  const [ax,ay]=project(s.x,s.z);let [dx,dy]=offsets[s.id]||[0,0];
  if(posePoint&&Math.hypot(ax+dx-posePoint[0],ay+dy-posePoint[1])<34)dx+=38;
  const x=ax+dx,y=ay+dy;
  const leader=dx||dy?`<path d="M${ax} ${ay} L${x} ${y}" stroke="#f5da72" stroke-width="1.6"/><circle cx="${ax}" cy="${ay}" r="2.7" fill="#f5da72"/>`:'';
  return `<g data-review-number="${s.id}" data-review-id="${s.id}" data-world-x="${s.x}" data-world-z="${s.z}" aria-label="${esc(`${s.id}. ${s.label}`)}"><title>${esc(`${s.id}. ${s.label}`)}</title>${leader}<circle cx="${x}" cy="${y}" r="14" fill="${s.provisional?'#242e40':'#f5da72'}" stroke="${s.provisional?'#f5da72':'#141e27'}" stroke-width="2"${s.provisional?' stroke-dasharray="3 2"':''}/><text x="${x}" y="${y+5}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" font-weight="750" fill="${s.provisional?'#f5da72':'#111b25'}">${s.id}</text></g>`;
 }).join('');
 let location='';
 if(pose&&finite(pose.x)&&finite(pose.z)&&finite(pose.yaw)){
  const [x,y]=project(pose.x,pose.z),angle=fmt(-pose.yaw*180/Math.PI);
  location=`<g data-review-pose="true" transform="translate(${x} ${y})" aria-label="Tu posición y orientación"><circle r="19" fill="#0b1823" opacity=".80"/><g transform="rotate(${angle})"><path d="M0 -16 L9 10 L0 6 L-9 10 Z" fill="#5ce6eb" stroke="#ffffff" stroke-width="1.5"/></g><circle r="2" fill="#ffffff"/></g>`;
 }
 const localCenter=posePoint||project(0,19);
 const viewBox=compact?`${fmt(localCenter[0]-12*scale)} ${fmt(localCenter[1]-16*scale)} ${fmt(24*scale)} ${fmt(32*scale)}`:`0 0 ${width} ${height}`;
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="Mapa de revisión: ${reviewSections.length} referencias aproximadas" data-review-map="${compact?'compact':'full'}" style="display:block;width:100%;height:auto;overflow:hidden"><title>ONE16 · mapa de revisión numerado</title><desc>Posiciones aproximadas para revisar el recorrido. Números informativos; 10 guía al tótem; 11 identifica la mesa Stellar Passport. La flecha cian indica posición y orientación cuando están disponibles.</desc><rect width="800" height="1200" rx="18" fill="#101d29"/>${compact?'':`<text x="400" y="34" text-anchor="middle" fill="#e9eef1" font-family="system-ui,sans-serif" font-size="18" font-weight="700">ONE16 · ${reviewSections.length} referencias para revisar</text>`}${floor}${obstacles}${guide}${showNumbers?pins:''}${location}${compact?'':`<text x="400" y="1155" text-anchor="middle" fill="#c0cdd5" font-family="system-ui,sans-serif" font-size="${compact?15:16}">Distribución estimada · guía al tótem de USDC de prueba</text><text x="400" y="1180" text-anchor="middle" fill="#8ca4b3" font-family="system-ui,sans-serif" font-size="13">Números de revisión, no nuevas ubicaciones verificadas</text>`}</svg>`;
}
