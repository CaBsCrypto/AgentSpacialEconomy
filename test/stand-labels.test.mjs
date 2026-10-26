import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {PASSPORT_STAND,isPassportStandObject} from '../dist/passport-stand.mjs';
const source=process.env.STAND_LABEL_QA_GLB||fileURLToPath(new URL('../dist/assets/one16.glb',import.meta.url));
const layoutPath=process.env.STAND_LABEL_QA_LAYOUT||fileURLToPath(new URL('../dist/assets/layout.json',import.meta.url));
const bytes=fs.readFileSync(source),gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12))),layout=JSON.parse(fs.readFileSync(layoutPath));
const parse=async()=>{const loader=new GLTFLoader();loader.register(()=>({name:'headless-label-images',loadTexture:()=>Promise.resolve(new T.Texture())}));const result=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'');result.scene.updateMatrixWorld(true);return result.scene;};

test('all eight exported tabletop wordmarks face upward, preserve aspect and read from their own visitor side',async()=>{
 const model=await parse();
 for(const position of layout.exhibition.positions){
  const object=model.getObjectByName('Stands_printed_tabletop_'+position.graphic);assert(object,position.graphic);
  const p=object.geometry.attributes.position,uv=object.geometry.attributes.uv;
  const samples=Array.from({length:p.count},(_,i)=>({point:new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(object.matrixWorld),u:uv.getX(i),v:uv.getY(i)}));
  const average=points=>points.reduce((sum,p)=>sum.add(p.point),new T.Vector3()).multiplyScalar(1/points.length);
  const right=average(samples.filter(p=>p.u>.99)).sub(average(samples.filter(p=>p.u<.01)));
  const up=average(samples.filter(p=>p.v<.01)).sub(average(samples.filter(p=>p.v>.99)));
  const normal=new T.Vector3().fromBufferAttribute(object.geometry.attributes.normal,0).applyMatrix3(new T.Matrix3().getNormalMatrix(object.matrixWorld)).normalize();
  const sign=position.face==='arrival'?1:-1;
  assert(right.clone().normalize().dot(new T.Vector3(sign,0,0))>.999,position.brand+' mirrors U');
  assert(up.clone().normalize().dot(new T.Vector3(0,0,-sign))>.999,position.brand+' reverses image up');
  assert(normal.y>.999,position.brand+' faces under the tabletop');assert(object.matrixWorld.determinant()>0);
  assert(Math.abs(right.length()-1.84)<1e-5);assert(Math.abs(up.length()-.64)<1e-5);
  assert(Math.abs(right.length()/up.length()/(2048/712)-1)<.005);
  assert.equal(object.material.side,T.FrontSide);assert.equal(object.material.alphaTest,.5);
 }
});

test('the stable Grantfox and Trustless labels stay clear of the repeated divider logos',async()=>{
 const model=await parse(),pattern=model.getObjectByName('Stands_repeated_event_footer_booth-grantfox-trustless');assert(pattern);
 const patternBounds=new T.Box3().setFromObject(pattern);
 for(const name of ['Stands_label_Trustless_Work','Stands_label_Grantfox']){
  const label=model.getObjectByName(name);assert(label,name);
  const bounds=new T.Box3().setFromObject(label);
  assert(bounds.min.y>patternBounds.max.y+.12,`${name} overlaps or crowds the repeated-logo field`);
 }
});

test('the exported alpha masks contain landscape images rather than opaque portrait posters',()=>{
 const images=[];
 for(const material of gltf.materials.filter(m=>/^Venue graphic.*booth-/.test(m.name)&&!m.name.endsWith('booth-footer'))){
  assert.equal(material.alphaMode,'MASK',material.name);assert.notEqual(material.doubleSided,true,material.name);
  images.push(gltf.textures[material.pbrMetallicRoughness.baseColorTexture.index].source);
 }
 assert.equal(images.length,8);
 const python=`import json,sys,struct,io\nfrom PIL import Image\nb=open(sys.argv[1],'rb').read();n=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+n]);start=28+n;out=[]\nfor i in map(int,sys.argv[2:]):\n v=j['bufferViews'][j['images'][i]['bufferView']];im=Image.open(io.BytesIO(b[start+v.get('byteOffset',0):start+v.get('byteOffset',0)+v['byteLength']]));out.append({'size':im.size,'mode':im.mode,'alpha':im.getchannel('A').getextrema()})\nprint(json.dumps(out))`;
 const decoded=JSON.parse(execFileSync('python',['-c',python,source,...images.map(String)],{encoding:'utf8'}));
 for(const image of decoded){assert.deepEqual(image.size,[2048,712]);assert.equal(image.mode,'RGBA');assert.deepEqual(image.alpha,[0,255]);}
});

test('facing visitor counters retain a 1.05m passage and the lateral Passport entry remains clickable',async()=>{
 for(const side of ['left','right']){
  const reverse=layout.exhibition.positions.find(p=>p.side===side&&p.row===1&&p.face==='stage');
  const arrival=layout.exhibition.positions.find(p=>p.side===side&&p.row===2&&p.face==='arrival');
  assert(Math.abs(reverse.table.z-arrival.table.z)-.75>=1.05-1e-8);
 }
 const zone=layout.zones.find(z=>z.id===PASSPORT_STAND.id);assert(zone);assert.deepEqual(zone.view,{...PASSPORT_STAND.view});
 assert.equal(zone.polygon[0][0],2);
 const model=await parse(),origin=new T.Vector3(zone.view.x,1.45,zone.view.z),direction=new T.Vector3(PASSPORT_STAND.x-origin.x,0,PASSPORT_STAND.z-origin.z).normalize();
 const hit=new T.Raycaster(origin,direction).intersectObject(model,true)[0];assert(hit&&isPassportStandObject(hit.object));
});
