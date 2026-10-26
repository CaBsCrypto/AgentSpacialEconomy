import test from 'node:test';
import assert from 'node:assert/strict';
import * as sdk from '@stellar/stellar-sdk';
import { createWalletProvider } from '../dist/wallet-provider.mjs';
import { TESTNET_PASSPHRASE } from '../dist/wallet-controller.mjs';

const address = sdk.StrKey.encodeContract(Buffer.alloc(32, 7));
const token = sdk.StrKey.encodeContract(Buffer.alloc(32, 8));
const hash = 'ab'.repeat(32);
const config = { networkPassphrase: TESTNET_PASSPHRASE, rpcUrl: 'https://soroban-testnet.stellar.org', accountWasmHash: hash, webauthnVerifierAddress: token, tokenContract: token, rpId: 'one16.example', relayerUrl: '/api/wallet/relay' };
const browser = { isSecureContext: true, navigator: { credentials: {} }, PublicKeyCredential: function(){}, location: { hostname: 'one16.example' } };

function fixture({ session = null, pending = [], submitSuccess = true, chainHash = hash, simulationError = false, existingContract = false, transactionStatus = 'NOT_FOUND', ledgerError = false } = {}) {
  const calls = [], sessions = [], listeners = new Map(), credentials = new Map(pending.map(value => [value.credentialId, value]));
  class Storage {
    saveSession(value) { sessions.push(value); return Promise.resolve(); }
    async get(id) { return credentials.get(id); }
    async update(id, patch) { calls.push(['update', id, patch]); credentials.set(id, { ...credentials.get(id), ...patch }); }
  }
  class Kit {
    contractId = address;
    constructor(value) { calls.push(['config', value]); }
    events = { on(name, callback) { listeners.set(name, callback); return () => listeners.delete(name); } };
    credentials = {
      getPending: async () => pending,
      deploy: async (id, options) => { calls.push(['deploy', id, options]); return { contractId: address, submitResult: { success: submitSuccess, error: { code: 'relay_failure' } } }; },
    };
    connectWallet(options) { calls.push(['connect', options]); return Promise.resolve(options?.fresh || options?.credentialId ? { contractId: address } : session); }
    createWallet(...args) {
      calls.push(['create', ...args]);
      const credential = { credentialId: 'new-credential', contractId: address, isPrimary: true, deploymentStatus: 'pending' };
      credentials.set(credential.credentialId, credential); listeners.get('credentialCreated')?.({ credential });
      return Promise.resolve({ contractId: address, submitResult: { success: submitSuccess, error: { code: 'relay_failure' } } });
    }
  }
  class Server {
    async getTransaction(hash) { calls.push(['transaction', hash]); return { status: transactionStatus, ledger: 123 }; }
    async getLedgerEntries(key) { calls.push(['footprint', key]); if (ledgerError) throw new TypeError('RPC disconnected'); return { entries: existingContract ? [{}] : [] }; }
    async getContractData(id, key) {
      calls.push(['instance', id, key.switch().name]);
      return { val: { contractData: () => ({ val: () => ({ instance: () => ({ executable: () => ({ switch: () => ({ name: 'contractExecutableWasm' }), wasmHash: () => Buffer.from(chainHash, 'hex') }) }) }) }) } };
    }
    async simulateTransaction(tx) {
      calls.push(['simulate', tx]);
      return simulationError ? { error: 'offline' } : { result: { retval: sdk.nativeToScVal(1000000000n, { type: 'i128' }) } };
    }
  }
  return { calls, sessions, credentials, options: { browser, loadKit: async () => ({ ...sdk, SmartAccountKit: Kit, IndexedDBStorage: Storage, rpc: { Server } }) } };
}

test('provider uses IndexedDB, silent restore and no private Stellar deployer secret', async () => {
  const f = fixture();
  const provider = await createWalletProvider(config, f.options);
  assert.equal(await provider.restore(), null);
  const configured = f.calls.find(call => call[0] === 'config')[1];
  assert.equal(configured.networkPassphrase, TESTNET_PASSPHRASE);
  assert.equal(configured.relayerUrl, '/api/wallet/relay');
  assert.equal(configured.deployerSecret, undefined);
  assert.equal(f.calls.filter(call => call[0] === 'create').length, 0);
  assert.equal(f.calls.find(call => call[0] === 'connect')[1], undefined);
});

test('provider requires successful confirmed deployment before returning a new wallet address', async () => {
  const f = fixture({ submitSuccess: false }), provider = await createWalletProvider(config, f.options), progress = [];
  await provider.restore();
  await assert.rejects(provider.create({ onState: state => progress.push(state) }), error => error.code === 'relay_failure');
  assert.equal(provider.hasPendingDeployment, true);
  assert.deepEqual(progress, ['deploying']);
  assert.equal(f.calls.filter(call => call[0] === 'create').length, 1);
  await assert.rejects(provider.create(), error => error.code === 'relay_failure');
  assert.equal(f.calls.filter(call => call[0] === 'create').length, 1, 'retry reuses the existing passkey');
  assert.equal(f.calls.filter(call => call[0] === 'deploy').length, 1);
});

test('a pending wallet recovered after reload resumes the same deterministic deployment', async () => {
  const f = fixture({ pending: [{ credentialId: 'existing', isPrimary: true, deploymentStatus: 'failed', createdAt: 10 }] });
  const provider = await createWalletProvider(config, f.options);
  assert.deepEqual(await provider.restore(), { pendingDeployment: true });
  const result = await provider.create();
  assert.deepEqual(result, { address });
  assert.equal(f.calls.filter(call => call[0] === 'create').length, 0);
  assert.equal(f.calls.find(call => call[0] === 'deploy')[1], 'existing');
  assert.equal(f.sessions[0].credentialId, 'existing');
  assert.equal(f.sessions[0].contractId, address);
});

test('an explicit connect requests a fresh ownership-authenticated passkey immediately', async () => {
  const f = fixture(), provider = await createWalletProvider(config, f.options);
  const result = provider.connect();
  assert.deepEqual(f.calls.find(call => call[0] === 'connect')[1], { fresh: true });
  assert.deepEqual(await result, { address });
});

test('balance reads verify the wallet WASM and simulate the locked SAC balance on Testnet', async () => {
  const f = fixture(), provider = await createWalletProvider(config, f.options);
  const chain = await provider.readWallet(address);
  assert.deepEqual(chain, { deployed: true, balanceUnits: '1000000000' });
  assert.equal(f.calls.find(call => call[0] === 'instance')[2], 'scvLedgerKeyContractInstance');
  const tx = f.calls.find(call => call[0] === 'simulate')[1];
  assert.equal(tx.networkPassphrase, TESTNET_PASSPHRASE);
  assert.equal(tx.operations[0].type, 'invokeHostFunction');
  const invoked = tx.operations[0].func.invokeContract();
  assert.equal(sdk.Address.fromScAddress(invoked.contractAddress()).toString(), token);
  assert.equal(invoked.functionName().toString(), 'balance');
  assert.equal(sdk.scValToNative(invoked.args()[0]), address);
});

test('unaccepted wallet code and failed balance simulations cannot pass verification', async () => {
  const mismatch = fixture({ chainHash: 'cd'.repeat(32) }), a = await createWalletProvider(config, mismatch.options);
  await assert.rejects(a.readWallet(address), error => error.code === 'wallet_code_mismatch');
  assert.equal(mismatch.calls.filter(call => call[0] === 'simulate').length, 0);
  const offline = fixture({ simulationError: true }), b = await createWalletProvider(config, offline.options);
  await assert.rejects(b.readWallet(address), /comprobar el saldo/);
});

test('insecure origins, mismatched relying-party domains and mainnet fail before loading SDK', async () => {
  let imports = 0;
  const options = { browser: { ...browser, isSecureContext: false }, loadKit: () => { imports++; } };
  await assert.rejects(createWalletProvider(config, options), error => error.code === 'passkey_unavailable');
  await assert.rejects(createWalletProvider(config, { ...options, browser: { ...browser, location: { hostname: 'another.example' } } }), error => error.code === 'wrong_origin');
  await assert.rejects(createWalletProvider({ ...config, networkPassphrase: sdk.Networks.PUBLIC }, { ...options, browser }), error => error.code === 'wrong_network');
  assert.equal(imports, 0);
});

test('vendored browser ESM loads with its Buffer shim without global Buffer injection', async () => {
  const original = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined;
    const bundle = await import('../dist/vendor/wallet/kit.mjs?without-global-buffer');
    assert.equal(typeof bundle.SmartAccountKit, 'function');
    assert.equal(typeof bundle.IndexedDBStorage, 'function');
    assert.equal(bundle.StrKey.isValidContract(address), true);
    const kit = new bundle.SmartAccountKit({ ...config, storage: {}, indexerUrl: false });
    assert.match(kit.deployerPublicKey, /^G/);
  } finally { globalThis.Buffer = original; }
});



test('canonical origin is exact even when a subdomain could technically use the same RP id', async () => {
  let loaded = false;
  await assert.rejects(createWalletProvider({ ...config, origin: 'https://one16.example' }, {
    browser: { ...browser, location: { hostname: 'www.one16.example', origin: 'https://www.one16.example' } },
    loadKit: async () => { loaded = true; },
  }), error => error.code === 'wrong_origin');
  assert.equal(loaded, false);
});


test('a late confirmed deployment resumes the stored passkey through SDK ownership checks without redeploying', async () => {
  const credential = { credentialId: 'late', contractId: address, isPrimary: true, deploymentStatus: 'pending', deploymentTransactionHash: 'ab'.repeat(32), birthConstructorArgsHash: 'cd'.repeat(32), createdAt: 1 };
  const f = fixture({ pending: [credential], transactionStatus: 'SUCCESS' }), provider = await createWalletProvider(config, f.options);
  await provider.restore(); assert.deepEqual(await provider.create(), { address });
  assert.equal(provider.hasPendingDeployment, false);
  assert.equal(f.calls.filter(call => call[0] === 'create' || call[0] === 'deploy').length, 0);
  assert.deepEqual(f.calls.find(call => call[0] === 'connect' && call[1]?.credentialId)[1], { credentialId: 'late', contractId: address });
  assert.equal(f.credentials.get('late').creationTransactionHash, credential.deploymentTransactionHash);
  assert.equal(f.credentials.get('late').creationLedger, 123);
});

test('an unresolved known deployment hash stays pending without another relay submission', async () => {
  const f = fixture({ pending: [{ credentialId: 'unknown', contractId: address, isPrimary: true, deploymentStatus: 'pending', deploymentTransactionHash: 'ab'.repeat(32), createdAt: 1 }] });
  const provider = await createWalletProvider(config, f.options); await provider.restore();
  await assert.rejects(provider.create(), error => error.code === 'deployment_pending');
  assert.equal(provider.hasPendingDeployment, true); assert.equal(f.calls.filter(call => call[0] === 'deploy').length, 0);
});

test('existing occupied chain state reconnects only a local approved constructor and never redeploys', async () => {
  const credential = { credentialId: 'existing', contractId: address, isPrimary: true, deploymentStatus: 'failed', birthConstructorArgsHash: 'cd'.repeat(32), createdAt: 1 };
  const f = fixture({ pending: [credential], existingContract: true }), provider = await createWalletProvider(config, f.options);
  await provider.restore(); assert.deepEqual(await provider.create(), { address });
  assert.equal(f.calls.filter(call => call[0] === 'deploy').length, 0);
  assert.ok(f.calls.find(call => call[0] === 'connect' && call[1]?.credentialId === 'existing'));
  const unverified = fixture({ pending: [{ ...credential, birthConstructorArgsHash: undefined }], existingContract: true });
  const other = await createWalletProvider(config, unverified.options); await other.restore();
  await assert.rejects(other.create(), error => error.code === 'wallet_provenance_pending');
  assert.equal(unverified.calls.filter(call => call[0] === 'deploy' || call[1]?.credentialId).length, 0);
});

test('resume reads the latest persisted credential and an RPC outage cannot authorize redeployment', async () => {
  const credential = { credentialId: 'latest', contractId: address, isPrimary: true, deploymentStatus: 'failed', createdAt: 1 };
  const f = fixture({ pending: [credential] }), provider = await createWalletProvider(config, f.options); await provider.restore();
  f.credentials.set('latest', { ...credential, deploymentStatus: 'occupied' });
  await assert.rejects(provider.create(), error => error.code === 'wallet_provenance_pending'); assert.equal(f.calls.filter(call => call[0] === 'deploy').length, 0);
  const offline = fixture({ pending: [credential], ledgerError: true }), other = await createWalletProvider(config, offline.options); await other.restore();
  await assert.rejects(other.create(), /RPC disconnected/); assert.equal(offline.calls.filter(call => call[0] === 'deploy').length, 0);
});

test('a definitely failed transaction with no contract can retry the same credential deployment', async () => {
  const f = fixture({ pending: [{ credentialId: 'failed', contractId: address, isPrimary: true, deploymentStatus: 'failed', deploymentTransactionHash: 'ab'.repeat(32), createdAt: 1 }], transactionStatus: 'FAILED' });
  const provider = await createWalletProvider(config, f.options); await provider.restore(); assert.deepEqual(await provider.create(), { address });
  assert.equal(f.calls.filter(call => call[0] === 'create').length, 0); assert.equal(f.calls.find(call => call[0] === 'deploy')[1], 'failed');
});
