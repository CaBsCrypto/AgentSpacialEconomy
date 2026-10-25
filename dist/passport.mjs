import { bindQuickLook } from './quicklook.mjs?v=1';
import { withTimeout } from './load-timeout.mjs?v=8';
const button=document.getElementById('load3d'),host=document.getElementById('modelHost'),poster=document.getElementById('poster'),status=document.getElementById('status');
let busy=false,loaded=false;
button.addEventListener('click',async()=>{
 if(busy||loaded)return;busy=true;button.disabled=true;status.textContent='Preparando el visor del Passport… La imagen y los enlaces AR siguen disponibles.';
 try{
  await withTimeout(import('./vendor/model-viewer/model-viewer.min.js'),15000,'El visor tardó demasiado');
  const viewer=document.createElement('model-viewer');viewer.setAttribute('alt','Passport azul y dorado: portada original, reverso aproximado');viewer.setAttribute('src','./assets/passport.glb');viewer.setAttribute('poster','./assets/passport-preview.jpg?v=1');viewer.setAttribute('camera-controls','');viewer.setAttribute('camera-orbit','0deg 25deg auto');viewer.setAttribute('touch-action','pan-y');viewer.setAttribute('ar','');viewer.setAttribute('ar-modes','scene-viewer webxr quick-look');viewer.setAttribute('shadow-intensity','1');viewer.setAttribute('exposure','1');
  const ar=document.createElement('button');ar.slot='ar-button';ar.textContent='Ver en mi espacio';viewer.append(ar);
  const ready=new Promise((resolve,reject)=>{viewer.addEventListener('load',resolve,{once:true});viewer.addEventListener('error',()=>reject(Error('No se pudo mostrar 3D en este navegador')),{once:true})});
  host.replaceChildren(viewer);host.hidden=false;
  await withTimeout(ready,25000,'La carga 3D tardó demasiado');
  poster.hidden=true;loaded=true;button.textContent='Passport listo · arrastra para girar';status.textContent='Vista 3D. La cámara solo se solicita al elegir Ver en mi espacio en un dispositivo compatible.';
 }catch(error){host.replaceChildren();host.hidden=true;poster.hidden=false;button.disabled=false;status.textContent='El visor 3D no está disponible aquí. Puedes seguir viendo la imagen o abrir el visor nativo desde Android / iPhone. '+error.message;
 }finally{busy=false;}
});

bindQuickLook(document.getElementById('iosAR'),document.getElementById('iosStatus'));
