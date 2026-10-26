import test from "node:test";
import assert from "node:assert/strict";
import { advertiserOffer, sectionRequest, validateSectionRequest, sectionPreflight, guardSinglePaymentClient } from "../lib/ad-section.mjs";
import { networkConfig } from "../config/networks.mjs";
test("only explicit valid sections opt in to the new offer",()=>{
 assert.equal(advertiserOffer(undefined).slot.path,"/ad-slot");
 assert.equal(advertiserOffer(" b ").slot.path,"/ad-section"); assert.equal(advertiserOffer(" b ").section,"B");
 for(const q of [""," ","E",null,{},0])assert.throws(()=>advertiserOffer(q));
});
test("invalid or absent sections fail before the payment gate is reached",()=>{
 for(const body of [{advertiser:"A"},{advertiser:"A",section:"E"},{advertiser:"A",section:""},{advertiser:"",section:"A"}]){
  let calls=0,status=0; const res={status(n){status=n;return this;},json(){return this;}};
  validateSectionRequest({body},res,()=>calls++);
  assert.equal(status,400); assert.equal(calls,0);
 }
 const req={body:{advertiser:"A",section:"c"}}; let calls=0;
 validateSectionRequest(req,{},()=>calls++); assert.equal(calls,1); assert.equal(req.sectionCreative.section,"C");
});
test("section preflight pins the token, exact amount, recipient and network",()=>{
 const net=networkConfig();const expected={network:net.id,treasury:"treasury",asset:net.usdc.sac};
 const good={scheme:"exact",network:net.id,payTo:"treasury",asset:net.usdc.sac,amount:"50000000"};
 assert.equal(sectionPreflight({accepts:[good]},expected).ok,true);
 for(const bad of [{asset:"wrong"},{amount:"1"},{amount:"60000000"},{network:"stellar:pubnet"},{payTo:"wrong"},{scheme:"upto"}]){
  assert.equal(sectionPreflight({accepts:[{...good,...bad}]},expected).ok,false);
 }
});

test("a changed second challenge is rejected at the signing boundary",async()=>{
 const net=networkConfig(), good={scheme:"exact",network:net.id,payTo:"treasury",asset:net.usdc.sac,amount:"50000000"};
 assert.equal(sectionPreflight({accepts:[good]},{network:net.id,treasury:"treasury",asset:net.usdc.sac}).ok,true);
 for(const changed of [{payTo:"other"},{asset:"other"},{amount:"60000000"},{network:"stellar:pubnet"},{scheme:"upto"}]){
  let signed=0;
  const guarded=guardSinglePaymentClient({createPaymentPayload:async()=>{signed++;return {};}},
   {network:net.id,treasury:"treasury",asset:net.usdc.sac,priceUsdc:"5"});
  await assert.rejects(guarded.createPaymentPayload(2,{...good,...changed}),/changed/);assert.equal(signed,0);
 }
 let signed=0;
 const guarded=guardSinglePaymentClient({createPaymentPayload:async()=>{signed++;return {};}},
  {network:net.id,treasury:"treasury",asset:net.usdc.sac,priceUsdc:"5"});
 await guarded.createPaymentPayload(2,good);
 await assert.rejects(guarded.createPaymentPayload(2,good),/already attempted/);assert.equal(signed,1);
});
test("a signer exception cannot trigger another signature attempt",async()=>{
 const net=networkConfig();let attempts=0;
 const guarded=guardSinglePaymentClient({createPaymentPayload:async()=>{attempts++;throw Error("unknown");}},
  {network:net.id,treasury:"treasury",asset:net.usdc.sac,priceUsdc:"5"});
 const requirement={scheme:"exact",network:net.id,payTo:"treasury",asset:net.usdc.sac,amount:"50000000"};
 await assert.rejects(guarded.createPaymentPayload(2,requirement),/unknown/);
 await assert.rejects(guarded.createPaymentPayload(2,requirement),/already attempted/);assert.equal(attempts,1);
});
