import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createVenueLoadingController, resolveVenueIntent, resolveVenueLanguage, mountVenueWelcome } from '../dist/venue-loading.mjs';
import { bootstrapEntry, prepareVenueWelcome } from '../dist/entry.mjs';

function fixture() {
 const states=[],ready=[],errors=[];
 const controller=createVenueLoadingController({onState:s=>states.push(s),onReady:s=>ready.push(s),onError:e=>errors.push(e)});
 return {controller,states,ready,errors};
}

test('download and decoded resources keep the cover until a successful render at the final pose',()=>{
 const f=fixture(),id=f.controller.begin();let renders=0;const camera={pose:null};
 f.controller.progress(id,'download',{loaded:50,total:100});
 assert.equal(f.controller.state.cover,true);
 assert.equal(f.controller.renderFrame(id,{width:400,height:800,render:()=>renders++}),false);
 f.controller.progress(id,'geometry');f.controller.prepared(id);
 assert.equal(f.controller.state.phase,'render');assert.equal(f.controller.state.cover,true);assert.equal(f.ready.length,0);
 camera.pose={x:3.2,z:-29.15,yaw:Math.PI,pitch:0};
 assert.equal(f.controller.renderFrame(id,{width:400,height:800,render:()=>{assert.equal(f.controller.state.cover,true);assert.equal(camera.pose.z,-29.15);renders++;}}),true);
 assert.equal(renders,1);assert.equal(f.controller.state.phase,'ready');assert.equal(f.controller.state.cover,false);assert.equal(f.ready.length,1);
 f.controller.renderFrame(id,{width:400,height:800,render:()=>renders++});assert.equal(renders,2);assert.equal(f.ready.length,1);
});

test('hidden or zero-sized viewports cannot claim a first frame, and a restored viewport can',()=>{
 const f=fixture(),id=f.controller.begin();f.controller.prepared(id);let renders=0;
 for(const [width,height]of[[0,0],[400,0],[0,800]])assert.equal(f.controller.renderFrame(id,{width,height,render:()=>renders++}),false);
 assert.equal(renders,0);assert.equal(f.controller.state.cover,true);
 f.controller.renderFrame(id,{width:400,height:800,render:()=>renders++});assert.equal(renders,1);assert.equal(f.ready.length,1);
});

for(const kind of ['renderer','context'])test(`${kind} failure retains Welcome with no false ready and supports a clean retry`,()=>{
 const f=fixture(),old=f.controller.begin();f.controller.prepared(old);
 f.controller.renderFrame(old,{width:400,height:800,contextLost:kind==='context',render:()=>{throw Error('GPU failure');}});
 assert.equal(f.controller.state.phase,'error');assert.equal(f.controller.state.cover,true);assert.equal(f.errors.length,1);assert.equal(f.ready.length,0);
 const id=f.controller.begin();f.controller.progress(old,'download',{loaded:100,total:100});f.controller.prepared(old);
 assert.equal(f.controller.renderFrame(old,{width:400,height:800,render:()=>{throw Error('stale render');}}),false);
 assert.equal(f.controller.state.attempt,id);assert.equal(f.controller.state.prepared,false);
 f.controller.prepared(id);f.controller.renderFrame(id,{width:400,height:800,render(){}});assert.equal(f.ready.length,1);
});

for(const choice of ['choosePlan','leave'])test(`${choice} blocks late loading, error and render callbacks from revealing 3D`,()=>{
 const f=fixture(),id=f.controller.begin();let renders=0;f.controller[choice]();
 f.controller.progress(id,'geometry');f.controller.prepared(id);
 assert.equal(f.controller.renderFrame(id,{width:400,height:800,render:()=>renders++}),false);
 assert.equal(renders,0);assert.equal(f.controller.state.cover,false);assert.equal(f.ready.length,0);
 f.controller.fail(id,Error('late texture error'));assert.equal(f.controller.state.cover,false);
 f.controller.show();const retry=f.controller.begin();f.controller.prepared(retry);f.controller.renderFrame(retry,{width:400,height:800,render:()=>renders++});assert.equal(f.ready.length,1);
});

test('the initial intent preserves static access, saved native pose and Passport precedence exactly once',()=>{
 const saved={expires:200,mode:'overview',pose:{x:4,z:-10,yaw:0.8,pitch:-0.2}};
 assert.deepEqual(resolveVenueIntent({hash:'#accessibleTour',search:'?passport=return',savedReturn:saved,now:100}),{kind:'static',mode:'plan'});
 assert.deepEqual(resolveVenueIntent({hash:'#recorrido',search:'?passport=return',savedReturn:JSON.stringify(saved),now:100}),{kind:'ar-return',mode:'overview',pose:saved.pose});
 for(const invalid of [null,'bad JSON',{...saved,expires:99},{...saved,mode:'flying'},{...saved,pose:{...saved.pose,x:Infinity}},{...saved,pose:{...saved.pose,pitch:8}}])assert.deepEqual(resolveVenueIntent({hash:'#recorrido',search:'?passport=return',savedReturn:invalid,now:100}),{kind:'passport-return',mode:'walk'});
 assert.deepEqual(resolveVenueIntent({}),{kind:'entrance',mode:'walk'});
 assert.equal(resolveVenueIntent({hash:'',savedReturn:saved,now:100}).kind,'entrance','a saved return is not consumed on a normal visit');
});

test('Welcome language uses URL, then shared preference, then English without requiring storage',()=>{
 assert.equal(resolveVenueLanguage({search:'?lang=es',storage:{getItem:()=> 'en'}}),'es');
 assert.equal(resolveVenueLanguage({search:'?lang=en',storage:{getItem(){throw Error('blocked');}}}),'en');
 assert.equal(resolveVenueLanguage({search:'?lang=xx',storage:{getItem:()=> 'es'}}),'es');
 assert.equal(resolveVenueLanguage({storage:{getItem(){throw Error('blocked');}}}),'en');
});

class Classes {values=new Set();add(...n){n.forEach(v=>this.values.add(v));}remove(...n){n.forEach(v=>this.values.delete(v));}contains(n){return this.values.has(n);}toggle(n,v){if(v)this.add(n);else this.remove(n);}}
class Element {attrs=new Map();hidden=false;dataset={};classList=new Classes();setAttribute(k,v){this.attrs.set(k,v);}getAttribute(k){return this.attrs.get(k)??null;}removeAttribute(k){this.attrs.delete(k);}}
function documentFixture(){const ids=Object.fromEntries(['venueWelcome','venueWelcomePoster','venueWelcomeEyebrow','venueWelcomeTitle','venueWelcomeDescription','venueWelcomeStatus','venueWelcomeProgress','venueWelcomeRetry','venueWelcomePlan','venueWelcomeExit'].map(id=>[id,new Element()]));ids.venueWelcomePoster.attrs.set('data-venue-src','./assets/exterior.webp?v=9');const documentRef=new EventTarget();Object.assign(documentRef,{getElementById:id=>ids[id]??null,documentElement:new Element()});return {ids,documentRef};}

test('progress percentages describe download only; geometry, textures and first view remain indeterminate',()=>{
 const {ids,documentRef}=documentFixture(),welcome=mountVenueWelcome(documentRef,{language:'es'});
 welcome.update({cover:true,phase:'download',loaded:50,total:100});assert.match(ids.venueWelcomeStatus.textContent,/50%/);assert.equal(ids.venueWelcomeProgress.value,50);
 for(const phase of ['geometry','textures','render']){ids.venueWelcomeProgress.attrs.set('value','50');welcome.update({cover:true,phase,loaded:100,total:100});assert.doesNotMatch(ids.venueWelcomeStatus.textContent,/%/);assert.equal(ids.venueWelcomeProgress.getAttribute('value'),null);}
 welcome.update({cover:true,phase:'error'});assert.equal(ids.venueWelcomeRetry.hidden,false);assert.equal(ids.venueWelcomeProgress.hidden,true);assert.match(ids.venueWelcomeStatus.textContent,/reintentar/);
});

test('the early inline Welcome bootstrap requests no venue image for NFC or explicit static access',()=>{
 const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
 const guard=html.match(/<script>(document\.documentElement\.classList\.add\('one16-booting'\);.*?)<\/script>/s)[1];
 const welcome=html.match(/<script data-venue-welcome>(.*?)<\/script>/s)[1];
 for(const [search,hash,expected]of[['?passport=stand16','#recorrido',false],['','#accessibleTour',false],['?lang=es','',true],['?passport=return','#recorrido',true]]){
  const {documentRef,ids}=documentFixture();const context={document:documentRef,location:{search,hash},URLSearchParams,localStorage:{getItem:()=>null}};
  vm.runInNewContext(guard,context);vm.runInNewContext(welcome,context);
  assert.equal(Boolean(ids.venueWelcomePoster.src),expected,search+hash);
  if(expected)assert.equal(ids.venueWelcomePoster.src,'./assets/exterior.webp?v=9');
  if(search==='?lang=es')assert.equal(ids.venueWelcomeTitle.textContent,'Tu experiencia empieza aquí.');
 }
 assert.match(html,/html\.passport-direct\.venue-returning #viewer\{display:block!important\}/,'return viewer has layout behind the opaque curtain');
 assert.match(html,/\.venue-welcome-media img\{object-fit:contain/,'portrait preserves the sign and entrance within the image');
});

test('entry import failure shows the retry curtain while explicit 2D access stays available',async()=>{
 const {documentRef,ids}=documentFixture();documentRef.documentElement.classList.add('one16-booting');
 await assert.rejects(bootstrapEntry({documentRef,locationRef:{search:'?lang=en',hash:'',pathname:'/one16'},activateAssets:async()=>{},importWorld:async()=>{throw Error('offline module');}}),/offline module/);
 assert.equal(ids.venueWelcome.hidden,false);assert.equal(ids.venueWelcomeRetry.hidden,false);assert.equal(documentRef.documentElement.classList.contains('one16-booting'),false);
 const staticDoc=documentFixture();prepareVenueWelcome(staticDoc.documentRef,{search:'',hash:'#accessibleTour'});assert.equal(staticDoc.ids.venueWelcome.hidden,true);assert.equal(staticDoc.ids.venueWelcomePoster.getAttribute('src'),null);
});

for(const eventType of ['one16-plan','one16-left'])test(`Passport return settles after ${eventType} without reviving a finished loading cover`,async()=>{
 const {documentRef,ids}=documentFixture();let mounted;
 await bootstrapEntry({documentRef,locationRef:{search:'?passport=stand16&lang=es',hash:'#recorrido',pathname:'/one16'},historyRef:{replaceState(_a,_b,url){assert.equal(url,'/one16?passport=return&lang=es#recorrido');}},activateAssets:async()=>{},importWorld:async()=>{},importPassport:async()=>({mountPassportEntry:options=>{mounted=options;return{};}})});
 const returned=mounted.onReturn();await Promise.resolve();await Promise.resolve();await Promise.resolve();
 documentRef.dispatchEvent(new Event(eventType));await returned;
 assert.equal(ids.venueWelcome.hidden,true);assert.equal(documentRef.documentElement.classList.contains('passport-direct'),false);assert.equal(documentRef.documentElement.classList.contains('venue-returning'),false);
});

test('NFC-only important hiding is disabled on explicit return before measuring the world',()=>{
 const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
 const critical=html.match(/<style id="passportEntryCritical">(.*?)<\/style>/s)[1];
 const persistent=fs.readFileSync(new URL('../dist/passport-entry.css',import.meta.url),'utf8');
 assert.match(persistent,/html\.passport-direct:not\(\.venue-returning\) body>:not\(#passportDirect\):not\(#activationDialog\):not\(#walletQuickOpen\)\{display:none!important\}/);
 assert.doesNotMatch(persistent,/html\.passport-direct body>/,'the loaded Passport stylesheet must also stop hiding world children on return');
 assert.match(critical,/html\.passport-direct:not\(\.venue-returning\) body>:not\(#passportDirect\):not\(#activationDialog\):not\(#walletQuickOpen\)\{display:none!important\}/);
 assert.doesNotMatch(critical,/html\.passport-direct body>/,'unconditional three-ID important rule would defeat one-ID viewer and curtain return rules');
 // Evaluate the two route predicates, not specificity assumptions: the strong rule must not participate on return.
 const hidesBodyChild=classes=>classes.has('passport-direct')&&!classes.has('venue-returning');
 assert.equal(hidesBodyChild(new Set(['passport-direct','one16-booting'])),true,'fresh NFC keeps all venue children hidden');
 assert.equal(hidesBodyChild(new Set(['passport-direct','one16-booting','venue-cover','venue-returning'])),false,'return gives viewer and curtain a nonzero layout');
});
