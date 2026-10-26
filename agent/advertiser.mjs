// Buy the original whole-screen offer, or explicitly opt in to the isolated section experiment.
// One payment attempt per run is recorded independently of --out. Unknown outcomes require
// reconciliation before retrying: a timeout is never permission to sign another payment.
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { networkConfig, explorerTx } from "./config/networks.mjs";
import { paymentRequiredFrom, settlementFrom, settlementTx } from "./lib/x402-headers.mjs";
import { sponsorPreflight } from "./lib/income.mjs";
import { AD_TYPE, adKey } from "./lib/ads.mjs";
import { advertiserOffer, sectionPreflight, guardSinglePaymentClient } from "./lib/ad-section.mjs";
import { paymentJournalPath, readPaymentJournal, beginPaymentJournal, savePaymentJournal } from "./lib/payment-journal.mjs";
import { toUnits, toDollarPrice } from "./lib/money.mjs";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
const { values: args } = parseArgs({options:{
 "run-id":{type:"string"},
 name:{type:"string",default:"Demo Advertiser (testnet)"},
 headline:{type:"string",default:"Five minutes on the main stage, paid in testnet USDC"},
 max:{type:"string",default:"5.00"},
 section:{type:"string"},
 out:{type:"string"},
}});
const fail=msg=>{console.error(msg);process.exit(1);};
let selected;
try{selected=advertiserOffer(args.section);}catch(e){fail(e.message+" Nothing was signed.");}
const {slot:expectedSlot,section}=selected;
const net=networkConfig();
const NETWORK=net.id;
const SERVICES_URL=(process.env.SERVICES_URL||"http://localhost:3001").replace(/\/$/,"");
const file=args.out||fileURLToPath(new URL("../dist/state/ads.json",import.meta.url));
if(!process.env.ADVERTISER_SECRET_KEY)fail("ADVERTISER_SECRET_KEY is missing. Use a separate testnet wallet holding testnet USDC.");
const treasury=(process.env.TREASURY_PUBLIC_KEY||"").trim();
if(!StrKey.isValidEd25519PublicKey(treasury))fail("TREASURY_PUBLIC_KEY is missing or not a public G... key.");
const advertiser=Keypair.fromSecret(process.env.ADVERTISER_SECRET_KEY.trim()).publicKey();
const runId=args["run-id"]??new Date().toISOString();
const key=adKey(runId);
const journalFile=paymentJournalPath(fileURLToPath(new URL("./out/ad-journal/",import.meta.url)),runId);
const journal=await readPaymentJournal(journalFile);
if(journal){
 if(journal.status!=="settled")fail("An earlier payment attempt is pending or ambiguous. Reconcile its journal before retrying; nothing was signed.");
 const previous=journal.state;
 if(previous?.advertiser?.account!==advertiser||previous.offer?.payTo!==treasury||previous.offer?.id!==expectedSlot.offerId||(previous.advertiser?.section??null)!==section)fail("This run already belongs to different payment terms. Nothing was signed.");
 await writeFile(file,JSON.stringify(previous,null,2));
 console.log("Ad payment already settled for this run; restored its receipt without paying again.");process.exit(0);
}
// Preserve the original CLI's recorded receipt guard for ledgers created before journals existed.
const previous=existsSync(file)?JSON.parse(await readFile(file,"utf8")):null;
if(previous?.runId===runId&&previous.rows?.some(r=>r.key===key&&r.status==="settled")){
 console.log("Ad slot already settled for this run; not paying again.");process.exit(0);
}
const catalog=await fetch(SERVICES_URL+"/catalog").then(r=>r.json()).catch(()=>null);
const slot=catalog?.income?.find(s=>s.id===expectedSlot.id);
if(!slot)fail("The services do not offer "+expectedSlot.id+". Nothing was signed.");
if(slot.path!==expectedSlot.path||slot.offerId!==expectedSlot.offerId||slot.placement!==expectedSlot.placement||slot.durationMs!==expectedSlot.durationMs||toUnits(slot.priceUsdc)!==toUnits(expectedSlot.priceUsdc))fail("The catalog does not match the requested offer. Nothing was signed.");
if(toUnits(slot.priceUsdc)>toUnits(args.max))fail("The ad slot exceeds --max. Nothing was signed.");
const state={runId,network:NETWORK,
 offer:{id:slot.offerId,placement:slot.placement,durationMs:slot.durationMs,priceUsdc:slot.priceUsdc,payTo:treasury},
 advertiser:{account:advertiser,name:null,headline:null,...(section?{section}:{})},rows:[]};
let paymentStarted=false;
const record=async(status,extra={})=>{
 state.rows.push({type:AD_TYPE,agent:"advertiser",service:slot.id+" · main-stage screen · 5 min",priceUsdc:slot.priceUsdc,status,key:status==="settled"?key:null,at:new Date().toISOString(),...extra});
 if(paymentStarted)await savePaymentJournal(journalFile,status==="settled"?"settled":"unknown",state);
 await writeFile(file,JSON.stringify(state,null,2));
};
const url=SERVICES_URL+"/paid"+slot.path;
const init={method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({advertiser:args.name,headline:args.headline,...(section?{section}:{})})};
const pre=await fetch(url,init);
if(pre.status!==402)fail("Expected 402 Payment Required, got "+pre.status+". Nothing was signed.");
let preBody=null;try{preBody=await pre.json();}catch{}
const required=paymentRequiredFrom(pre,preBody);
const check=section?sectionPreflight(required,{network:NETWORK,treasury,asset:net.usdc.sac}):sponsorPreflight(required,{network:NETWORK,maxUsdc:args.max,treasury});
if(!check.ok){await record("blocked",{reason:"refused before signing: "+check.reason});fail("Ad payment refused: "+check.reason);}
const {wrapFetchWithPaymentFromConfig}=await import("@x402/fetch");
const {createEd25519Signer}=await import("@x402/stellar");
const {ExactStellarScheme}=await import("@x402/stellar/exact/client");
const signer=createEd25519Signer(process.env.ADVERTISER_SECRET_KEY,NETWORK);
const payFetch=wrapFetchWithPaymentFromConfig(fetch,{
 schemes:[{network:NETWORK,client:guardSinglePaymentClient(new ExactStellarScheme(signer),{network:NETWORK,treasury,asset:net.usdc.sac,priceUsdc:slot.priceUsdc})}],
 spendControls:{maxAmountPerPayment:toDollarPrice(slot.priceUsdc)},
});
// Exclusive create protects concurrent invocations and crashes even if --out changes.
await beginPaymentJournal(journalFile,state);paymentStarted=true;
let res;
try{res=await payFetch(url,init);}
catch{await record("unknown",{reason:"payment request interrupted; reconcile before any retry"});fail("Payment outcome unknown. No automatic repayment; reconcile the journal.");}
const {tx,success,errorReason}=settlementTx(settlementFrom(res));
if(!res.ok||success===false||!tx){
 await record("unknown",{reason:"payment result not confirmed; reconcile before retry",...(tx?{tx}:{})});
 fail("Payment outcome not confirmed (HTTP "+res.status+"). Reconcile before retrying.");
}
let bought;
try{bought=await res.json();}catch{
 await record("unknown",{tx,reason:"settlement received but response unreadable; reconcile before retry"});
 fail("Settlement receipt received; response unreadable. Do not pay again.");
}
if(section&&(bought.section!==section||bought.offerId!==slot.offerId||bought.payTo!==treasury||bought.durationMs!==slot.durationMs||toUnits(bought.priceUsdc)!==toUnits(slot.priceUsdc))){
 await record("unknown",{tx,reason:"settled response terms differ; reconcile before retry"});fail("Settlement response differs from the purchased section. Do not pay again.");
}
state.advertiser={account:advertiser,name:bought.advertiser,headline:bought.headline,...(section?{section}:{})};
await record("settled",{tx,explorer:explorerTx(NETWORK,tx)});
console.log("Advertiser paid "+slot.priceUsdc+" testnet USDC to the venue treasury: SETTLED "+explorerTx(NETWORK,tx));
