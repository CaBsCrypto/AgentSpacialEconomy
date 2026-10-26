import { AdsError, canonical, sha256 } from './common.mjs';
export const TESTNET_USDC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
export const TESTNET_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const refuse = message => { throw new AdsError(422,'payment_payload_invalid',message); };
const b64 = value => typeof value==='string'?value:value.toXDR('base64');
const credentials = entry => {
 const c=entry.credentials();
 if(c.switch().name==='sorobanCredentialsAddress') return c.address();
 if(c.switch().name==='sorobanCredentialsAddressV2') return c.addressV2();
 refuse('Solo se admiten auth entries de dirección; no delegación ni source-account.');
};

/** Pure XDR validation. Signature validity is checked by facilitator simulation and the network. */
export function inspectStellarPayment(payload,expected,sdk) {
 if(payload?.x402Version!==2||payload?.accepted?.scheme!=='exact'||payload.accepted.network!==expected.network) refuse('Protocolo o red incorrectos.');
 for(const key of ['asset','amount','payTo']) if(String(payload.accepted[key])!==String(expected[key])) refuse(`La autorización no coincide con ${key}.`);
 if(typeof payload.payload?.transaction!=='string'||payload.payload.transaction.length>100000) refuse('XDR inválido.');
 let tx;try{tx=sdk.TransactionBuilder.fromXDR(payload.payload.transaction,sdk.Networks.TESTNET);}catch{refuse('No se puede decodificar la autorización.');}
 if(tx.innerTransaction||tx.operations.length!==1)refuse('Solo se permite una transferencia de token.');
 const op=tx.operations[0];
 if(op.type!=='invokeHostFunction'||op.func.switch().name!=='hostFunctionTypeInvokeContract')refuse('Operación no permitida.');
 const fn=op.func.invokeContract(),args=fn.args();
 if(sdk.Address.fromScAddress(fn.contractAddress()).toString()!==expected.asset||fn.functionName().toString()!=='transfer'||args.length!==3)refuse('La operación no transfiere el token permitido.');
 const [payer,to,amount]=args.map(a=>sdk.scValToNative(a));
 if(payer!==expected.payer||to!==expected.payTo||String(amount)!==String(expected.amount))refuse('Pagador, beneficiario o importe incorrectos.');
 if(!op.auth||op.auth.length!==1)refuse('Se requiere una sola autorización del pagador.');
 const entry=op.auth[0],c=credentials(entry),root=entry.rootInvocation();
 if(sdk.Address.fromScAddress(c.address()).toString()!==payer||root.subInvocations().length||c.signature().switch().name==='scvVoid')refuse('Autorización adicional o sin firma.');
 const authFn=root.function();
 if(authFn.switch().name!=='sorobanAuthorizedFunctionTypeContractFn'||b64(authFn.contractFn())!==b64(fn))refuse('La firma no autoriza exactamente esta transferencia.');
 return {payer,nonce:c.nonce().toString(),expiresLedger:c.signatureExpirationLedger(),authHash:sha256(canonical(op.auth.map(b64))),payloadHash:sha256(canonical(payload)),auth:op.auth.map(b64)};
}
const deadline = async (work,ms) => {
 let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('external_payment_timeout')),ms);})]);}finally{clearTimeout(timer);}
};

/** Explicit x402 resource server; no response-handler middleware can enqueue before settlement. */
export function createStellarPaymentRuntime({config,rpc,resourceServer,loadSdk=()=>import('@stellar/stellar-sdk')}) {
 let sdkPromise,serverPromise;
 const sdk=()=>sdkPromise??=loadSdk();
 const check=()=>{
  if(config.network!=='stellar:testnet'||config.asset!==TESTNET_USDC||config.issuer!==TESTNET_ISSUER)throw new AdsError(503,'testnet_asset_not_allowed','Solo se permite el USDC de Stellar Testnet configurado.');
 };
 const rpcClient=async()=>{check();if(rpc)return rpc;const {Server}=await import('@stellar/stellar-sdk/rpc');rpc=new Server(config.rpcUrl??'https://soroban-testnet.stellar.org');return rpc;};
 const server=()=>serverPromise??=(async()=>{
  check();if(resourceServer)return resourceServer;
  const url=new URL(config.facilitatorUrl??'https://x402.org/facilitator');
  if(url.protocol!=='https:'||url.username||url.password)throw new AdsError(503,'facilitator_invalid','Facilitador HTTPS inválido.');
  const [{x402ResourceServer,HTTPFacilitatorClient},{ExactStellarScheme}]=await Promise.all([import('@x402/core/server'),import('@x402/stellar/exact/server')]);
  const r=new x402ResourceServer(new HTTPFacilitatorClient({url:url.href.replace(/\/$/,'')}));
  r.register('stellar:testnet',new ExactStellarScheme());await r.initialize();return r;
 })();
 const expectedFor = attempt=>({...attempt.requirements,payer:attempt.payer});
 const filters=async expected=>{
  const s=await sdk();return [{type:'contract',contractIds:[expected.asset],topics:[[s.nativeToScVal('transfer',{type:'symbol'}).toXDR('base64'),s.nativeToScVal(expected.payer,{type:'address'}).toXDR('base64'),s.nativeToScVal(expected.payTo,{type:'address'}).toXDR('base64'),'**']]}];
 };
 const matchesEvent=async(event,expected)=>{
  const s=await sdk();let contract=event.contractId;
  if(typeof contract?.contractId==='function')contract=contract.contractId();
  if(contract!==expected.asset)return false;
  try{const topic=event.topic.map(v=>s.scValToNative(typeof v==='string'?s.xdr.ScVal.fromXDR(v,'base64'):v));const value=s.scValToNative(typeof event.value==='string'?s.xdr.ScVal.fromXDR(event.value,'base64'):event.value);return topic[0]==='transfer'&&topic[1]===expected.payer&&topic[2]===expected.payTo&&String(value)===String(expected.amount);}catch{return false;}
 };
 async function verifyCandidate(hash,attempt,event) {
  const s=await sdk(),r=await (await rpcClient()).getTransaction(hash);
  if(r.status!=='SUCCESS'||!r.envelopeXdr)return null;
  let tx;try{tx=s.TransactionBuilder.fromXDR(b64(r.envelopeXdr),s.Networks.TESTNET);if(tx.innerTransaction)tx=tx.innerTransaction;}catch{return null;}
  const expected=expectedFor(attempt),client={...attempt.signed_payload,payload:{transaction:tx.toXDR()}};
  let parsed;try{parsed=inspectStellarPayment(client,expected,s);}catch{return null;}
  if(parsed.authHash!==attempt.auth_hash||parsed.nonce!==attempt.auth_nonce||Number(parsed.expiresLedger)!==Number(attempt.expires_ledger))return null;
  // Event is a candidate only; confirmed envelope authorization binds it to this attempt.
  if(!event){const page=await (await rpcClient()).getEvents({startLedger:r.ledger,endLedger:r.ledger+1,filters:await filters(expected),limit:1000});event=page.events.find(e=>e.txHash===hash&&e.inSuccessfulContractCall!==false&&Number(e.ledger)===Number(r.ledger)&&e.type==='contract'&&e.id);if(event&&!await matchesEvent(event,expected))event=null;}
  if(!event||!await matchesEvent(event,expected))return null;
  return {state:'CONFIRMED',txHash:hash,payer:parsed.payer,ledger:r.ledger,eventId:event.id,authHash:parsed.authHash,asset:expected.asset,amount:expected.amount,payTo:expected.payTo};
 }
 return {
  async decodePayment(payload,expected){check();return inspectStellarPayment(payload,expected,await sdk());},
  async latestLedger(){return (await (await rpcClient()).getLatestLedger()).sequence;},
  async verify(payload,requirements){return deadline((await server()).verifyPayment(payload,requirements),config.paymentRequestTimeoutMs??20000);},
  async settle(payload,requirements){return deadline((await server()).settlePayment(payload,requirements),config.paymentRequestTimeoutMs??20000);},
  async confirm(attempt){
   check();if(attempt.settlement_tx){const proof=await verifyCandidate(attempt.settlement_tx,attempt);return proof??{state:'UNKNOWN',reason:'transaction_not_confirmed'};}
   const client=await rpcClient(),expected=expectedFor(attempt),health=await client.getHealth();
   if(Number(health.oldestLedger)>Number(attempt.start_ledger))return {state:'UNKNOWN',reason:'history_gap'};
   let cursor;const found=[];const latest=(await client.getLatestLedger()).sequence;
   for(let pageNo=0;pageNo<(config.maxReconcilePages??20);pageNo++){
    const page=await client.getEvents({...(!cursor?{startLedger:Number(attempt.start_ledger),endLedger:latest+1}:{cursor}),filters:await filters(expected),limit:1000});
    for(const event of page.events){if(!await matchesEvent(event,expected))continue;const proof=await verifyCandidate(event.txHash,attempt,event);if(proof&&!found.some(p=>p.txHash===proof.txHash))found.push(proof);}
    if(found.length>1)return {state:'UNKNOWN',reason:'ambiguous_settlement'};
    if(page.events.length<1000||!page.cursor||page.cursor===cursor)return found[0]??{state:'UNKNOWN',reason:'settlement_not_found'};
    cursor=page.cursor;
   }
   return {state:'UNKNOWN',reason:'reconciliation_scan_incomplete'};
  }
 };
}
