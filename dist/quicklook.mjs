const bindings=new WeakMap();
// Same typed-Blob strategy used by official model-viewer Quick Look export.
// First tap prepares locally; only a SECOND explicit tap can open the AR viewer.
export function bindQuickLook(link,status,{fetcher=fetch,createURL=blob=>URL.createObjectURL(blob)}={}){
 if(bindings.has(link))return bindings.get(link);
 let busy=false,ready=false;
 const click=async event=>{
  if(ready)return;
  event.preventDefault();if(busy)return;busy=true;status.textContent='Preparando archivo para Quick Look…';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
   const response=await fetcher('./assets/passport.usdz',{signal:controller.signal});if(!response.ok)throw Error(`HTTP ${response.status}`);
   const data=await response.arrayBuffer();const magic=new Uint8Array(data,0,Math.min(4,data.byteLength));if(magic[0]!==0x50||magic[1]!==0x4b)throw Error('Archivo USDZ inválido');
   const blob=new Blob([data],{type:'model/vnd.usdz+zip'});link.href=createURL(blob);link.setAttribute('aria-label','Archivo preparado: toca para abrir Quick Look');ready=true;status.textContent='Preparado. Toca otra vez la portada para abrir Quick Look en Safari.';
  }catch(error){status.textContent='No se pudo preparar Quick Look. Puedes reintentar o usar la vista estática. '+error.message;}finally{clearTimeout(timer);busy=false;}
 };
 link.addEventListener('click',click);const binding={get state(){return{busy,ready}},dispose(){link.removeEventListener('click',click);bindings.delete(link)}};bindings.set(link,binding);return binding;
}
