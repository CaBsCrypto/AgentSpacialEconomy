import { randomBytes } from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk';
import { createDatabase,migrate } from '../server/reservations/db.mjs';
import { readConfig } from '../server/reservations/config.mjs';
import { createResourceBudget } from '../server/reservations/resources.mjs';
import { createProjectService } from '../server/reservations/project.mjs';
import { createTransactionService } from '../server/reservations/transactions.mjs';
import { createOfferService } from '../server/reservations/offers.mjs';
import { createConversationService } from '../server/reservations/conversation.mjs';
import { createIntakeService } from '../server/reservations/intake.mjs';
import { uuid,ServiceError } from '../server/identity/common.mjs';
export const address=n=>StrKey.encodeContract(Buffer.alloc(32,n));
export function validateTestDatabaseUrl(value,env=process.env) {
  let url;try{url=new URL(value);}catch{throw new Error('Use an explicit isolated reservations_test database URL.');}
  if(env.NODE_ENV!=='test'||!['postgres:','postgresql:'].includes(url.protocol)||url.pathname!=='/reservations_test'||url.search||url.hash)throw new Error('Refusing a database other than isolated reservations_test with NODE_ENV=test.');
  return url.href;
}
export async function testDatabase() {
  if(process.env.RESERVATIONS_TEST_DATABASE_URL) {
    const connectionString=validateTestDatabaseUrl(process.env.RESERVATIONS_TEST_DATABASE_URL);
    const {Pool}=await import('pg'),schema='reservations_test_'+randomBytes(12).toString('hex');
    const bootstrap=new Pool({connectionString,max:1,connectionTimeoutMillis:5000});
    const assertTarget=async()=>{if((await bootstrap.query('SELECT current_database() AS name')).rows[0].name!=='reservations_test'||!/^reservations_test_[a-f0-9]{24}$/.test(schema))throw new Error('Unsafe test database or schema.');};
    await assertTarget();await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    const pool=new Pool({connectionString,max:24,connectionTimeoutMillis:5000,options:`-c search_path=${schema},public`});
    const db=createDatabase({pool});
    try{await migrate(db);}catch(error){await pool.end();await assertTarget();await bootstrap.query(`DROP SCHEMA "${schema}" CASCADE`);await bootstrap.end();throw error;}
    return {...db,testBackend:'postgres',async close(){await pool.end();await assertTarget();await bootstrap.query(`DROP SCHEMA "${schema}" CASCADE`);await bootstrap.end();}};
  }
  const {PGlite}=await import('@electric-sql/pglite'),engine=new PGlite();await engine.waitReady;
  const adapter=client=>({async query(sql,args){const result=args?.length?await client.query(sql,args):(await client.exec(sql)).at(-1);return{...result,rows:result?.rows??[],rowCount:result?.affectedRows??result?.rows?.length??0};}});
  const db={...adapter(engine),transaction:work=>engine.transaction(tx=>work(adapter(tx))),close:()=>engine.close(),testBackend:'pglite'};
  await migrate(db);return db;
}
export function testConfig() {
  const cfg=readConfig({RESERVATIONS_MODE:'PUBLIC',RESERVATIONS_ENABLED:'true',RESERVATIONS_INTAKE_ENABLED:'true',RESERVATIONS_DATABASE_URL:'test-adapter',RESERVATIONS_HOST_ADDRESS:address(1),RESERVATIONS_PROJECT_ID:uuid(),RESERVATIONS_CONTRACT_ID:address(2),RESERVATIONS_CONTRACT_WASM_HASH:'a'.repeat(64),VERCEL_BLOB_RETRIES:'0',BLOB_READ_WRITE_TOKEN:'test-adapter',CHANNELS_API_KEY:'test-adapter'});
  cfg.coverage={id:uuid(),zeroAdditionalSpend:true,platformHardCapsVerified:true,verifiedUntil:'2099-01-01T00:00:00Z',resources:Object.fromEntries(['database','rpc','blob','channels','gateway','functions','transfer'].map(x=>[x,true])),quotas:{blobDeleteCalls:1000000,rpcAuthCalls:1000000,rpcRecoveryCalls:1000000,recoveryRequests:1000000,recoveryTransferBytes:1000000000000,functionRequests:1000000,transferBytes:1000000000000,rpcCalls:1000000,channelsSubmissions:1000000,blobWriteBytes:1000000000,blobReadBytes:1000000000,gatewayReadCalls:1000000},autoTopupDisabled:true,byokDisabled:true,exclusiveGatewayBudget:true,gatewayBudgetMicrousd:1000000};return cfg;
}
export function actor(config,n=1){const value=n===1?config.hostAddress:address(n);return{address:value,ownerId:'stellar:testnet:'+value,role:n===1?'host':'brand',credentialId:'test-credential',authorityHash:'test-authority',ruleId:0};}
export const proposal={summary:'A proposal for review.',title:'Reviewed venue',context:'Host supplied facts',spaces:[{name:'Stage',purpose:'One exclusive display'}]};
export async function fixture({db:provided,config=testConfig(),chain:suppliedChain,model:suppliedModel,now=Date.now,admit=true}={}) {
  const db=provided||await testDatabase(),resources=createResourceBudget({db,config,now}),images=new Map();
  const intake=createIntakeService({db,config,now});
  if(admit&&config.enabled&&config.intakeEnabled&&(await intake.status()).state==='MISSING'){
    const paused=await intake.change(true,{dryRun:false});await intake.change(false,{dryRun:false,expectedRevision:paused.revision});
  }
  const storage={async put(bytes,id){const key='reservations/'+id+'.png';images.set(key,Buffer.from(bytes));return{key};},async get(key){if(!images.has(key))throw new ServiceError(404,'MEDIA_NOT_FOUND','Missing test image');return images.get(key);},async remove(key){images.delete(key);}};
  const projects=createProjectService({db,config,storage,resources,now});
  const chain=suppliedChain||fakeChain(config),transactions=createTransactionService({db,config,chain,projects,now}),offers=createOfferService({db,config,chain,projects,now});
  const model=suppliedModel||{calls:0,inspections:0,async inspect(){this.inspections++;return{balance:'5',pricing:{input:config.model.inputUsdPerToken,output:config.model.outputUsdPerToken}};},async generate(){this.calls++;return{proposal,usage:{inputTokens:100,outputTokens:100}};}};
  const conversation=createConversationService({db,config,projects,model,now});
  return{db,config,resources,intake,storage,images,projects,chain,transactions,offers,model,conversation,host:actor(config),brand:actor(config,3)};
}
export function fakeChain(config) {
  const states=new Map(),intents=new Map(),receipts=new Map();
  return{states,intents,receipts,prepared:0,sends:0,unknown:false,
    async prepare(intent){this.prepared++;intents.set(intent.offerId+intent.actorAddress,intent);return{func:intent.offerId,auth:[intent.actorAddress],startLedger:1,expirationLedger:37};},
    validate(body,preparation){if(body.func!==preparation.func||body.auth?.[0]!==preparation.auth[0])throw Error('Test intent mismatch');},async preflight(){},
    async submit(body){this.sends++;const intent=intents.get(body.func+body.auth[0]);if(intent.operation==='publish')states.set(intent.offerId,{id:intent.offerId,projectId:config.projectId,spaceId:intent.spaceId,host:config.hostAddress,state:'AVAILABLE',holder:null});else{const old=states.get(intent.offerId);if(old.state==='AVAILABLE')states.set(intent.offerId,{...old,state:'RESERVED',holder:intent.actorAddress});}
      const hash=uuid();receipts.set(intent.offerId+intent.actorAddress,{hash,ledger:2});if(this.unknown)throw Error('Timeout after settlement');return{hash};},
    async reconcile(intent){const evidence=receipts.get(intent.offerId+intent.actorAddress),offer=states.get(intent.offerId);if(!evidence||this.unknown)return{state:'NEEDS_RECONCILIATION'};if(intent.operation==='reserve'&&offer.holder!==intent.actorAddress)return{state:'CONFLICT',offer};return{state:'CONFIRMED',...evidence,offer};},
    async getOffer(id){return states.get(id)||{id,state:'UNAVAILABLE'};}};
}
export async function approved(f) {
  const sharp=(await import('sharp')).default,bytes=await sharp({create:{width:10,height:10,channels:3,background:'#ffffff'}}).png().toBuffer();
  const media=await f.projects.upload(f.host,bytes,'image/png');
  let project=await f.projects.get(f.host);
  project=await f.projects.update(f.host,{expectedRevision:project.revision,title:'Reviewed venue',context:'Host supplied facts',spaces:[{name:'Stage',purpose:'One exclusive display'}],map:null});
  project=await f.projects.update(f.host,{expectedRevision:project.revision,title:project.title,context:project.context,spaces:project.spaces,map:{mediaId:media.id,points:[{spaceId:project.spaces[0].id,x:0.5,y:0.5}]}});
  return f.projects.approve(f.host,{expectedRevision:project.revision,spaceId:project.spaces[0].id});
}
export async function publish(f) {const snapshot=await approved(f),prepared=await f.transactions.prepare(f.host,{operation:'publish',snapshotId:snapshot.id}),result=await f.transactions.submit(f.host,prepared.attempt.id,{func:prepared.signing.func,auth:prepared.signing.auth});return{snapshot,prepared,result};}
