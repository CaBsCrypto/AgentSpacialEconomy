import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fetchModel} from '../dist/model-transfer.mjs';
const raw=await readFile(new URL('../dist/assets/one16.glb',import.meta.url));
const gz=await readFile(new URL('../dist/assets/one16.glb.gz',import.meta.url));
test('compressed runtime stream restores exact original model and reports progress',async()=>{
 const progress=[];let requests=0;
 const result=await fetchModel({fetcher:async url=>{requests++;assert.match(url,/glb.gz/);return new Response(gz)},onProgress:p=>progress.push(p)});
 assert.deepEqual(Buffer.from(result),raw);assert.equal(requests,1);assert.equal(progress.at(-1).loaded,gz.length);assert.ok(gz.length<raw.length*.2);
});
test('browser without gzip streaming support uses original GLB once',async()=>{
 let requests=0;const result=await fetchModel({decompressor:null,fetcher:async url=>{requests++;assert.match(url,/glb\?v=5/);return new Response(raw)}});
 assert.deepEqual(Buffer.from(result),raw);assert.equal(requests,1);
});
test('HTTP model errors are explicit and do not trigger duplicate downloads',async()=>{
 let n=0;await assert.rejects(fetchModel({fetcher:async()=>{n++;return new Response('',{status:503})}}),/HTTP 503/);assert.equal(n,1);
});
test('landing viewer defers heavy engine imports until initialization',async()=>{
 const src=await readFile(new URL('../dist/viewer.js',import.meta.url),'utf8');
 assert.doesNotMatch(src,/^import .*from ['"]three['"]/m);assert.match(src,/await loadEngine\(\)/);assert.match(src,/fetchModel\(/);
});
test('host-level gzip decoding is not decompressed twice',async()=>{
 const result=await fetchModel({fetcher:async()=>new Response(raw,{headers:{'content-encoding':'gzip'}})});assert.deepEqual(Buffer.from(result),raw);
});
