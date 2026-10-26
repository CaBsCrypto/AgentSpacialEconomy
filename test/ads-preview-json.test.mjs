import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createTestDatabase} from './helpers/ads-db.mjs';
import {createAdsService} from '../server/ads/service.mjs';
import {PILOT_PROFILE} from '../server/ads/offers.mjs';
import {uuid,sha256} from '../server/ads/common.mjs';
const {prepareValue}=createRequire(import.meta.url)('pg/lib/utils');
const artifact={placement:'main_stage_screen',key:'explicit-local-raster.png',hash:'a'.repeat(64),mime:'image/png',width:1280,height:720,alt:'Explicit local preview fixture'};
async function fixture(t,{empty=false,insertFailure=false}={}){
 const engine=await createTestDatabase();t.after(()=>engine.close());let calls=0,inserts=0;
 // Exercise pg's actual wire conversion even on local PGlite. Native CI uses
 // the same converted strings, so the test does not depend on PGlite JSON coercion.
 const adapt=target=>({query:async(sql,params)=>{if(sql.startsWith('INSERT INTO ads_previews')){inserts++;if(insertFailure)throw Error('PRIVATE_PG_DIAGNOSTIC');}return target.query(sql,params?.map(prepareValue));}});
 const db={...adapt(engine),transaction:work=>engine.transaction(tx=>work(adapt(tx)))};
 const owner='explicit-local-preview-owner',campaign=uuid(),revision=uuid(),logo=uuid();
 await db.query("INSERT INTO ads_uploads(id,owner_id,storage_key,hash,mime,width,height,size) VALUES($1,$2,'local-logo.png',$3,'image/png',64,64,64)",[logo,owner,sha256('local-logo')]);
 await db.query('INSERT INTO ads_campaigns(id,owner_id,brief,current_revision) VALUES($1,$2,$3,$4)',[campaign,owner,{name:'Local fixture'},revision]);
 await db.query("INSERT INTO ads_revisions(id,campaign_id,brief,logo_id,content_hash,state) VALUES($1,$2,$3,$4,$5,'PREAUDITED')",[revision,campaign,{name:'Local fixture'},logo,sha256('content')]);
 const generated={artifacts:empty?[]:[artifact],verdict:{allowed:!empty,state:empty?'QUARANTINED':'PREAUDITED',reasons:[]}};
 const creative={generate:async input=>{calls++;assert.equal(input.revisionId,revision);assert.deepEqual(input.placements,['main_stage_screen']);return structuredClone(generated);}};
 const service=createAdsService({db,config:{profile:PILOT_PROFILE,model:{previewPerHour:3}},creative,storage:{},now:()=>Date.now()});
 return{db,service,owner,campaign,revision,get calls(){return calls;},get inserts(){return inserts;}};
}

test('pg wire conversion distinguishes SQL arrays from JSON arrays including an empty result',()=>{
 assert.throws(()=>JSON.parse(prepareValue([artifact])));assert.deepEqual(JSON.parse(prepareValue([])),{});
 for(const value of [[artifact],[]])assert.deepEqual(JSON.parse(prepareValue(JSON.stringify(value))),value);
});

test('preview persists a JSON artifact array through pg binding and durable replay does not generate again',async t=>{
 const f=await fixture(t),result=await f.service.preview(f.owner,f.campaign,'preview-pg-json-key');
 assert.equal(result.artifacts.length,1);assert.equal(result.artifacts[0].imageUrl,'/api/ads/previews/'+f.revision+'/'+artifact.key);
 const row=(await f.db.query('SELECT artifacts FROM ads_previews WHERE revision_id=$1',[f.revision])).rows[0];assert(Array.isArray(row.artifacts));assert.deepEqual(row.artifacts,[artifact]);
 assert.deepEqual(await f.service.preview(f.owner,f.campaign,'preview-pg-json-key'),result);assert.equal(f.calls,1);assert.equal(f.inserts,1);
 const action=(await f.db.query("SELECT state,response FROM ads_actions WHERE owner_id=$1 AND key='preview-pg-json-key'",[f.owner])).rows[0];assert.equal(action.state,'DONE');assert.deepEqual(action.response,result);
 for(const table of ['ads_orders','ads_payment_attempts','ads_outbox','ads_delivery'])assert.equal((await f.db.query('SELECT * FROM '+table)).rowCount,0);
});

test('uncertain empty preview stays a JSON array and keeps its audit verdict',async t=>{
 const f=await fixture(t,{empty:true}),result=await f.service.preview(f.owner,f.campaign,'preview-empty-json-key');assert.deepEqual(result.artifacts,[]);assert.equal(result.verdict.allowed,false);
 const row=(await f.db.query('SELECT artifacts FROM ads_previews WHERE revision_id=$1',[f.revision])).rows[0];assert(Array.isArray(row.artifacts));assert.deepEqual(row.artifacts,[]);assert.equal(f.calls,1);
});

test('a failed preview remains durable and replay does not spend another generation',async t=>{
 const f=await fixture(t,{insertFailure:true});for(let i=0;i<2;i++)await assert.rejects(f.service.preview(f.owner,f.campaign,'preview-failed-json-key'),error=>error.code==='action_failed_closed'&&!error.message.includes('PRIVATE_PG_DIAGNOSTIC'));
 assert.equal(f.calls,1);assert.equal(f.inserts,1);assert.equal((await f.db.query('SELECT * FROM ads_previews')).rowCount,0);assert.equal((await f.db.query('SELECT state FROM ads_actions')).rows[0].state,'FAILED');
});
