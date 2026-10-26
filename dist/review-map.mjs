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
// The legacy registry above is retained for source/evidence compatibility only.
// Production maps never render its numeric IDs, even with showNumbers:true.
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const fmt=n=>Number(n.toFixed(2));
const validPoint=p=>p&&finite(p.x)&&finite(p.z);
const routePoints=points=>Array.isArray(points)&&points.length>1&&points.every(validPoint)?points:[];
const phases=new Set(['entry','companies','completed']);

export function buildReviewSvg(layout={}, {pose,compact=false,guidedTourState}={}) {
 const phase=phases.has(guidedTourState?.phase)?guidedTourState.phase:'entry';
 const milestones=guidedTourState?.milestones??{};
 const polys=(Array.isArray(layout.walkable)?layout.walkable:[]).filter(p=>Array.isArray(p)&&p.length>=3&&p.every(v=>Array.isArray(v)&&finite(v[0])&&finite(v[1])));
 const bounds=layout.bounds;
 const authoredBounds=bounds&&['minX','maxX','minZ','maxZ'].every(k=>finite(bounds[k]))&&bounds.maxX>bounds.minX&&bounds.maxZ>bounds.minZ?[[bounds.minX,bounds.minZ],[bounds.maxX,bounds.maxZ]]:[];
 const all=[...polys.flat(),...authoredBounds];
 if(!all.length)all.push([-15,-50],[15,27]);
 const minX=Math.min(...all.map(p=>p[0]))-2,maxX=Math.max(...all.map(p=>p[0]))+2;
 const minZ=Math.min(...all.map(p=>p[1]))-3,maxZ=Math.max(...all.map(p=>p[1]))+3;
 const width=800,height=1200,scale=Math.min(600/(maxX-minX),1040/(maxZ-minZ));
 const project=(x,z)=>[fmt(width/2+(x-(minX+maxX)/2)*scale),fmt(80+(z-minZ)*scale)];
 const polygon=p=>p.map(([x,z])=>project(x,z).join(',')).join(' ');
 const floor=polys.map(p=>'<polygon points="'+polygon(p)+'" fill="#263a48" stroke="#8ca4b3" stroke-width="1.4"/>').join('');
 const obstacles=(Array.isArray(layout.obstacles)?layout.obstacles:[]).filter(b=>b&&['minX','maxX','minZ','maxZ'].every(k=>finite(b[k]))&&b.maxX>b.minX&&b.maxZ>b.minZ).map(b=>{
  const [x,y]=project(b.minX,b.minZ);
  return '<rect x="'+x+'" y="'+y+'" width="'+fmt((b.maxX-b.minX)*scale)+'" height="'+fmt((b.maxZ-b.minZ)*scale)+'" rx="1" fill="#73838b" opacity=".65"/>';
 }).join('');
 function route(points,id,label,{visited=false,endpointLabel=false}={}){
  points=routePoints(points);if(!points.length)return '';
  const [x,y]=project(points.at(-1).x,points.at(-1).z),opacity=visited?'.28':'.95';
  const anchor=id==='passport'?'start':id==='palta'?'end':'middle',labelX=fmt(x+(id==='passport'?10:id==='palta'?-10:0));
  const line='<polyline data-guidance-route="'+esc(id)+'"'+(id==='entry'?' data-activation-route="true"':'')+' data-route-visited="'+visited+'" points="'+points.map(p=>project(p.x,p.z).join(',')).join(' ')+'" fill="none" stroke="#53edff" stroke-opacity="'+opacity+'" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="0.1 '+fmt(.55*scale)+'" aria-label="'+esc(label+(visited?' · visitado':''))+'"/>';
  const text=endpointLabel?'<text data-guidance-label="'+esc(id)+'" x="'+labelX+'" y="'+fmt(y-13)+'" text-anchor="'+anchor+'" font-family="system-ui,sans-serif" font-size="'+(compact?'12':'24')+'" font-weight="700" fill="#e9faff" opacity="'+(visited?'.5':'1')+'" stroke="#101d29" stroke-width="4" paint-order="stroke">'+esc(label+(visited?' · visitado':''))+'</text>':'';
  return line+text;
 }
 let guides='';
 if(phase==='entry')guides=route(layout.activationRoute,'entry','USDC de prueba',{endpointLabel:true});
 else if(phase==='companies'){
  guides=route(layout.companyRoutes?.trunk,'trunk','Camino hacia las empresas');
  const seen=new Set();
  for(const branch of Array.isArray(layout.companyRoutes?.branches)?layout.companyRoutes.branches:[]){
   if(!['passport','palta'].includes(branch?.id)||seen.has(branch.id))continue;seen.add(branch.id);
   guides+=route(branch.points,branch.id,branch.label||(branch.id==='passport'?'Stellar Passport':'DeFindex · Soroswap'),{visited:milestones[branch.id]===true,endpointLabel:true});
  }
 }
 let location='';
 const hasPose=validPoint(pose)&&finite(pose.yaw),posePoint=hasPose?project(pose.x,pose.z):null;
 if(hasPose){
  const [x,y]=posePoint,angle=fmt(-pose.yaw*180/Math.PI);
  location='<g data-map-pose="true" data-review-pose="true" transform="translate('+x+' '+y+')" aria-label="Tu posición y orientación"><circle r="19" fill="#0b1823" opacity=".80"/><g transform="rotate('+angle+')"><path d="M0 -16 L9 10 L0 6 L-9 10 Z" fill="#5ce6eb" stroke="#ffffff" stroke-width="1.5"/></g><circle r="2" fill="#ffffff"/></g>';
 }
 const localCenter=posePoint||project(finite(layout.spawn?.x)?layout.spawn.x:0,finite(layout.spawn?.z)?layout.spawn.z:0);
 const viewBox=compact?[fmt(localCenter[0]-12*scale),fmt(localCenter[1]-16*scale),fmt(24*scale),fmt(32*scale)].join(' '):'0 0 '+width+' '+height;
 const footer=phase==='completed'?'Recorrido completado':phase==='companies'?'Sigue la guía hacia Stellar Passport y DeFindex · Soroswap':'Sigue la guía luminosa hasta USDC de prueba';
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="'+viewBox+'" role="img" aria-label="Plano del recinto" data-venue-map="'+(compact?'compact':'full')+'" data-guided-tour-phase="'+phase+'" style="display:block;width:100%;height:auto;overflow:hidden"><title>ONE16 · plano del recinto</title><desc>Distribución aproximada. La flecha cian indica tu posición y orientación. '+esc(footer)+'.</desc><rect width="800" height="1200" rx="18" fill="#101d29"/>'+(compact?'':'<text x="400" y="34" text-anchor="middle" fill="#e9eef1" font-family="system-ui,sans-serif" font-size="18" font-weight="700">ONE16 · plano del recinto</text>')+floor+obstacles+guides+location+(compact?'':'<text x="400" y="1155" text-anchor="middle" fill="#c0cdd5" font-family="system-ui,sans-serif" font-size="16">'+esc(footer)+'</text><text x="400" y="1180" text-anchor="middle" fill="#8ca4b3" font-family="system-ui,sans-serif" font-size="13">Distribución aproximada</text>')+'</svg>';
}
