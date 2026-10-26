import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { StrKey } from '@stellar/stellar-sdk';
import { IndexedDBStorage } from '../node_modules/smart-account-kit/dist/storage/indexeddb.js';
import { DB_NAME, DB_VERSION, IDB_STORE_CREDENTIALS, IDB_STORE_SESSION, IDB_SESSION_KEY } from '../node_modules/smart-account-kit/dist/constants.js';
import { WALLET_BADGE_STORAGE, isContractAddress, formatBadgeBalance, readStoredWallet, mountWalletBadge } from '../dist/wallet-badge.mjs';

const ADDRESS=StrKey.encodeContract(Buffer.alloc(32,21)),OTHER=StrKey.encodeContract(Buffer.alloc(32,22));
const session=(address=ADDRESS,id='own-credential',extra={})=>({contractId:address,credentialId:id,connectedAt:1000,expiresAt:10000,...extra});
const credential=(address=ADDRESS,id='own-credential',extra={})=>({contractId:address,credentialId:id,deploymentStatus:'deployed',publicKey:new Uint8Array(65),createdAt:500,...extra});
const wallet=(address=ADDRESS,id='own-credential',extra={})=>({address,credentialId:id,connectedAt:1000,expiresAt:10000,...extra});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

/** Native request/transaction event ordering, with no alternate identity queries. */
function storageFixture({exists=true,enumerate=true,sessionRecord=session(),credentials=[credential()],stores=['session','credentials'],deny=false}={}){
 const maps={session:new Map(),credentials:new Map(credentials.map(c=>[c.credentialId,structuredClone(c)]))};if(sessionRecord)maps.session.set('current',{id:'current',...sessionRecord});
 const log=[],stats={opens:0,aborts:0,closes:0,exists};
 const db={objectStoreNames:{contains:name=>stores.includes(name)},close(){stats.closes++;},transaction(names,mode){
  names=Array.isArray(names)?names:[names];log.push({transaction:names,mode});let pending=0,finished=false;
  const tx={oncomplete:null,onabort:null,onerror:null,objectStore(name){assert.ok(names.includes(name));return{
   get(key){log.push({get:name,key});return request(()=>structuredClone(maps[name].get(key)));},
   put(value){if(mode!=='readwrite')throw Error('readonly');log.push({put:name});return request(()=>{const key=name==='session'?value.id:value.credentialId;maps[name].set(key,structuredClone(value));return key;});}
  };}};
  function request(action){pending++;const req={};queueMicrotask(()=>{req.result=action();req.onsuccess?.();pending--;queueMicrotask(()=>{if(!pending&&!finished){finished=true;tx.oncomplete?.();}});});return req;}
  return tx;
 }};
 const indexedDB={open(...args){stats.opens++;log.push({open:args});const req={};queueMicrotask(()=>{
  if(deny){req.onerror?.();return;}
  if(!stats.exists){let aborted=false;req.transaction={abort(){aborted=true;stats.aborts++;}};req.onupgradeneeded?.();if(aborted){req.onerror?.();return;}stats.exists=true;}
  req.result=db;req.onsuccess?.();
 });return req;}};
 if(enumerate)indexedDB.databases=async()=>stats.exists?[{name:DB_NAME,version:2}]:[];
 return{indexedDB,maps,log,stats,db};
}

class Classes{values=new Set();add(...names){names.forEach(n=>this.values.add(n));}remove(...names){names.forEach(n=>this.values.delete(n));}contains(name){return this.values.has(name);}}
class Element extends EventTarget{
 attrs=new Map();classList=new Classes();children=[];hidden=false;_text='';
 setAttribute(name,value){this.attrs.set(name,String(value));}getAttribute(name){return this.attrs.get(name)??null;}removeAttribute(name){this.attrs.delete(name);}
 replaceChildren(...children){this.children=children;this._text='';}set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join(' ');}
}
function pageFixture(){const anchor=new Element(),group=new Element();group.classList.add('header-wallet-controls');anchor.parentElement=group;const documentRef=new EventTarget(),windowRef=new EventTarget();Object.assign(documentRef,{getElementById:id=>id==='platformWallet'?anchor:null,createElement:()=>new Element(),visibilityState:'visible',defaultView:windowRef});return{anchor,group,documentRef,windowRef};}
const balanceResponse=(address=ADDRESS,balance='1000000000')=>new Response(JSON.stringify({state:'confirmed',address,balance}));

function badgeFixture(options={}){const page=pageFixture();let reads=0,requests=0;const calls=[];
 const controller=mountWalletBadge({...page,now:()=>2000,readSession:async()=>{reads++;return wallet();},fetcher:async(url,options)=>{requests++;calls.push({url,options});return balanceResponse();},...options});
 return{...page,controller,calls,get reads(){return reads;},get requests(){return requests;}};
}

test('the public schema matches the installed pinned SDK and reads its actual saveSession output',async()=>{
 assert.equal(JSON.parse(fs.readFileSync(new URL('../node_modules/smart-account-kit/package.json',import.meta.url))).version,'0.9.1');
 assert.deepEqual(WALLET_BADGE_STORAGE,{database:DB_NAME,version:DB_VERSION,session:IDB_STORE_SESSION,credentials:IDB_STORE_CREDENTIALS,current:IDB_SESSION_KEY});
 const f=storageFixture({sessionRecord:null,credentials:[]}),sdk=new IndexedDBStorage();sdk.getDB=async()=>f.db;
 await sdk.save(credential());await sdk.saveSession(session());assert.equal(f.maps.session.get('current').id,'current');f.log.length=0;
 assert.deepEqual(await readStoredWallet({indexedDB:f.indexedDB,now:()=>2000}),wallet());
 assert.deepEqual(f.log.filter(row=>row.get),[{get:'session',key:'current'},{get:'credentials',key:'own-credential'}]);
 assert.equal(f.log.find(row=>row.transaction).mode,'readonly');assert.deepEqual(f.log.find(row=>row.open).open,[DB_NAME]);assert.equal(f.stats.closes,1);
});

test('new and restored own sessions resolve exactly the same deployed association',async()=>{
 for(const record of [session(),session(ADDRESS,'restored',{connectedAt:1500})]){
  const f=storageFixture({sessionRecord:record,credentials:[credential(ADDRESS,record.credentialId)]});
  const value=await readStoredWallet({indexedDB:f.indexedDB,now:()=>2000});assert.equal(value.address,ADDRESS);assert.equal(value.credentialId,record.credentialId);
 }
});

for(const [name,record,creds]of[
 ['missing current session',null,[credential(),credential(OTHER,'another')]],
 ['expired current session',session(ADDRESS,'own-credential',{expiresAt:2000}),[credential(),credential(OTHER,'another')]],
 ['mismatched association',session(),[credential(OTHER)]],
 ['pending deployment',session(),[credential(ADDRESS,'own-credential',{deploymentStatus:'pending'})]],
 ['occupied deployment',session(),[credential(ADDRESS,'own-credential',{deploymentStatus:'occupied'})]]
])test(`${name} hides instead of selecting a different stored visitor`,async()=>{
 const f=storageFixture({sessionRecord:record,credentials:creds});assert.equal(await readStoredWallet({indexedDB:f.indexedDB,now:()=>2000}),null);
 assert.ok(f.log.every(row=>!row.get||row.key==='current'||row.key==='own-credential'));
});

test('an absent database is never created, with enumeration or the upgrade-abort fallback',async()=>{
 const listed=storageFixture({exists:false});assert.equal(await readStoredWallet({indexedDB:listed.indexedDB}),null);assert.equal(listed.stats.opens,0);
 const fallback=storageFixture({exists:false,enumerate:false});assert.equal(await readStoredWallet({indexedDB:fallback.indexedDB}),null);assert.equal(fallback.stats.aborts,1);assert.equal(fallback.stats.exists,false);
});

test('missing stores, denied access and unsupported IndexedDB fail quietly',async()=>{
 for(const f of [storageFixture({stores:['credentials']}),storageFixture({deny:true})])assert.equal(await readStoredWallet({indexedDB:f.indexedDB}),null);
 assert.equal(await readStoredWallet({indexedDB:null}),null);
});

test('the badge shows exact BigInt USDC, a compact address, a full accessible label and top-document link',async()=>{
 const f=badgeFixture();await f.controller.ready;
 assert.equal(f.anchor.hidden,false);assert.equal(f.anchor.children[0].textContent,'100 USDC · Testnet');assert.equal(f.anchor.children[1].textContent,ADDRESS.slice(0,4)+'…'+ADDRESS.slice(-4));
 assert.equal(f.anchor.getAttribute('href'),'/wallet.html');assert.equal(f.anchor.getAttribute('target'),'_top');assert.match(f.anchor.getAttribute('aria-label'),/100 USDC/);assert.ok(f.anchor.getAttribute('aria-label').includes(ADDRESS));
 assert.ok(f.group.classList.contains('has-wallet'));assert.equal(f.controller.state.balanceVerified,true);
 assert.equal(f.calls[0].url,'/api/wallet/faucet?address='+ADDRESS);assert.equal(f.calls[0].options.method,'GET');assert.equal(f.calls[0].options.cache,'no-store');assert.equal(f.calls[0].options.credentials,'same-origin');f.controller.dispose();
 assert.equal(formatBadgeBalance('99999999999999999999999999999999999999'),'9999999999999999999999999999999.9999999');assert.equal(formatBadgeBalance('1'),'0.0000001');assert.equal(formatBadgeBalance('0'),'0');assert.equal(formatBadgeBalance('-1'),null);
});

for(const response of [()=>Promise.reject(Error('offline')),()=>new Response('{}',{status:503}),()=>balanceResponse(OTHER),()=>balanceResponse(ADDRESS,'not units')])test('a balance error or a different response address keeps only the own public wallet identity',async()=>{
 const f=badgeFixture({fetcher:response});await f.controller.ready;
 assert.equal(f.anchor.children[0].textContent,'Wallet · Testnet');assert.equal(f.controller.state.balanceVerified,false);assert.ok(f.anchor.getAttribute('aria-label').includes(ADDRESS));assert.ok(!f.anchor.textContent.includes('100'));f.controller.dispose();
});

test('absent and expired sessions remove the previous address, balance and accessibility attributes',async()=>{
 let selected=wallet();const f=badgeFixture({readSession:async()=>selected});await f.controller.ready;
 selected=null;await f.controller.refresh();assert.equal(f.anchor.hidden,true);assert.equal(f.anchor.textContent,'');assert.equal(f.anchor.getAttribute('aria-label'),null);assert.equal(f.anchor.getAttribute('data-address'),null);assert.equal(f.group.classList.contains('has-wallet'),false);
 selected=wallet(ADDRESS,'own-credential',{expiresAt:1999});await f.controller.refresh();assert.equal(f.anchor.hidden,true);f.controller.dispose();
});

test('a late previous-wallet balance can never replace the current session address or balance',async()=>{
 let selected=wallet(),old=deferred(),first=true;const f=badgeFixture({readSession:async()=>selected,fetcher:async url=>{if(first){first=false;return old.promise;}return balanceResponse(OTHER,'25000000');}});
 await tick();selected=wallet(OTHER,'other');await f.controller.refresh();assert.equal(f.controller.state.address,OTHER);assert.equal(f.controller.state.balance,'2.5');
 old.resolve(balanceResponse(ADDRESS,'1000000000'));await f.controller.ready;assert.equal(f.controller.state.address,OTHER);assert.equal(f.controller.state.balance,'2.5');f.controller.dispose();
});

test('concurrent entry events serialize storage reads and re-read the latest identity',async()=>{
 const firstRead=deferred();let calls=0,active=0,max=0;
 const f=badgeFixture({readSession:async()=>{calls++;active++;max=Math.max(max,active);let value;if(calls===1)value=await firstRead.promise;else value=wallet(OTHER,'other');active--;return value;},fetcher:async url=>balanceResponse(url.includes(OTHER)?OTHER:ADDRESS)});
 const current=f.controller.refresh();firstRead.resolve(wallet());await current;
 assert.equal(calls,2);assert.equal(max,1);assert.equal(f.controller.state.address,OTHER);f.controller.dispose();
});

test('focus, pageshow and visible-page changes coalesce, never poll, and are removed on dispose',async()=>{
 const scheduled=new Map();let id=0,reads=0;
 const f=badgeFixture({timer:(callback,ms)=>{scheduled.set(++id,{callback,ms});return id;},clearTimer:key=>scheduled.delete(key),readSession:async()=>{reads++;return null;}});await f.controller.ready;
 f.windowRef.dispatchEvent(new Event('focus'));f.windowRef.dispatchEvent(new Event('pageshow'));f.documentRef.dispatchEvent(new Event('visibilitychange'));
 assert.equal(scheduled.size,1);assert.equal([...scheduled.values()][0].ms,80);const run=[...scheduled.values()][0].callback;scheduled.clear();run();await tick();assert.equal(reads,2);assert.equal(scheduled.size,0);
 f.controller.dispose();f.windowRef.dispatchEvent(new Event('focus'));assert.equal(scheduled.size,0);
});

test('expiry is one scheduled refresh and clears the badge when the active session expires',async()=>{
 const scheduled=new Map();let id=0,clock=2000;
 const f=badgeFixture({now:()=>clock,timer:(callback,ms)=>{scheduled.set(++id,{callback,ms});return id;},clearTimer:key=>scheduled.delete(key)});await f.controller.ready;
 const expiry=[...scheduled.values()].find(item=>item.ms===8000);assert.ok(expiry);clock=10000;expiry.callback();await tick();assert.equal(f.anchor.hidden,true);f.controller.dispose();
});

test('mounting is idempotent for the same anchor and never loads a graphics or wallet runtime',async()=>{
 const f=badgeFixture();assert.equal(mountWalletBadge({...f}),f.controller);await f.controller.ready;assert.equal(f.reads,1);f.controller.dispose();
 const source=fs.readFileSync(new URL('../dist/wallet-badge.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/\bimport\s*(?:\(|[{*'"\w])/);assert.doesNotMatch(source,/navigator|PublicKeyCredential|getUserMedia|credentials\.(?:get|create)|method:\s*['"]POST|\.transaction\([^\n]*['"]readwrite/);
 const css=fs.readFileSync(new URL('../dist/wallet-badge.css',import.meta.url),'utf8');assert.match(css,/#platformWallet\[hidden\]\{display:none!important\}/);assert.match(css,/width:120px/);assert.doesNotMatch(css,/(?:^|\})\s*(?:body|html|\*)\s*\{/);
});

test('the lightweight contract checksum validator matches SDK addresses and refuses altered strings',()=>{
 assert.equal(isContractAddress(ADDRESS),true);assert.equal(isContractAddress(OTHER),true);assert.equal(isContractAddress('C'+'A'.repeat(55)),false);assert.equal(isContractAddress(ADDRESS.slice(0,-1)+(ADDRESS.endsWith('A')?'B':'A')),false);assert.equal(isContractAddress('G'+ADDRESS.slice(1)),false);
});
