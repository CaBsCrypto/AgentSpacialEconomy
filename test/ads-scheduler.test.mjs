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

test('frozen pass render lead wins over a larger new default without changing sixty-second units',()=>{
 const newConfig={timeUnitMs:300000,rotationMs:60000,passMs:60000,renderLeadMs:10000,maxUnits:5,maxWindowMs:600000,maxCampaignSharePercent:100};
 const legacy={id:'legacy-lead',campaignId:'legacy',committedAt:0,plan:'PASSES',units:5,passMs:60000,renderLeadMs:2000,startsAt:0,endsAt:600000};
 const fresh={...legacy,id:'fresh-lead',renderLeadMs:10000};
 assert.equal(buildDemand(legacy,newConfig).durationMs,310000);assert.equal(buildDemand(fresh,newConfig).durationMs,350000);
 for(const [quote,occupied] of [[legacy,62000],[fresh,70000]]){
  const slots=planRotations([quote],[],newConfig);assert.equal(slots.length,5);
  assert(slots.every(slot=>slot.end-slot.start===occupied&&slot.deliveryUnits===1));
 }
 assert.equal(legacy.passMs,60000);assert.equal(legacy.units,5);assert.equal(legacy.renderLeadMs,2000);
});


test('new campaign spacing separates five passes while legacy and another campaign retain their capacity',()=>{
 const config={maxUnits:5,maxWindowMs:3600000,maxCampaignSharePercent:100,passMs:60000,renderLeadMs:10000,rotationMs:60000};
 const order={id:'a',campaignId:'campaign-a',plan:'PASSES',units:5,startsAt:0,endsAt:3600000,committedAt:0,passMs:60000,renderLeadMs:10000,minCampaignGapMs:60000};
 const spaced=planRotations([order],[],config);for(let i=1;i<spaced.length;i++)assert(spaced[i].start-spaced[i-1].end>=60000);
 const legacy=planRotations([{...order,minCampaignGapMs:0}],[],config);assert.equal(legacy[1].start,legacy[0].end);
 const mixed=planRotations([order,{...order,id:'b',campaignId:'campaign-b',committedAt:1}],[],config);assert.equal(mixed[1].orderId,'b');assert.equal(mixed[1].start,mixed[0].end);
 const retry=planRotations([{...order,units:1,startsAt:100000}],[],{...config,campaignHistory:[{campaignId:'campaign-a',end:90000,minCampaignGapMs:60000}]});assert.equal(retry[0].start,150000);
});


test('a campaign waiting for its interval cannot advance the clock past another eligible campaign',()=>{
 const config={maxUnits:5,maxWindowMs:1000000,maxCampaignSharePercent:100,passMs:60000,renderLeadMs:10000,rotationMs:60000,campaignHistory:[{campaignId:'a',end:0,minCampaignGapMs:60000}]};
 const base={plan:'PASSES',units:1,startsAt:0,passMs:60000,renderLeadMs:10000,minCampaignGapMs:60000};
 const slots=planRotations([{...base,id:'a',campaignId:'a',endsAt:140000,committedAt:0},{...base,id:'b',campaignId:'b',endsAt:70000,committedAt:1}],[],config);
 assert.deepEqual(slots.map(s=>s.orderId),['b','a']);assert.deepEqual(slots.map(s=>s.start),[0,70000]);
});

test('eligible scheduling preserves one complete pass per campaign per round without starvation',()=>{
 const config={maxUnits:5,maxWindowMs:3600000,maxCampaignSharePercent:100,passMs:60000,renderLeadMs:10000,rotationMs:60000,campaignHistory:[{campaignId:'a',end:0,minCampaignGapMs:60000}]};
 const base={plan:'PASSES',units:5,startsAt:0,endsAt:3600000,passMs:60000,renderLeadMs:10000,minCampaignGapMs:60000};
 const slots=planRotations(['a','b','c'].map((id,i)=>({...base,id,campaignId:id,committedAt:i})),[],config);
 for(let round=0;round<5;round++)assert.deepEqual(new Set(slots.slice(round*3,round*3+3).map(s=>s.campaignId)),new Set(['a','b','c']));
 for(const id of ['a','b','c']){const campaign=slots.filter(s=>s.campaignId===id);assert.equal(campaign.length,5);for(let i=1;i<5;i++)assert(campaign[i].start-campaign[i-1].end>=60000);}
});
