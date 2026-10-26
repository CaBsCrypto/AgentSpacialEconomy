/** The reverse of the first right Trustless Work / Grantfox backdrop, near review16. */
export const PASSPORT_STAND = Object.freeze({
 id:'passport-stand16',name:'PassportStand target panel',x:3.2,y:1.45,z:-27.858,
 width:1.2,height:1.44,targetSrc:'./assets/passport-target.png',
 view:Object.freeze({x:3.2,z:-29.15,yaw:Math.PI,pitch:0})
});
export function isPassportStandObject(object){
 for(let o=object;o;o=o.parent)if(/^PassportStand/.test(o.name||''))return true;
 return false;
}
/** Keep a single clickable graphic; the interactive book is loaded only by the experience. */
export function addPassportStand(model,THREE,{textureLoader=new THREE.TextureLoader(),onReady=()=>{}}={}){
 const existing=model.getObjectByName(PASSPORT_STAND.name)||model.getObjectByName(PASSPORT_STAND.name.replaceAll(' ','_'));if(existing)return existing;
 const group=new THREE.Group();group.name=PASSPORT_STAND.name;
 group.userData={experienceId:PASSPORT_STAND.id,url:'./passport-ar.html',reviewSection:16,loadState:'loading'};
 const material=new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false});
 const panel=new THREE.Mesh(new THREE.PlaneGeometry(PASSPORT_STAND.width,PASSPORT_STAND.height),material);
 panel.name='PassportStand scan graphic';panel.rotation.y=Math.PI;
 panel.position.set(PASSPORT_STAND.x,PASSPORT_STAND.y,PASSPORT_STAND.z);
 group.add(panel);model.add(group);
 textureLoader.load(PASSPORT_STAND.targetSrc,texture=>{
  texture.colorSpace=THREE.SRGBColorSpace;material.map=texture;material.needsUpdate=true;group.userData.loadState='ready';onReady();
 },undefined,()=>{group.userData.loadState='error';material.color.set('#132846');material.needsUpdate=true;});
 return group;
}
