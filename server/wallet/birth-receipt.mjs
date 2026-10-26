import { createHash, ECDH } from 'node:crypto';
import { Address, FeeBumpTransaction, StrKey, TransactionBuilder, hash, xdr } from '@stellar/stellar-sdk';
import { Redis } from '@upstash/redis';
import { readConfig, SHARED_DEPLOYER, TESTNET } from './config.mjs';
import { assertReady, json, readBody, WalletApiError, withErrors } from './http.mjs';

const INDEXER = 'https://testnet.mercurydata.app/rest/smart-account-indexer';
const HORIZON = 'https://horizon-testnet.stellar.org';
const RATE_SCRIPT = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n";
const refuse = (reason, message = 'No se pudo verificar el origen de esta wallet. Conserva tu passkey y vuelve a comprobar.') => { throw new WalletApiError(409, reason, message); };
const same = (left, right) => Buffer.from(left).equals(Buffer.from(right));

export function validateBirthRequest(body) {
  if (!body || Object.keys(body).some(key => !['address', 'credentialId'].includes(key)) || typeof body.address !== 'string' || !StrKey.isValidContract(body.address)) throw new WalletApiError(400, 'invalid_birth_request', 'Se requiere la dirección pública de la smart wallet y su passkey.');
  if (typeof body.credentialId !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(body.credentialId)) throw new WalletApiError(400, 'invalid_birth_request', 'El identificador de passkey no es válido.');
  const bytes = Buffer.from(body.credentialId, 'base64url');
  if (!bytes.length || bytes.length > 191 || bytes.toString('base64url') !== body.credentialId) throw new WalletApiError(400, 'invalid_birth_request', 'El identificador de passkey no es válido.');
  return { address: body.address, credentialId: body.credentialId };
}

function contractAddress(create) {
  const preimage = new xdr.HashIdPreimageContractId({ networkId: hash(Buffer.from(TESTNET)), contractIdPreimage: create.contractIdPreimage() });
  return StrKey.encodeContract(hash(xdr.HashIdPreimage.envelopeTypeContractId(preimage).toXDR()));
}

/** Historical metadata is only a candidate: the unchanged SDK checks it again. */
export function verifyBirthReceipt(record, body, config) {
  const { address, credentialId } = validateBirthRequest(body), credential = Buffer.from(credentialId, 'base64url');
  if (config.networkPassphrase !== TESTNET) refuse('birth_wrong_network');
  if (!record || record.successful !== true || !Number.isSafeInteger(record.ledger) || record.ledger < 1 || !/^[0-9a-f]{64}$/.test(record.hash || '') || typeof record.envelope_xdr !== 'string' || record.envelope_xdr.length > 1_000_000) refuse('birth_receipt_invalid');
  let parsed;
  try { parsed = TransactionBuilder.fromXDR(record.envelope_xdr, TESTNET); } catch { refuse('birth_receipt_invalid'); }
  if (parsed.hash().toString('hex') !== record.hash) refuse('birth_hash_mismatch');
  const transaction = parsed instanceof FeeBumpTransaction ? parsed.innerTransaction : parsed;
  const matches = transaction.operations.filter(operation => operation.type === 'invokeHostFunction' && operation.func.switch().name === 'hostFunctionTypeCreateContractV2').map(operation => operation.func.createContractV2()).filter(create => contractAddress(create) === address);
  if (matches.length !== 1) refuse('birth_creation_ambiguous');
  const create = matches[0], preimage = create.contractIdPreimage();
  if (preimage.switch().name !== 'contractIdPreimageFromAddress') refuse('birth_deployer_mismatch');
  const from = preimage.fromAddress();
  if (Address.fromScAddress(from.address()).toString() !== SHARED_DEPLOYER || !same(from.salt(), hash(credential))) refuse('birth_deployer_mismatch');
  if (create.executable().switch().name !== 'contractExecutableWasm' || create.executable().wasmHash().toString('hex') !== config.accountWasmHash) refuse('birth_wasm_mismatch');
  const args = create.constructorArgs();
  if (args.length !== 2 || args[0].switch().name !== 'scvVec' || args[1].switch().name !== 'scvMap' || args[1].map().length !== 0) refuse('birth_constructor_mismatch');
  const signers = args[0].vec();
  if (signers.length !== 1 || signers[0].switch().name !== 'scvVec') refuse('birth_signer_mismatch');
  const signer = signers[0].vec();
  if (signer.length !== 3 || signer[0].switch().name !== 'scvSymbol' || signer[0].sym().toString() !== 'External' || signer[1].switch().name !== 'scvAddress' || signer[2].switch().name !== 'scvBytes' || Address.fromScAddress(signer[1].address()).toString() !== config.webauthnVerifierAddress) refuse('birth_signer_mismatch');
  const key = signer[2].bytes();
  if (key.length !== 65 + credential.length || key[0] !== 4 || !same(key.subarray(65), credential)) refuse('birth_signer_mismatch');
  try { ECDH.convertKey(key.subarray(0, 65), 'prime256v1', undefined, undefined, 'uncompressed'); } catch { refuse('birth_signer_mismatch'); }
  // Supplying this hash would make the SDK consider the recovered record locally
  // approved and skip fresh ownership. Only the SDK may persist it after proof.
  return { address, credentialId, publicKeyBase64Url: key.subarray(0, 65).toString('base64url'), birthWasmHash: config.accountWasmHash, creationTransactionHash: record.hash, creationLedger: record.ledger, network: 'testnet' };
}

async function boundedJson(fetchImpl, url, signal) {
  const response = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal });
  if (!response.ok || Number(response.headers.get('content-length') || 0) > 2_000_000) refuse('birth_history_unavailable');
  const reader = response.body?.getReader();
  if (!reader) refuse('birth_history_unavailable');
  const chunks = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 2_000_000) { await reader.cancel(); refuse('birth_history_unavailable'); } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { refuse('birth_history_unavailable'); }
}

/** One public ledger hint and at most 200 transactions, from fixed providers. */
export async function resolveBirthReceipt(body, { config, fetchImpl = fetch } = {}) {
  const input = validateBirthRequest(body), signal = AbortSignal.timeout(12000);
  const details = await boundedJson(fetchImpl, INDEXER + '/api/contract/' + input.address, signal);
  const ledger = Number(details?.summary?.first_seen_ledger);
  if (details?.contractId !== input.address || details?.summary?.contract_id !== input.address || !Number.isSafeInteger(ledger) || ledger < 1) refuse('birth_hint_unavailable');
  const page = await boundedJson(fetchImpl, HORIZON + '/ledgers/' + ledger + '/transactions?include_failed=false&limit=200', signal);
  const records = page?._embedded?.records;
  if (!Array.isArray(records) || records.length >= 200 || records.some(record => record.ledger !== ledger)) refuse('birth_history_unavailable');
  const matches = [];
  for (const record of records) {
    try { matches.push(verifyBirthReceipt(record, input, config)); }
    catch (error) { if (!(error instanceof WalletApiError)) throw error; }
  }
  if (matches.length !== 1) refuse('birth_creation_ambiguous');
  return matches[0];
}

export function createBirthReceiptHandler({ env = process.env, config = readConfig(env), redis, resolve = body => resolveBirthReceipt(body, { config }) } = {}) {
  let store = redis;
  return request => withErrors(async () => {
    if (request.method !== 'POST') throw new WalletApiError(405, 'method_not_allowed', 'Se requiere POST.');
    assertReady(config);
    if (request.headers.get('origin') !== config.origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new WalletApiError(403, 'origin_not_allowed', 'Abre la experiencia desde su dominio de wallet.');
    const body = validateBirthRequest(await readBody(request, 4096));
    store ||= new Redis({ url: env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL, token: env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN });
    const addressKey = createHash('sha256').update(body.address).digest('hex');
    const counts = await Promise.all([store.eval(RATE_SCRIPT, ['wallet:birth-receipt:testnet:' + addressKey], [60]), store.eval(RATE_SCRIPT, ['wallet:birth-receipt:testnet:global'], [60])]);
    if (counts.some(count => !Number.isSafeInteger(Number(count)) || Number(count) < 1) || Number(counts[0]) > 3 || Number(counts[1]) > 60) throw new WalletApiError(429, 'rate_limited', 'Espera un minuto antes de volver a comprobar el origen de la wallet.');
    return json(await resolve(body));
  });
}
