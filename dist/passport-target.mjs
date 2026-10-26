const $=id=>document.getElementById(id);
let stationURL=new URL('./passport-station.html',location.href).href;
function applyAccess(url){const value=new URL(url,location.href);if(!['https:','http:'].includes(value.protocol))throw Error('Invalid access URL');stationURL=value.href;for(const id of ['qrLink','phoneLink'])$(id).href=stationURL;$('nfcLink').value=stationURL;}
applyAccess(stationURL);
fetch('./assets/passport-access.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('access');return r.json();}).then(data=>{applyAccess(data.url);$('accessNote').textContent=data.temporary?'Enlace temporal: '+stationURL+' · funciona mientras la demo local está activa.':'Acceso QR / NFC: '+stationURL+' · elige ONE16 o Passport en AR.';}).catch(()=>{$('accessNote').textContent='No se pudo cargar el acceso publicado. Puedes abrir ONE16 con el botón de arriba.';});
$('copyNfc').addEventListener('click',async()=>{
 try{if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');await navigator.clipboard.writeText(stationURL);$('copyStatus').textContent='Enlace copiado. Puedes grabarlo como URL en la etiqueta NFC con tu herramienta habitual.';$('nfcLink').hidden=true;}
 catch{$('nfcLink').hidden=false;$('nfcLink').value=stationURL;$('nfcLink').focus();$('nfcLink').select();$('copyStatus').textContent='Copia el enlace seleccionado para usarlo en la etiqueta NFC.';}
});
$('focusTarget').addEventListener('click',()=>{document.body.classList.add('target-only');$('restore').hidden=false;});$('restore').addEventListener('click',()=>{document.body.classList.remove('target-only');$('restore').hidden=true;});
