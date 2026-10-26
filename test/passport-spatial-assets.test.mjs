import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Box3,Matrix4,Quaternion,Vector3} from 'three';

const root=fileURLToPath(new URL('../',import.meta.url)),asset=name=>fs.readFileSync(path.join(root,'dist/assets',name));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function glb(bytes){
 assert.equal(bytes.toString('ascii',0,4),'glTF');assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
 const chunks=[];for(let offset=12;offset<bytes.length;){const length=bytes.readUInt32LE(offset),type=bytes.readUInt32LE(offset+4);assert.equal(length%4,0);chunks.push({type,data:bytes.subarray(offset+8,offset+8+length)});offset+=8+length;}
 return {document:JSON.parse(chunks.find(c=>c.type===0x4e4f534a).data.toString('utf8')),chunks,binary:chunks.find(c=>c.type===0x004e4942).data};
}
function bounds(document){
 const box=new Box3();
 const visit=(index,parent)=>{
  const node=document.nodes[index],local=node.matrix?new Matrix4().fromArray(node.matrix):new Matrix4().compose(new Vector3(...(node.translation||[0,0,0])),new Quaternion(...(node.rotation||[0,0,0,1])),new Vector3(...(node.scale||[1,1,1]))),world=new Matrix4().multiplyMatrices(parent,local);
  if(node.mesh!==undefined)for(const primitive of document.meshes[node.mesh].primitives){const accessor=document.accessors[primitive.attributes.POSITION];box.union(new Box3(new Vector3(...accessor.min),new Vector3(...accessor.max)).applyMatrix4(world));}
  for(const child of node.children||[])visit(child,world);
 };
 for(const node of document.scenes[document.scene||0].nodes)visit(node,new Matrix4());return box;
}
const crcTable=Array.from({length:256},(_,index)=>{let value=index;for(let i=0;i<8;i++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function crc32(bytes){let value=0xffffffff;for(const byte of bytes)value=(value>>>8)^crcTable[(value^byte)&255];return(value^0xffffffff)>>>0;}
function zip(bytes){
 const entries=[];let offset=0;
 while(bytes.readUInt32LE(offset)===0x04034b50){
  const flags=bytes.readUInt16LE(offset+6),method=bytes.readUInt16LE(offset+8),crc=bytes.readUInt32LE(offset+14),size=bytes.readUInt32LE(offset+18),rawSize=bytes.readUInt32LE(offset+22),nameLength=bytes.readUInt16LE(offset+26),extraLength=bytes.readUInt16LE(offset+28),name=bytes.toString('utf8',offset+30,offset+30+nameLength),start=offset+30+nameLength+extraLength;
  assert.equal(flags&9,0,'USDZ entries must be unencrypted and have no data descriptors');assert.equal(method,0,'USDZ uses ZIP_STORED');assert.equal(size,rawSize);assert.equal(start%64,0,`${name} starts on a 64-byte boundary`);
  const data=bytes.subarray(start,start+size);assert.equal(data.length,size);assert.equal(crc32(data),crc,`${name} CRC`);entries.push({name,start,data});offset=start+size;
 }
 assert.equal(bytes.readUInt32LE(offset),0x02014b50);assert.equal(entries[0].name,'model.usda');return entries;
}
const sourceGLB=asset('passport.glb'),sourceUSDZ=asset('passport.usdz'),nativeGLB=asset('passport-spatial.glb'),nativeUSDZ=asset('passport-spatial.usdz');
const original=glb(sourceGLB),spatial=glb(nativeGLB);

test('native spatial GLB wraps the existing roots without altering geometry, materials or source JPEG bytes',()=>{
 assert.deepEqual(spatial.binary,original.binary);
 for(const key of ['buffers','bufferViews','accessors','meshes','materials','textures','samplers','images','asset'])assert.deepEqual(spatial.document[key],original.document[key],key);
 assert.deepEqual(spatial.document.nodes.slice(0,-1),original.document.nodes);
 const rootIndex=spatial.document.scenes[spatial.document.scene||0].nodes[0],node=spatial.document.nodes[rootIndex];
 assert.equal(spatial.document.scenes[spatial.document.scene||0].nodes.length,1);assert.deepEqual(node.children,original.document.scenes[original.document.scene||0].nodes);
 const image=spatial.document.images[0],view=spatial.document.bufferViews[image.bufferView];assert.equal(image.mimeType,'image/jpeg');
 assert.deepEqual(spatial.binary.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength),asset('passport-cover.jpg'));
});

test('native placement is upright, twenty centimetres wide, centered eighteen centimetres above the anchor',()=>{
 const node=spatial.document.nodes.at(-1),matrix=new Matrix4().fromArray(node.matrix),size=bounds(spatial.document).getSize(new Vector3()),center=bounds(spatial.document).getCenter(new Vector3());
 assert.ok(Math.abs(size.x-.20)<1e-9,`width ${size.x}`);assert.ok(size.y>.25&&size.y<.27,`height ${size.y}`);assert.ok(size.z>.012&&size.z<.015,`thickness ${size.z}`);
 assert.ok(Math.abs(center.x)<1e-9);assert.ok(Math.abs(center.y-.18)<1e-9);assert.ok(Math.abs(center.z)<1e-9);assert.ok(bounds(spatial.document).min.y>.04,'geometry floats above its horizontal anchor');
 const front=new Vector3(0,1,0).transformDirection(matrix);assert.ok(front.distanceTo(new Vector3(0,0,1))<1e-12,'front +Y becomes viewer-facing +Z');
 const metadata=node.extras;assert.equal(metadata.widthMeters,.20);assert.equal(metadata.centerHeightMeters,.18);
});

test('native USDZ preserves every source payload except the top scene transform and shares GLB orientation',()=>{
 const sourceEntries=zip(sourceUSDZ),nativeEntries=zip(nativeUSDZ);assert.deepEqual(nativeEntries.map(e=>e.name),sourceEntries.map(e=>e.name));
 for(let i=1;i<sourceEntries.length;i++)assert.deepEqual(nativeEntries[i].data,sourceEntries[i].data,sourceEntries[i].name);
 const source=sourceEntries[0].data.toString('utf8'),native=nativeEntries[0].data.toString('utf8');
 assert.equal((native.match(/# Passport native upright placement/g)||[]).length,1);
 const restored=native.replace(/^[ \t]*# Passport native upright placement\r?\n[ \t]*matrix4d xformOp:transform = [^\r\n]*\r?\n[ \t]*uniform token\[\] xformOpOrder = \["xformOp:transform"\]\r?\n/m,'');
 assert.equal(restored,source,'scene transform is the only USD content change');
 assert.match(native,/metersPerUnit = 1/);assert.match(native,/upAxis = "Y"/);assert.match(native,/token preliminary:anchoring:type = "plane"/);assert.match(native,/token preliminary:planeAnchoring:alignment = "horizontal"/);
 const line=native.slice(native.indexOf('# Passport native upright placement')).split(/\r?\n/)[1],values=line.slice(line.indexOf('=')+1).match(/[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g).map(Number);
 assert.deepEqual(values,spatial.document.nodes.at(-1).matrix,'USD row-major matrix and glTF column-major values encode the same placement');
});

test('the spatial builder is reproducible and does not modify the supplied source assets',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'passport-spatial-assets-'));const before=[hash(asset('passport.glb')),hash(asset('passport.usdz'))];
 try{
  const run=spawnSync(process.env.PASSPORT_PYTHON||'python',[path.join(root,'scripts/build-passport-spatial.py'),'--output-dir',directory],{encoding:'utf8',windowsHide:true});assert.equal(run.status,0,run.stderr||run.stdout);
  const result=JSON.parse(run.stdout);assert.equal(result.widthMeters,.20);assert.equal(result.centerHeightMeters,.18);
  assert.deepEqual(fs.readFileSync(path.join(directory,'passport-spatial.glb')),nativeGLB);assert.deepEqual(fs.readFileSync(path.join(directory,'passport-spatial.usdz')),nativeUSDZ);
  assert.deepEqual([hash(asset('passport.glb')),hash(asset('passport.usdz'))],before);
 }finally{
  for(const name of ['passport-spatial.glb','passport-spatial.usdz']){const file=path.join(directory,name);if(fs.existsSync(file))fs.unlinkSync(file);}
  fs.rmdirSync(directory);
 }
});
