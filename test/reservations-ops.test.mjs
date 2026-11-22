import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as sdk from '@stellar/stellar-sdk';
import { signAuthEntry as kitSignAuthEntry } from '../node_modules/smart-account-kit/dist/kit/webauthn-ops.js';
import { PINS, createPlan, validatePlan, attachSimulation, assertSigningPolicy, validateSignedExport, parseBoundedJson } from '../dist/reservations-operator-core.mjs';
import { createOperatorController } from '../dist/reservations-operator-wallet.mjs';
import { OPERATOR_POLICY } from '../dist/reservations-operator-policy.mjs';
import { run } from '../scripts/reservations-ops.mjs';
const { xdr, Address, StrKey } = sdk;
const id = n => n.repeat(64);
const address = n => StrKey.encodeContract(Buffer.alloc(32, n));
const now = Date.parse('2026-11-13T12:00:00Z');
const input = (kind = 'bootstrap') => ({ kind, intentId: id('a'), sourceSha: 'b'.repeat(40), hostAddress: address(1), projectId: id('c'), ...(kind === 'bootstrap' ? { salt: id('d') } : { contractId: address(4), offers: [id('e')] }) });
const browser = { isSecureContext: true, navigator: { credentials: {} }, PublicKeyCredential: class {}, location: { origin: PINS.origin, hostname: PINS.rpId } };
const enc = value => value.toXDR('base64');
const clone = value => structuredClone(value);
function capture(plan) {
  const func = xdr.HostFunction.fromXDR(plan.func, 'base64');
  const child = new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({ contractAddress: new Address(plan.contractId).toScAddress(), functionName: '__constructor', args: [xdr.ScVal.scvBytes(Buffer.from(plan.projectId, 'hex')), new Address(plan.hostAddress).toScVal()] })), subInvocations: [] });
  const root = new xdr.SorobanAuthorizedInvocation({ function: plan.kind === 'bootstrap' ? xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeCreateContractV2HostFn(func.createContractV2()) : xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(func.invokeContract()), subInvocations: plan.kind === 'bootstrap' ? [child] : [] });
  const entry = new xdr.SorobanAuthorizationEntry({ credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({ address: new Address(plan.hostAddress).toScAddress(), nonce: xdr.Int64.fromString('123'), signatureExpirationLedger: 0, signature: xdr.ScVal.scvVoid() })), rootInvocation: root });
  return { intentId: plan.intentId, func: plan.func, networkPassphrase: PINS.networkPassphrase, observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 120000).toISOString(), coverageId: 'fixture-coverage', result: { latestLedger: 1000, minResourceFee: '100', transactionData: enc(new sdk.SorobanDataBuilder().setResourceFee('100').build()), results: [{ auth: [enc(entry)] }] } };
}
async function prepared(kind = 'bootstrap') { const plan = await createPlan(sdk, input(kind)); return attachSimulation(sdk, plan, capture(plan), now); }
function policy(plan) { return { ...OPERATOR_POLICY, enabled: true, ...Object.fromEntries(['sourceSha', 'hostAddress', 'projectId', 'contractId', 'configFingerprint'].map(key => [key, plan[key]])), coverageId: plan.simulation.coverageId, coverageVerifiedUntil: new Date(now + 3600000).toISOString(), zeroAdditionalSpend: true, platformHardCapsVerified: true, maxResourceFeeStroops: '100' }; }
function signerKit(plan, calls, changes = {}) {
  const credentialId = 'ZmFrZS1jcmVkZW50aWFs';
  const signer = { tag: 'External', values: [PINS.webauthnVerifierAddress, Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1), Buffer.from(credentialId, 'base64url')])] };
  const kit = { contractId: plan.hostAddress, credentialId,
    async connectWallet() { calls.connect++; return { contractId: this.contractId }; },
    async signAuthEntry(entry, options) {
      calls.sign++;
      return kitSignAuthEntry({ rpId: PINS.rpId, networkPassphrase: PINS.networkPassphrase,
        requireWallet: () => ({ wallet: {}, contractId: this.contractId }), resolveAuthDigestScheme: async () => 'preimage-v1',
        storage: { async update() {} },
        webAuthn: { async startAuthentication({ optionsJSON }) {
          calls.webauthn++; assert.equal(optionsJSON.rpId, PINS.rpId); assert.equal(optionsJSON.userVerification, 'required'); assert.equal(optionsJSON.allowCredentials[0].id, credentialId); assert.match(optionsJSON.challenge, /^[A-Za-z0-9_-]{43}$/);
          // Deterministic fake authenticator response; never a real user ceremony.
          return { id: credentialId, response: { signature: Buffer.from('3006020101020102', 'hex').toString('base64url'), authenticatorData: Buffer.alloc(37).toString('base64url'), clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: optionsJSON.challenge, origin: PINS.origin })).toString('base64url') } };
        } },
      }, entry, { ...options, signer });
    },
    signAndSubmit() { throw Error('Forbidden transmission'); }, createWallet() { throw Error('Forbidden wallet creation'); }, ...changes };
  return kit;
}
const fakeSdk = () => ({ ...sdk, IndexedDBStorage: class {} });

test('bootstrap derives a deterministic C address and exact create/constructor args using real XDR', async () => {
  const plan = await createPlan(sdk, input());
  assert.deepEqual(await createPlan(sdk, input()), plan);
  assert.notEqual((await createPlan(sdk, { ...input(), salt: id('e') })).contractId, plan.contractId);
  const func = xdr.HostFunction.fromXDR(plan.func, 'base64').createContractV2();
  assert.equal(Address.fromScAddress(func.contractIdPreimage().fromAddress().address()).toString(), plan.hostAddress);
  assert.equal(func.executable().wasmHash().toString('hex'), PINS.wasmHash);
  assert.equal(func.constructorArgs().length, 2);
  assert.equal(await validatePlan(sdk, plan), plan);
  await assert.rejects(createPlan(sdk, { ...input(), hostAddress: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3)) }));
  await assert.rejects(createPlan(sdk, { ...input(), privateKey: 'not-accepted' }));
  for (const offers of ['', { length: 0 }, null]) await assert.rejects(createPlan(sdk, { ...input(), offers }));
});
test('plan rejects changes to network origin WASM SHA host project salt function and fingerprint', async () => {
  const plan = await createPlan(sdk, input());
  for (const [key, value] of Object.entries({ network: 'stellar:pubnet', origin: 'https://elsewhere.invalid', rpId: 'elsewhere.invalid', wasmHash: id('e'), accountWasmHash: id('e'), sourceSha: 'e'.repeat(40), hostAddress: address(7), projectId: id('e'), salt: id('e'), func: '', configFingerprint: id('e'), contractId: address(8) })) await assert.rejects(validatePlan(sdk, { ...plan, [key]: value }));
  assert.throws(() => parseBoundedJson(' '.repeat(262145)));
});
test('maintenance is bounded to distinct IDs and never changes holder or creates availability', async () => {
  for (const count of [0, 20]) { const value = await createPlan(sdk, { ...input('maintain'), offers: Array.from({ length: count }, (_, n) => n.toString(16).padStart(64, '0')) }); assert.equal(xdr.HostFunction.fromXDR(value.func, 'base64').invokeContract().args()[0].vec().length, count); }
  for (const offers of [[id('e'), id('e')], Array(21).fill(id('e')), ['invalid']]) await assert.rejects(createPlan(sdk, { ...input('maintain'), offers }));
});
test('capture preserves the RPC nonce and accepts only the exact C create+constructor auth tree', async () => {
  const plan = await createPlan(sdk, input()), valid = capture(plan);
  const reviewed = await attachSimulation(sdk, plan, valid, now);
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(reviewed.simulation.auth[0], 'base64');
  assert.equal(entry.credentials().address().nonce().toString(), '123'); assert.equal(entry.credentials().address().signatureExpirationLedger(), 1036);
  for (const mutate of [e => e.rootInvocation().subInvocations([]), e => e.rootInvocation().subInvocations([e.rootInvocation().subInvocations()[0], e.rootInvocation().subInvocations()[0]]), e => e.rootInvocation().subInvocations()[0].function().contractFn().functionName('transfer'), e => e.credentials().address().address(new Address(address(9)).toScAddress())]) {
    const bad = clone(valid), e = xdr.SorobanAuthorizationEntry.fromXDR(bad.result.results[0].auth[0], 'base64'); mutate(e); bad.result.results[0].auth = [enc(e)]; await assert.rejects(attachSimulation(sdk, plan, bad, now));
  }
  await assert.rejects(attachSimulation(sdk, plan, { ...valid, func: 'changed' }, now));
  await assert.rejects(attachSimulation(sdk, plan, { ...valid, result: { ...valid.result, restorePreamble: {} } }, now));
  await assert.rejects(validatePlan(sdk, reviewed, now + 120001));
});
test('disabled policy, wrong host, expired coverage, fees and insecure origins prevent every connection', async () => {
  const plan = await prepared();
  for (const p of [OPERATOR_POLICY, { ...policy(plan), hostAddress: address(9) }, { ...policy(plan), zeroAdditionalSpend: false }, { ...policy(plan), maxResourceFeeStroops: '99' }, { ...policy(plan), coverageVerifiedUntil: new Date(now - 1).toISOString() }]) {
    let created = 0; const controller = createOperatorController({ sdk: fakeSdk(), policy: p, browser, now: () => now, makeKit: () => { created++; throw Error('Must not connect'); } }); await controller.load(plan); await assert.rejects(controller.connect()); assert.equal(created, 0);
  }
  await assert.rejects(assertSigningPolicy(sdk, plan, policy(plan), { ...browser, location: { origin: 'https://elsewhere.invalid', hostname: 'elsewhere.invalid' } }, now));
});
test('real SDK signing with mocked WebAuthn exports exact C authorization without submit or wallet creation', async () => {
  for (const kind of ['bootstrap', 'maintain']) {
    const plan = await prepared(kind), calls = { connect: 0, sign: 0, webauthn: 0 };
    const controller = createOperatorController({ sdk: fakeSdk(), policy: policy(plan), browser, now: () => now, makeKit: () => signerKit(plan, calls) });
    await controller.load(plan); await assert.rejects(controller.sign()); assert.equal(calls.webauthn, 0);
    await controller.connect(); assert.equal(calls.webauthn, 0);
    const exported = await controller.sign(); assert.deepEqual(calls, { connect: 1, sign: 1, webauthn: 1 });
    assert.equal((await validateSignedExport(sdk, plan, exported, now)).status, 'STRUCTURE_VALID_SIGNATURE_UNVERIFIED');
    assert.deepEqual(controller.export(), exported); await assert.rejects(controller.sign());
    const changed = clone(exported), entry = xdr.SorobanAuthorizationEntry.fromXDR(changed.auth[0], 'base64'); entry.credentials().address().nonce(xdr.Int64.fromString('124')); changed.auth[0] = enc(entry); await assert.rejects(validateSignedExport(sdk, plan, changed, now));
  }
});
test('wrong connected wallet and expiration during the ceremony cannot export', async () => {
  const plan = await prepared(), calls = { connect: 0, sign: 0, webauthn: 0 }; let time = now;
  const wrong = createOperatorController({ sdk: fakeSdk(), policy: policy(plan), browser, now: () => time, makeKit: () => signerKit(plan, calls, { contractId: address(9) }) }); await wrong.load(plan); await assert.rejects(wrong.connect()); await assert.rejects(wrong.sign()); assert.equal(calls.sign, 0);
  const expired = createOperatorController({ sdk: fakeSdk(), policy: policy(plan), browser, now: () => time, makeKit: () => { const kit = signerKit(plan, calls); const sign = kit.signAuthEntry.bind(kit); kit.signAuthEntry = async (...args) => { const result = await sign(...args); time += 120001; return result; }; return kit; } });
  await expired.load(plan); await expired.connect(); await assert.rejects(expired.sign()); assert.throws(() => expired.export());
});
test('archival metadata is preserved and requires a separate maintenance-only approval', async () => {
  const plan = await createPlan(sdk, input('maintain')), raw = capture(plan);
  const data = xdr.SorobanTransactionData.fromXDR(raw.result.transactionData, 'base64');
  data.resources().footprint().readWrite([xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({ contract: new Address(plan.contractId).toScAddress(), key: xdr.ScVal.scvLedgerKeyContractInstance(), durability: xdr.ContractDataDurability.persistent() }))]);
  data.ext(new xdr.SorobanTransactionDataExt(1, new xdr.SorobanResourcesExtV0({ archivedSorobanEntries: [0] }))); raw.result.transactionData = enc(data);
  const reviewed = await attachSimulation(sdk, plan, raw, now); assert.equal(reviewed.simulation.restorationRequired, true);
  await assert.rejects(assertSigningPolicy(sdk, reviewed, policy(reviewed), browser, now));
  await assertSigningPolicy(sdk, reviewed, { ...policy(reviewed), allowRestoration: true }, browser, now);
  for (const indices of [[1], [0, 0]]) { data.ext(new xdr.SorobanTransactionDataExt(1, new xdr.SorobanResourcesExtV0({ archivedSorobanEntries: indices }))); await assert.rejects(attachSimulation(sdk, plan, { ...raw, result: { ...raw.result, transactionData: enc(data) } }, now)); }
});
test('offline CLI rejects another WASM and never consumes environment/provider configuration', async () => {
  const io = { async read(name) { return name === 'input' ? JSON.stringify(input()) : Buffer.from('wrong wasm'); } };
  await assert.rejects(run(['bootstrap', 'input', 'wasm'], io), /WASM/);
  const plan = await createPlan(sdk, input()); const report = await run(['check', 'plan'], { read: async () => JSON.stringify(plan) }); assert.equal(report.status, 'DRAFT_NOT_SIGNABLE'); assert.equal(report.externalEvidenceVerified, false);
  for (const file of ['../scripts/reservations-ops.mjs', '../dist/reservations-operator-wallet.mjs', '../dist/reservations-operator-page.mjs']) { const source = await readFile(new URL(file, import.meta.url), 'utf8'); assert.doesNotMatch(source, /fetch\(|sendTransaction\(|signAndSubmit\(|process\.env|createWallet\(/); }
});

test('malformed JSON never exposes file content through CLI or page errors', async () => {
  const marker = 'PRIVATE_FIXTURE_NOT_A_CREDENTIAL';
  assert.throws(() => parseBoundedJson('{"private":"' + marker + '" broken}'), error => error.message === 'El archivo no contiene JSON válido.' && !error.message.includes(marker));
  await assert.rejects(run(['check', 'malformed'], { read: async () => '{' + marker }), error => !error.message.includes(marker));
});

test('concurrent clicks or file replacement cannot create multiple ceremonies', async () => {
  const plan = await prepared(), calls = { connect: 0, sign: 0, webauthn: 0 };
  const controller = createOperatorController({ sdk: fakeSdk(), policy: policy(plan), browser, now: () => now, makeKit: () => signerKit(plan, calls) });
  await controller.load(plan);
  const connecting = controller.connect(); await assert.rejects(controller.connect()); await assert.rejects(controller.load(plan)); await connecting;
  const signing = controller.sign(); await assert.rejects(controller.sign()); await assert.rejects(controller.load(plan)); await signing;
  assert.deepEqual(calls, { connect: 1, sign: 1, webauthn: 1 });
});
