import test from 'node:test';
import assert from 'node:assert/strict';
import { planRotations, buildDemand, quotePrice } from '../server/ads/scheduler.mjs';
const cfg={rotationMs:1000,passMs:2000,timeUnitMs:1000,exclusiveUnitMs:1000,maxUnits:100,maxWindowMs:60000,maxCampaignSharePercent:100};
const order=(id,plan,units,start=0,end=10000)=>({id,campaignId:id,committedAt:0,plan,units,startsAt:start,endsAt:end});
test('TIME and PASSES alternate by campaign, passes stay whole',()=>{
 const slots=planRotations([order('a','TIME',2),order('b','PASSES',2)],[],cfg);
 assert.deepEqual(slots.map(s=>[s.orderId,s.start,s.end]),[['a',0,1000],['b',1000,3000],['a',3000,4000],['b',4000,6000]]);
});
test('exclusive and host half-open blocks cannot overlap turns',()=>{
 const s=planRotations([order('a','TIME',3),order('x','EXCLUSIVE',2,1000,3000)],[{start:3000,end:4000}],cfg);
 assert.deepEqual(s.filter(s=>s.orderId==='a').map(s=>[s.start,s.end]),[[0,1000],[4000,5000],[5000,6000]]);
});
test('impossible exclusive or insufficient time refuses entire schedule',()=>{
 assert.throws(()=>planRotations([order('a','EXCLUSIVE',3,0,3000),order('b','EXCLUSIVE',2,1000,3000)],[],cfg),/capacity/i);
 assert.throws(()=>planRotations([order('a','PASSES',6)],[],cfg),/capacity/i);
});
test('independent clients have no effect on demand',()=>assert.deepEqual(buildDemand(order('a','TIME',5),cfg),{durationMs:5000,requiredUnits:5000,unit:'MILLISECONDS',turnMs:1000}));
test('prices are exact integers with independent design line item',()=>{
 const config={...cfg,pricing:{main_stage_screen:{TIME:{unitAmount:'9007199254740993',designAmount:'7'}}}};
 assert.equal(quotePrice(['main_stage_screen'],'TIME',2,config).amountUnits,'18014398509481993');
});
test('tie breaks are stable, input order does not affect schedule',()=>{
 assert.deepEqual(planRotations([order('b','TIME',2),order('a','TIME',2)],[],cfg),planRotations([order('a','TIME',2),order('b','TIME',2)],[],cfg));
});
test('negative, fractional, excessive and infeasible demand fail before pricing',()=>{
 for(const units of [-1,0,1.2,101])assert.throws(()=>buildDemand(order('x','TIME',units),cfg));
 assert.throws(()=>buildDemand(order('x','EXCLUSIVE',1,0,2000),cfg));
});
