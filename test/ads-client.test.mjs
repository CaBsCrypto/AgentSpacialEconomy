import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createAdsPlayer, validatePlaylist, verifyAdsImage } from '../dist/ads-player.mjs';
import { exclusiveUnits, formatAdsAmount, orderProgress, createAdsApi, decodePaymentChallenge } from '../dist/ads.mjs';
import { ADS_USDC, validatePaymentRequirements, selectPaymentRuleIds } from '../dist/ads-wallet.mjs';
const image = new Uint8Array([137,80,78,71,13,10,26,10]);
const hash = createHash('sha256').update(image).digest('hex');
const origin = 'https://venue.example';
const active = { orderId:'order-1', revisionId:'revision-1', manifestHash:'a'.repeat(64), imageHash:hash, imageUrl:'/api/ads/assets/'+hash, alt:'Project', cta:[{label:'Website',url:'https://project.example/',domain:'project.example'}], startsAt:100_000,endsAt:110_000 };
const playlist = (overrides={}) => ({ serverTime:100_000, validUntil:102_000, version:1,active:structuredClone(active),...overrides });
function fixture() {
 let clock=0, value=playlist(), offline=false, reads=0, writes=0;
 const changes=[];
 const fetchImpl=async(url,options)=>{if(options.method && options.method!=='GET')writes++;if(offline)throw Error('network');if(String(url).includes('/playlists/')){reads++;return Response.json(value);}return new Response(image,{headers:{'content-type':'image/png'}});};
 const player=createAdsPlayer({placementId:'main_stage_screen',origin,now:()=>clock,fetchImpl,onChange:value=>changes.push(value),verifyImage:(response,expected)=>verifyAdsImage(response,expected,webcrypto)});
 return {player,changes,get reads(){return reads;},get writes(){return writes;},clock:value=>{clock=value;},next:next=>{value=next;},offline:()=>{offline=true;}};
}
test('ads reader verifies image bytes and expires from server time even when local wall clock differs',async()=>{
 const f=fixture();await f.player.refresh();assert.equal(f.player.state.status,'active');assert.deepEqual(f.player.state.bytes,image);
 f.clock(1_999);assert.equal(f.player.tick().status,'active');f.clock(2_000);assert.equal(f.player.tick().status,'neutral');assert.equal(f.writes,0);
});
test('ads reader immediately removes cached content on failed freshness check and version rollback',async()=>{
 const f=fixture();await f.player.refresh();f.next(playlist({version:0}));await f.player.refresh();assert.equal(f.player.state.status,'neutral');
 f.next(playlist({version:2}));await f.player.refresh();assert.equal(f.player.state.status,'active');f.offline();await f.player.refresh();assert.equal(f.player.state.status,'neutral');
});
test('neutral update, suspension and expired half-open creative remove the active revision',async()=>{
 const f=fixture();await f.player.refresh();f.next(playlist({version:2,active:null}));await f.player.refresh();assert.equal(f.player.state.status,'neutral');
 f.next(playlist({version:3,active:{...active,endsAt:100_100}}));await f.player.refresh();f.clock(100);assert.equal(f.player.tick().status,'neutral');
 f.clock(0);f.player.suspend();assert.equal(f.player.state.status,'neutral');await f.player.refresh();assert.equal(f.reads,3);
});
test('changing a creative cannot resurrect an image whose validation finished after suspension',async()=>{
 let finish,started;const ready=new Promise(resolve=>{started=resolve;});
 const player=createAdsPlayer({placementId:'venue_center_banner',origin,now:()=>0,fetchImpl:async url=>String(url).includes('/playlists/')?Response.json(playlist()):new Response(image,{headers:{'content-type':'image/png'}}),verifyImage:async()=>{started();await new Promise(resolve=>{finish=resolve;});return{bytes:image,mimeType:'image/png'};}});
 const request=player.refresh();await ready;player.suspend();finish();await request;assert.equal(player.state.status,'neutral');
});
test('multiple independent readers never generate audience or delivery mutations',async()=>{
 const readers=[fixture(),fixture(),fixture()];await Promise.all(readers.map(item=>item.player.refresh()));for(const f of readers){for(let i=0;i<5;i++)f.player.tick();assert.equal(f.writes,0);assert.equal(f.player.state.active.orderId,'order-1');}
});
test('tampered image, active CTA schemes and off-origin artefacts fail closed',async()=>{
 await assert.rejects(verifyAdsImage(new Response(image,{headers:{'content-type':'image/png'}}),'b'.repeat(64),webcrypto),/coincide/);
 assert.throws(()=>validatePlaylist(playlist({active:{...active,imageUrl:'https://evil.example/ad.png'}}),'main_stage_screen',{origin}),/publicador/);
 assert.throws(()=>validatePlaylist(playlist({active:{...active,cta:[{url:'javascript:alert(1)'}]}}),'main_stage_screen',{origin}),/HTTPS/);
 assert.throws(()=>validatePlaylist(playlist({active:{...active,cta:[{url:'https://project.example',domain:'other.example'}]}}),'main_stage_screen',{origin}),/dominio/);
});
test('paid, queued and fulfilled states remain distinct including partial and remedied orders',()=>{
 assert.equal(orderProgress({status:'PAYMENT_PENDING',payment:{status:'AUTHORIZED'}}).payment,false);
 const queued=orderProgress({status:'QUEUED',payment:{status:'SETTLED'},queue:{state:'PROCESSING'}});assert.equal(queued.payment,true);assert.equal(queued.queue,true);assert.equal(queued.delivery,false);
 assert.equal(orderProgress({status:'COMPLETED',payment:{status:'SETTLED'},placements:[{status:'PARTIAL'}]}).delivery,false);
 assert.equal(orderProgress({status:'COMPLETED',payment:{status:'SETTLED'},placements:[{status:'FULFILLED'},{status:'CLOSED_WITH_REMEDY'}]}).delivery,true);
});
test('quote values preserve exact integer money and exclusive window units',()=>{
 assert.equal(formatAdsAmount('10000001'),'1.0000001');assert.equal(formatAdsAmount('90071992547409930'),'9007199254.740993');
 assert.equal(exclusiveUnits(0,30_000,10_000),3);assert.throws(()=>exclusiveUnits(0,31_000,10_000),/múltiplo/);assert.throws(()=>exclusiveUnits(0,30_000,undefined));
});
test('API sends raw uploads and stable idempotency keys, and understands x402 402 without treating it as settlement',async()=>{
 const calls=[],challenge={x402Version:2,accepts:[]};const api=createAdsApi({fetchImpl:async(url,options)=>{calls.push([url,options]);return Response.json(challenge,{status:402});}});
 const result=await api('/orders/id/pay',{method:'POST',allow402:true,idempotencyKey:'stable-key'});assert.deepEqual(result.paymentRequired,challenge);assert.equal(calls[0][1].headers['Idempotency-Key'],'stable-key');assert.equal(calls[0][1].credentials,'same-origin');
 const encoded=Buffer.from(JSON.stringify(challenge)).toString('base64');assert.deepEqual(decodePaymentChallenge(new Response(null,{headers:{'PAYMENT-REQUIRED':encoded}}),{}),challenge);
});
test('payment requirements pin amount, payee, network and asset before a wallet can sign',()=>{
 const expected={amountUnits:'1000000',asset:ADS_USDC,payTo:'payee',network:'stellar:testnet'};
 const requirement={scheme:'exact',network:'stellar:testnet',asset:ADS_USDC,amount:'1000000',payTo:'payee',maxTimeoutSeconds:60,extra:{areFeesSponsored:true}};
 assert.equal(validatePaymentRequirements({x402Version:2,accepts:[requirement]},expected),requirement);
 for(const changed of [{amount:'1000001'},{payTo:'evil'},{network:'stellar:pubnet'},{asset:'another'},{maxTimeoutSeconds:9999}])assert.throws(()=>validatePaymentRequirements({x402Version:2,accepts:[{...requirement,...changed}]},expected));
});
test('wallet chooses a single exact current context rule and refuses ambiguity or policy bypass',()=>{
 const base={id:7,context_type:{tag:'Default'},signers:['key'],policies:[],valid_until:20};const opts={credentialId:'key',asset:ADS_USDC,ledger:10,credentialOf:value=>value};
 assert.deepEqual(selectPaymentRuleIds([base],opts),[7]);assert.throws(()=>selectPaymentRuleIds([base,{...base,id:8}],opts));assert.throws(()=>selectPaymentRuleIds([{...base,valid_until:10}],opts));assert.throws(()=>selectPaymentRuleIds([{...base,policies:['threshold']}],opts));
 assert.deepEqual(selectPaymentRuleIds([base,{...base,id:9,context_type:{tag:'CallContract',values:[ADS_USDC]}}],opts),[9]);
});

test('a response delayed beyond its validity never revives cached content',async()=>{
 let clock=0;const player=createAdsPlayer({placementId:'main_stage_screen',origin,now:()=>clock,fetchImpl:async url=>{if(String(url).includes('/playlists/')){clock=2500;return Response.json(playlist());}return new Response(image,{headers:{'content-type':'image/png'}});},verifyImage:(response,expected)=>verifyAdsImage(response,expected,webcrypto)});await player.refresh();assert.equal(player.state.status,'neutral');
});

test('structured API failures retain the server explanation instead of showing an object',async()=>{
 const api=createAdsApi({fetchImpl:async()=>Response.json({error:{code:'checkout_unconfigured',message:'Compras deshabilitadas hasta completar la configuración.'}},{status:503})});
 await assert.rejects(api('/quotes',{method:'POST',body:{}}),error=>error.message.includes('Compras deshabilitadas')&&error.reason==='checkout_unconfigured');
});

test('QR configuration preserves every placement parameter for server validation',async()=>{
 const {adsConfigPath,configuredPlacement}=await import('../dist/ads.mjs');
 assert.equal(adsConfigPath('?publisher=1'),'/config');
 assert.equal(adsConfigPath('?placement=venue%5Fcenter%5Fbanner'),'/config?placement=venue_center_banner');
 assert.equal(adsConfigPath('?placement=main_stage_screen&placement=venue_center_banner'),'/config?placement=main_stage_screen&placement=venue_center_banner');
 assert.equal(adsConfigPath('?placement=unknown'),'/config?placement=unknown');
 assert.equal(configuredPlacement({selectedPlacement:'main_stage_screen',placements:[{id:'main_stage_screen'}]},true),'main_stage_screen');
 assert.throws(()=>configuredPlacement({placements:[{id:'main_stage_screen'}]},true),/servidor/);
 assert.throws(()=>configuredPlacement({selectedPlacement:'unknown',placements:[{id:'main_stage_screen'}]},true),/servidor/);
 assert.equal(configuredPlacement({placements:[{id:'main_stage_screen'}]},false),null);
});
