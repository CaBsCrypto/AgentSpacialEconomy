import test from 'node:test';import assert from 'node:assert/strict';
import {createARSession,createPassportTransform,stopMediaTracks,fetchAssetBytes} from '../dist/ar-session.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
test('AR reports tracking only after an active camera session and actual target events',async()=>{let callbacks,stops=0;const events=[];const session=createARSession({createAdapter:async c=>{callbacks=c;return {start:async()=>{},stop(){stops++;}};},onState:s=>events.push(s.state)});assert.equal(session.state,'idle');await session.start();assert.equal(session.state,'searching');callbacks.found();assert.equal(session.state,'tracking');callbacks.lost();assert.equal(session.state,'searching');session.stop();assert.equal(session.state,'paused');callbacks.found();assert.equal(session.state,'paused');assert.equal(stops,1);assert.deepEqual(events.slice(0,4),['loading','requesting','searching','searching']);});
test('stopping while camera permission is pending cleans up again after the request resolves',async()=>{const permission=deferred();let stops=0;const session=createARSession({createAdapter:async()=>({start:()=>permission.promise,stop(){stops++;}})});const pending=session.start();await new Promise(r=>setImmediate(r));session.stop();permission.resolve();assert.equal(await pending,false);assert.equal(session.state,'paused');assert.equal(session.busy,false);assert.equal(stops,2);});
test('stopping while libraries load prevents a later camera start',async()=>{const preparation=deferred();let starts=0,stops=0;const session=createARSession({createAdapter:()=>preparation.promise});const pending=session.start();await new Promise(r=>setImmediate(r));session.stop();preparation.resolve({start(){starts++;},stop(){stops++;}});await pending;assert.equal(starts,0);assert.equal(stops,1);});
test('denied camera is recoverable and cleans the failed adapter',async()=>{let attempts=0,stops=0;const session=createARSession({createAdapter:async()=>({async start(){if(++attempts===1)throw new DOMException('denied','NotAllowedError');},stop(){stops++;}})});assert.equal(await session.start(),false);assert.equal(session.state,'error');assert.equal(stops,1);assert.equal(await session.start(),true);assert.equal(session.state,'searching');});
test('duplicate starts share a request; lost tracking does not reset user transformations',async()=>{const permission=deferred();let callbacks,preparations=0;const transform=createPassportTransform(),session=createARSession({createAdapter:async c=>{callbacks=c;preparations++;return {start:()=>permission.promise,stop(){}};}});const a=session.start(),b=session.start();assert.equal(a,b);permission.resolve();await a;callbacks.found();transform.drag(100,50);transform.pinch(1.5);const pose=transform.value;callbacks.lost();callbacks.found();assert.deepEqual(transform.value,pose);assert.equal(preparations,1);});
test('gesture scale and pitch stay bounded, invalid pinch values cannot corrupt state, reset is exact',()=>{const t=createPassportTransform();t.drag(10,10000);t.pinch(1000);assert.equal(t.value.pitch,.8);assert.equal(t.value.scale,2.4);t.drag(0,-10000);t.pinch(.0001);assert.equal(t.value.pitch,-.8);assert.equal(t.value.scale,.6);const previous=t.value;for(const n of [NaN,Infinity,0,-1])t.pinch(n);assert.deepEqual(t.value,previous);t.reset();assert.deepEqual(t.value,{yaw:0,pitch:0,scale:1});});
test('camera shutdown stops every track and clears the video stream',()=>{let stops=0,paused=0;const video={srcObject:{getTracks:()=>[{stop(){stops++;}},{stop(){stops++;}}]},pause(){paused++;}};stopMediaTracks(video);assert.equal(stops,2);assert.equal(paused,1);assert.equal(video.srcObject,null);stopMediaTracks(video);assert.equal(stops,2);});

test('stop immediately releases busy; a late canceled permission cannot clear a restarted session',async()=>{
 const first=deferred(),second=deferred();let attempts=0,oldSignal,stops=0;
 const session=createARSession({createAdapter:async({signal})=>{const index=++attempts;if(index===1)oldSignal=signal;return {start:()=>index===1?first.promise:second.promise,stop(){stops++;}};}});
 const oldRequest=session.start();await new Promise(r=>setImmediate(r));assert.equal(session.busy,true);
 session.stop();assert.equal(session.busy,false);assert.equal(session.state,'paused');assert.equal(oldSignal.aborted,true);
 const newRequest=session.start();await new Promise(r=>setImmediate(r));assert.equal(attempts,2);assert.equal(session.state,'requesting');assert.equal(session.busy,true);
 first.resolve();assert.equal(await oldRequest,false);assert.equal(session.state,'requesting');assert.equal(session.busy,true);assert.equal(session.start(),newRequest);
 second.resolve();assert.equal(await newRequest,true);assert.equal(session.state,'searching');assert.equal(session.busy,false);assert.equal(stops,2);
});
test('cancel before the startup microtask never begins preparation or changes paused state',async()=>{
 let preparations=0;const session=createARSession({createAdapter:async()=>{preparations++;return {start:async()=>{},stop(){}};}});
 const request=session.start();session.stop();await request;assert.equal(preparations,0);assert.equal(session.state,'paused');assert.equal(session.busy,false);
});
test('target prefetch aborts on exit and clears its timeout',async()=>{
 const abort=new AbortController();let clear=0,fetchSignal;
 const request=fetchAssetBytes('target.mind',{signal:abort.signal,timer:()=>123,clearTimer:id=>{assert.equal(id,123);clear++;},fetcher:(_,options)=>new Promise((resolve,reject)=>{fetchSignal=options.signal;options.signal.addEventListener('abort',()=>reject(options.signal.reason));})});
 abort.abort();await assert.rejects(request,{name:'AbortError'});assert.equal(fetchSignal.aborted,true);assert.equal(clear,1);
});
test('target prefetch timeout also covers a stalled response body',async()=>{
 let expire,clear=0;const request=fetchAssetBytes('target.mind',{timer:callback=>{expire=callback;return 42;},clearTimer:id=>{assert.equal(id,42);clear++;},fetcher:async(_,options)=>({ok:true,arrayBuffer:()=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason)))})});
 await Promise.resolve();expire();await assert.rejects(request,{name:'TimeoutError'});assert.equal(clear,1);
});
