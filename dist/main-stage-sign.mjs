import {screenPlacement,BACKDROP_NODE} from './stage-screen.mjs';
import {playbackLabel} from './ads-player.mjs';
export const MAIN_STAGE_ENTRY_URL='https://agenticreality.space/ads?placement=main_stage_screen';
export function isMainStageSign(object){for(let node=object;node;node=node.parent)if(node.userData?.mainStageEntry===true)return true;return false;}
export function mainStageSignPlacement(bounds,centre){
 const stage=screenPlacement(bounds.min,bounds.max,centre);stage.width=Math.min(stage.width,stage.height*16/9);
 const width=Math.min(1.45,stage.width*.32),height=width*210/148,right=[Math.cos(stage.rotationY),0,-Math.sin(stage.rotationY)],front=[Math.sin(stage.rotationY),0,Math.cos(stage.rotationY)];
 return {position:stage.position.map((v,i)=>i===1?Math.max(height*.6,stage.position[1]-stage.height*.5+height*.48):v+right[i]*(stage.width*.5+width*.6+.25)+front[i]*.07),rotationY:stage.rotationY,width,height};
}
/** Access sign and public timing belong beside the stage, never on top of the creative. */
export function createMainStageSign(T,model,{documentRef=globalThis.document,textureLoader=new T.TextureLoader(),textureUrl='/assets/main-stage-ads-poster.png'}={}){
 const backdrop=model.getObjectByName(BACKDROP_NODE);if(!backdrop)return null;
 const bounds=new T.Box3().setFromObject(backdrop),centre=new T.Box3().setFromObject(model).getCenter(new T.Vector3()),placement=mainStageSignPlacement({min:bounds.min.toArray(),max:bounds.max.toArray()},centre.toArray());
 const root=new T.Group();root.name='Main stage advertising access';root.userData.mainStageEntry=true;root.userData.entryUrl=MAIN_STAGE_ENTRY_URL;root.position.set(...placement.position);root.rotation.y=placement.rotationY;model.add(root);
 const material=new T.MeshBasicMaterial({color:0xffffff,side:T.DoubleSide,toneMapped:false});
 const sign=new T.Mesh(new T.PlaneGeometry(placement.width,placement.height),material);sign.name='Main stage QR and NFC';root.add(sign);
 let disposed=false,texture;
 const loaded=textureLoader.load(textureUrl,value=>{if(disposed){value.dispose();return;}texture=value;value.colorSpace=T.SRGBColorSpace;material.map=value;material.needsUpdate=true;},undefined,()=>{});
 if(loaded){texture=loaded;loaded.colorSpace=T.SRGBColorSpace;material.map=loaded;}
 const canvas=documentRef?.createElement?.('canvas'),context=canvas?.getContext?.('2d');let clockTexture,clock,last='';
 if(context){canvas.width=768;canvas.height=154;clockTexture=new T.CanvasTexture(canvas);clockTexture.colorSpace=T.SRGBColorSpace;clock=new T.Mesh(new T.PlaneGeometry(placement.width*1.5,placement.width*.3),new T.MeshBasicMaterial({map:clockTexture,side:T.DoubleSide,toneMapped:false}));clock.position.y=-placement.height*.5-placement.width*.2;clock.position.z=.008;clock.name='Main stage public playback time';clock.userData.mainStageEntry=true;root.add(clock);}
 function updatePlayback(playback,{active=false}={}){const text=!playback&&active?'Anuncio activo':playbackLabel(playback);if(!context||text===last)return;last=text;context.fillStyle='#07121f';context.fillRect(0,0,768,154);context.fillStyle='#e8c78a';context.font='bold 25px sans-serif';context.fillText('MAIN STAGE · ENTREGA DIGITAL',24,44);context.fillStyle='#eef4f7';context.font='25px sans-serif';context.fillText(text,24,105);clockTexture.needsUpdate=true;}
 updatePlayback(null);
 return {root,placement,updatePlayback,dispose(){disposed=true;root.removeFromParent();sign.geometry.dispose();material.dispose();texture?.dispose();clock?.geometry.dispose();clock?.material.dispose();clockTexture?.dispose();}};
}
