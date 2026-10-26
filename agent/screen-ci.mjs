// Isolated six-payment Testnet experiment. Never overwrites the committed replay fixture.
// Keys exist only in process memory. Each advertiser can submit at most once.
import {spawn, spawnSync, execFileSync} from 'node:child_process';
import {readFile, writeFile, mkdir, open} from 'node:fs/promises';
import {createServer} from 'node:net';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {Asset, BASE_FEE, Horizon, Keypair, Operation, TransactionBuilder} from '@stellar/stellar-sdk';
import {networkConfig, explorerTx} from './config/networks.mjs';
import {AD_SECTION_SLOT} from './catalog.mjs';
import {adTerms, adCommitment, readBack} from './lib/ads.mjs';
import {scheduleOrder, SLOT_MS} from './lib/screen.mjs';
import {toUnits, fromUnits} from './lib/money.mjs';
import {verifyScreenRun} from './lib/screen-payments.mjs';
import {createRegistry, REGISTRY_WASM_HASH} from './registry.mjs';

export const SCREEN_PLAN = Object.freeze([
 {section:'A',name:'Demo Advertiser 1 (testnet)',headline:'Live demo at table 4'},
 {section:'B',name:'Demo Advertiser 2 (testnet)',headline:'Workshop at 15:00, room 2'},
 {section:'C',name:'Demo Advertiser 3 (testnet)',headline:'Ask us about the testnet faucet'},
 {section:'D',name:'Demo Advertiser 4 (testnet)',headline:'Hiring Soroban developers'},
 {section:'A',name:'Demo Advertiser 5 (testnet)',headline:'Free coffee at the merch stand'},
 {section:'C',name:'Demo Advertiser 6 (testnet)',headline:'Vote for our project'},
]);
const agentDir = fileURLToPath(new URL('./',import.meta.url));
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const safeError = e => String(e?.message??e).replace(/\bS[A-Z2-7]{55}\b/g,'[REDACTED]').slice(0,500);
const freePort = () => new Promise((ok,fail)=>{
 const s=createServer();s.once('error',fail);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>ok(port));});
});
export function requireBudget(slot,plan=SCREEN_PLAN) {
 if(plan.length!==6||toUnits(slot.priceUsdc)!==50000000n||slot.durationMs!==300000)throw Error('Only six exact 5-USDC / 300000-ms Testnet section orders are authorized.');
 return 300000000n;
}
export async function claimScreenRun(dir,metadata) {
 await mkdir(dir,{recursive:true});
 const marker=await open(join(dir,'run-started.json'),'wx');
 try{await marker.writeFile(JSON.stringify(metadata));await marker.sync();}finally{await marker.close();}
}
export async function runScreen({outputDir,runId=new Date().toISOString()}={}) {
 const maxUnits=requireBudget(AD_SECTION_SLOT);
 const net=networkConfig('stellar:testnet');
 if(process.env.STELLAR_NETWORK&&process.env.STELLAR_NETWORK!=='stellar:testnet')throw Error('Testnet only.');
 const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:agentDir,encoding:'utf8'}).trim();
 const dirty=execFileSync('git',['status','--porcelain'],{cwd:agentDir,encoding:'utf8'}).trim();
 if(dirty)throw Error('Commit the reviewed source before a paid run so its evidence identifies the exact code.');
 if(!Number.isFinite(Date.parse(runId)))throw Error('Run ID must be an ISO timestamp.');
 const dir=resolve(outputDir??join(agentDir,'out','screen-'+runId.replace(/[:.]/g,'-')));
 await mkdir(dir,{recursive:true});
 // Atomic marker also prevents accidental reruns after an interrupted/uncertain payment.
 await claimScreenRun(dir,{runId,sourceCommit,maximumAdvertisingUnits:String(maxUnits)});
 const output=join(dir,'screen.json');
 const state={runId,sourceCommit,network:net.id,kind:'recorded testnet run',status:'RUNNING',
  screen:{sections:['A','B','C','D'],slotMs:SLOT_MS,priceUsdc:AD_SECTION_SLOT.priceUsdc,placement:AD_SECTION_SLOT.placement,offerId:AD_SECTION_SLOT.offerId},
  maximumAdvertisingUnits:String(maxUnits),attempts:[],treasury:null,orders:[],registry:null,verification:null,recordedAt:null};
 const save=async()=>{state.recordedAt=new Date().toISOString();await writeFile(output,JSON.stringify(state,null,2)+'\n');};
 await save();
 let services;
 try {
  const horizon=new Horizon.Server(net.horizonUrl),USDC=new Asset(net.usdc.code,net.usdc.issuer);
  const submit=async(kp,ops)=>{
   const account=await horizon.loadAccount(kp.publicKey());
   const builder=new TransactionBuilder(account,{fee:String(Number(BASE_FEE)*10),networkPassphrase:net.passphrase});
   ops.forEach(op=>builder.addOperation(op));const tx=builder.setTimeout(60).build();tx.sign(kp);
   return horizon.submitTransaction(tx);
  };
  const usdc=async(pub)=>{
   const account=await horizon.loadAccount(pub);
   const balance=account.balances.find(b=>b.asset_code==='USDC'&&b.asset_issuer===USDC.issuer);
   if(!balance)throw Error('Missing Testnet USDC trustline.');return balance.balance;
  };
  const friendbot=async(pub)=>{
   for(let i=0;i<2;i++){
    const r=await fetch(net.friendbotUrl+'?addr='+encodeURIComponent(pub),{signal:AbortSignal.timeout(30000)});
    if(r.ok)return;
    if(r.status===400){try{await horizon.loadAccount(pub);return;}catch{}}
    if(i===0)await sleep(2000);
   }
   throw Error('Friendbot could not fund '+pub);
  };
  const treasury=Keypair.random(),funder=Keypair.random(),service=Keypair.random(),buyers=SCREEN_PLAN.map(()=>Keypair.random());
  state.treasury={account:treasury.publicKey(),usdcBefore:null,usdcAfter:null,receivedUsdc:null,verified:false};
  state.advertisers=buyers.map(k=>k.publicKey());await save();
  console.log('Fresh run '+runId+' at '+sourceCommit+'; ephemeral treasury '+treasury.publicKey());
  // Assert the configured facilitator actually advertises Testnet before funding any account.
  const facilitator=process.env.FACILITATOR_URL||net.facilitatorUrl;
  const supported=await fetch(facilitator.replace(/\/$/,'')+'/supported',{signal:AbortSignal.timeout(20000)});
  if(!supported.ok)throw Error('Facilitator capabilities unavailable: HTTP '+supported.status);
  const capabilities=await supported.json();
  if(!capabilities.kinds?.some(k=>k.network===net.id&&k.scheme==='exact'&&k.x402Version===2))throw Error('Facilitator does not advertise exact x402 v2 on Testnet.');
  state.facilitator=facilitator;await save();
  for(const kp of [treasury,funder,...buyers])await friendbot(kp.publicKey());
  for(const kp of [treasury,funder,...buyers])await submit(kp,[Operation.changeTrust({asset:USDC})]);
  const each=51000000n,min=each*6n+5000000n;
  let funded=false;
  for(const sendAmount of ['50','200','1000','5000']){
   const {records}=await horizon.strictSendPaths(Asset.native(),sendAmount,[USDC]).call();
   const best=records.filter(p=>toUnits(p.destination_amount)>=min).sort((a,b)=>toUnits(a.destination_amount)>toUnits(b.destination_amount)?-1:1)[0];
   if(!best)continue;
   const path=best.path.map(p=>p.asset_type==='native'?Asset.native():new Asset(p.asset_code,p.asset_issuer));
   const receipt=await submit(funder,[Operation.pathPaymentStrictSend({sendAsset:Asset.native(),sendAmount,destination:funder.publicKey(),destAsset:USDC,destMin:fromUnits(min),path})]);
   state.funding={funder:funder.publicKey(),swapTx:receipt.hash};
   funded=true;break;
  }
  if(!funded)throw Error('No Testnet DEX path supplies the six advertisers. No advertisement has been paid.');
  const funding=await submit(funder,buyers.map(kp=>Operation.payment({destination:kp.publicKey(),asset:USDC,amount:fromUnits(each)})));
  state.funding.distributionTx=funding.hash;
  state.treasury.usdcBefore=await usdc(treasury.publicKey());await save();
  const port=await freePort();
  const childEnv={...process.env,STELLAR_NETWORK:net.id,FACILITATOR_URL:facilitator,SERVICE_RECIPIENT:service.publicKey(),TREASURY_PUBLIC_KEY:treasury.publicKey(),SERVICES_URL:'http://127.0.0.1:'+port,SERVICES_PORT:String(port)};
  services=spawn(process.execPath,['services.mjs'],{cwd:agentDir,windowsHide:true,stdio:['ignore','pipe','pipe'],env:childEnv});
  services.stdout.on('data',d=>process.stdout.write('[services] '+String(d).replace(/\bS[A-Z2-7]{55}\b/g,'[REDACTED]')));
  services.stderr.on('data',d=>process.stderr.write('[services] '+String(d).replace(/\bS[A-Z2-7]{55}\b/g,'[REDACTED]')));
  let up=false;
  for(let i=0;i<40&&!up;i++){
   await sleep(500);if(services.exitCode!==null)break;
   try{const response=await fetch(childEnv.SERVICES_URL+'/health',{signal:AbortSignal.timeout(1000)});const health=await response.json();up=response.ok&&health.network===net.id;}catch{}
  }
  if(!up)throw Error('Isolated services did not start.');
  for(const [i,p] of SCREEN_PLAN.entries()){
   const out=join(dir,'order-'+(i+1)+'.json'),orderRun=runId+'#'+(i+1);
   state.attempts.push({id:orderRun,section:p.section,payer:buyers[i].publicKey(),maximumUnits:'50000000',status:'STARTED'});
   await save();
   // Never retry this subprocess. Unknown outcomes require read-only reconciliation.
   const receipt=spawnSync(process.execPath,['advertiser.mjs','--run-id',orderRun,'--section',p.section,'--name',p.name,'--headline',p.headline,'--max','5.00','--out',out],{
    cwd:agentDir,windowsHide:true,encoding:'utf8',timeout:120000,env:{...childEnv,ADVERTISER_SECRET_KEY:buyers[i].secret()},
   });
   process.stdout.write(String(receipt.stdout??'').replace(/\bS[A-Z2-7]{55}\b/g,'[REDACTED]'));
   process.stderr.write(String(receipt.stderr??'').replace(/\bS[A-Z2-7]{55}\b/g,'[REDACTED]'));
   let result;try{result=JSON.parse(await readFile(out,'utf8'));}catch{}
   const row=result?.rows?.find(r=>r.status==='settled');
   const attempt=state.attempts.at(-1);
   if(row?.tx)attempt.tx=row.tx;
   if(receipt.status!==0||!row){attempt.status='UNRESOLVED';await save();throw Error('Order '+(i+1)+' did not finish with a confirmed receipt. Stopped without retry; reconcile this attempt before any further payment.');}
   attempt.status='RECEIPT_RECORDED';
   state.orders=scheduleOrder(state.orders,{id:orderRun,quadrant:result.advertiser.section,paidAt:Date.now(),advertiser:result.advertiser.name,headline:result.advertiser.headline,account:result.advertiser.account,priceUsdc:row.priceUsdc,tx:row.tx,explorer:row.explorer});
   await save();
  }
  services.kill();services=null;
  let after=state.treasury.usdcBefore;
  for(let i=0;i<10;i++){
   after=await usdc(treasury.publicKey());
   if(toUnits(after)-toUnits(state.treasury.usdcBefore)>=maxUnits)break;
   await sleep(1500);
  }
  const received=toUnits(after)-toUnits(state.treasury.usdcBefore);
  Object.assign(state.treasury,{usdcAfter:after,receivedUsdc:fromUnits(received),verified:received===maxUnits});await save();
  if(received!==maxUnits)throw Error('Treasury balance does not reconcile to exactly 30 Testnet USDC.');
  const registry=createRegistry(net);
  const deployed=await registry.deploy(treasury,Keypair.random().rawPublicKey());
  state.registry={contractId:deployed.contractId,explorerContract:net.explorer+'/contract/'+deployed.contractId,wasmHash:REGISTRY_WASM_HASH,wasmVerified:false,deployTx:deployed.hash,deployExplorer:explorerTx(net.id,deployed.hash)};
  await save();
  state.registry.wasmVerified=(await registry.wasmHashOf(deployed.contractId))===REGISTRY_WASM_HASH;await save();
  if(!state.registry.wasmVerified)throw Error('Registry WASM does not match the expected build.');
  for(const order of state.orders){
   const terms=adTerms({slot:AD_SECTION_SLOT,payTo:treasury.publicKey(),network:net.id,section:order.quadrant});
   const commitment=adCommitment({runId:order.id,creative:{advertiser:order.advertiser,headline:order.headline},terms,paymentTx:order.tx,claimant:order.account,startMs:order.start,durationMs:SLOT_MS});
   const committed=await registry.commit(treasury,deployed.contractId,commitment);
   Object.assign(order,{commitTx:committed.hash,commitExplorer:explorerTx(net.id,committed.hash),order:commitment.order,commitment});
   await save();
   order.readBack=readBack(await registry.get(deployed.contractId,commitment.order,treasury.publicKey()),commitment);await save();
   if(!order.readBack.verified)throw Error('Full registry commitment read-back mismatch for '+order.id);
  }
  state.verification=await verifyScreenRun(state,{runId,sourceCommit,expectedOrders:6});
  state.status='VERIFIED';await save();
  console.log('VERIFIED: six unique exact payments, 30 Testnet USDC, six Queued commitments; no delivery claimed. '+output);
  return state;
 }catch(error){
  state.status='FAILED';state.error=safeError(error);await save();
  throw Error(state.error+'; diagnostics: '+output);
 }finally{services?.kill();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {values}=parseArgs({options:{out:{type:'string'},'run-id':{type:'string'}}});
 runScreen({outputDir:values.out,runId:values['run-id']}).catch(e=>{console.error(safeError(e));process.exitCode=1;});
}
