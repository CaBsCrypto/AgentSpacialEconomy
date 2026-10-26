/** Reveal only a successfully rendered model; canceled views cannot reveal a later session. */
export function createPassportFirstFrame({onReady=()=>{},scheduleFrame=requestAnimationFrame,cancelFrame=cancelAnimationFrame}={}){
 let pending=null,shown=false,generation=0;
 return {
  rendered({calls,width,height,contextLost=false}={}){
   if(shown||pending!==null||contextLost||!(calls>0&&width>0&&height>0))return false;
   const token=generation;pending=scheduleFrame(()=>{if(token!==generation)return;pending=null;shown=true;onReady();});return true;
  },
  reset(){++generation;if(pending!==null)cancelFrame(pending);pending=null;shown=false;},
  get ready(){return shown;}
 };
}
