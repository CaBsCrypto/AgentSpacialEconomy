import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {requireBudget,claimScreenRun,SCREEN_PLAN} from '../screen-ci.mjs';
import {AD_SECTION_SLOT} from '../catalog.mjs';
test('a screen run cannot exceed six exact five-USDC purchases',()=>{
 assert.equal(requireBudget(AD_SECTION_SLOT),300000000n);
 for(const slot of [{...AD_SECTION_SLOT,priceUsdc:'5.01'},{...AD_SECTION_SLOT,priceUsdc:'4.99'},{...AD_SECTION_SLOT,durationMs:60000}])assert.throws(()=>requireBudget(slot));
 assert.throws(()=>requireBudget(AD_SECTION_SLOT,SCREEN_PLAN.slice(1)));
 assert.throws(()=>requireBudget(AD_SECTION_SLOT,[...SCREEN_PLAN,SCREEN_PLAN[0]]));
});
test('a fresh output directory is claimed once and interrupted runs cannot silently pay again',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'screen-run-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const marker={runId:'2026-10-26T10:00:00.000Z',sourceCommit:'a'.repeat(40),maximumAdvertisingUnits:'300000000'};
 await claimScreenRun(dir,marker);
 assert.deepEqual(JSON.parse(await readFile(join(dir,'run-started.json'),'utf8')),marker);
 await assert.rejects(claimScreenRun(dir,{...marker,runId:'another-run'}),{code:'EEXIST'});
 assert.deepEqual(JSON.parse(await readFile(join(dir,'run-started.json'),'utf8')),marker);
});
