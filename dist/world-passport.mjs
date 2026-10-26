export function isPassportObject(object){for(let o=object;o;o=o.parent)if(/^Passport/i.test(o.name||''))return true;return false}
export function bindWorldPassport({dialog,openButtons=[],closeButton,clearInput,loadPanel,onOpen=()=>{},onClose=()=>{}}){
 let panelPromise;
 const open=()=>{clearInput();if(!dialog.open)dialog.showModal();onOpen();panelPromise??=Promise.resolve().then(loadPanel).catch(error=>{panelPromise=null;throw error});panelPromise.catch(()=>{});return panelPromise};
 const close=()=>{dialog.close();clearInput()};
 for(const b of openButtons)b.addEventListener('click',open);closeButton.addEventListener('click',close);dialog.addEventListener('close',()=>{clearInput();onClose()});
 return{open,close};
}
