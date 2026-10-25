/** World coordinates are metres. Floor polygons and obstacles must be supplied
 * from reviewed reference evidence; this module invents no venue geometry. */
export function insidePolygon(x,z,polygon){
 let inside=false;
 for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
  const [xi,zi]=polygon[i],[xj,zj]=polygon[j];
  if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)inside=!inside;
 }
 return inside;
}
export function canStand(x,z,{walkable=[],obstacles=[]},radius=.24){
 const samples=[[0,0],[radius,0],[-radius,0],[0,radius],[0,-radius]];
 return samples.every(([dx,dz])=>walkable.some(p=>insidePolygon(x+dx,z+dz,p))) &&
  !obstacles.some(b=>x+radius>b.minX&&x-radius<b.maxX&&z+radius>b.minZ&&z-radius<b.maxZ);
}
export function walk(state,input,dt,layout,speed=2.2){
 const d=Math.min(Math.max(dt,0),.05)*speed;
 let f=Math.max(-1,Math.min(1,input.forward||0)),s=Math.max(-1,Math.min(1,input.right||0));
 const length=Math.hypot(f,s);if(length>1){f/=length;s/=length;}
 // yaw 0 faces negative Z, matching Three.js camera forward.
 const dx=(-Math.sin(state.yaw)*f+Math.cos(state.yaw)*s)*d;
 const dz=(-Math.cos(state.yaw)*f-Math.sin(state.yaw)*s)*d;
 let x=state.x,z=state.z;
 if(canStand(x+dx,z,layout))x+=dx;
 if(canStand(x,z+dz,layout))z+=dz;
 return {...state,x,z};
}
export function turn(state,dx,dy){return {...state,yaw:state.yaw-dx*.004,pitch:Math.max(-1.25,Math.min(1.25,state.pitch-dy*.004))};}
export function roomAt(state,zones){return zones.find(z=>insidePolygon(state.x,state.z,z.polygon))?.id??null;}
export function changeMode(state,mode){if(!['walk','overview','plan'].includes(mode))throw Error('Unknown view');return {...state,mode};}
