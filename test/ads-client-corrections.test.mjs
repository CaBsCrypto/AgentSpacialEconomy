import test from 'node:test';
import assert from 'node:assert/strict';
import {includedCorrectionEligible,submitIncludedCorrection} from '../dist/ads.mjs';
const order={id:'original-order',status:'QUARANTINED',quote:{campaignId:'original-campaign',terms:{includedRevisions:1}},disputes:[],refunds:[]};
const brief={name:'Corrected project',description:'Corrected description',xUrl:'https://x.com/project',websiteUrl:'https://project.example',rightsAccepted:true};
const logo=new Blob(['test-image'],{type:'image/png'});
test('included corrections are restricted by order state and terms, with disputes and refunds blocking the action',()=>{
 assert.equal(includedCorrectionEligible(order),true);
 for(const changed of [{status:'LIVE'},{status:'COMPLETED'},{quote:{...order.quote,terms:{includedRevisions:0}}},{disputes:[{state:'OPEN'}]},{refunds:[{state:'REQUESTED'}]},{refunds:[{state:'CONFIRMED'}]}])assert.equal(includedCorrectionEligible({...order,...changed}),false);
});
test('explicit correction preserves the original order and campaign and applies only the exact passing revision',async()=>{
 const calls=[];const api=async(path,options)=>{calls.push({path,...options});if(path==='/uploads')return{id:'logo-clean'};if(path.endsWith('/revisions'))return{revisionId:'new-revision'};if(path.endsWith('/preaudit'))return{revisionId:'new-revision',state:'PREAUDITED',allowed:true};return{additionalCharge:false};};
 const result=await submitIncludedCorrection({api,order,brief,logo,keyFor:async action=>'stable-'+action});
 assert.deepEqual(calls.map(call=>call.path),['/uploads','/campaigns/original-campaign/revisions','/campaigns/original-campaign/preaudit','/orders/original-order/revision']);
 assert.equal(calls[0].raw,true);assert.deepEqual(calls[1].body,{brief,logoId:'logo-clean'});assert.deepEqual(calls[3].body,{revisionId:'new-revision'});assert.equal(calls[3].idempotencyKey,'stable-orderRevision');assert.equal(result.additionalCharge,false);assert.equal(calls.some(call=>/\/pay$|\/quotes$|\/orders$/.test(call.path)),false);
});
test('a blocked or concurrently replaced correction never reaches the paid order',async()=>{
 for(const audit of [{revisionId:'new-revision',state:'QUARANTINED',allowed:false},{revisionId:'another-revision',state:'PREAUDITED',allowed:true}]){
  const calls=[];const api=async path=>{calls.push(path);return path==='/uploads'?{id:'logo'}:path.endsWith('/revisions')?{revisionId:'new-revision'}:audit;};
  await assert.rejects(submitIncludedCorrection({api,order,brief,logo,keyFor:async()=> 'stable-key'}));assert.equal(calls.length,3);assert.equal(calls.some(path=>path.startsWith('/orders/')),false);
 }
});
test('an ineligible order is rejected before upload or any mutation',async()=>{
 let calls=0;await assert.rejects(submitIncludedCorrection({api:async()=>{calls++;},order:{...order,status:'LIVE'},brief,logo,keyFor:async()=> 'stable-key'}));assert.equal(calls,0);
});
