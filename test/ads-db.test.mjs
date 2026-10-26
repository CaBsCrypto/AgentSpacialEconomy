import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, validateTestPostgresUrl } from './helpers/ads-db.mjs';

test('PostgreSQL CI guard rejects non-test environments, database names and URL overrides before loading a driver',async()=>{
 let loads=0;const loadPg=async()=>{loads++;throw Error('must not connect');};
 for(const [NODE_ENV,url] of [['production','postgres://tester:private-password@localhost/ads_test'],['test','postgres://tester:private-password@localhost/production'],['test','postgres://tester:private-password@localhost/ads_test?options=-c%20search_path=public'],['test','postgres://tester:private-password@localhost/ads_test#override'],['test','https://localhost/ads_test']]){
  await assert.rejects(createTestDatabase({env:{NODE_ENV,ADS_TEST_DATABASE_URL:url},loadPg}),error=>!error.message.includes('private-password'));
 }
 assert.equal(loads,0);
 assert.equal(new URL(validateTestPostgresUrl('postgresql://tester@postgres:5432/ads_test',{NODE_ENV:'test'})).pathname,'/ads_test');
});

test('CI fixtures isolate search_path per pool and remove only their generated schema',async()=>{
 const pools=[],calls=[];
 class Pool {
  constructor(options){this.options=options;this.ended=false;pools.push(this);}
  async query(sql,params){calls.push({pool:this,sql,params});return {rows:sql==='SELECT current_database() AS name'?[{name:'ads_test'}]:sql==='SELECT current_database() AS database, current_schema() AS schema'?[{database:'ads_test',schema:this.options.options.match(/search_path=([^,]+)/)[1]}]:[],rowCount:0};}
  async connect(){return {query:(...args)=>this.query(...args),release:()=>{}};}
  async end(){this.ended=true;}
 }
 const before=process.env.PGOPTIONS,env={NODE_ENV:'test',ADS_TEST_DATABASE_URL:'postgres://tester@postgres:5432/ads_test'};
 const a=await createTestDatabase({env,applyMigrations:false,loadPg:async()=>({Pool})}),b=await createTestDatabase({env,applyMigrations:false,loadPg:async()=>({Pool})});
 assert.equal(a.testBackend,'postgres');assert.notEqual(a.testSchema,b.testSchema);assert.match(a.testSchema,/^ads_test_[a-f0-9]{24}$/);
 assert(pools.some(p=>p.options.options===`-c search_path=${a.testSchema},public`));
 assert(calls.some(c=>c.sql==='CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public'));
 await a.close();await a.close();
 const drops=calls.filter(c=>c.sql.startsWith('DROP SCHEMA'));
 assert.deepEqual(drops.map(c=>c.sql),[`DROP SCHEMA "${a.testSchema}" CASCADE`]);
 assert.equal(process.env.PGOPTIONS,before);await b.close();assert(pools.every(p=>p.ended));
});

test('server-selected database identity is checked before any schema mutation',async()=>{
 const calls=[];class Pool {async query(sql){calls.push(sql);return {rows:[{name:'production'}]};}async end(){}}
 await assert.rejects(createTestDatabase({env:{NODE_ENV:'test',ADS_TEST_DATABASE_URL:'postgres://tester@localhost/ads_test'},loadPg:async()=>({Pool})}),/outside ads_test/);
 assert.deepEqual(calls,['SELECT current_database() AS name']);
});
