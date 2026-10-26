import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PropertyBinding} from 'three';
import {canStand,roomAt} from '../src/navigation.mjs';
import {isActivationObject,createWorldWallet} from '../dist/world-wallet.mjs';
const layout=JSON.parse(fs.readFileSync(new URL('../dist/assets/layout.json',import.meta.url)));

test('activation approach remains arrival-right, walkable and independently labelled',()=>{
 const point=layout.zones.find(z=>z.id==='activation');
 assert.ok(point.view.x>0);assert.ok(canStand(point.view.x,point.view.z,layout));
 assert.equal(roomAt(point.view,layout.zones),'activation');
});
test('every exported totem name is recognized after the actual Three loader sanitization',()=>{
 const bytes=fs.readFileSync(new URL('../dist/assets/one16.glb',import.meta.url));
 const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
 const names=gltf.nodes.filter(node=>node.name?.startsWith('ActivationTotem')).map(node=>PropertyBinding.sanitizeNodeName(node.name));
 assert.ok(names.length>5);for(const name of names)assert.equal(isActivationObject({name}),true,name);
});
test('a tap resolves any totem mesh through its model parent without accepting a Passport',()=>{
 assert.equal(isActivationObject({name:'screen mesh',parent:{name:'ActivationTotem / portrait housing'}}),true);
 assert.equal(isActivationObject({name:'Passport / cover'}),false);
 assert.equal(isActivationObject({name:'OtherActivationTotem'}),false);
});
class Element extends EventTarget {
 children=[];dataset={};open=false;attrs={};
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 setAttribute(key,value){this.attrs[key]=value;}
 showModal(){this.open=true;}
 close(){this.open=false;this.dispatchEvent(new Event('close'));}
}
function fixture(){
 const documentRef=new EventTarget(),head=new Element(),body=new Element();
 Object.assign(documentRef,{head,body,defaultView:{CustomEvent},createElement:()=>new Element(),getElementById:id=>body.children.find(e=>e.id===id)});
 return documentRef;
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
test('first-frame scheduling warms once without starting a wallet ceremony or a claim',async()=>{
 const documentRef=fixture(),idle=[],calls=[];
 const controller={prepare:async()=>calls.push('prepare'),subscribe(){},ensureWalletReady:()=>calls.push('claim')};
 const flow=createWorldWallet({documentRef,idle:fn=>idle.push(fn),loadModules:async()=>{calls.push('modules');return[{createWalletController:()=>controller},{bindWalletPanel:()=>({open:()=>calls.push('open')})}];}});
 assert.deepEqual(calls,[]);assert.equal(documentRef.body.children.length,0);
 flow.afterFirstFrame();flow.afterFirstFrame();assert.equal(idle.length,1);assert.deepEqual(calls,[]);
 idle[0]();await flow.prepare();assert.deepEqual(calls,['modules','prepare']);
 assert.equal(documentRef.body.children.filter(e=>e.id==='walletQuickOpen').length,1);
});
test('closing during module preparation does not reopen the wallet over the experience',async()=>{
 const documentRef=fixture(),modules=deferred();let opened=0;
 const flow=createWorldWallet({documentRef,loadModules:()=>modules.promise});
 const pending=flow.open(),dialog=documentRef.getElementById('activationDialog');
 assert.equal(dialog.open,true);dialog.close();
 modules.resolve([{createWalletController:()=>({prepare:async()=>{},subscribe(){}})},{bindWalletPanel:()=>({open:()=>opened++})}]);
 await pending;assert.equal(opened,0);assert.equal(dialog.open,false);
 await flow.open();assert.equal(opened,1);
});
test('totem, map and NFC use the shared panel while modal navigation stays paused',()=>{
 const js=fs.readFileSync(new URL('../dist/viewer.js',import.meta.url),'utf8');
 const nfc=fs.readFileSync(new URL('../dist/passport-entry.mjs',import.meta.url),'utf8');
 assert.match(js,/isActivationObject\(hit.object\)\)openActivation/);
 assert.match(js,/spot.id==='activation'\)\{openActivation/);
 assert.match(js,/mode==='walk'&&[^{};]*!\$\('activationDialog'\).open/);
 assert.match(nfc,/getWorldWallet\(documentRef\).afterFirstFrame\(\)/);
});

test('world wallet state observation is lazy, replays state and supports independent unsubscribe', async () => {
 const documentRef = fixture(), calls = [], observers = new Set();
 let state = {status: 'available', address: null};
 const controller = {get state() {return state;}, subscribe(fn) {observers.add(fn);fn(state);return () => observers.delete(fn);}, prepare: async () => calls.push('prepare')};
 const flow = createWorldWallet({documentRef, loadModules: async () => {calls.push('modules');return [{createWalletController: () => controller}, {bindWalletPanel: () => ({open() {}})}];}});
 const seen = [], stop = flow.subscribe(value => seen.push(value));
 assert.equal(flow.state, null);assert.deepEqual(seen, [null]);assert.deepEqual(calls, []);assert.equal(documentRef.body.children.length, 0);
 await flow.prepare();assert.deepEqual(calls, ['modules', 'prepare']);assert.equal(seen.at(-1).status, 'available');
 state = {status: 'ready', address: 'Cwallet', config: {network: 'testnet'}};for (const fn of observers) fn(state);
 assert.equal(flow.state.status, 'ready');const copy = flow.state;copy.config.network = 'changed';assert.equal(flow.state.config.network, 'testnet');
 stop();const count = seen.length;for (const fn of observers) fn(state);assert.equal(seen.length, count);
});

test('world wallet Continue carries the opening source while close and repeat triggers do not acknowledge', async () => {
 const documentRef = fixture(), continues = [], closes = [];let panelOptions;
 const state = {status: 'ready', address: 'Cwallet', balanceUnits: '1000000000'};
 const controller = {get state() {return state;}, subscribe(fn) {fn(state);}, prepare: async () => {}};
 const flow = createWorldWallet({documentRef, loadModules: async () => [{createWalletController: () => controller}, {bindWalletPanel: options => {panelOptions = options;return {open: () => options.dialog.showModal()};}}]});
 documentRef.addEventListener('one16-wallet-continue', e => continues.push(e.detail));documentRef.addEventListener('one16-wallet-close', e => closes.push(e.detail));
 await flow.open({source: 'totem'});await flow.open();panelOptions.onContinue(state);panelOptions.dialog.close();
 assert.equal(continues.length, 1);assert.equal(continues[0].source, 'totem');assert.deepEqual(continues[0].state, state);assert.equal(closes[0].source, 'totem');
 await flow.open();panelOptions.onContinue(state);panelOptions.dialog.close();assert.equal(continues[1].source, 'wallet');
 await flow.open({source: 'totem'});panelOptions.dialog.close();assert.equal(continues.length, 2);
 await flow.open({source: 'unknown'});panelOptions.onContinue(state);panelOptions.dialog.close();assert.equal(continues[2].source, 'wallet');
});
