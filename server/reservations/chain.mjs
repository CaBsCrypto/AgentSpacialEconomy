import { Account, Address, Contract, Operation, TransactionBuilder, StrKey, scValToNative, xdr, rpc } from '@stellar/stellar-sdk';
import { SHARED_DEPLOYER } from '../wallet/config.mjs';
import { canonical, exactKeys, fail, simulationRequiresRestoration } from '../identity/common.mjs';
import { createWalletAuthority } from '../identity/wallet-authority.mjs';
const HASH = /^[a-f0-9]{64}$/u;
const bytes = value => xdr.ScVal.scvBytes(Buffer.from(value,'hex'));
const encoded = value => value.toXDR('base64');
function credentials(entry) {
  const value=entry.credentials(), type=value.switch().name;
  if (type==='sorobanCredentialsAddress') return value.address();
  if (type==='sorobanCredentialsAddressV2') return value.addressV2();
  fail(422,'AUTHORIZATION_REJECTED','Only direct wallet address authorization is allowed.');
}
export function expectedFunction(config,intent) {
  const args = intent.operation==='publish' ? [bytes(config.projectId),bytes(intent.offerId),bytes(intent.spaceId)] : [bytes(intent.offerId),new Address(intent.actorAddress).toScVal()];
  return xdr.HostFunction.hostFunctionTypeInvokeContract(new xdr.InvokeContractArgs({ contractAddress:new Address(config.contractId).toScAddress(),functionName:intent.operation,args }));
}
/** Compare complete unsigned XDR, allowing only the signature field to change. */
export function validateSignedPayload(body,preparation,config,intent) {
  exactKeys(body,['func','auth']);
  if (typeof body.func!=='string' || body.func.length>8192 || !Array.isArray(body.auth) || body.auth.length!==1 || typeof body.auth[0]!=='string' || body.auth[0].length>32768) fail(422,'AUTHORIZATION_REJECTED','Exactly one bounded wallet authorization is required.');
  try {
    const func=xdr.HostFunction.fromXDR(body.func,'base64');
    if (encoded(func)!==preparation.func || encoded(func)!==encoded(expectedFunction(config,intent))) fail(422,'INTENT_MISMATCH','The function does not match the reviewed reservation intent.');
    const entry=xdr.SorobanAuthorizationEntry.fromXDR(body.auth[0],'base64');
    const auth=credentials(entry), root=entry.rootInvocation();
    if (Address.fromScAddress(auth.address()).toString()!==intent.actorAddress || root.subInvocations().length || root.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn' || encoded(root.function().contractFn())!==encoded(func.invokeContract())) fail(422,'INTENT_MISMATCH','The authorization does not match the exact signer and invocation.');
    const signature=auth.signature();
    if (signature.switch().name==='scvVoid') fail(422,'SIGNATURE_REQUIRED','Sign the reviewed authorization before submitting.');
    const payload=scValToNative(signature);
    if (!Array.isArray(payload?.context_rule_ids) || canonical(payload.context_rule_ids.map(Number))!=='[0]') fail(422,'CONTEXT_RULE_REJECTED','Only the verified original wallet rule is allowed.');
    const unsigned=xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR()); credentials(unsigned).signature(xdr.ScVal.scvVoid());
    if (encoded(unsigned)!==preparation.auth[0]) fail(422,'INTENT_MISMATCH','The nonce, expiration or authorization was changed.');
    return { func,auth:[entry] };
  } catch(error) { if (error.status) throw error; fail(422,'AUTHORIZATION_REJECTED','The signed XDR could not be validated.'); }
}
export function normalizeOffer(value) {
  if (!value || !Buffer.isBuffer(value.offer) || !Buffer.isBuffer(value.project) || !Buffer.isBuffer(value.space)) return null;
  const state=Array.isArray(value.state)?value.state[0]:value.state;
  if (!['Available','Reserved'].includes(state) || typeof value.host!=='string') return null;
  return { id:value.offer.toString('hex'),projectId:value.project.toString('hex'),spaceId:value.space.toString('hex'),host:value.host,state:state==='Available'?'AVAILABLE':'RESERVED',holder:value.holder??null,publishedAt:Number(value.published_at),reservedAt:Number(value.reserved_at) };
}
export function transactionMatches(tx,hash,preparation,signedPayload,config,intent) {
  try {
    if (!tx.envelopeXdr || !signedPayload) return false;
    const envelope=TransactionBuilder.fromXDR(tx.envelopeXdr,config.networkPassphrase);
    const transaction=envelope.innerTransaction??envelope;
    if (![envelope.hash().toString('hex'),transaction.hash().toString('hex')].includes(hash) || transaction.operations.length!==1) return false;
    const operation=transaction.operations[0];
    if (operation.type!=='invokeHostFunction') return false;
    const body={func:encoded(operation.func),auth:operation.auth.map(encoded)};
    if (canonical(body)!==canonical(signedPayload)) return false;
    validateSignedPayload(body,preparation,config,intent); return true;
  } catch {return false;}
}
export function createChainAdapter({ config, server = new rpc.Server(config.rpcUrl), authority = createWalletAuthority({config}), fetchImpl = fetch }) {
  const transaction = (func,auth=[]) => new TransactionBuilder(new Account(SHARED_DEPLOYER,'0'),{fee:'100',networkPassphrase:config.networkPassphrase}).addOperation(Operation.invokeHostFunction({func,auth})).setTimeout(30).build();
  async function read(method,args=[]) {
    const result=await server.simulateTransaction(new TransactionBuilder(new Account(SHARED_DEPLOYER,'0'),{fee:'100',networkPassphrase:config.networkPassphrase}).addOperation(new Contract(config.contractId).call(method,...args)).setTimeout(30).build());
    if (rpc.Api.isSimulationError(result) || simulationRequiresRestoration(result) || !result.result?.retval) fail(503,'CHAIN_UNAVAILABLE','The contract record is unavailable or requires restoration.');
    return scValToNative(result.result.retval);
  }
  async function binding() {
    const network=await server.getNetwork();
    if (network.passphrase!==config.networkPassphrase) fail(503,'RPC_NETWORK_MISMATCH','The RPC is not the configured Testnet.');
    const key=xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({contract:new Address(config.contractId).toScAddress(),key:xdr.ScVal.scvLedgerKeyContractInstance(),durability:xdr.ContractDataDurability.persistent()}));
    const entries=(await server.getLedgerEntries(key)).entries;
    let code; try { code=entries[0]?.val.contractData().val().instance().executable().wasmHash().toString('hex'); } catch {}
    if (entries.length!==1 || code!==config.contractWasmHash) fail(503,'CONTRACT_BINDING_MISMATCH','The approved reservation contract could not be verified.');
    const project=await read('project'),host=await read('host');
    if (!Buffer.isBuffer(project) || project.toString('hex')!==config.projectId || host!==config.hostAddress) fail(503,'CONTRACT_BINDING_MISMATCH','The contract belongs to a different project or host.');
  }
  async function getOffer(id) { await binding(); const value=normalizeOffer(await read('get',[bytes(id)])); return value || {id,state:'UNAVAILABLE',holder:null}; }
  async function prepare(intent,identity) {
    await binding();
    const verified=await authority.read({address:identity.address,credentialId:identity.credentialId});
    if (verified.ruleId!==0 || verified.authorityHash!==identity.authorityHash) fail(401,'WALLET_AUTHORITY_CHANGED','Sign in again with the current wallet authority.');
    const func=expectedFunction(config,intent), latest=await server.getLatestLedger();
    const simulated=await server.simulateTransaction(transaction(func),undefined,'record');
    if (rpc.Api.isSimulationError(simulated) || simulationRequiresRestoration(simulated) || simulated.result?.auth?.length!==1) fail(503,'PREPARATION_UNAVAILABLE','The exact reservation could not be prepared.');
    const entry=simulated.result.auth[0], auth=credentials(entry);
    if (Address.fromScAddress(auth.address()).toString()!==intent.actorAddress || entry.rootInvocation().subInvocations().length || encoded(entry.rootInvocation().function().contractFn())!==encoded(func.invokeContract())) fail(503,'PREPARATION_MISMATCH','The simulated authorization did not match the reviewed intent.');
    const expirationLedger=latest.sequence+36;
    auth.signatureExpirationLedger(expirationLedger); auth.signature(xdr.ScVal.scvVoid());
    return { func:encoded(func),auth:[encoded(entry)],signerAddress:intent.actorAddress,expirationLedger,contextRuleIds:[0],networkPassphrase:config.networkPassphrase,rpcUrl:config.rpcUrl,contractId:config.contractId,method:intent.operation,startLedger:latest.sequence };
  }
  async function preflight(body,preparation,intent) {
    await binding(); const parsed=validateSignedPayload(body,preparation,config,intent);
    if ((await server.getLatestLedger()).sequence>=preparation.expirationLedger) fail(422,'AUTHORIZATION_EXPIRED','The unsigned preparation expired before submission.');
    const result=await server.simulateTransaction(transaction(parsed.func,parsed.auth),undefined,'enforce');
    if (rpc.Api.isSimulationError(result) || simulationRequiresRestoration(result)) fail(422,'SIGNATURE_OR_STATE_REJECTED','The signature or current reservation state was rejected before relay.');
  }
  async function submit(body) {
    // No retries: callers have persisted and exclusively claimed this signed payload.
    const response=await fetchImpl(config.channelsUrl,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.channelsKey},body:JSON.stringify({params:body}),signal:AbortSignal.timeout(90000)});
    const value=await response.json();
    if (!response.ok || value.success!==true || !HASH.test(value.data?.hash || '')) fail(503,'RELAY_UNCERTAIN','The relay result is uncertain. Reconciliation is required.');
    return {hash:value.data.hash};
  }
  function matchesEvent(event,intent) {
    try {
      const contract=event.contractId?.contractId?.() ?? event.contractId;
      const topic=event.topic.map(scValToNative), data=scValToNative(event.value);
      return contract===config.contractId && event.inSuccessfulContractCall!==false && topic[0]===(intent.operation==='publish'?'published':'reserved') && Buffer.isBuffer(topic[1]) && topic[1].toString('hex')===intent.offerId && (intent.operation==='publish' ? Buffer.isBuffer(data.project) && data.project.toString('hex')===config.projectId && data.host===intent.actorAddress : data.holder===intent.actorAddress);
    } catch { return false; }
  }
  async function reconcile(intent,preparation,hash,signedPayload) {
    await binding();
    const topics=[[encoded(xdr.ScVal.scvSymbol(intent.operation==='publish'?'published':'reserved')),encoded(bytes(intent.offerId))]];
    let events;
    try { events=(await server.getEvents({startLedger:preparation.startLedger,filters:[{type:'contract',contractIds:[config.contractId],topics}],limit:100})).events.filter(event=>matchesEvent(event,intent)); }
    catch { return {state:'NEEDS_RECONCILIATION'}; }
    const event=events.find(event=>HASH.test(event.txHash||'') && (!hash || event.txHash===hash));
    const txHash=hash||event?.txHash;
    if (!txHash) return {state:'NEEDS_RECONCILIATION'};
    const tx=await server.getTransaction(txHash);
    if (tx.status==='NOT_FOUND') return {state:'PENDING',hash:txHash};
    if (!transactionMatches(tx,txHash,preparation,signedPayload,config,intent)) return {state:'NEEDS_RECONCILIATION',hash:txHash};
    if (tx.status==='FAILED') return {state:'REJECTED',hash:txHash,definitive:true};
    if (tx.status!=='SUCCESS' || !event || Number(event.ledger)!==Number(tx.ledger)) return {state:'NEEDS_RECONCILIATION',hash:txHash};
    const offer=await getOffer(intent.offerId);
    if (offer.projectId!==config.projectId || offer.spaceId!==intent.spaceId || offer.host!==config.hostAddress) return {state:'NEEDS_RECONCILIATION',hash:txHash};
    if (intent.operation==='reserve' && offer.state==='RESERVED' && offer.holder!==intent.actorAddress) return {state:'CONFLICT',hash:txHash,offer};
    if (intent.operation==='publish' && !['AVAILABLE','RESERVED'].includes(offer.state) || intent.operation==='reserve' && (offer.state!=='RESERVED'||offer.holder!==intent.actorAddress)) return {state:'NEEDS_RECONCILIATION',hash:txHash};
    return {state:'CONFIRMED',hash:txHash,ledger:Number(tx.ledger),offer};
  }
  return { prepare,preflight,submit,reconcile,getOffer,validate:(body,preparation,intent)=>validateSignedPayload(body,preparation,config,intent) };
}
