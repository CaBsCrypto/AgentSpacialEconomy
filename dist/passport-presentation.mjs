/** Pixel bounds shared by the immediate cover preview and the first closed 3D frame. */
export function getInitialPassportRect(width,height){
 const viewportWidth=Number.isFinite(width)?Math.max(0,width):0,viewportHeight=Number.isFinite(height)?Math.max(0,height):0;
 const coverWidth=Math.min(viewportWidth*.60,280,viewportHeight*.48),coverHeight=coverWidth*1123/861;
 return{x:(viewportWidth-coverWidth)/2,y:viewportHeight*.45-coverHeight/2,width:coverWidth,height:coverHeight};
}
