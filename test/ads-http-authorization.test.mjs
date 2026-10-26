import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdsHandler} from '../server/ads/http.mjs';
import {createAdsApi} from '../dist/ads.mjs';
const origin='https://ads.example';
const disputeId='11111111-1111-4111-8111-111111111111',spoofedId='22222222-2222-4222-8222-222222222222';
const identityA={ownerId:'operator-owner-A',address:'operator-A',role:'operator'};
const identityB={ownerId:'operator-owner-B',address:'operator-B',role:'operator'};
function fixture(identity=identityA){
 const calls=[],queries=[];let authentications=0;
 const fake=name=>async(...args)=>{calls.push({name,args});return {status:'RECORDED'};};
 const service={};for(const name of ['upload','campaign','revision','preaudit','preview','quote','order','getOrder','evidence','pay','dispute','reprogram','suspend'])service[name]=fake(name);
 const corrections={apply:fake('correction'),release:fake('release'),resolve:fake('resolve')};
 const refunds={requestSettlementRemedy:fake('requestRefund'),reject:fake('rejectRefund'),approve:fake('approveRefund'),submit:fake('submitRefund'),reconcile:fake('reconcileRefund')};
 const db={query:async sql=>{queries.push(sql);return {rows:[{count:1}],rowCount:1};}};
 const auth={authenticate:async()=>{authentications++;return identity;}};
 const handler=createAdsHandler({config:{origin,publisherToken:'',network:'stellar:testnet',enabled:false,missing:[],limits:{uploadBytes:1024}},db,auth,service,refunds,corrections});
 const request=(path,{body={},key='trusted-request-key',requestOrigin=origin}={})=>new Request(origin+'/api/ads'+path,{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json',...(key==null?{}:{'Idempotency-Key':key})},body:JSON.stringify(body)});
 return{handler,request,calls,queries,get authentications(){return authentications;}};
}
test('dispute resolution takes authority and dispute identity only from the authenticated session and route',async()=>{
 const f=fixture();const response=await f.handler(f.request('/operator/disputes/'+disputeId+'/resolve',{body:{identity:identityB,disputeId:spoofedId,outcome:'REJECTED',reason:'Explicit operator decision'}}));
 assert.equal(response.status,200);assert.equal(f.calls.length,1);const payload=f.calls[0].args[0];assert.equal(f.calls[0].name,'resolve');assert.deepEqual(payload.identity,identityA);assert.equal(payload.disputeId,disputeId);assert.equal(payload.outcome,'REJECTED');assert.equal(payload.reason,'Explicit operator decision');
});
test('every authenticated business mutation requires an idempotency key before touching quotas or services',async()=>{
 const paths=['/uploads','/campaigns','/campaigns/'+disputeId+'/revisions','/campaigns/'+disputeId+'/preaudit','/campaigns/'+disputeId+'/preview','/quotes','/orders','/orders/'+disputeId+'/pay','/orders/'+disputeId+'/revision','/orders/'+disputeId+'/disputes','/orders/'+disputeId+'/reprogram','/orders/'+disputeId+'/refunds','/operator/orders/'+disputeId+'/suspend','/operator/orders/'+disputeId+'/release','/operator/disputes/'+disputeId+'/resolve',...['reject','approve','submit','reconcile'].map(action=>'/operator/refunds/'+disputeId+'/'+action)];
 for(const path of paths){const f=fixture();const response=await f.handler(f.request(path,{key:null}));assert.equal(response.status,400,path);assert.equal((await response.json()).error.code,'idempotency_required',path);assert.equal(f.calls.length,0,path);assert.equal(f.queries.length,0,path);}
});
test('malformed keys and a foreign origin cannot reach a protected action',async()=>{
 for(const key of ['short','bad key with spaces','x'.repeat(161)]){const f=fixture();const response=await f.handler(f.request('/quotes',{key}));assert.equal(response.status,400);assert.equal(f.calls.length,0);}
 const f=fixture();const response=await f.handler(f.request('/operator/disputes/'+disputeId+'/resolve',{requestOrigin:'https://foreign.example'}));assert.equal(response.status,403);assert.equal(f.authentications,0);assert.equal(f.calls.length,0);
});
test('an advertiser cannot make an operator request by placing an operator identity in JSON',async()=>{
 const f=fixture({...identityA,role:'advertiser'});const response=await f.handler(f.request('/operator/disputes/'+disputeId+'/resolve',{body:{identity:identityB,outcome:'REJECTED',reason:'Spoofed operator'}}));assert.equal(response.status,403);assert.equal(f.calls.length,0);
});
test('the initial x402 challenge includes its key and does not transmit an authorization payload',async()=>{
 const f=fixture();let payload;const handler=createAdsHandler({config:{origin,publisherToken:'',limits:{}},db:{query:async()=>({rows:[{count:1}],rowCount:1})},auth:{authenticate:async()=>identityA},service:{pay:async(owner,id,key,body)=>{payload={owner,id,key,body};return {status:402,paymentRequired:{x402Version:2,accepts:[]}};}}});
 const api=createAdsApi({fetchImpl:async(url,options)=>handler(new Request(origin+url,{...options,headers:{...options.headers,Origin:origin}}))});
 const result=await api('/orders/'+disputeId+'/pay',{method:'POST',allow402:true,idempotencyKey:'challenge-original-order'});assert.equal(result.paymentRequired.x402Version,2);assert.deepEqual(payload,{owner:identityA.ownerId,id:disputeId,key:'challenge-original-order',body:undefined});
});
