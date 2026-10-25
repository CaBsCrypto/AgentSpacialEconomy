export const HOTSPOTS=[
 {id:'passport',mark:'P',label:'Passport AR',status:'available',detail:'Sponsor · demo disponible · ubicación provisional'},
 {id:'stage',mark:'E',label:'Escenario',status:'soon',detail:'Host del evento · próximamente · contenido AR por definir'},
 {id:'merch',mark:'M',label:'Merch',status:'soon',detail:'Próximamente · contenido AR por definir'},
 {id:'stands',mark:'S',label:'Stands',status:'soon',detail:'Próximamente · experiencias de marca por definir'}
];
export function hotspotPositions(layout){const b=layout.bounds;return HOTSPOTS.flatMap(h=>{const z=layout.zones.find(z=>z.id===h.id);if(!z)return[];const x=z.polygon.reduce((sum,p)=>sum+p[0],0)/z.polygon.length,y=z.polygon.reduce((sum,p)=>sum+p[1],0)/z.polygon.length;return[{...h,x,z:y,left:(x-b.minX+2)/(b.maxX-b.minX+4)*100,top:(y-b.minZ+2)/(b.maxZ-b.minZ+4)*100}]})}
const mounted=new WeakMap();
export function enhancePlan(container,layout,onOpen,{legendOnly=false}={}){
 mounted.get(container)?.disconnect();const svg=container.querySelector('svg');if(!svg)return;
 const doc=container.ownerDocument,viewport=doc.createElement('div'),stage=doc.createElement('div'),legend=doc.createElement('div');
 viewport.className='plan-map-viewport';stage.className='plan-map-stage';legend.className='ar-map-legend';legend.setAttribute('aria-label','Experiencias AR del plano');container.classList.add('plan-hotspots');
 svg.before(viewport);viewport.append(stage);stage.append(svg);
 const positions=hotspotPositions(layout);
 for(const spot of positions){
  for(const marker of (legendOnly?[false]:[true,false])){const button=doc.createElement('button');button.type='button';button.dataset.arHotspot=spot.id;button.dataset.status=spot.status;button.className=marker?'ar-map-beacon':'ar-map-choice';button.setAttribute('aria-label',`${spot.label}: ${spot.detail}`);button.title=`${spot.label}: ${spot.detail}`;
   if(marker){button.style.left=spot.left+'%';button.style.top=spot.top+'%';button.textContent=spot.mark;stage.append(button)}else{const title=doc.createElement('strong'),detail=doc.createElement('span');title.textContent=`${spot.mark} · ${spot.label}`;detail.textContent=spot.detail;button.append(title,detail);legend.append(button)}
   button.addEventListener('click',()=>onOpen(spot,button));
  }
 }
 container.append(legend);const caption=container.querySelector('p');if(caption)caption.textContent='Toca un destello o su nombre · P: demo AR provisional · E/M/S: próximamente. Plano aproximado; desplázalo si no cabe.';
 const fit=()=>{const width=viewport.clientWidth,height=viewport.clientHeight;if(!width||!height)return;const vb=svg.getAttribute('viewBox').split(/\s+/).map(Number),ratio=vb[2]/vb[3];const w=Math.min(width,height*ratio),h=w/ratio;stage.style.width=w+'px';stage.style.height=h+'px';stage.style.left=(width-w)/2+'px';stage.style.top=(height-h)/2+'px'};
 if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(fit);observer.observe(viewport);mounted.set(container,observer)}fit();
}
