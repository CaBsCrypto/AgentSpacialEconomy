import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {deliveryInterval,signEvidence,verifyEvidence} from '../server/ads/publisher.mjs';
const prev={fence:1,version:2,revision_id:'r',manifest_hash:'hash',ack_at:new Date(1000)};
const ack={fence:1,version:2,revisionId:'r',manifestHash:'hash'};
const options={now:2000,slotStart:0,slotEnd:5000,maxGapMs:2500,requiredRemaining:10000};
test('only interval between matching applied-frame acknowledgements counts',()=>assert.deepEqual(deliveryInterval(prev,ack,options),{start:1000,end:2000,units:1000}));
test('stale, fenced and different revision acknowledgements never count',()=>{
 for(const a of [{...ack,fence:2},{...ack,version:3},{...ack,revisionId:'other'}])assert.equal(deliveryInterval(prev,a,options),null);
 assert.equal(deliveryInterval(prev,ack,{...options,now:4000}),null);assert.equal(deliveryInterval(null,ack,options),null);
});
test('time clips to window and remaining obligation',()=>assert.deepEqual(deliveryInterval(prev,ack,{...options,slotStart:1500,requiredRemaining:100}),{start:1500,end:1600,units:100}));
test('tampering and another publisher key invalidate evidence',()=>{
 const keys=generateKeyPairSync('ed25519'),other=generateKeyPairSync('ed25519');const e={orderId:'a',units:1000,nonce:'unique'};const signature=signEvidence(e,keys.privateKey);
 assert(verifyEvidence(e,signature,keys.publicKey));assert(!verifyEvidence({...e,units:999},signature,keys.publicKey));assert(!verifyEvidence(e,signature,other.publicKey));
});
