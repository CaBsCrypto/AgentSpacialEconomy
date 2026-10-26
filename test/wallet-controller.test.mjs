import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalletController, TESTNET_PASSPHRASE, formatWalletBalance } from '../dist/wallet-controller.mjs';

const address = 'C' + 'A'.repeat(55);
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function fixture({ restored = null, balance = '0', claim = { state: 'none' }, onPost, create, enabled = true, network = TESTNET_PASSPHRASE, deployed = true } = {}) {
  const calls = [], metrics = [], state = { balance, claim, creates: 0, connects: 0, reads: 0, loads: 0, restored: 0, restoredSession: restored, config: { enabled, networkPassphrase: network, accountWasmHash: 'wasm' } };
  const provider = {
    restore: async () => { state.restored++; return state.restoredSession; },
    create(options) { state.creates++; options?.onState?.('deploying'); return create ? create() : Promise.resolve({ address }); },
    connect() { state.connects++; return Promise.resolve({ address }); },
    readWallet: async () => { state.reads++; return { deployed, balanceUnits: state.balance }; },
  };
  const fetcher = async (url, options) => {
    calls.push({ url, method: options?.method || 'GET', body: options?.body });
    if (url === '/api/wallet/config') { if (state.configReadError) throw state.configReadError; return reply({ ...state.config }); }
    if (url === '/api/wallet/faucet' && options?.method !== 'POST') return reply({ available: true, claimAmount: 100 });
    if (options?.method === 'POST') {
      if (onPost) return onPost(state, options);
      state.claim = { state: 'confirmed', hash: 'receipt' };
      state.balance = '1000000000';
      return reply(state.claim);
    }
    return reply(state.claim);
  };
  const controller = createWalletController({ fetcher, loadProvider: async () => { state.loads++; return provider; }, pollAttempts: 0, sleep: async () => {}, now: () => calls.length * 10, onMetric: value => metrics.push(value) });
  return { controller, state, calls, metrics, provider, posts: () => calls.filter(call => call.method === 'POST') };
}

test('preparation and silent restore never create a passkey, deploy or request funds', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.controller.prepare(), f.controller.prepare()]);
  assert.equal(a.prepared, true); assert.equal(b.prepared, true);
  assert.equal(f.state.loads, 1); assert.equal(f.state.restored, 1);
  assert.equal(f.state.creates, 0); assert.equal(f.state.connects, 0); assert.equal(f.posts().length, 0);
  assert.equal(f.controller.state.status, 'available');
});

test('a cold first click prepares only; the next tap starts WebAuthn synchronously', async () => {
  const grant = deferred(), f = fixture({ create: () => grant.promise });
  await f.controller.ensureWalletReady();
  assert.equal(f.state.creates, 0); assert.equal(f.controller.state.requiresAction, true);
  const pending = f.controller.ensureWalletReady();
  assert.equal(f.state.creates, 1, 'ceremony begins before the method returns');
  assert.equal(f.controller.state.status, 'deploying');
  grant.resolve({ address });
  assert.equal((await pending).status, 'ready');
  assert.equal(f.posts().length, 1);
});

test('a double tap shares deployment and funding, then chain balance confirms readiness', async () => {
  const grant = deferred(), f = fixture({ create: () => grant.promise });
  await f.controller.prepare();
  const first = f.controller.ensureWalletReady(), second = f.controller.ensureWalletReady();
  assert.equal(first, second); assert.equal(f.state.creates, 1);
  grant.resolve({ address });
  const result = await first;
  assert.equal(result.status, 'ready'); assert.equal(result.balance, '100'); assert.equal(result.receipt, 'receipt');
  assert.equal(f.posts().length, 1); assert.deepEqual(JSON.parse(f.posts()[0].body), { address });
  assert.ok(f.metrics.some(metric => metric.name === 'activation'));
});

test('an existing funded session is reused without prompting or refilling', async () => {
  const f = fixture({ restored: { address }, balance: '25000000' });
  await f.controller.prepare(); assert.equal(f.controller.state.status, 'ready');
  await f.controller.ensureWalletReady();
  assert.equal(f.state.creates, 0); assert.equal(f.state.connects, 0); assert.equal(f.posts().length, 0);
  assert.equal(f.controller.state.balance, '2.5');
});

test('cancelling the passkey leaves the experience retryable and never claims', async () => {
  let attempts = 0;
  const f = fixture({ create: () => ++attempts === 1 ? Promise.reject(new DOMException('User cancelled', 'NotAllowedError')) : Promise.resolve({ address }) });
  await f.controller.prepare(); await f.controller.ensureWalletReady();
  assert.equal(f.controller.state.status, 'available'); assert.equal(f.controller.state.error.cancelled, true); assert.equal(f.posts().length, 0);
  await f.controller.ensureWalletReady(); assert.equal(f.controller.state.status, 'ready');
});

test('deployment must exist before requesting USDC', async () => {
  const f = fixture({ deployed: false });
  await f.controller.prepare(); await f.controller.ensureWalletReady();
  assert.equal(f.controller.state.status, 'error'); assert.equal(f.controller.state.error.code, 'deployment_pending');
  assert.equal(f.posts().length, 0);
});

test('pending or unknown claims reconcile without ever posting again, including explicit retry', async () => {
  for (const state of ['pending', 'unknown']) {
    const f = fixture({ restored: { address }, claim: { state } });
    await f.controller.prepare(); await f.controller.ensureWalletReady(); await f.controller.retryFunding(); await f.controller.refresh();
    assert.equal(f.controller.state.status, 'pending'); assert.equal(f.posts().length, 0);
    f.state.balance = '1000000000'; await f.controller.refresh();
    assert.equal(f.controller.state.status, 'ready');
  }
});

test('successful faucet JSON alone cannot mark the wallet ready', async () => {
  const f = fixture({ claim: { state: 'confirmed', hash: 'upstream-hash', balance: '100' } });
  await f.controller.prepare(); await f.controller.ensureWalletReady();
  assert.equal(f.controller.state.status, 'pending'); assert.equal(f.controller.state.balance, '0'); assert.equal(f.posts().length, 0);
});

test('a claim timeout is reconciled on the next action without duplicate claims', async () => {
  const f = fixture({ onPost: async state => { state.claim = { state: 'unknown' }; throw new TypeError('network disconnected'); } });
  await f.controller.prepare(); await f.controller.ensureWalletReady();
  assert.equal(f.controller.state.status, 'error'); assert.equal(f.posts().length, 1);
  await f.controller.ensureWalletReady(); assert.equal(f.controller.state.status, 'pending'); assert.equal(f.posts().length, 1);
  f.state.balance = '1000000000'; await f.controller.refresh();
  assert.equal(f.controller.state.status, 'ready');
});

test('cooldown is shown without automatic retries; a definitive failure needs explicit retry', async () => {
  const f = fixture({ restored: { address }, claim: { state: 'failed', reason: 'user_cooldown', nextAvailableAt: '2099-01-01T00:00:00Z', message: 'Vuelve a intentar más tarde.' } });
  await f.controller.prepare(); await f.controller.ensureWalletReady();
  assert.equal(f.controller.state.error.code, 'user_cooldown'); assert.equal(f.controller.state.nextAvailableAt, '2099-01-01T00:00:00Z');
  assert.equal(f.posts().length, 0);
  f.state.claim = { state: 'failed', reason: 'upstream_error' };
  await f.controller.retryFunding();
  assert.equal(f.posts().length, 1); assert.equal(JSON.parse(f.posts()[0].body).retry, true);
});

test('wrong networks and unavailable configuration never import signing code', async () => {
  const wrong = fixture({ network: 'Public Global Stellar Network ; September 2015' });
  await wrong.controller.prepare(); assert.equal(wrong.controller.state.error.code, 'wrong_network'); assert.equal(wrong.state.loads, 0);
  const unavailable = fixture({ enabled: false });
  await unavailable.controller.prepare(); assert.equal(unavailable.controller.state.status, 'unavailable'); assert.equal(unavailable.state.loads, 0);
});

test('explicit connect uses the same funded flow and state observers can unsubscribe', async () => {
  const f = fixture(), states = [];
  const stop = f.controller.subscribe(state => states.push(state.status));
  await f.controller.prepare(); await f.controller.connect();
  assert.equal(f.state.connects, 1); assert.equal(f.state.creates, 0); assert.equal(f.controller.state.status, 'ready');
  stop(); const count = states.length; await f.controller.refresh(); assert.equal(states.length, count);
});

test('USDC formatting retains seven-decimal precision without floating point conversion', () => {
  assert.equal(formatWalletBalance('1000000000'), '100');
  assert.equal(formatWalletBalance('1234567890123456789'), '123456789012.3456789');
  assert.equal(formatWalletBalance('1'), '0.0000001');
});


test('relay or network rejection is reported as an error rather than passkey cancellation', async () => {
  const f = fixture({ create: () => Promise.reject(Object.assign(new Error('Relay request denied'), { code: 'relay_denied' })) });
  await f.controller.prepare(); await f.controller.ensureWalletReady();
  assert.equal(f.controller.state.status, 'error');
  assert.equal(f.controller.state.error.cancelled, false);
  assert.equal(f.posts().length, 0);
});


test('readonly configuration refresh reuses the prepared provider when public identity is unchanged', async () => {
  const f = fixture({ restored: { address }, balance: '1000000000' });
  await f.controller.prepare();
  const beforeReads = f.state.reads;
  await f.controller.refreshConfiguration();
  assert.equal(f.state.loads, 1); assert.equal(f.state.restored, 1); assert.equal(f.state.reads, beforeReads);
  assert.equal(f.controller.state.address, address); assert.equal(f.controller.state.status, 'ready');
  assert.equal(f.posts().length, 0); assert.equal(f.state.creates, 0); assert.equal(f.state.connects, 0);
  assert.equal(f.calls.filter(call => call.url === '/api/wallet/config').length, 2);
});

test('changed public identity clears old in-memory balance and restores through a new provider without writes', async () => {
  const f = fixture({ restored: { address }, balance: '1000000000' });
  f.state.config.configFingerprint = 'old-domain-configuration';
  await f.controller.prepare();
  f.state.restoredSession = null;
  f.state.config = { ...f.state.config, configFingerprint: 'new-domain-configuration', origin: 'https://agenticreality.space', rpId: 'agenticreality.space' };
  await f.controller.refreshConfiguration();
  assert.equal(f.state.loads, 2); assert.equal(f.state.restored, 2);
  assert.equal(f.controller.state.config.origin, 'https://agenticreality.space');
  assert.equal(f.controller.state.address, null); assert.equal(f.controller.state.balance, '0'); assert.equal(f.controller.state.receipt, null);
  assert.equal(f.controller.state.status, 'available');
  assert.equal(f.posts().length, 0); assert.equal(f.state.creates, 0); assert.equal(f.state.connects, 0);
});

test('new configuration waits for the current passkey and funding operation, then removes stale results', async () => {
  const grant = deferred(), f = fixture({ create: () => grant.promise });
  f.state.config.configFingerprint = 'generation-one';
  await f.controller.prepare();
  const active = f.controller.ensureWalletReady();
  assert.equal(f.state.creates, 1);
  f.state.config = { ...f.state.config, configFingerprint: 'generation-two', tokenContract: 'new-token-config' };
  await f.controller.refreshConfiguration();
  assert.equal(f.state.loads, 1); assert.equal(f.controller.state.config.configFingerprint, 'generation-one');
  assert.equal(f.controller.state.busy, true);
  grant.resolve({ address });
  const settled = await active;
  assert.equal(f.posts().length, 1); assert.equal(f.state.creates, 1);
  assert.equal(f.state.loads, 2); assert.equal(settled.config.configFingerprint, 'generation-two');
  assert.equal(settled.address, null); assert.equal(settled.balance, '0'); assert.equal(settled.status, 'available');
});

test('a failed readonly configuration refresh preserves the existing funded session', async () => {
  const f = fixture({ restored: { address }, balance: '1000000000' });
  await f.controller.prepare();
  f.state.configReadError = new TypeError('offline config');
  await f.controller.refreshConfiguration();
  assert.equal(f.controller.state.status, 'ready'); assert.equal(f.controller.state.address, address);
  assert.equal(f.controller.state.balance, '100'); assert.equal(f.state.loads, 1);
  assert.match(f.controller.state.configurationError.message, /offline config/);
  assert.equal(f.posts().length, 0);
});

test('a configuration disabled by the server cannot keep an old signing provider active', async () => {
  const f = fixture({ restored: { address }, balance: '1000000000' });
  await f.controller.prepare();
  f.state.config = { ...f.state.config, enabled: false };
  await f.controller.refreshConfiguration();
  assert.equal(f.controller.state.status, 'unavailable'); assert.equal(f.controller.state.prepared, false);
  assert.equal(f.controller.state.address, null); assert.equal(f.controller.state.balance, '0');
  await f.controller.ensureWalletReady();
  assert.equal(f.state.creates, 0); assert.equal(f.state.connects, 0); assert.equal(f.posts().length, 0);
});
