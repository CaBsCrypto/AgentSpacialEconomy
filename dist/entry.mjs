import { mountVenueWelcome, resolveVenueLanguage } from './venue-loading.mjs?v=1';
/** The public NFC URL chooses its lightweight entry before importing the venue. */
export const isPassportDirect=search=>new URLSearchParams(search).get('passport')==='stand16';

export function activateVenueAssets(documentRef,{timer=globalThis.setTimeout,clearTimer=globalThis.clearTimeout}={}){
 const styles=[];
 for(const link of documentRef.querySelectorAll('link[data-one16-stylesheet]')){
  if(link.getAttribute('href'))continue;
  styles.push(new Promise(resolve=>{
   let timeout;
   const finish=()=>{clearTimer(timeout);link.removeEventListener('load',finish);link.removeEventListener('error',finish);resolve();};
   link.addEventListener('load',finish,{once:true});link.addEventListener('error',finish,{once:true});
   timeout=timer(finish,8000);link.setAttribute('href',link.getAttribute('data-one16-stylesheet'));
  }));
 }
 for(const image of documentRef.querySelectorAll('img[data-one16-src]')){
  image.setAttribute('src',image.getAttribute('data-one16-src'));image.removeAttribute('data-one16-src');
 }
 return Promise.all(styles);
}

export function prepareVenueWelcome(documentRef,locationRef,{fromPassport=false,storage}={}){
 const language=resolveVenueLanguage({search:locationRef.search,storage});
 const welcome=mountVenueWelcome(documentRef,{language});
 if(locationRef.hash==='#accessibleTour'&&!fromPassport){welcome.update({phase:'idle',cover:false});return welcome;}
 documentRef.documentElement.classList.add('venue-cover');
 if(fromPassport)documentRef.documentElement.classList.add('venue-returning');
 const poster=documentRef.getElementById?.('venueWelcomePoster');
 if(poster&&!poster.getAttribute('src'))poster.setAttribute('src',poster.getAttribute('data-venue-src'));
 welcome.update({phase:'engine',cover:true});return welcome;
}

function waitForVenue(documentRef){
 let finish;
 const promise=new Promise(resolve=>{finish=resolve;});
 const types=['one16-ready','one16-failed','one16-plan','one16-left'];
 const ready=event=>{cleanup();finish({type:event.type,failed:event.type==='one16-failed',detail:event.detail});};
 const cleanup=()=>{for(const type of types)documentRef.removeEventListener(type,ready);};
 for(const type of types)documentRef.addEventListener(type,ready);
 return {promise,cancel:cleanup};
}

export async function bootstrapEntry({documentRef=globalThis.document,locationRef=globalThis.location,historyRef=globalThis.history,storage=(()=>{try{return globalThis.localStorage;}catch{return null;}})(),importWorld=()=>import('./viewer.js?v=welcome-1'),importPassport=()=>import('./passport-entry.mjs?v=spatial2'),activateAssets=()=>activateVenueAssets(documentRef)}={}){
 const enterWorld=async(fromPassport=false)=>{
  const settled=fromPassport?waitForVenue(documentRef):null;
  const welcome=prepareVenueWelcome(documentRef,locationRef,{fromPassport,storage});
  try{
   if(fromPassport){const query=new URLSearchParams(locationRef.search);query.set('passport','return');historyRef.replaceState(null,'',`${locationRef.pathname||'/'}?${query}#recorrido`);}
   await activateAssets();await importWorld();if(settled){const result=await settled.promise;welcome.update({phase:result.failed?'error':result.type==='one16-ready'?'ready':'idle',cover:result.failed});}
   documentRef.documentElement.classList.remove('passport-direct','one16-booting','venue-returning');documentRef.defaultView?.dispatchEvent?.(new Event('resize'));
  }catch(error){
   settled?.cancel();
   if(locationRef.hash!=='#accessibleTour')welcome.update({phase:'error',cover:true});
   documentRef.documentElement.classList.remove('passport-direct','one16-booting','venue-returning');throw error;
  }
 };
 if(isPassportDirect(locationRef.search)){
  documentRef.documentElement.classList.add('passport-direct');
  const {mountPassportEntry}=await importPassport();
  return mountPassportEntry({documentRef,onReturn:()=>enterWorld(true)});
 }
 await enterWorld();return null;
}

if(typeof document!=='undefined')void bootstrapEntry().catch(()=>{
 const root=document.getElementById('passportDirect'),status=document.getElementById('passportDirectStatus');
 if(root&&status&&document.documentElement.classList.contains('passport-direct')){root.dataset.error='true';status.textContent='No se pudo preparar el Passport. Recarga la página para volver a intentar.';}
 else{const status=document.getElementById('landingProgress');if(status)status.textContent='ONE16 could not be prepared. The 2D plan and images remain available.';}
});
