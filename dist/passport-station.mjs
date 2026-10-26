// Only explicit visitor choices navigate. Opening the NFC/QR URL never starts a camera.
const status=document.getElementById('choiceStatus');
const idle=()=>{status.textContent='';};
for(const link of document.querySelectorAll('[data-experience]'))link.addEventListener('click',()=>{status.textContent=link.dataset.experience==='world'?'Abriendo ONE16…':'Abriendo la experiencia AR…';});
window.addEventListener('pageshow',idle);
