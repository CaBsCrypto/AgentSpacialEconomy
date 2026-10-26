import {PASSPORT_CONTENT} from './passport-content.mjs';

/** Cover, two pages, then a closed-book completion screen. Renderer-independent. */
export function createPassportReading({onChange=()=>{}}={}){
 let page=0;
 const listeners=new Set();
 function setPage(next){
  next=Math.max(0,Math.min(3,next));
  if(next===page)return page;
  page=next;onChange(page);
  for(const listener of [...listeners])listener(page);
  return page;
 }
 return {
  get page(){return page;},
  next:()=>setPage(page+1),previous:()=>setPage(page-1),close:()=>setPage(0),
  subscribe(listener){listeners.add(listener);listener(page);return()=>listeners.delete(listener);}
 };
}

/** A touch and keyboard alternative to tapping the animated pages. */
export function bindPassportReading(host,reading,{documentRef=host.ownerDocument,content=PASSPORT_CONTENT,onReturn=()=>{}}={}){
 const element=(tag,className,text)=>{
  const node=documentRef.createElement(tag);
  if(className)node.className=className;
  if(text!==undefined)node.textContent=text;
  return node;
 };
 const root=element('section','passport-reading');
 root.setAttribute('aria-label','Lectura del Passport');
 const status=element('p','passport-reading-status');
 status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const badge=element('span','passport-reading-badge',content.badge);
 const progress=element('span','passport-reading-progress');
 status.append(badge,progress);
 const hint=element('p','passport-reading-hint','Toca el Passport para abrirlo');
 const navigation=element('nav','passport-reading-navigation');
 navigation.setAttribute('aria-label','Páginas del Passport');
 const previous=element('button','passport-reading-previous passport-reading-arrow','‹');
 previous.setAttribute('aria-label','Página anterior');
 const next=element('button','passport-reading-next passport-reading-arrow','›');
 const returnButton=element('button','passport-reading-return','Volver a ONE16');
 for(const button of [previous,next,returnButton])button.type='button';
 const cta=element('a','passport-reading-cta',content.cta.label);
 cta.href=content.cta.url;cta.target='_blank';cta.rel='noopener noreferrer';
 cta.setAttribute('aria-label',content.cta.label);
 navigation.append(previous,next,cta,returnButton);
 const details=element('details','passport-reading-text');
 const summary=element('summary','','Leer texto');
 const title=element('h3','passport-reading-title');
 const body=element('p','passport-reading-body');
 const note=element('p','passport-reading-note',content.note);
 details.append(summary,title,body,note);
 root.append(status,hint,navigation,details);host.append(root);
 const onPrevious=()=>reading.previous(),onNext=()=>reading.next();
 const onReturnClick=()=>{if(reading.page===3)onReturn();};
 previous.addEventListener('click',onPrevious);next.addEventListener('click',onNext);returnButton.addEventListener('click',onReturnClick);
 const unsubscribe=reading.subscribe(page=>{
  root.dataset.page=String(page);
  const complete=page===3,active=content.pages[Math.max(0,Math.min(content.pages.length-1,page-1))];
  progress.textContent=complete?'Lectura completa':page?`Página ${page} de ${content.pages.length}`:'Portada';
  hint.hidden=page!==0;
  previous.hidden=page===0||complete;
  next.hidden=complete;
  next.setAttribute('aria-label',page===0?'Abrir Passport':page===2?'Finalizar lectura':'Página siguiente');
  cta.hidden=returnButton.hidden=!complete;
  details.hidden=page===0||complete;
  if(details.hidden)details.open=false;
  title.textContent=active.title;body.textContent=active.body;
 });
 let disposed=false;
 return {dispose(){
  if(disposed)return;disposed=true;unsubscribe();
  previous.removeEventListener('click',onPrevious);next.removeEventListener('click',onNext);returnButton.removeEventListener('click',onReturnClick);root.remove();
 }};
}

