/** A book pose belongs to the XR world, with its initial facing captured only once. */
export function createWorldPassportPlacement(T,{elevation=.18}={}){
 let hit=null,placed=null;
 const lift=Number.isFinite(elevation)?elevation:.18;
 const copy=value=>value?.slice()||null;
 const rigid=value=>{
  if(!value||value.length!==16)return null;
  const values=Array.from(value);if(!values.every(Number.isFinite))return null;
  const epsilon=.001;
  if(Math.abs(values[3])>epsilon||Math.abs(values[7])>epsilon||Math.abs(values[11])>epsilon||Math.abs(values[15]-1)>epsilon)return null;
  const x=new T.Vector3(values[0],values[1],values[2]),y=new T.Vector3(values[4],values[5],values[6]),z=new T.Vector3(values[8],values[9],values[10]);
  if([x,y,z].some(axis=>Math.abs(axis.lengthSq()-1)>epsilon)||Math.abs(x.dot(y))>epsilon||Math.abs(x.dot(z))>epsilon||Math.abs(y.dot(z))>epsilon)return null;
  if(Math.abs(new T.Vector3().crossVectors(x,y).dot(z)-1)>epsilon)return null;
  return values;
 };
 const reset=()=>{hit=placed=null;};
 return{
  get hit(){return copy(hit);},
  get placed(){return copy(placed);},
  offerHit(matrix){if(!placed)hit=rigid(matrix);},
  place(viewerMatrix){
   if(placed||!hit)return null;
   const viewer=rigid(viewerMatrix);if(!viewer)return null;
   const x=hit[12],y=hit[13]+lift,z=hit[14],dx=viewer[12]-x,dz=viewer[14]-z;
   // With the viewer directly overhead, its initial backward axis supplies a stable heading.
   const yaw=Math.hypot(dx,dz)>1e-6?Math.atan2(dx,dz):Math.atan2(viewer[8],viewer[10]);
   placed=new T.Matrix4().makeRotationY(yaw).setPosition(x,y,z).toArray();
   return copy(placed);
  },
  reset,
  rebase(newOriginInOldMatrix){
   const origin=rigid(newOriginInOldMatrix);
   if(!origin){reset();return false;}
   // XR reset.transform describes the new origin in the previous coordinate system.
   const oldToNew=new T.Matrix4().fromArray(origin).invert();
   const transform=matrix=>oldToNew.clone().multiply(new T.Matrix4().fromArray(matrix)).toArray();
   if(hit)hit=transform(hit);if(placed)placed=transform(placed);
   return !!placed;
  }
 };
}
