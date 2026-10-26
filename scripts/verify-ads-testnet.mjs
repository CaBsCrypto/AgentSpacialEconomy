// Read-only gate. This script never creates accounts, signs, funds, or submits payments.
import {readAdsConfig,ASSET,NETWORK} from '../server/ads/config.mjs';
import {createDatabase} from '../server/ads/db.mjs';
import {createStellarPaymentRuntime} from '../server/ads/stellar-payments.mjs';
const expected=Number(process.env.ADS_EXPECTED_SETTLEMENTS||'1');
if(!Number.isSafeInteger(expected)||expected<1)throw Error('ADS_EXPECTED_SETTLEMENTS must be positive. Zero settlements never passes this gate.');
const config=readAdsConfig(),db=createDatabase({connectionString:config.databaseUrl});
try{
 const {rows}=await db.query("SELECT a.*,row_to_json(o) AS order FROM ads_payment_attempts a JOIN ads_orders o ON o.id=a.order_id WHERE a.state='SETTLED' AND a.created_at>=COALESCE($1::timestamptz,now()-interval '1 hour')",[process.env.ADS_EVIDENCE_SINCE||null]);
 if(rows.length<expected)throw Error('Expected at least '+expected+' NEW settlements, found '+rows.length+'. Unit fixtures are not testnet evidence.');
 const runtime=createStellarPaymentRuntime({config});const evidence=[];
 for(const attempt of rows){
  if(attempt.network!==NETWORK)throw Error('Unexpected payment network');
  const proof=await runtime.confirm({...attempt,requirements:{scheme:'exact',network:NETWORK,asset:ASSET,payTo:attempt.order.pay_to,amount:attempt.order.amount,extra:{areFeesSponsored:true}}});
  if(proof.state!=='CONFIRMED'||proof.txHash!==attempt.settlement_tx)throw Error('Settlement failed independent RPC verification');
  const queued=(await db.query("SELECT 1 FROM ads_outbox WHERE aggregate_id=$1 AND topic='creative'",[attempt.order_id])).rowCount;
  if(!queued&&attempt.order.state!=='RECONCILIATION_REQUIRED')throw Error('Confirmed payment has no durable creative job');
  evidence.push({orderId:attempt.order_id,transaction:proof.txHash,network:NETWORK,ledger:proof.ledger,source:'live Stellar RPC'});
 }
 console.log(JSON.stringify({verifiedAt:new Date().toISOString(),expected,settlements:evidence},null,2));
}finally{await db.close();}
