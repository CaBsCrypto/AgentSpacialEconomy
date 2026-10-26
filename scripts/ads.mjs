import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {writeFile,access} from 'node:fs/promises';
import {readAdsConfig} from '../server/ads/config.mjs';
import {createDatabase,migrate} from '../server/ads/db.mjs';
import {createJobRunner} from '../server/ads/jobs.mjs';
import {createPublisher,runCanonicalRenderer} from '../server/ads/publisher.mjs';
import {enqueue} from '../server/ads/common.mjs';
const command=process.argv[2],controller=new AbortController();
process.on('SIGINT',()=>controller.abort());process.on('SIGTERM',()=>controller.abort());
const delay=ms=>new Promise(resolve=>{let t;const done=()=>{clearTimeout(t);controller.signal.removeEventListener('abort',done);resolve();};t=setTimeout(done,ms);controller.signal.addEventListener('abort',done,{once:true});});
if(command==='keys'){
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 await writeFile('.ads-publisher.private.pem',privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
 await writeFile('.ads-publisher.public.pem',publicKey.export({type:'spki',format:'pem'}),{flag:'wx',mode:0o600});
 await writeFile('.env.ads.local','ADS_CHECKOUT_ENABLED=false\nADS_CONFIG_PATH=config/ads.local.json\nADS_PUBLISHER_PRIVATE_KEY_FILE=.ads-publisher.private.pem\nADS_PUBLISHER_PUBLIC_KEY_FILE=.ads-publisher.public.pem\nADS_PUBLISHER_TOKEN='+randomBytes(32).toString('base64url')+'\n',{flag:'wx',mode:0o600});
 console.log('Created private local advertising configuration. No key values are printed. Complete config/ads.local.json and ADS_DATABASE_URL before purchases.');
}else if(command==='migrate'){
 const db=createDatabase();try{await migrate(db);console.log('Advertising migrations applied.');}finally{await db.close();}
}else if(['worker','publisher','registry'].includes(command)){
 const {createAdsRuntime}=await import('../server/ads/runtime.mjs');const r=createAdsRuntime();
 try{
  if(command==='publisher'&&(!r.config.publisherToken||!r.config.publisherKey||!r.config.publisherPublicKey))throw Error('Configure canonical publisher keys and token first.');
  if(command==='publisher')await runCanonicalRenderer({publisher:createPublisher(r),config:r.config,signal:controller.signal});
  else if(command==='registry')console.log(JSON.stringify(await r.registry.flush({limit:25})));
  else {
   const runner=createJobRunner(r);
   while(!controller.signal.aborted){
    await r.db.transaction(async tx=>{
     const attempts=(await tx.query("SELECT id,order_id FROM ads_payment_attempts WHERE state IN ('VERIFYING','SETTLING','RECONCILIATION_REQUIRED') AND updated_at<now()-interval '15 seconds' LIMIT 20")).rows;
     for(const a of attempts)await enqueue(tx,'payment-reconcile',a.order_id,'payment-reconcile:'+a.id+':'+Math.floor(Date.now()/60000),{attemptId:a.id});
     const live=(await tx.query("SELECT o.id FROM ads_orders o JOIN ads_revisions r ON r.id=o.revision_id WHERE o.state IN ('QUEUED','LIVE') AND r.state='AUDITED' AND o.suspended=false LIMIT 100")).rows;
     for(const o of live)await enqueue(tx,'cta-check',o.id,'cta-check:'+o.id+':'+Math.floor(Date.now()/60000),{});
    });
    if(!await runner.runOnce())await delay(1000);
   }
  }
 }finally{await r.db.close();}
}else {console.error('Usage: node scripts/ads.mjs keys|migrate|worker|publisher|registry');process.exitCode=1;}
