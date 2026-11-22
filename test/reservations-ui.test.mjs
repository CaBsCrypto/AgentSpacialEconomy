import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Address, StrKey, xdr, scValToNative } from '@stellar/stellar-sdk';
import { createReservationsApi, errorMessage } from '../dist/reservations-api.mjs';
import { projectPayload, editableProject, draftChanged, applyProposal, removeSpace, pointFromPointer, confirmedReceipt, safeExplorerUrl } from '../dist/reservations-state.mjs';
import { createReservationsWallet, validateReservationPreparation, assertReservationConfig, TESTNET } from '../dist/reservations-wallet.mjs';
import { resolvePlatformRequest, platformCanonicalPath } from '../dist/platform-routing.mjs';

const id = byte => byte.repeat(64);
const address = byte => StrKey.encodeContract(Buffer.alloc(32, byte));
const actor = address(1), contract = address(2), verifier = address(3);
const sdk = { Address, StrKey, xdr, scValToNative };
const config = { network: 'stellar:testnet', networkPassphrase: TESTNET, rpcUrl: 'https://soroban-testnet.stellar.org', origin: 'https://agenticreality.space', rpId: 'agenticreality.space', projectId: id('a'), contractId: contract, accountWasmHash: id('f'), webauthnVerifierAddress: verifier };
const snapshot = { id: id('b'), projectId: id('a'), spaceId: id('c'), revision: 1, title: 'Proyecto revisado', context: 'Contexto', space: { id: id('c'), name: 'Escenario', purpose: 'Encuentro' }, map: { mediaId: id('d'), points: [{ spaceId: id('c'), x: .5, y: .5 }] } };
const browser = { isSecureContext: true, navigator: { credentials: {} }, PublicKeyCredential: class {}, location: { origin: config.origin, hostname: config.rpId } };
const hexValue = value => xdr.ScVal.scvBytes(Buffer.from(value, 'hex'));
function preparation(operation = 'publish') {
  const offerId = id('e');
  const args = operation === 'publish' ? [hexValue(config.projectId), hexValue(offerId), hexValue(snapshot.spaceId)] : [hexValue(offerId), new Address(actor).toScVal()];
  const invocation = new xdr.InvokeContractArgs({ contractAddress: new Address(contract).toScAddress(), functionName: operation, args });
  const func = xdr.HostFunction.hostFunctionTypeInvokeContract(invocation);
  const entry = new xdr.SorobanAuthorizationEntry({ credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({ address: new Address(actor).toScAddress(), nonce: xdr.Int64.fromString('123'), signatureExpirationLedger: 100, signature: xdr.ScVal.scvVoid() })), rootInvocation: new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invocation), subInvocations: [] }) });
  return { attempt: { id: id('1'), operation, state: 'PREPARED', offerId, snapshotId: snapshot.id, actorAddress: actor, expiresAt: new Date(Date.now() + 120000).toISOString() }, review: { operation, offerId, snapshotId: snapshot.id, projectId: snapshot.projectId, spaceId: snapshot.spaceId, actorAddress: actor, contractId: contract, title: snapshot.title, spaceName: snapshot.space.name, network: 'stellar:testnet', paymentRequired: false }, signing: { func: func.toXDR('base64'), auth: [entry.toXDR('base64')], signerAddress: actor, expirationLedger: 100, contextRuleIds: [0], networkPassphrase: TESTNET, rpcUrl: config.rpcUrl, contractId: contract, method: operation } };
}
const expected = operation => ({ operation, actorAddress: actor, snapshot, ...(operation === 'reserve' ? { offerId: id('e') } : {}) });
const signature = () => xdr.ScVal.scvMap([new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('context_rule_ids'), val: xdr.ScVal.scvVec([xdr.ScVal.scvU32(0)]) })]);

test('manual edits preserve server IDs, exclude conversation and invalidate no existing snapshot locally', () => {
  const project = { id: config.projectId, revision: 2, title: 'Título', context: '', spaces: [snapshot.space], map: snapshot.map, conversation: [{ content: 'Privado' }], approvedSnapshot: snapshot };
  const draft = editableProject(project); assert.equal(draftChanged(project, draft), false);
  draft.title = 'Cambio'; draft.spaces.push({ name: 'Nuevo', purpose: '' });
  const payload = projectPayload(project, draft);
  assert.equal(payload.expectedRevision, 2); assert.equal(payload.spaces[0].id, snapshot.spaceId); assert.equal(payload.spaces[1].id, undefined);
  assert.equal(payload.conversation, undefined); assert.equal(payload.approvedSnapshot, undefined); assert.equal(snapshot.title, 'Proyecto revisado');
  assert.throws(() => projectPayload(project, { ...draft, spaces: Array.from({ length: 21 }, () => ({ name: 'N', purpose: '' })) }));
  assert.throws(() => projectPayload(project, { ...draft, map: { ...draft.map, points: [{ spaceId: id('0'), x: .5, y: .5 }] } }));
  const removed = removeSpace(draft, 0); assert.deepEqual(removed.map.points, []); assert.equal(draft.map.points.length, 1);
});

test('AI remains a proposal until explicit application and cannot retain old spatial positions', () => {
  const draft = { title: 'Original', context: 'Privado', spaces: [snapshot.space], map: snapshot.map };
  const proposal = { summary: '<img src=x onerror=alert(1)>', title: 'Propuesta', context: 'Nueva', spaces: [{ name: 'Nuevo', purpose: '' }] };
  const applied = applyProposal(draft, proposal);
  assert.equal(draft.title, 'Original'); assert.equal(applied.title, 'Propuesta'); assert.deepEqual(applied.map.points, []); assert.equal(applied.spaces[0].id, undefined);
  assert.throws(() => applyProposal(draft, { ...proposal, spaces: Array(21).fill({ name: 'A', purpose: '' }) }));
});

test('map pointer coordinates use the actual image bounds and remain normalized', () => {
  assert.deepEqual(pointFromPointer(150, 200, { left: 50, top: 100, width: 200, height: 400 }), { x: .5, y: .25 });
  assert.deepEqual(pointFromPointer(-30, 900, { left: 50, top: 100, width: 200, height: 400 }), { x: 0, y: 1 });
  assert.throws(() => pointFromPointer(0, 0, { left: 0, top: 0, width: 0, height: 0 }));
});

test('receipts require confirmed state, valid transaction, ledger, owner and matching offer', () => {
  const result = { attempt: { ...preparation('reserve').attempt, state: 'CONFIRMED' }, receipt: { txHash: id('9'), ledger: 80, explorerUrl: 'https://evil.example', offer: { id: id('e'), projectId: snapshot.projectId, spaceId: snapshot.spaceId, host: address(5), state: 'RESERVED', holder: actor } } };
  assert.ok(confirmedReceipt(result, { address: actor })); assert.equal(safeExplorerUrl(result.receipt), 'https://stellar.expert/explorer/testnet/tx/' + id('9'));
  for (const state of ['PENDING', 'SUBMITTING', 'NEEDS_RECONCILIATION']) assert.equal(confirmedReceipt({ ...result, attempt: { ...result.attempt, state } }, { address: actor }), null);
  assert.equal(confirmedReceipt(result, { address: address(4) }), null);
  assert.equal(confirmedReceipt({ ...result, receipt: { ...result.receipt, ledger: 0 } }, { address: actor }), null);
  assert.equal(confirmedReceipt({ ...result, receipt: { ...result.receipt, offer: { ...result.receipt.offer, holder: address(4) } } }, { address: actor }), null);
  assert.equal(confirmedReceipt({ ...result, attempt: { ...result.attempt, operation: 'transfer' } }, { address: actor }), null);
  assert.equal(confirmedReceipt({ ...result, attempt: { ...result.attempt, operation: 'publish' } }, { address: actor }), null);
});

test('HTTP client keeps same-origin cookies, disables cache and never retries an uncertain mutation', async () => {
  const calls = [];
  const api = createReservationsApi({ fetchImpl: async (url, options) => { calls.push({ url, options }); throw Error('network'); } });
  await assert.rejects(api.request('/attempts/prepare', { method: 'POST', body: { operation: 'reserve', offerId: id('e') } }), error => error.code === 'NETWORK_UNCERTAIN');
  assert.equal(calls.length, 1); assert.equal(calls[0].options.credentials, 'same-origin'); assert.equal(calls[0].options.cache, 'no-store'); assert.equal(calls[0].url, '/api/reservations/attempts/prepare');
  await assert.rejects(api.request('//evil.example')); assert.equal(calls.length, 1);
  const failing = createReservationsApi({ fetchImpl: async () => new Response(JSON.stringify({ code: 'UNKNOWN', message: 'secret SQL and provider response' }), { status: 503 }) });
  try { await failing.request('/project'); } catch (error) { assert.doesNotMatch(errorMessage(error), /secret|SQL|provider/); }
});

test('prepared publish and reserve validate against exact reviewed intent', () => {
  for (const operation of ['publish', 'reserve']) assert.ok(validateReservationPreparation(sdk, preparation(operation), config, expected(operation)));
  for (const mutate of [p => p.review.paymentRequired = true, p => p.review.projectId = id('0'), p => p.review.spaceId = id('0'), p => p.review.actorAddress = address(4), p => p.review.title = 'Alterado', p => p.attempt.state = 'PENDING', p => p.attempt.offerId = id('0'), p => p.signing.signerAddress = address(4), p => p.signing.rpcUrl = 'https://evil.example', p => p.signing.contextRuleIds = [1], p => p.signing.auth.push(p.signing.auth[0]), p => p.attempt.expiresAt = '2000-01-01']) {
    const changed = preparation(); mutate(changed); assert.throws(() => validateReservationPreparation(sdk, changed, config, expected('publish')));
  }
  const changed = preparation();
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(changed.signing.auth[0], 'base64'); entry.rootInvocation().subInvocations([xdr.SorobanAuthorizedInvocation.fromXDR(entry.rootInvocation().toXDR())]); changed.signing.auth[0] = entry.toXDR('base64');
  assert.throws(() => validateReservationPreparation(sdk, changed, config, expected('publish')), /adicionales/);
  const transfer = preparation('reserve');
  const func = xdr.HostFunction.fromXDR(transfer.signing.func, 'base64'); func.invokeContract().functionName('transfer'); transfer.signing.func = func.toXDR('base64');
  assert.throws(() => validateReservationPreparation(sdk, transfer, config, expected('reserve')));
});

test('wallet adapter only connects an existing identity; registration and funding are not exposed', async () => {
  const calls = [];
  class Kit { constructor(options) { calls.push(['constructor', options]); this.credentialId = 'existing-passkey'; } async connectWallet(options) { calls.push(['connect', options]); return { contractId: actor }; } }
  const wallet = await createReservationsWallet(config, { browser, loadSdk: async () => ({ ...sdk, SmartAccountKit: Kit, IndexedDBStorage: class {}, startAuthentication: async () => ({}) }), api: { request: async () => { throw Error('No HTTP expected'); } } });
  assert.equal((await wallet.connect()).address, actor); assert.deepEqual(calls[1], ['connect', { fresh: true }]);
  assert.equal(wallet.create, undefined); assert.equal(wallet.fund, undefined); assert.equal(wallet.readBalance, undefined);
  await assert.rejects(calls[0][1].webAuthn.startRegistration());
  assert.throws(() => assertReservationConfig({ ...config, networkPassphrase: 'Public Global Stellar Network ; September 2015' }, browser));
  assert.throws(() => assertReservationConfig(config, { ...browser, location: { origin: 'https://evil.example', hostname: 'evil.example' } }));
});

test('authentication preparation and passkey assertion are separate actions with one-use challenge', async () => {
  let prompts = 0; const requests = [];
  class Kit { constructor() { this.credentialId = 'existing-passkey'; } async connectWallet() { return { contractId: actor }; } }
  const options = { challenge: 'A'.repeat(43), rpId: config.rpId, userVerification: 'required', allowCredentials: [{ id: 'existing-passkey' }] };
  const api = { async request(path, value) { requests.push({ path, value }); return path === '/auth/challenge' ? { challengeId: id('4'), options, expiresAt: new Date(Date.now() + 120000).toISOString() } : { identity: { address: actor, role: 'host' } }; } };
  const wallet = await createReservationsWallet(config, { browser, api, loadSdk: async () => ({ ...sdk, SmartAccountKit: Kit, IndexedDBStorage: class {}, startAuthentication: async () => { prompts++; return { id: 'existing-passkey' }; } }) });
  await wallet.connect(); await wallet.prepareAuthentication(); assert.equal(prompts, 0); assert.equal(requests.length, 1);
  await wallet.authenticate(); assert.equal(prompts, 1); assert.equal(requests[1].path, '/auth/verify');
  await assert.rejects(wallet.authenticate()); assert.equal(prompts, 1);
});

test('signing consumes one reviewed token and preserves the entire unsigned authorization', async () => {
  let signed = 0, mutate = false;
  class Kit { constructor() { this.credentialId = 'existing-passkey'; } async connectWallet() { return { contractId: actor }; } async signAuthEntry(entry, options) { signed++; assert.deepEqual(options.contextRuleIds, [0]); entry.credentials().value().signature(signature()); if (mutate) entry.credentials().value().nonce(xdr.Int64.fromString('124')); return entry; } }
  const wallet = await createReservationsWallet(config, { browser, api: {}, loadSdk: async () => ({ ...sdk, SmartAccountKit: Kit, IndexedDBStorage: class {}, startAuthentication: async () => ({}) }) });
  await wallet.connect(); const original = preparation(), token = wallet.prepare(original, expected('publish'));
  original.signing.func = 'tampered after review';
  const payload = await wallet.sign(token); assert.equal(payload.auth.length, 1); assert.notEqual(payload.func, original.signing.func); assert.equal(signed, 1);
  await assert.rejects(wallet.sign(token)); assert.equal(signed, 1);
  mutate = true; const unsafe = wallet.prepare(preparation(), expected('publish'));
  await assert.rejects(wallet.sign(unsafe), /nonce/);
});

test('reservation routes are additive and keep ONE16 behavior', async () => {
  assert.deepEqual(resolvePlatformRequest(config.origin + '/reservas'), { type: 'file', pathname: '/reservations.html' });
  assert.equal(resolvePlatformRequest(config.origin + '/reservas/?intento=' + id('1')).destination, '/reservas?intento=' + id('1'));
  assert.equal(platformCanonicalPath('reservations.html'), '/reservas');
  assert.deepEqual(resolvePlatformRequest(config.origin + '/?passport=stand16'), { type: 'file', pathname: '/index.html' });
  const vercel = JSON.parse(await fs.readFile(new URL('../vercel.json', import.meta.url)));
  assert.equal(vercel.routes.find(route => route.src === '^/reservas$').dest, '/reservations.html');
  assert.equal(vercel.routes.find(route => route.src === '^/api/reservations(?:/.*)?$').dest, '/api/reservations.js');
});
