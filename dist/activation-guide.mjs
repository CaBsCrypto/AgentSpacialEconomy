import {canStand, floorHeight, insidePolygon} from './navigation.mjs';

const NORMAL_SPACING=.55, STAIR_SPACING=.22, FLOOR_OFFSET=.025;
const MAX_SAMPLES=4096, EPSILON=1e-8;
const finitePoint=point=>point&&Number.isFinite(point.x)&&Number.isFinite(point.z);
const distance=(a,b)=>Math.hypot(b.x-a.x,b.z-a.z);

function stairSurfaces(layout){
  return (layout.surfaces??[]).filter(surface=>{
    if(!Number.isFinite(surface.baseY)||!Array.isArray(surface.polygon)||surface.polygon.length<3)return false;
    const z=surface.polygon.map(point=>point[1]);
    return z.every(Number.isFinite)&&Math.min(...z)>=-EPSILON&&Math.max(...z)<=2.45+EPSILON&&surface.baseY>=-1.05-EPSILON&&surface.baseY<=EPSILON;
  });
}

/** Pure floor-following route data in the viewer's already-shortened coordinates.
 * A blocked, incomplete or malformed authored route produces no guide. This
 * never invents a detour, draws through furniture or points onto the kiosk base.
 */
export function sampleActivationRoute(layout={}){
  if(!Array.isArray(layout.activationRoute)||!finitePoint(layout.activation?.approach))return [];
  const route=layout.activationRoute.map(point=>({...point}));
  if(route.length)route[route.length-1]={...layout.activation.approach};
  return sampleFloorRoute(layout,route);
}

export function sampleFloorRoute(layout={},waypoints){
  if(!Array.isArray(waypoints)||waypoints.length<2||!waypoints.every(finitePoint))return [];
  const route=waypoints.map(({x,z})=>({x,z}));
  const stairs=stairSurfaces(layout),result=[];
  const base=layout.activation?.position;
  let travelled=0,previous=null;
  function clear(point){
    return canStand(point.x,point.z,layout)&&(!finitePoint(base)||distance(point,base)>=.60);
  }
  function add(point,along){
    if(result.length>=MAX_SAMPLES||!clear(point))return false;
    const height=floorHeight(point.x,point.z,layout);
    if(!Number.isFinite(height))return false;
    // A runner or rug can stand a few centimetres above the walking surface.
    // Only the rendered dots follow finishes; step clearance uses floorHeight.
    let surfaceY=height;
    for(const finish of layout.floorFinishes??[]){
      if(Number.isFinite(finish.topY)&&Array.isArray(finish.polygon)&&finish.polygon.length>=3&&
         finish.polygon.every(p=>Array.isArray(p)&&p.length>=2&&p.every(Number.isFinite))&&
         insidePolygon(point.x,point.z,finish.polygon))surfaceY=Math.max(surfaceY,finish.topY);
    }
    if(result.length&&distance(point,result.at(-1))<EPSILON)return true;
    result.push({x:point.x,y:surfaceY+FLOOR_OFFSET,z:point.z,surfaceY,distance:along,stairs:stairs.some(surface=>insidePolygon(point.x,point.z,surface.polygon))});
    return true;
  }
  if(!add(route[0],0))return [];
  for(let segment=1;segment<route.length;segment++){
    const a=route[segment-1],b=route[segment],length=distance(a,b);
    if(length<EPSILON)continue;
    if(!Number.isFinite(length)||length/NORMAL_SPACING>MAX_SAMPLES)return [];
    // Probe more densely than the dot spacing so a thin collision obstacle
    // between two legal dots cannot be hidden by the visualization.
    const probes=Math.ceil(length/.10);
    for(let i=1;i<=probes;i++){
      const t=i/probes,point={x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};
      if(!clear(point))return [];
      const height=floorHeight(point.x,point.z,layout);
      if(!Number.isFinite(height)||(previous&&Math.abs(height-previous.height)>.251))return [];
      previous={height};
    }
    const cuts=[0,1];
    if(Math.abs(b.z-a.z)>EPSILON){
      for(const boundary of [0,2.45]){
        const t=(boundary-a.z)/(b.z-a.z);
        if(t>EPSILON&&t<1-EPSILON)cuts.push(t);
      }
    }
    cuts.sort((x,y)=>x-y);
    for(let part=1;part<cuts.length;part++){
      const t0=cuts[part-1],t1=cuts[part],middle=(t0+t1)/2;
      const mx=a.x+(b.x-a.x)*middle,mz=a.z+(b.z-a.z)*middle;
      const onStairs=stairs.some(surface=>insidePolygon(mx,mz,surface.polygon));
      const count=Math.max(1,Math.ceil(length*(t1-t0)/(onStairs?STAIR_SPACING:NORMAL_SPACING)));
      if(result.length+count>MAX_SAMPLES)return [];
      for(let i=1;i<=count;i++){
        const t=t0+(t1-t0)*i/count;
        if(!add({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t},travelled+length*t))return [];
      }
    }
    travelled+=length;
  }
  if(result.length<2)return [];
  return result;
}

/** Two unlit instanced layers; the caller controls walk-mode visibility. */
export function createActivationGuide(THREE,layout,{reducedMotion={matches:false},route,dimmed=false,distanceOffset=0}={}){
  const root=new THREE.Group();root.name='Activation luminous route';
  root.userData.role='activation-guide';
  const points=route?sampleFloorRoute(layout,route):sampleActivationRoute(layout);
  root.userData.pointCount=points.length;
  root.userData.endpoint=route?'authored-route':'activation.approach';
  root.userData.dimmed=dimmed;
  let disposed=false,elapsed=0,lastReduced;
  const geometries=[],materials=[],meshes=[];
  if(points.length){
    const coreGeometry=new THREE.CircleGeometry(.043,12);
    const haloGeometry=new THREE.CircleGeometry(.105,16);
    const coreMaterial=new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
    const haloMaterial=new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false,transparent:true,opacity:.32,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
    const halo=new THREE.InstancedMesh(haloGeometry,haloMaterial,points.length);
    const core=new THREE.InstancedMesh(coreGeometry,coreMaterial,points.length);
    halo.name='Activation guide cyan halos';core.name='Activation guide white dots';
    halo.renderOrder=2;core.renderOrder=3;
    const matrix=new THREE.Matrix4().makeRotationX(-Math.PI/2);
    points.forEach((point,index)=>{
      matrix.setPosition(point.x,point.y,point.z);halo.setMatrixAt(index,matrix);
      matrix.setPosition(point.x,point.y+.002,point.z);core.setMatrixAt(index,matrix);
    });
    for(const mesh of [halo,core]){
      mesh.castShadow=mesh.receiveShadow=false;mesh.frustumCulled=false;
      mesh.instanceMatrix.needsUpdate=true;root.add(mesh);
    }
    geometries.push(coreGeometry,haloGeometry);materials.push(coreMaterial,haloMaterial);meshes.push(halo,core);
  }
  const white=new THREE.Color(0xeefcff),cyan=new THREE.Color(0x27e4ff),color=new THREE.Color();
  function paint(still){
    if(!meshes.length)return;
    const [halo,core]=meshes;
    points.forEach((point,index)=>{
      // Positive-distance wave travels from spawn toward the visitor approach.
      // A five-metre repeating train is continuous, slow and gently eased.
      const wave=still ? .65 : Math.max(0,Math.cos((point.distance+distanceOffset-elapsed*1.15)*Math.PI*2/5))**6;
      const intensity=dimmed?.18:1;
      core.setColorAt(index,color.copy(white).multiplyScalar((still ? .86 : .45+.55*wave)*intensity));
      halo.setColorAt(index,color.copy(cyan).multiplyScalar((still ? .80 : .38+.62*wave)*intensity));
    });
    for(const mesh of meshes)if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  }
  function update(dt=0){
    if(disposed)return;
    const still=dimmed||!!reducedMotion.matches;
    if(still&&lastReduced===true)return;
    if(!still&&Number.isFinite(dt)&&dt>0)elapsed=(elapsed+Math.min(dt,.10))%1000;
    paint(still);lastReduced=still;
  }
  update(0);
  return{
    root,points,update,
    dispose(){
      if(disposed)return;disposed=true;
      root.parent?.remove(root);root.clear();
      for(const geometry of geometries)geometry.dispose();
      for(const material of materials)material.dispose();
    },
  };
}

/** Stable scene owner; progress lives in the tour controller, never in meshes. */
export function createGuidedRoutes(THREE,layout,{state={phase:'entry'},reducedMotion={matches:false}}={}){
  const root=new THREE.Group();root.name='Guided luminous routes';root.userData.role='activation-guide';
  let routes=[],key,disposed=false;
  function setState(next){
    if(disposed)return;
    const signature=JSON.stringify([next.phase,!!next.milestones?.passport,!!next.milestones?.palta]);
    if(signature===key)return;
    key=signature;for(const route of routes)route.dispose();routes=[];
    const add=(id,options={})=>{
      const guide=createActivationGuide(THREE,layout,{reducedMotion,...options});
      guide.root.userData.role='floor-route';guide.root.userData.routeId=id;
      routes.push(guide);root.add(guide.root);return guide;
    };
    if(next.phase==='entry')add('entry');
    else if(next.phase==='companies'){
      const trunk=add('companies',{route:layout.companyRoutes?.trunk??[]});
      const offset=trunk.points.at(-1)?.distance??0;
      for(const branch of layout.companyRoutes?.branches??[]){
        if(!['passport','palta'].includes(branch.id))continue;
        add(branch.id,{route:branch.points,dimmed:!!next.milestones?.[branch.id],distanceOffset:offset});
      }
    }
    root.userData.phase=next.phase;
    root.userData.pointCount=routes.reduce((sum,route)=>sum+route.points.length,0);
  }
  setState(state);
  return{root,setState,get routes(){return routes;},get points(){return routes.flatMap(route=>route.points.map(point=>({...point,routeId:route.root.userData.routeId})));},
    update(dt){if(!disposed)for(const route of routes)route.update(dt);},
    dispose(){if(disposed)return;disposed=true;for(const route of routes)route.dispose();routes=[];root.parent?.remove(root);root.clear();}
  };
}
