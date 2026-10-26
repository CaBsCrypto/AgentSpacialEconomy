import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDatabase} from './helpers/ads-db.mjs';
import {durableAction,sha256,AdsError} from '../server/ads/common.mjs';

test('external model actions commit intent before work, reject conflicting or ambiguous replay and cache failures',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());let calls=0;
 const action={ownerId:'local-test-wallet',key:'preaudit-replay-key',action:'preaudit',payload:{revisionId:'one'}};
 const run=()=>durableAction(db,action,async()=>{calls++;assert.equal((await db.query('SELECT state FROM ads_actions WHERE key=$1',[action.key])).rows[0].state,'RUNNING');return {allowed:true};});
 assert.deepEqual(await run(),{allowed:true});assert.deepEqual(await run(),{allowed:true});assert.equal(calls,1);
 await assert.rejects(durableAction(db,{...action,payload:{revisionId:'other'}},async()=>{calls++;}),{code:'idempotency_conflict'});
 const uncertain={...action,key:'uncertain-action-key'};
 await db.query("INSERT INTO ads_actions(owner_id,key,action,fingerprint,state) VALUES($1,$2,$3,$4,'RUNNING')",[uncertain.ownerId,uncertain.key,uncertain.action,sha256({action:uncertain.action,payload:uncertain.payload})]);
 await assert.rejects(durableAction(db,uncertain,async()=>{calls++;}),{code:'action_reconciliation_required'});assert.equal(calls,1);
 const failed={...action,key:'failed-action-key'};
 const fail=()=>durableAction(db,failed,async()=>{calls++;throw new AdsError(422,'model_uncertain','Model failed closed.');});
 await assert.rejects(fail(),{code:'model_uncertain'});await assert.rejects(fail(),{code:'model_uncertain'});assert.equal(calls,2);
});
