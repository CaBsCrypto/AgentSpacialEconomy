/** Articulates the supplied closed GLB; all Three.js classes come from the caller. */
export function createPassportBook(T,asset,{content={},createCanvas=()=>document.createElement('canvas'),reducedMotion=false,watermarkImage=null}={}){
 const resources=new Set(),added=[],originalParts=[],pageTextures=[];
 const object=new T.Group();object.name='Passport interactive book';
 const base=new T.Group();base.name='Passport normalized upright';object.add(base);base.add(asset);
 const assetTransform={position:asset.position.clone(),quaternion:asset.quaternion.clone(),scale:asset.scale.clone()};
 asset.updateMatrixWorld(true);
 const originalBounds=new T.Box3().setFromObject(asset),size=originalBounds.getSize(new T.Vector3());
 if(!Number.isFinite(size.x)||size.x<=0)throw Error('El Passport no tiene dimensiones válidas.');
 const inverse=new T.Matrix4().copy(asset.matrixWorld).invert();
 const localBounds=part=>new T.Box3().setFromObject(part).applyMatrix4(inverse);
 let front,edge,block;
 asset.traverse(part=>{const name=(part.name||'').replaceAll('_',' ').toLowerCase();if(name.startsWith('passport exact supplied front'))front=part;else if(name.startsWith('passport front gold binding edge'))edge=part;else if(name.startsWith('passport page block'))block=part;});
 if(!front||!edge||!block)throw Error('El modelo Passport no contiene una tapa y páginas articulables.');
 const coverBounds=localBounds(front),edgeBounds=localBounds(edge),paperBounds=localBounds(block),paperSize=paperBounds.getSize(new T.Vector3()),paperCenter=paperBounds.getCenter(new T.Vector3());
 const hingePosition=new T.Vector3(coverBounds.min.x,edgeBounds.getCenter(new T.Vector3()).y,paperCenter.z);
 const hinge=new T.Group();hinge.name='Passport front cover hinge';hinge.position.copy(hingePosition);asset.add(hinge);added.push(hinge);asset.updateMatrixWorld(true);
 for(const part of [edge,front]){originalParts.push({part,parent:part.parent,position:part.position.clone(),quaternion:part.quaternion.clone(),scale:part.scale.clone()});hinge.attach(part);}
 const own=resource=>{resources.add(resource);return resource;};
 const width=paperSize.x*.96,height=paperSize.z*.97;
 const geometry=own(new T.PlaneGeometry(width,height));
 const paperMaterial=own(new T.MeshBasicMaterial({color:'#eee7d4',side:T.BackSide,toneMapped:false}));
 const plane=(name,parent,material,x,y,z)=>{const mesh=new T.Mesh(geometry,material);mesh.name=name;mesh.rotation.x=-Math.PI/2;mesh.position.set(x,y,z);parent.add(mesh);return mesh;};
 // The inside of the cover faces -Y before opening, then +Y when fully open.
 plane('Passport inside front cover',hinge,paperMaterial,paperCenter.x-hingePosition.x,edgeBounds.min.y-hingePosition.y-.00004,paperCenter.z-hingePosition.z);
 const pageY=paperBounds.max.y+.00012;
 const pageMaterial=(entry,index)=>{
  const canvas=createCanvas();drawPage(canvas,entry,index,watermarkImage);
  const texture=own(new T.CanvasTexture(canvas));texture.colorSpace=T.SRGBColorSpace;pageTextures.push({canvas,entry,index,texture});
  return own(new T.MeshBasicMaterial({map:texture,side:T.FrontSide,toneMapped:false}));
 };
 const pages=content.pages||[];
 const second=plane('Passport information page 2',asset,pageMaterial(pages[1],2),paperCenter.x,pageY-.00008,paperCenter.z);added.push(second);
 const leaf=new T.Group();leaf.name='Passport turning information leaf';leaf.position.set(hingePosition.x,pageY,paperCenter.z);asset.add(leaf);added.push(leaf);
 plane('Passport information page 1',leaf,pageMaterial(pages[0],1),paperCenter.x-hingePosition.x,.00001,0);
 plane('Passport information leaf back',leaf,paperMaterial,paperCenter.x-hingePosition.x,-.00001,0);
 // The GLB is laid flat with its illustrated face along +Y. This keeps its UVs intact.
 asset.position.sub(originalBounds.getCenter(new T.Vector3()));base.rotation.x=Math.PI/2;base.scale.setScalar(1/size.x);
 object.updateMatrixWorld(true);
 let page=0,coverAngle=0,leafAngle=0,disposed=false;
 const apply=()=>{hinge.rotation.z=coverAngle;leaf.rotation.z=leafAngle;object.updateMatrixWorld(true);};
 const approach=(angle,target,step)=>angle<target?Math.min(target,angle+step):Math.max(target,angle-step);
 const api={
  object,
  get page(){return page;},
  get openness(){return coverAngle/Math.PI;},
  setPage(next,{immediate=false}={}){
   if(![0,1,2].includes(next))throw new RangeError('La página del Passport debe ser 0, 1 o 2.');
   if(disposed)return;
   page=next;
   if(immediate||reducedMotion){coverAngle=page?Math.PI:0;leafAngle=page===2?Math.PI:0;apply();}
  },
  setWatermarkImage(image){
   if(disposed)return false;
   watermarkImage=image||null;
   for(const {canvas,entry,index,texture} of pageTextures){drawPage(canvas,entry,index,watermarkImage);texture.needsUpdate=true;}
   return true;
  },
  update(dtSeconds){
   if(disposed||!Number.isFinite(dtSeconds)||dtSeconds<=0)return;
   const step=Math.min(dtSeconds,.1)*Math.PI/.48;
   if(page===0){
    // Close the leaf first so it cannot cut through the returning cover.
    leafAngle=approach(leafAngle,0,step);if(leafAngle===0)coverAngle=approach(coverAngle,0,step);
   }else{
    coverAngle=approach(coverAngle,Math.PI,step);
    if(page===1)leafAngle=approach(leafAngle,0,step);
    else if(coverAngle===Math.PI)leafAngle=approach(leafAngle,Math.PI,step);
   }
   apply();
  },
  dispose(){
   if(disposed)return;disposed=true;
   for(const {part,parent,position,quaternion,scale} of originalParts){parent.add(part);part.position.copy(position);part.quaternion.copy(quaternion);part.scale.copy(scale);}
   for(const node of added)node.removeFromParent();
   for(const resource of resources)resource.dispose();
   asset.position.copy(assetTransform.position);asset.quaternion.copy(assetTransform.quaternion);asset.scale.copy(assetTransform.scale);object.updateMatrixWorld(true);
  }
 };
 return api;
}

function drawPage(canvas,entry={},index,watermarkImage){
 canvas.width=1024;canvas.height=1340;const ctx=canvas.getContext('2d');
 if(!ctx)throw Error('No se pudo preparar la información del Passport.');
 ctx.fillStyle='#eee7d4';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.strokeStyle='#b99247';ctx.lineWidth=3;ctx.strokeRect(45,45,934,1250);
 ctx.fillStyle='#6c552e';ctx.font='600 32px system-ui, sans-serif';ctx.fillText('STELLAR PASSPORT',90,128);
 if(watermarkImage){
  ctx.globalAlpha=.10;
  try{ctx.drawImage(watermarkImage,230,500,560,554);}catch{}finally{ctx.globalAlpha=1;}
 }
 ctx.fillStyle='#112b49';ctx.font='700 88px system-ui, sans-serif';
 let y=260;const titleLines=wrap(ctx,String(entry?.title||`Página ${index}`),844);
 for(const line of titleLines){ctx.fillText(line,90,y);y+=104;}
 y+=48;
 const body=String(entry?.body||'Descubre Stellar Passport.');let bodySize=88,lines;
 do{ctx.font=`400 ${bodySize}px system-ui, sans-serif`;lines=wrap(ctx,body,844);if(lines.length*bodySize*1.3<=1170-y||bodySize<=70)break;bodySize-=2;}while(true);
 for(const line of lines){ctx.fillText(line,90,y);y+=bodySize*1.3;}
 ctx.fillStyle='#6c552e';ctx.font='500 32px system-ui, sans-serif';ctx.fillText(`${index} / 2`,90,1240);
}

function wrap(ctx,text,maxWidth){
 const result=[];
 for(const paragraph of text.split('\n')){
  let line='';
  for(const word of paragraph.trim().split(/\s+/).filter(Boolean)){
   if(line&&ctx.measureText(`${line} ${word}`).width>maxWidth){result.push(line);line='';}
   if(ctx.measureText(word).width>maxWidth){
    for(const char of word){if(line&&ctx.measureText(line+char).width>maxWidth){result.push(line);line='';}line+=char;}
   }else line+=(line?' ':'')+word;
  }
  result.push(line);
 }
 return result;
}

/** Load the original same-origin emblem without making it a dependency of the book. */
export function loadPassportWatermark({imageFactory=()=>new Image(),timeoutMs=5000}={}){
 return new Promise(resolve=>{
  let image,timer,settled=false;
  const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);if(image){image.onload=null;image.onerror=null;}resolve(value);};
  try{
   image=imageFactory();image.decoding='async';
   image.onload=()=>finish(image);image.onerror=()=>finish(null);
   timer=setTimeout(()=>finish(null),Math.max(0,Number.isFinite(timeoutMs)?timeoutMs:5000));
   image.src='./assets/passport-emblem.svg';
   if(image.complete&&image.naturalWidth>0)finish(image);
  }catch{finish(null);}
 });
}


