import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {bootstrapEntry,activateVenueAssets,isPassportDirect} from '../dist/entry.mjs';
import {mountPassportEntry} from '../dist/passport-entry.mjs';
class Classes {values=new Set();add(...names){for(const name of names)this.values.add(name);}remove(...names){for(const name of names)this.values.delete(name);}contains(name){return this.values.has(name);}toggle(name,force){const on=force??!this.values.has(name);if(on)this.values.add(name);else this.values.delete(name);return on;}}
class Element extends EventTarget {
 attrs=new Map();dataset={};classList=new Classes();hidden=false;isConnected=true;children=[];
 setAttribute(name,value){this.attrs.set(name,value);if(name==='href')queueMicrotask(()=>this.dispatchEvent(new Event('load')));}
 getAttribute(name){return this.attrs.get(name)||null;}removeAttribute(name){this.attrs.delete(name);}
 append(...elements){for(const element of elements){this.children.push(element);element.isConnected=true;}}
 remove(){this.isConnected=false;}
}
function documentFixture(){const documentRef=new EventTarget(),html=new Element(),head=new Element(),style=new Element(),image=new Element();style.attrs.set('data-one16-stylesheet','style.css?v=1');image.attrs.set('data-one16-src','assets/exterior.webp');html.classList.add('one16-booting');
 const welcomeIds=Object.fromEntries(['venueWelcome','venueWelcomePoster','venueWelcomeEyebrow','venueWelcomeTitle','venueWelcomeDescription','venueWelcomeStatus','venueWelcomeProgress','venueWelcomeRetry','venueWelcomePlan','venueWelcomeExit'].map(id=>[id,new Element()]));welcomeIds.venueWelcomePoster.attrs.set('data-venue-src','./assets/exterior.webp?v=9');
 Object.assign(documentRef,{getElementById:id=>welcomeIds[id]??null,documentElement:html,head,defaultView:{matchMedia:()=>({matches:false})},querySelectorAll(selector){return selector.startsWith('link')?[style]:selector.startsWith('img')?[image]:[];},createElement:()=>new Element()});return{documentRef,html,style,image,welcomeIds};}

test('the NFC URL imports only its Passport entry and never hydrates or starts the venue',async()=>{
 const {documentRef,html,style,image,welcomeIds}=documentFixture();let worldLoads=0,assetLoads=0,passportLoads=0,mounted;
 const controller={unmount(){}};const result=await bootstrapEntry({documentRef,locationRef:{search:'?passport=stand16&v=old',pathname:'/'},historyRef:{replaceState(){throw Error('no navigation on entry');}},importWorld:async()=>worldLoads++,activateAssets:async()=>assetLoads++,importPassport:async()=>{passportLoads++;return{mountPassportEntry:options=>{mounted=options;return controller;}};}});
 assert.equal(result,controller);assert.equal(passportLoads,1);assert.equal(worldLoads,0);assert.equal(assetLoads,0);assert.equal(style.getAttribute('href'),null);assert.equal(image.getAttribute('src'),null);assert.ok(html.classList.contains('passport-direct'));assert.equal(mounted.documentRef,documentRef);assert.equal(welcomeIds.venueWelcomePoster.getAttribute('src'),null,'NFC never requests the venue poster');assert.equal(html.classList.contains('venue-cover'),false);
});

test('explicit return changes the route before lazy world import and holds the curtain until the venue ready event',async()=>{
 const {documentRef,html,welcomeIds}=documentFixture(),calls=[];let returned,mounted;
 await bootstrapEntry({documentRef,locationRef:{search:'?passport=stand16',pathname:'/'},historyRef:{replaceState:(...args)=>calls.push(['route',...args])},activateAssets:async()=>calls.push(['assets']),importWorld:async()=>{calls.push(['world']);},importPassport:async()=>({mountPassportEntry:options=>{mounted=options;return{};}})});
 returned=mounted.onReturn();await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.deepEqual(calls.map(call=>call[0]),['route','assets','world']);assert.equal(calls[0][3],'/?passport=return#recorrido');assert.ok(html.classList.contains('passport-direct'),'no map is revealed during world loading');
 assert.ok(html.classList.contains('venue-returning'),'viewer can have a layout behind the opaque return curtain');assert.equal(welcomeIds.venueWelcomePoster.getAttribute('src'),'./assets/exterior.webp?v=9');
 documentRef.dispatchEvent(new Event('one16-prepared'));await Promise.resolve();assert.ok(html.classList.contains('passport-direct'),'parsed resources do not reveal a frame');
 documentRef.dispatchEvent(new Event('one16-ready'));await returned;assert.equal(html.classList.contains('passport-direct'),false);assert.equal(html.classList.contains('one16-booting'),false);
});

test('a failed venue initialization reveals its normal fallback instead of leaving a loading curtain forever',async()=>{
 const {documentRef,html}=documentFixture();let mounted;
 await bootstrapEntry({documentRef,locationRef:{search:'?passport=stand16',pathname:'/'},historyRef:{replaceState(){}},activateAssets:async()=>{},importWorld:async()=>documentRef.dispatchEvent(new Event('one16-failed')),importPassport:async()=>({mountPassportEntry:options=>{mounted=options;return{};}})});
 await mounted.onReturn();assert.equal(html.classList.contains('passport-direct'),false);assert.ok(html.classList.contains('venue-cover'),'failure keeps the Welcome curtain, never an automatic 2D plan');assert.equal(documentRef.getElementById('venueWelcomeRetry').hidden,false);
});

test('normal ONE16 entry restores deferred CSS and image sources without importing the Passport entry',async()=>{
 const {documentRef,html,style,image}=documentFixture();let worldLoads=0;
 await bootstrapEntry({documentRef,locationRef:{search:'',pathname:'/'},importWorld:async()=>worldLoads++,importPassport:async()=>{throw Error('unexpected Passport import');}});
 assert.equal(style.getAttribute('href'),'style.css?v=1');assert.equal(image.getAttribute('src'),'assets/exterior.webp');assert.equal(image.getAttribute('data-one16-src'),null);assert.equal(worldLoads,1);assert.equal(html.classList.contains('one16-booting'),false);assert.ok(html.classList.contains('venue-cover'),'module import alone does not remove the curtain');
 await activateVenueAssets(documentRef);assert.equal(style.getAttribute('href'),'style.css?v=1');assert.equal(isPassportDirect('?passport=return'),false);
});

function passportFixture(){const {documentRef}=documentFixture(),ids=Object.fromEntries(['passportDirect','passportDirectFrame','passportDirectCurtain','passportDirectCover','passportDirectStatus','passportDirectRetry'].map(id=>[id,new Element()]));documentRef.getElementById=id=>ids[id];return{documentRef,ids};}

test('loading keeps one exact-cover curtain, releases its background only for a real camera message, and fades once after the first frame',()=>{
 const {documentRef,ids}=passportFixture(),scheduled=[];let callbacks;
 mountPassportEntry({documentRef,timer:(fn,ms)=>{scheduled.push({fn,ms});return scheduled.length;},clearTimer(){},createEmbedded:(host,options)=>{callbacks=options;return{mount(){},unmount(){},retry(){}};}});
 assert.equal(callbacks.presentation,'fullscreen');assert.equal(ids.passportDirectCover.hidden,false);assert.equal(ids.passportDirectCurtain.classList.contains('camera-ready'),false);
 callbacks.onCameraReady();assert.ok(ids.passportDirectCurtain.classList.contains('camera-ready'));assert.equal(ids.passportDirectCurtain.isConnected,true);
 callbacks.onReady();callbacks.onReady();assert.equal(scheduled.length,1);assert.equal(scheduled[0].ms,120);assert.ok(ids.passportDirectCurtain.classList.contains('is-revealing'));scheduled[0].fn();assert.equal(ids.passportDirectCurtain.isConnected,false);
});

test('model loading failure preserves the cover and offers a real retry of the existing iframe',()=>{
 const {documentRef,ids}=passportFixture();let callbacks,retries=0;
 const controller=mountPassportEntry({documentRef,createEmbedded:(host,options)=>{callbacks=options;return{mount(){},unmount(){},retry(){retries++;}};}});
 callbacks.onError({message:'offline'});assert.equal(ids.passportDirect.dataset.error,'true');assert.equal(ids.passportDirectRetry.hidden,false);assert.equal(ids.passportDirectCurtain.isConnected,true);
 ids.passportDirectRetry.dispatchEvent(new Event('click'));assert.equal(retries,1);assert.equal(ids.passportDirectRetry.hidden,true);assert.equal(ids.passportDirect.dataset.error,'false');controller.unmount();
});

test('HTML chooses the fast route before module loading and contains no eager venue image URLs',()=>{
 const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8'),withoutNoscript=html.replace(/<noscript>.*?<\/noscript>/gs,'');
 const firstModule=html.indexOf('<script type="module"');assert.ok(html.indexOf("classList.add('passport-direct')")<firstModule);assert.match(html,/<script type="module" src="\.\/entry\.mjs/);assert.doesNotMatch(withoutNoscript,/<script[^>]+src="[^"\n]*viewer\.js/);assert.doesNotMatch(withoutNoscript,/<img\b[^>]*\ssrc="(?:\.\/)?assets\//);assert.doesNotMatch(withoutNoscript,/<link\b[^>]*\shref="[^"\n]*\.css/);
 const cover=withoutNoscript.match(/id="passportDirectCover" src="data:image\/jpeg;base64,([^"]+)"/);assert.ok(cover);assert.deepEqual(Buffer.from(cover[1],'base64'),fs.readFileSync(new URL('../dist/assets/passport-cover.jpg',import.meta.url)));
 assert.ok(html.indexOf('id="passportDirect"')<html.indexOf('<header>'));assert.match(html,/id="embeddedLayout" type="application\/json"/);assert.match(html,/id="scene"/);assert.match(html,/id="passportDialog"/);
});

test('native placement waits for the model, follows page state, and never duplicates the final two-action screen',()=>{
 const {documentRef,ids}=passportFixture(),created=[];let callbacks,disposed=0,unmounted=0;
 const controller=mountPassportEntry({documentRef,timer:()=>0,clearTimer(){},createEmbedded:(host,options)=>{callbacks=options;return{mount(){},unmount(){unmounted++;},retry(){},pause(){throw Error('native links must not pause or launch through a synthetic bridge');}};},createNative:(host,options)=>{const access={pages:[],setPage(page){this.pages.push(page);},dispose(){disposed++;}};created.push({host,options,access});return access;}});
 callbacks.onSpatialCapability({kind:'quick-look'});callbacks.onReadingPage({page:1});assert.equal(created.length,0,'no native assets or button before the model is ready');
 callbacks.onReady();assert.equal(created.length,1);assert.equal(created[0].host,ids.passportDirect);assert.equal(created[0].options.kind,'quick-look');assert.deepEqual(created[0].access.pages,[1]);
 callbacks.onReadingPage({page:0});callbacks.onSpatialCapability({kind:'quick-look'});assert.equal(created.length,1,'duplicate capabilities reuse the same native link');assert.equal(created[0].access.pages.at(-1),0);
 created[0].options.onLaunch();assert.equal(ids.passportDirect.dataset.nativeOpened,'true');assert.equal(unmounted,0,'the browser owns the original native gesture');
 callbacks.onReadingPage({page:2});callbacks.onReadingPage({page:3});assert.equal(created[0].access.pages.at(-1),3,'the native link hides for the final two actions');
 callbacks.onSpatialCapability({kind:'webxr'});assert.equal(disposed,1,'webxr does not keep a duplicate native entry');controller.unmount();assert.equal(unmounted,1);
});