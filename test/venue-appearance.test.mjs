import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const bytes=fs.readFileSync(new URL('../dist/assets/one16.glb',import.meta.url));
const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
const layout=JSON.parse(fs.readFileSync(new URL('../dist/assets/layout.json',import.meta.url)));
test('PBR export preserves timber and blue fabric tints and all surface channels',()=>{
 for(const [name,color] of [['Aged floor timber 0',[.25,.225,.18,1]],['Petrol blue upholstery',[.035,.19,.29,1]]]){
  const material=gltf.materials.find(m=>m.name===name);assert.ok(material,name);
  const pbr=material.pbrMetallicRoughness;assert.ok(pbr.baseColorTexture,name+' color map');
  assert.ok(pbr.metallicRoughnessTexture,name+' roughness map');assert.ok(material.normalTexture,name+' normal map');
  assert.equal(pbr.baseColorFactor.length,4);
  pbr.baseColorFactor.forEach((v,i)=>assert.ok(Math.abs(v-color[i])<1e-5,name+' tint component '+i));
 }
 const sources=new Set(gltf.textures.map(t=>t.source));
 assert.ok(sources.size<=34,'Shared image sources must not multiply with material count');
 assert.ok(gltf.images.some(i=>i.mimeType==='image/jpeg'),'Compressed color maps are exported');
});
test('the narrated exhibition has four dividers, eight branded positions and a wider aisle',()=>{
 assert.equal(layout.exhibition.dividerCount,4);assert.equal(layout.exhibition.positionCount,8);
 assert.equal(layout.exhibition.positions.length,8);assert.ok(layout.exhibition.aisleWidth>=4.4);
 assert.equal(new Set(layout.exhibition.positions.map(p=>p.graphic)).size,8);
 for(const side of ['left','right'])for(const row of [1,2]){
  assert.deepEqual(layout.exhibition.positions.filter(p=>p.side===side&&p.row===row).map(p=>p.face),['arrival','stage']);
 }
 assert.ok(layout.zones.find(z=>z.id==='passport-stand16'));
});
