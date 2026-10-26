import test from 'node:test';import assert from 'node:assert/strict';
import {detectPassportSpatialSupport,mountPassportNativeAccess} from '../dist/passport-spatial-access.mjs';
const documentWithAR=supported=>({createElement:()=>({relList:{supports:value=>value==='ar'&&supported}})});

test('actual immersive-ar support takes precedence over user-agent native fallbacks',async()=>{
 const requests=[];const result=await detectPassportSpatialSupport({navigatorRef:{userAgent:'iPhone',xr:{isSessionSupported:async mode=>{requests.push(mode);return true;}}},documentRef:{createElement(){throw Error('unnecessary native detection');}},secure:true});
 assert.deepEqual(requests,['immersive-ar']);assert.deepEqual(result,{kind:'webxr'});
});

test('Quick Look requires an iOS device and an actual rel-ar feature declaration',async()=>{
 for(const navigatorRef of [{userAgent:'iPhone',platform:'iPhone'},{userAgent:'Mozilla Macintosh',platform:'MacIntel',maxTouchPoints:5}])assert.equal((await detectPassportSpatialSupport({navigatorRef,documentRef:documentWithAR(true),secure:true})).kind,'quick-look');
 assert.equal((await detectPassportSpatialSupport({navigatorRef:{userAgent:'iPhone'},documentRef:documentWithAR(false),secure:true})).kind,'unavailable');
 assert.equal((await detectPassportSpatialSupport({navigatorRef:{userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:0},documentRef:documentWithAR(true),secure:true})).kind,'unavailable');
});

test('Android without web AR offers an explicitly unverified native viewer rather than claiming installed ARCore',async()=>{
 const support=await detectPassportSpatialSupport({navigatorRef:{userAgent:'Android',xr:{isSessionSupported:async()=>{throw new DOMException('blocked','SecurityError');}}},documentRef:documentWithAR(false),secure:true});
 assert.deepEqual(support,{kind:'scene-viewer',reason:'native-viewer-not-verified'});
});

test('insecure contexts do not probe or offer camera-based placement',async()=>{
 let probes=0;const support=await detectPassportSpatialSupport({navigatorRef:{userAgent:'Android',xr:{isSessionSupported:async()=>{probes++;return true;}}},documentRef:documentWithAR(true),secure:false});
 assert.deepEqual(support,{kind:'unavailable',reason:'insecure-context'});assert.equal(probes,0);
});

class Node extends EventTarget{
 constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.attrs=new Map();this.hidden=false;this.textContent='';}
 setAttribute(name,value){this.attrs.set(name,value);}getAttribute(name){return this.attrs.get(name)||null;}
 append(...children){for(const child of children){this.children.push(child);child.parentNode=this;}}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}
}
function fixture(){const documentRef={location:{href:'https://one16.example/?passport=stand16#recorrido'},createElement:tag=>new Node(tag)},host=new Node('div');host.ownerDocument=documentRef;return{documentRef,host};}

test('Quick Look uses a same-origin spatial USDZ and precisely one image child on a real rel-ar link',()=>{
 const {host}=fixture();let launches=0;const access=mountPassportNativeAccess(host,{kind:'quick-look',onLaunch:()=>launches++}),navigation=host.children[0],link=navigation.children[0];
 assert.equal(link.tagName,'A');assert.equal(link.rel,'ar');assert.equal(link.href,'https://one16.example/assets/passport-spatial.usdz');assert.equal(link.getAttribute('aria-label'),'Colocar Passport en mi espacio');assert.equal(link.getAttribute('data-label'),'Colocar en mi espacio');
 assert.equal(link.children.length,1);assert.equal(link.children[0].tagName,'IMG');assert.equal(link.children[0].src,'https://one16.example/assets/passport-emblem.svg');assert.equal(link.textContent,'');assert.equal(launches,0,'mount never launches native AR');
 const event=new Event('click',{cancelable:true});link.dispatchEvent(event);assert.equal(launches,1,'callback runs synchronously in the real link gesture');assert.equal(event.defaultPrevented,false,'native navigation remains owned by the browser');access.dispose();
});

test('Scene Viewer intent uses ARCore ar_only, the spatial GLB, and the same NFC URL as fallback',()=>{
 const {host}=fixture(),access=mountPassportNativeAccess(host,{kind:'scene-viewer'}),link=host.children[0].children[0];
 assert.match(link.href,/^intent:\/\/arvr\.google\.com\/scene-viewer\/1\.0\?/);assert.match(link.href,/&mode=ar_only/);assert.match(link.href,/package=com\.google\.ar\.core;/);
 const file=decodeURIComponent(link.href.match(/[?&]file=([^&]+)/)[1]),fallback=decodeURIComponent(link.href.match(/S\.browser_fallback_url=([^;]+)/)[1]);
 assert.equal(file,'https://one16.example/assets/passport-spatial.glb');assert.equal(fallback,'https://one16.example/?passport=stand16&native_fallback=1#recorrido');assert.equal(link.rel,undefined);access.dispose();
});

test('native entry is hidden throughout the information pages and final two-action screen, and is cleaned up',()=>{
 const {host}=fixture();let launches=0;const access=mountPassportNativeAccess(host,{kind:'quick-look',onLaunch:()=>launches++}),navigation=host.children[0],link=navigation.children[0];
 for(const page of [1,2,3]){access.setPage(page);assert.equal(navigation.hidden,true);link.dispatchEvent(new Event('click'));assert.equal(launches,0);}
 access.setPage(0);assert.equal(navigation.hidden,false);link.dispatchEvent(new Event('click'));assert.equal(launches,1);access.dispose();access.dispose();assert.equal(host.children.length,0);link.dispatchEvent(new Event('click'));assert.equal(launches,1);
});

test('unsupported and webxr capability kinds do not add native buttons',()=>{
 const {host}=fixture();for(const kind of ['webxr','unavailable','unknown']){const access=mountPassportNativeAccess(host,{kind});access.setPage(0);access.dispose();}assert.equal(host.children.length,0);
});

test('native fallback explains an unresolved launch without claiming hardware incompatibility and hides with the native entry',()=>{
 const {host}=fixture(),locationRef={href:'https://one16.example/?passport=stand16&native_fallback=1#recorrido',search:'?passport=stand16&native_fallback=1'};
 const access=mountPassportNativeAccess(host,{kind:'scene-viewer',locationRef}),navigation=host.children[0],note=navigation.children[1];
 assert.equal(note.tagName,'P');assert.equal(note.getAttribute('role'),'status');assert.equal(note.textContent,'El visor AR no se abrió. Puedes seguir explorando en 3D.');
 assert.equal(navigation.hidden,false);for(const page of [1,2,3]){access.setPage(page);assert.equal(navigation.hidden,true);}access.setPage(0);assert.equal(navigation.hidden,false);access.dispose();
 const normal=mountPassportNativeAccess(host,{kind:'scene-viewer'});assert.equal(host.children[0].children.length,1,'ordinary entry has no failure notice');normal.dispose();
});