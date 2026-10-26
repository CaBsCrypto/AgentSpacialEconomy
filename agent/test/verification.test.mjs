import test from 'node:test';
import assert from 'node:assert/strict';
import {requireSettlementReport} from '../lib/verification.mjs';
test('live CI cannot pass with zero payments, absent hashes, stale runs or reused transfers',()=>{
 for(const report of [{runId:'fresh',rows:[]},{runId:'fresh',rows:[{service:'venue-feed',status:'settled'}]},{runId:'stale',rows:[]},{runId:'fresh',rows:['venue-feed','screen-card'].map(service=>({service,status:'settled',tx:'a'.repeat(64)}))}])assert.throws(()=>requireSettlementReport(report,{runId:'fresh'}));
});
test('fresh distinct receipts are required for each expected paid step',()=>{
 const report={runId:'fresh',rows:['venue-feed','screen-card'].map((service,i)=>({service,status:'settled',tx:(i?'b':'a').repeat(64)}))};
 assert.equal(requireSettlementReport(report,{runId:'fresh'}).length,2);
});
