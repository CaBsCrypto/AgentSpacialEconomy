import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Writable,Readable} from 'node:stream';
import {platformContinuationUrl,resolvePlatformRequest,platformCanonicalPath} from '../dist/platform-routing.mjs';
import {createWalletDevelopmentServer} from '../scripts/serve-wallet.mjs';

const origin='https://agenticreality.space';

test('only known legacy root links continue to ONE16 with their exact query and fragment',()=>{
 for(const tail of ['?passport=stand16&entry=nfc#recorrido','?passport=return&lang=es#recorrido','?ar_fallback=1#recorrido','?native_fallback=1#accessibleTour','#recorrido','#accessibleTour']){
  assert.equal(platformContinuationUrl(origin+'/'+tail),origin+'/one16'+tail);
 }
 for(const href of [origin+'/',origin+'/?lang=es',origin+'/?passport=unknown',origin+'/#vision',origin+'/one16#recorrido',origin+'/passport-space.html#recorrido','mailto:hello@example.com','not a URL'])assert.equal(platformContinuationUrl(href),null);
});

test('legacy continuation cannot consume a supplied external destination or change the visitor origin',()=>{
 for(const host of ['https://preview.example','http://localhost:4318','https://one16-preview-a123.vercel.app']){
  const href=host+'/?passport=stand16&next=https%3A%2F%2Fevil.example#recorrido';
  const continued=platformContinuationUrl(href);
  assert.equal(new URL(continued).origin,new URL(href).origin);
  assert.equal(continued,host+'/one16?passport=stand16&next=https%3A%2F%2Fevil.example#recorrido');
 }
});

test('server routes prioritize NFC before brand landing and normalize duplicate experience URLs',()=>{
 assert.deepEqual(resolvePlatformRequest(origin+'/'),{type:'file',pathname:'/platform.html'});
 assert.deepEqual(resolvePlatformRequest(origin+'/?lang=es'),{type:'file',pathname:'/platform.html'});
 for(const query of ['?passport=stand16','?passport=return','?passport=stand16&ar_fallback=1'])assert.deepEqual(resolvePlatformRequest(origin+'/'+query),{type:'file',pathname:'/index.html'});
 assert.deepEqual(resolvePlatformRequest(origin+'/one16'),{type:'file',pathname:'/index.html'});
 assert.deepEqual(resolvePlatformRequest(origin+'/?ar_fallback=1#recorrido'),{type:'redirect',status:308,destination:'/one16?ar_fallback=1#recorrido'});
 assert.deepEqual(resolvePlatformRequest(origin+'/one16/?lang=es'),{type:'redirect',status:308,destination:'/one16?lang=es'});
 assert.deepEqual(resolvePlatformRequest(origin+'/index.html?passport=stand16'),{type:'redirect',status:308,destination:'/one16?passport=stand16'});
 assert.deepEqual(resolvePlatformRequest(origin+'/platform.html?lang=es'),{type:'redirect',status:308,destination:'/?lang=es'});
 for(const route of ['/assets/one16.glb','/api/wallet/config','/passport-station.html','/one16/assets/missing.glb'])assert.equal(resolvePlatformRequest(origin+route),null);
});

test('platform and ONE16 have distinct canonical URLs while standalone AR paths remain unchanged',()=>{
 assert.equal(platformCanonicalPath('platform.html'),'/');
 assert.equal(platformCanonicalPath('index.html'),'/one16');
 assert.equal(platformCanonicalPath('passport-space.html'),'/passport-space.html');
});

/** A filesystem-first config would serve index at /. Reproduce that boundary explicitly. */
function resolveAdvancedRoute(config,href){
 const url=new URL(href),headers={};
 const files=new Set(['/index.html','/platform.html','/api/wallet/config','/assets/passport-spatial.glb','/passport-space.html']);
 const condition=item=>{
  const value=item.type==='host'?url.hostname:item.type==='query'?url.searchParams.get(item.key):null;
  return value!==null&&(item.value===undefined||new RegExp('^(?:'+item.value+')$').test(value));
 };
 for(const rule of config.routes){
  if(rule.handle==='filesystem'){
   const file=url.pathname==='/'?'/index.html':url.pathname;
   if(files.has(file))return{type:'filesystem',destination:file,headers};
   continue;
  }
  const match=new RegExp(rule.src).exec(url.pathname);
  if(!match||!((rule.has||[]).every(condition))||(rule.missing||[]).some(condition))continue;
  Object.assign(headers,rule.headers);
  if(rule.status&&headers.Location){
   const target=headers.Location.replace(/\$(\d+)/g,(_,index)=>match[Number(index)]||'');
   return{type:'redirect',destination:target+url.search,status:rule.status,headers};
  }
  if(rule.dest)return{type:'file',destination:rule.dest,headers};
 }
 return{type:'missing',headers};
}

test('advanced Vercel routes beat the physical index while preserving NFC, canonical redirects and API headers',async()=>{
 const config=JSON.parse(await fs.readFile(new URL('../vercel.json',import.meta.url)));
 assert.equal(config.rewrites,undefined);assert.equal(config.redirects,undefined);assert.equal(config.headers,undefined);
 const boundary=config.routes.findIndex(rule=>rule.handle==='filesystem');assert.ok(boundary>0);
 const root=resolveAdvancedRoute(config,origin+'/');
 assert.equal(root.type,'file');assert.equal(root.destination,'/platform.html');
 assert.match(root.headers['Permissions-Policy'],/camera=\(self\)/);assert.equal(root.headers['X-Content-Type-Options'],'nosniff');assert.match(root.headers['Cache-Control'],/must-revalidate/);
 for(const query of ['?passport=stand16','?passport=return','?passport=stand16&ar_fallback=1'])assert.equal(resolveAdvancedRoute(config,origin+'/'+query).destination,'/index.html');
 assert.equal(resolveAdvancedRoute(config,origin+'/one16').destination,'/index.html');
 for(const [from,to]of[['/one16/','/one16'],['/index.html?passport=stand16','/one16?passport=stand16'],['/platform.html?lang=es','/?lang=es'],['/?ar_fallback=1','/one16?ar_fallback=1']]){
  const route=resolveAdvancedRoute(config,origin+from);assert.equal(route.status,308);assert.equal(route.destination,to);
 }
 for(const host of ['one16-passport-ar.vercel.app','www.agenticreality.space']){
  const redirected=resolveAdvancedRoute(config,'https://'+host+'/?passport=stand16');assert.equal(redirected.destination,origin+'/?passport=stand16');assert.equal(redirected.status,308);
 }
 for(const source of ['/api/wallet/config','/assets/passport-access.json']){
  const route=resolveAdvancedRoute(config,origin+source);
  for(const name of ['Cache-Control','CDN-Cache-Control','Vercel-CDN-Cache-Control'])assert.match(route.headers[name],/no-store/);
 }
 for(const source of ['/assets/passport-spatial.glb','/passport-space.html','/api/wallet/config'])assert.equal(resolveAdvancedRoute(config,origin+source).type,'filesystem');
 assert.equal(config.functions['api/wallet/faucet.js'].maxDuration,180);
 assert.ok(config.functions['api/wallet/faucet.js'].includeFiles.includes('@sozu/faucet'));
});

test('local server handler serves landing/NFC/ONE16, keeps assets root-relative and delegates APIs intact',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'one16-platform-routing-'));
 await fs.mkdir(path.join(dir,'assets'));
 await fs.writeFile(path.join(dir,'platform.html'),'<h1>Agentic Reality Space</h1>');
 await fs.writeFile(path.join(dir,'index.html'),'<h1>ONE16</h1><script type="module" src="./entry.mjs"></script>');
 await fs.writeFile(path.join(dir,'entry.mjs'),'export const ready=true;');
 await fs.writeFile(path.join(dir,'passport-space.html'),'<h1>Spatial Passport</h1>');
 await fs.writeFile(path.join(dir,'assets','one16.glb'),'model fixture');
 const apiRequests=[];
 const server=createWalletDevelopmentServer({distRoot:dir,apiHandlers:new Map([['/api/wallet/config',(req,res)=>{apiRequests.push({method:req.method,origin:req.headers.origin});res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'private, no-store'});res.end('{"enabled":false}');}]])});
 // Execute the actual Node request listener against real streams/files, without a loopback socket.
 // Restricted Windows runners can prohibit loopback connects even within the same process.
 const base='http://localhost:4318';
 const localFetch=(input,options={})=>new Promise((resolve,reject)=>{
  const url=new URL(input),request=Readable.from([]),chunks=[];
  request.url=url.pathname+url.search;request.method=options.method||'GET';
  request.headers=Object.fromEntries(Object.entries(options.headers||{}).map(([key,value])=>[key.toLowerCase(),value]));
  class Result extends Writable {
   headers={};statusCode=200;headersSent=false;
   writeHead(status,headers={}){this.statusCode=status;this.headers=headers;this.headersSent=true;return this;}
   _write(chunk,encoding,done){chunks.push(Buffer.from(chunk));done();}
  }
  const response=new Result();
  response.on('error',reject);response.on('finish',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));
  void server.listeners('request')[0](request,response).catch(reject);
 });
 t.after(async()=>{await fs.rm(dir,{recursive:true,force:true});});
 const root=await localFetch(base+'/');assert.equal(root.status,200);assert.match(await root.text(),/Agentic Reality Space/);
 for(const suffix of ['/one16','/?passport=stand16','/?passport=return','/?passport=stand16&ar_fallback=1']){
  const response=await localFetch(base+suffix);assert.equal(response.status,200);assert.match(await response.text(),/ONE16/);
 }
 for(const [source,target] of [['/one16/?lang=es','/one16?lang=es'],['/index.html?passport=stand16','/one16?passport=stand16'],['/platform.html?lang=es','/?lang=es'],['/?ar_fallback=1','/one16?ar_fallback=1']]){
  const response=await localFetch(base+source,{redirect:'manual'});assert.equal(response.status,308);assert.equal(response.headers.get('location'),target);
 }
 const moduleUrl=new URL('./entry.mjs',base+'/one16');assert.equal(moduleUrl.pathname,'/entry.mjs');
 const moduleResponse=await localFetch(moduleUrl);assert.equal(moduleResponse.status,200);assert.match(moduleResponse.headers.get('Content-Type'),/javascript/);
 const model=await localFetch(base+'/assets/one16.glb');assert.equal(model.headers.get('Content-Type'),'model/gltf-binary');
 const standalone=await localFetch(base+'/passport-space.html');assert.match(await standalone.text(),/Spatial Passport/);
 const head=await localFetch(base+'/one16',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
 assert.equal((await localFetch(base+'/one16',{method:'POST'})).status,405);
 assert.equal((await localFetch(base+'/one16/assets/missing.glb')).status,404);
 const api=await localFetch(base+'/api/wallet/config',{headers:{Origin:base}});assert.equal(api.status,200);assert.equal(api.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(apiRequests,[{method:'GET',origin:base}]);
 const traversal=await localFetch(base+'/%2e%2e%2fserver%2fwallet%2fconfig.mjs');assert.equal(traversal.status,403);
});
