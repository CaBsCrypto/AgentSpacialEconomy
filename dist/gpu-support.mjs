// Capability detection only; never enables or bypasses disabled GPU features.
export function canUseWebGL2(createCanvas=()=>document.createElement('canvas')){
 try{const canvas=createCanvas(),context=canvas.getContext('webgl2');if(!context)return false;context.getExtension?.('WEBGL_lose_context')?.loseContext();return true}catch{return false}
}
