import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { waitForServices } from "../screen-ci.mjs";

function fixture() {
 const child=new EventEmitter();Object.assign(child,{pid:4321,exitCode:null,signalCode:null});
 const logs=[];let time=0,requests=0;
 return {child,logs,get time(){return time;},get requests(){return requests;},
  options:{url:"http://127.0.0.1:4321",network:"stellar:testnet",now:()=>time,sleepImpl:async ms=>{time+=ms;},log:message=>logs.push(message)},
  fetch(fn){return async(url,options)=>{requests++;assert.equal(url,"http://127.0.0.1:4321/health");assert.ok(options.signal);return fn({time,requests,advance:ms=>{time+=ms;}});};},
 };
}
const response=(status,network)=>({status,ok:status===200,json:async()=>({network})});
const assertClean=child=>{for(const event of ["spawn","error","exit"])assert.equal(child.listenerCount(event),0,event);};

test("readiness can take longer than twenty seconds without creating a false startup failure",async()=>{
 const f=fixture();
 const pending=waitForServices(f.child,{...f.options,fetchImpl:f.fetch(({time,requests})=>{
  if(requests===1)queueMicrotask(()=>f.child.emit("spawn"));
  return time<25000?response(503):response(200,"stellar:testnet");
 })});
 const result=await pending;
 assert.equal(result.elapsedMs,25000);assert.equal(result.attempts,51);
 assert.match(f.logs.join("\n"),/spawn pid=4321/);
 assert.match(f.logs.at(-1),/ready after 25000 ms/);
 assertClean(f.child);
});

test("an early child exit interrupts an outstanding health request immediately",async()=>{
 const f=fixture();
 await assert.rejects(waitForServices(f.child,{...f.options,fetchImpl:f.fetch(()=>{
  queueMicrotask(()=>{f.child.exitCode=1;f.child.emit("exit",1,null);});
  return new Promise(()=>{});
 })}),/process exited \(code=1 signal=none\).*last health: not requested/);
 assert.equal(f.time,0);assert.equal(f.requests,1);
 assert.match(f.logs.join("\n"),/exit code=1 signal=none/);
 assertClean(f.child);
});

test("spawn errors fail immediately and diagnostics redact secret-shaped text",async()=>{
 const f=fixture(),secret="S"+"A".repeat(55);
 await assert.rejects(waitForServices(f.child,{...f.options,fetchImpl:f.fetch(()=>{
  queueMicrotask(()=>f.child.emit("error",Error("spawn refused "+secret)));
  return new Promise(()=>{});
 })}),error=>{assert.match(error.message,/process error: spawn refused \[REDACTED\]/);assert.ok(!error.message.includes(secret));return true;});
 assert.equal(f.time,0);assert.ok(!f.logs.join("\n").includes(secret));
 assertClean(f.child);
});

test("an already exited child is rejected before making a health request",async()=>{
 const f=fixture();f.child.exitCode=0;
 await assert.rejects(waitForServices(f.child,{...f.options,fetchImpl:f.fetch(()=>response(200,"stellar:testnet"))}),/process exited \(code=0/);
 assert.equal(f.requests,0);assertClean(f.child);
});

test("the absolute deadline includes request and polling time and preserves the last health result",async()=>{
 const f=fixture();
 await assert.rejects(waitForServices(f.child,{...f.options,timeoutMs:1500,fetchImpl:f.fetch(({advance})=>{
  advance(1000);return response(503);
 })}),/startup timed out after 1500 ms; last health: HTTP 503/);
 assert.equal(f.time,1500);assert.equal(f.requests,1);assertClean(f.child);
});

test("connection failures stay diagnostic and stop at the default 120-second deadline",async()=>{
 const f=fixture();
 await assert.rejects(waitForServices(f.child,{...f.options,fetchImpl:f.fetch(()=>{throw Error("ECONNREFUSED");})}),/startup timed out after 120000 ms; last health: request error: ECONNREFUSED/);
 assert.equal(f.time,120000);assertClean(f.child);
});

test("a healthy service on the wrong network fails closed before any funding",async()=>{
 const f=fixture();
 await assert.rejects(waitForServices(f.child,{...f.options,fetchImpl:f.fetch(()=>response(200,"stellar:pubnet"))}),/health network mismatch.*HTTP 200 network=stellar:pubnet/);
 assert.equal(f.requests,1);assert.equal(f.time,0);assertClean(f.child);
});

test("run startup verification precedes Friendbot, trustlines, DEX funding and payment attempts",()=>{
 const source=readFileSync(new URL("../screen-ci.mjs",import.meta.url),"utf8");
 const ready=source.indexOf("state.services=await waitForServices");
 for(const operation of [
  "for(const kp of [treasury,funder,...buyers])await friendbot",
  "for(const kp of [treasury,funder,...buyers])await submit",
  "for(const sendAmount of",
  "for(const [i,p] of SCREEN_PLAN.entries())",
 ])assert.ok(ready>0&&ready<source.indexOf(operation),operation);
 assert.match(source,/finally\{services\?\.kill\(\);\}/);
});
