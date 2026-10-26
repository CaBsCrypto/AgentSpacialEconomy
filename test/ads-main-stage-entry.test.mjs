import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import * as T from '../dist/vendor/three/build/three.module.js';
import {validatePlayback,playbackCountdown,playbackLabel,createAdsPlayer} from '../dist/ads-player.mjs';
import {availabilitySuggestion,fulfillmentTimeline,consentedReprogramPayload,deliveryProgress,sessionCanPurchase} from '../dist/ads.mjs';
import {MAIN_STAGE_ENTRY_URL,isMainStageSign,mainStageSignPlacement,createMainStageSign} from '../dist/main-stage-sign.mjs';
const origin='https://venue.example',base=Date.parse('2026-10-26T12:00:00Z');
const iso=n=>new Date(base+n).toISOString();
const timing={phase:'PLAYING',passId:'pass-3',durationMs:60000,startedAt:iso(-10000),confirmedThrough:iso(-250),remainingMs:50000,validUntil:iso(2000)};
const active={plan:'PASSES',offerVersion:2,orderId:'o',revisionId:'r',manifestHash:'a'.repeat(64),imageHash:'b'.repeat(64),imageUrl:'/api/ads/assets/x.png',startsAt:base-10000,endsAt:base+60000};

test('countdown uses confirmed remaining time, never the seventy-second reservation or local wall clock',async()=>{
 let now=0,writes=0;const player=createAdsPlayer({placementId:'main_stage_screen',origin,now:()=>now,fetchImpl:async(url,o)=>{if(o.method&&o.method!=='GET')writes++;return url.includes('/playlists/')?Response.json({version:1,serverTime:iso(0),validUntil:iso(2000),active,playback:timing}):new Response('raster');},verifyImage:async()=>({bytes:new Uint8Array([1]),mimeType:'image/png'})});
 await player.refresh();assert.equal(player.state.playback.remainingMs,50000);now=1000;assert.equal(player.tick().playback.remainingMs,49000);assert.match(playbackLabel(player.state.playback),/0:49/);assert.equal(writes,0);now=2000;assert.equal(player.tick().status,'neutral');assert.equal(player.state.playback,null);player.dispose();
});
test('starting, pause, missing and stale evidence cannot produce a fabricated countdown',()=>{
 const options={serverTime:base,validUntil:base+2000};
 for(const phase of ['STARTING','PAUSED','IDLE']){const p=validatePlayback({...timing,phase},options);assert.equal(p.remainingMs,null);assert.equal(playbackCountdown(p,base),null);}
 assert.equal(validatePlayback(undefined,options),null);
 for(const change of [{remainingMs:60001},{remainingMs:-1},{remainingMs:1.5},{confirmedThrough:iso(-2100)},{confirmedThrough:iso(1)},{startedAt:iso(1)},{validUntil:iso(0)},{phase:'COMPLETE'}])assert.throws(()=>validatePlayback({...timing,...change},options));
});
test('a repeated public manifest or additional reader never adds delivery units',async()=>{
 let clock=0;const fetchImpl=async()=>Response.json({version:1,serverTime:iso(0),validUntil:iso(2000),active:null,playback:{...timing,phase:'PAUSED'}});
 const p=createAdsPlayer({placementId:'main_stage_screen',origin,now:()=>clock,fetchImpl});await p.refresh();clock=100;assert.equal(p.tick().playback.phase,'PAUSED');assert.match(playbackLabel(p.state.playback),/pendiente/);assert.equal(deliveryProgress({required:5,delivered:2,unit:'PASSES'},{plan:'PASSES',requiredUnits:5}).completed,2);p.dispose();
});
const order=()=>({quote:{plan:'PASSES'},placements:[{placementId:'main_stage_screen',delivered:2}],fulfillment:{version:7,serverTime:iso(0),window:{startsAt:iso(0),endsAt:iso(3600000)},nextEstimatedAt:iso(120000),units:[1,2,3,4,5].map(number=>({number,status:number<=2?'COMPLETED':number===3?'ACTIVE':number===4?'SCHEDULED':'DEBT',completedAt:number<=2?iso(-number*70000):null,estimatedStartsAt:number>2?iso(number*70000):null,batchId:'batch'}))}});
test('private five-pass timeline is backed by completed rows and preserves unpaid debt',()=>{
 const f=fulfillmentTimeline(order());assert.equal(f.valid,true);assert.equal(f.units.filter(u=>u.status==='COMPLETED').length,2);assert.equal(f.units.at(-1).status,'DEBT');
 const wrong=order();wrong.placements[0].delivered=3;assert.deepEqual(fulfillmentTimeline(wrong),{valid:false});
 const duplicate=order();duplicate.fulfillment.units[4].number=4;assert.equal(fulfillmentTimeline(duplicate).valid,false);
 assert.equal(fulfillmentTimeline({...order(),quote:{plan:'TIME'}}),null);
});
test('reprogramming requires explicit consent and sends the current fulfillment version without amount or signature',()=>{
 assert.throws(()=>consentedReprogramPayload(order(),iso(1000),iso(3601000),false),/Confirma/);
 const p=consentedReprogramPayload(order(),iso(1000),iso(3601000),true);assert.deepEqual(p,{startsAt:iso(1000),endsAt:iso(3601000),fulfillmentVersion:7,accept:true});assert.equal(p.amount,undefined);assert.equal(p.paymentPayload,undefined);
 assert.throws(()=>consentedReprogramPayload(order(),iso(2000),iso(1000),true),/ventana/);
});
test('availability is explicitly estimated and requires exactly five distinct server-provided turns',()=>{
 const value={estimated:true,serverTime:iso(0),window:{startsAt:iso(240000),endsAt:iso(3840000)},estimatedPasses:[1,2,3,4,5].map(number=>({number,estimatedStartsAt:iso(240000+number*70000),estimatedEndsAt:iso(300000+number*70000)}))};
 assert.equal(availabilitySuggestion(value).passes.length,5);assert.throws(()=>availabilitySuggestion({...value,estimated:false}),/horarios/);assert.throws(()=>availabilitySuggestion({...value,estimatedPasses:value.estimatedPasses.slice(1)}),/horarios/);
});
test('physical QR and NFC share the same stable main-stage URL with no wallet, order or payment token',async()=>{
 const metadata=JSON.parse(await readFile(new URL('../dist/assets/main-stage-ads-access.json',import.meta.url),'utf8'));assert.equal(metadata.url,MAIN_STAGE_ENTRY_URL);assert.equal(metadata.nfcRecordType,'NDEF URI');assert.equal(new URL(metadata.url).search,'?placement=main_stage_screen');const qr=await readFile(new URL('../dist/assets/main-stage-ads-qr.svg',import.meta.url),'utf8');assert.match(qr,/<rect/);assert(!qr.includes('<image'));
});
test('stage access stays beside the actual stage and is independently disposable',()=>{
 const bounds={min:[-5,0,-20.1],max:[5,4,-19.9]},p=mainStageSignPlacement(bounds,[0,0,0]);assert(p.position[0]>2.5);assert(p.position[2]>-19.9);assert(p.width/p.height<1);const model=new T.Group(),backdrop=new T.Mesh(new T.BoxGeometry(10,4,.2),new T.MeshBasicMaterial());backdrop.name='Yellow_event_backdrop';backdrop.position.set(0,2,-20);model.add(backdrop);let late;const placeholder=new T.Texture();const sign=createMainStageSign(T,model,{documentRef:null,textureLoader:{load:(_url,onLoad)=>{late=onLoad;return placeholder;}}});assert(sign);assert.equal(isMainStageSign(sign.root.children[0]),true);assert.equal(sign.root.userData.entryUrl,MAIN_STAGE_ENTRY_URL);sign.dispose();assert.equal(sign.root.parent,null);const lateTexture=new T.Texture();let disposed=0;lateTexture.addEventListener('dispose',()=>disposed++);late(lateTexture);assert.equal(disposed,1);assert.equal(sign.root.parent,null);backdrop.geometry.dispose();backdrop.material.dispose();
});

test('legacy TIME, EXCLUSIVE and unversioned manifests ignore pilot timing metadata',async()=>{
 for(const plan of ['TIME','EXCLUSIVE',undefined]){const p=createAdsPlayer({placementId:'main_stage_screen',origin,now:()=>0,fetchImpl:async url=>url.includes('/playlists/')?Response.json({version:1,serverTime:iso(0),validUntil:iso(2000),active:{...active,plan,offerVersion:null},playback:{...timing,phase:'IDLE'}}):new Response('raster'),verifyImage:async()=>({bytes:new Uint8Array([1]),mimeType:'image/png'})});await p.refresh();assert.equal(p.state.status,'active');assert.equal(p.state.playback,null);p.dispose();}
});
test('purchase access comes from authenticated eligibility while old fixtures keep existing semantics',()=>{
 assert.equal(sessionCanPurchase({enabled:true},{mode:'CONTROLLED',canPurchase:false}),false);
 assert.equal(sessionCanPurchase({enabled:true},{mode:'CONTROLLED',canPurchase:true}),true);
 assert.equal(sessionCanPurchase({enabled:false},{mode:'PUBLIC',canPurchase:true}),false);
 assert.equal(sessionCanPurchase({enabled:true},undefined),true);
});
