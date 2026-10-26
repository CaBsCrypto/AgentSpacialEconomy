import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {CANONICAL_ORIGIN,LEGACY_HOSTS,canonicalContinuationUrl,canonicalBootstrapScript} from '../dist/site-origin.mjs';

test('old NFC and www continue to the canonical domain with exact route, query and fragment',()=>{
 for(const host of LEGACY_HOSTS){
  assert.equal(canonicalContinuationUrl(`https://${host}/?passport=stand16&native_fallback=1#recorrido`),CANONICAL_ORIGIN+'/?passport=stand16&native_fallback=1#recorrido');
  assert.equal(canonicalContinuationUrl(`https://${host}/passport-station.html?from=nfc`),CANONICAL_ORIGIN+'/passport-station.html?from=nfc');
 }
 assert.equal(canonicalContinuationUrl('http://agenticreality.space/passport-space.html#place'),CANONICAL_ORIGIN+'/passport-space.html#place');
});
test('canonical, exact preview, localhost and unrelated sites are not redirected',()=>{
 for(const href of [CANONICAL_ORIGIN+'/?passport=stand16#recorrido','https://one16-passport-build-team.vercel.app/?passport=stand16','http://localhost:4318/','https://one16-passport-ar.vercel.app.evil.example/'])assert.equal(canonicalContinuationUrl(href),null);
});
test('inline guard uses replace before storage/modules and preserves the browser-only fragment',()=>{
 const redirects=[],location={href:'https://one16-passport-ar.vercel.app/?passport=stand16#recorrido',replace:value=>redirects.push(value)};
 vm.runInNewContext(canonicalBootstrapScript(),{URL,location});assert.deepEqual(redirects,[CANONICAL_ORIGIN+'/?passport=stand16#recorrido']);
 location.href=CANONICAL_ORIGIN+'/';vm.runInNewContext(canonicalBootstrapScript(),{URL,location});assert.equal(redirects.length,1);
 const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');assert.ok(html.indexOf('data-one16-canonical')<html.indexOf('classList.add(\'one16-booting\')'));assert.ok(html.indexOf('data-one16-canonical')<html.indexOf('type="module"'));assert.match(html,/entry\.mjs\?v=hackmeridian-unify-2/);
});
test('every standalone entry has the same early canonical guard and its own canonical URL',()=>{
 const dir=new URL('../dist/',import.meta.url);for(const filename of fs.readdirSync(dir).filter(name=>name.endsWith('.html'))){
  const html=fs.readFileSync(new URL(filename,dir),'utf8');assert.equal((html.match(/data-one16-canonical/g)||[]).length,1,filename);
  assert.ok(html.includes('href="'+CANONICAL_ORIGIN+(filename==='index.html'?'/one16':filename==='platform.html'?'/':'/'+filename)+'"'),filename);
 }
});
test('host redirects keep old NFC routes; wallet APIs and access metadata cannot be cached',()=>{
 const config=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url)));
 const hostRules=config.routes.filter(rule=>rule.has?.some(item=>item.type==='host'&&item.value==='one16-passport-ar.vercel.app'));
 const old=hostRules.find(rule=>rule.headers?.Location===CANONICAL_ORIGIN+'/$1');assert.ok(old);assert.equal(old.status,308);
 const root=hostRules.find(rule=>rule.src==='^/$');assert.equal(root.headers.Location,CANONICAL_ORIGIN+'/');assert.equal(root.status,308);
 assert.equal(config.routes.some(rule=>rule.has?.some(item=>item.type==='host'&&item.value?.includes('*'))),false);
 for(const requestPath of ['/api/wallet/config','/assets/passport-access.json']){
  const rules=config.routes.filter(rule=>rule.src&&new RegExp(rule.src).test(requestPath)&&rule.continue&&rule.headers);
  const headers=Object.assign({},...rules.map(rule=>rule.headers));
  for(const name of ['Cache-Control','CDN-Cache-Control','Vercel-CDN-Cache-Control'])assert.match(headers[name],/no-store/);
 }
 const access=JSON.parse(fs.readFileSync(new URL('../dist/assets/passport-access.json',import.meta.url)));
 assert.equal(access.origin,CANONICAL_ORIGIN);assert.equal(access.url,CANONICAL_ORIGIN+'/passport-station.html');
});
