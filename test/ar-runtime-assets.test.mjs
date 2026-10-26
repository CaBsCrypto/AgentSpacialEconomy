import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const root=new URL('../',import.meta.url),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
test('isolated AR runtime files match pinned distribution hashes and resolve local imports',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('dist/vendor/ar-runtime.json',root)));assert.equal(manifest.three,'0.160.0');assert.equal(manifest.mindar,'1.2.5');
 for(const entry of manifest.files){const file=new URL(entry.file,root),bytes=fs.readFileSync(file);assert.equal(hash(bytes),entry.sha256,entry.file);
 if(!entry.file.endsWith('.js'))continue;
 const text=bytes.toString('utf8');for(const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]*?\sfrom\s*)?['"]([^'"]+)['"]/g)){
 const spec=m[1];if(spec.startsWith('.'))assert.ok(fs.existsSync(new URL(spec,file)),spec);else if(spec.startsWith('three/addons/'))assert.ok(fs.existsSync(new URL('dist/vendor/ar-three/examples/jsm/'+spec.slice(13),root)),spec);else assert.equal(spec,'three');
 }
 }
});
test('compiled Passport target is bound to exact source image and contains real extraction output',()=>{
 const report=JSON.parse(fs.readFileSync(new URL('dist/assets/passport-target.compiled.json',root))),image=fs.readFileSync(new URL(report.input,root)),mind=fs.readFileSync(new URL(report.output,root));
 assert.equal(report.compiler,'mind-ar@1.2.5 OfflineCompiler');assert.equal(report.format,2);assert.equal(report.width,1000);assert.equal(report.height,1200);assert.equal(hash(image),report.inputSha256);assert.equal(hash(mind),report.sha256);assert.equal(mind.length,report.bytes);assert.ok(mind.length>100000);assert.ok(report.matching.every(k=>k.maxima+k.minima>0));assert.ok(report.tracking.some(k=>k.points>=10));assert.equal(report.physicalRecognitionVerified,false);
});
