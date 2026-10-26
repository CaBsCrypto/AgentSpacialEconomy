import test from 'node:test';
import assert from 'node:assert/strict';
import { bindWalletPanel } from '../dist/wallet-panel.mjs';

class Element extends EventTarget {
  constructor(tag = 'div') { super(); this.tagName = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.open = false; this.textContent = ''; this.classList = { add: value => { this.className = value; } }; }
  setAttribute(key, value) { this.attributes[key] = value; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  showModal() { this.open = true; this.shows = (this.shows || 0) + 1; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}
function fixture() {
  const nodes = [], doc = {
    head: new Element('head'),
    getElementById: id => nodes.find(node => node.id === id),
    createElement: tag => { const node = new Element(tag); nodes.push(node); return node; },
  };
  const dialog = new Element('dialog');
  dialog.ownerDocument = doc;
  let observer, state = { status: 'idle', prepared: false, busy: false, address: null, timings: {} };
  const calls = [];
  const controller = {
    get state() { return state; },
    subscribe(fn) { observer = fn; fn(state); return () => { observer = null; }; },
    prepare() { calls.push(['prepare']); return Promise.resolve(state); },
    connect() { calls.push(['connect']); return Promise.resolve(state); },
    ensureWalletReady(options) { calls.push(['ensure', options]); return Promise.resolve(state); },
    refresh() { calls.push(['refresh']); return Promise.resolve(state); },
    retryFunding() { calls.push(['retry']); return Promise.resolve(state); },
    verifyPasskey() { calls.push(['verify']); return Promise.resolve(state); },
  };
  const update = patch => { state = { ...state, ...patch }; observer?.(state); };
  return { doc, dialog, controller, calls, update, get: id => doc.getElementById(id) };
}

test('opening the main-document panel prepares without creating, funding or changing navigation', async () => {
  const f = fixture(), pose = { x: 5.8, z: -1.4 }, before = { ...pose };
  const panel = bindWalletPanel({ dialog: f.dialog, controller: f.controller });
  assert.equal(f.calls.length, 0); assert.equal(f.get('walletCreate').disabled, true);
  await panel.open(); await panel.open();
  assert.equal(f.dialog.shows, 1); assert.deepEqual(f.calls.map(call => call[0]), ['prepare', 'prepare']);
  assert.deepEqual(pose, before);
  assert.equal(f.get('walletStyles').href, './wallet.css?v=wallet1');
  assert.equal(f.dialog.attributes['aria-labelledby'], 'activationTitle');
  assert.equal(f.get('walletStatus').attributes['aria-live'], 'polite');
});

test('only explicit enabled buttons initiate passkey creation or connection', () => {
  const f = fixture();
  bindWalletPanel({ dialog: f.dialog, controller: f.controller });
  f.get('walletCreate').click(); assert.equal(f.calls.length, 0);
  f.update({ status: 'available', prepared: true });
  f.get('walletCreate').click(); f.get('walletConnect').click();
  assert.deepEqual(f.calls, [['ensure', { create: true }], ['connect']]);
  f.update({ status: 'awaiting-passkey', busy: true });
  f.get('walletCreate').click(); assert.equal(f.calls.length, 2);
});

test('pending operations offer a balance check; definite failures alone offer retry funding', () => {
  const f = fixture();
  bindWalletPanel({ dialog: f.dialog, controller: f.controller });
  f.update({ status: 'pending', prepared: true, address: 'Cwallet', claimState: 'unknown' });
  f.get('walletRetry').click(); assert.deepEqual(f.calls, [['refresh']]);
  f.update({ status: 'error', claimState: 'failed', error: { code: 'user_cooldown', message: 'Vuelve más tarde.' }, nextAvailableAt: '2099-01-01T00:00:00Z' });
  assert.equal(f.get('walletRetry').disabled, true);
  f.get('walletRetry').click(); assert.equal(f.calls.length, 1);
  f.update({ nextAvailableAt: null });
  f.get('walletRetry').click(); assert.deepEqual(f.calls[1], ['retry']);
});

test('confirmed onchain balance is shown using safe text nodes and a Testnet explorer', () => {
  const f = fixture();
  bindWalletPanel({ dialog: f.dialog, controller: f.controller });
  f.update({ status: 'ready', prepared: true, address: 'Cwallet', balance: '100', timings: { activation: 1530 } });
  assert.equal(f.get('walletCreate').hidden, true);
  assert.equal(f.get('walletReceive').hidden, true);
  assert.equal(f.get('walletContinue').textContent, 'Continuar con mi wallet');
  const card = f.dialog.children.find(node => node.className === 'wallet-account');
  assert.equal(card.children[0].textContent, '100 USDC');
  assert.equal(card.children[3].href, 'https://stellar.expert/explorer/testnet/contract/Cwallet');
});

test('close and native Escape preserve session and release subscriptions on teardown', async () => {
  const f = fixture(); let closed = 0;
  const panel = bindWalletPanel({ dialog: f.dialog, controller: f.controller, onClose: () => closed++ });
  await panel.open(); f.get('walletContinue').click();
  assert.equal(closed, 1);
  await panel.open(); f.dialog.close(); assert.equal(closed, 2);
  assert.equal(f.calls.some(call => call[0] === 'disconnect'), false);
  panel.destroy(); const prior = f.get('walletStatus').textContent; f.update({ status: 'ready' });
  assert.equal(f.get('walletStatus').textContent, prior);
});


test('availability warnings explain missing USDC capacity without blocking wallet access', () => {
  const f = fixture();
  bindWalletPanel({ dialog: f.dialog, controller: f.controller });
  f.update({ status: 'available', prepared: true, availability: { available: false, reason: 'ip_limit' } });
  assert.equal(f.get('walletAvailability').hidden, false);
  assert.match(f.get('walletAvailability').textContent, /agotó el cupo/);
  assert.equal(f.get('walletCreate').disabled, false);
  assert.equal(f.get('walletConnect').disabled, false);
  f.update({ status: 'ready', address: 'Cwallet', balance: '100' });
  assert.equal(f.get('walletAvailability').hidden, true);
});

test('unavailable setup offers a fresh read-only preparation check', () => {
  const f = fixture();
  bindWalletPanel({ dialog: f.dialog, controller: f.controller });
  f.update({ status: 'unavailable', unavailableReason: 'Activación pendiente.' });
  assert.equal(f.get('walletRetry').hidden, false);
  assert.equal(f.get('walletRetry').textContent, 'Comprobar activación');
  f.get('walletRetry').click();
  assert.deepEqual(f.calls, [['prepare']]);
});


test('reopening refreshes cooldown eligibility without requiring another controller state change', async () => {
  const f = fixture(), panel = bindWalletPanel({ dialog: f.dialog, controller: f.controller });
  const clock = Date.now, started = clock();
  try {
    Date.now = () => started;
    f.update({ status: 'error', prepared: true, address: 'Cwallet', claimState: 'failed', nextAvailableAt: new Date(started + 10000).toISOString(), error: { message: 'Vuelve más tarde.' } });
    await panel.open();
    assert.equal(f.get('walletRetry').disabled, true);
    assert.match(f.get('walletStatus').textContent, /Próximo intento:/);
    panel.close();
    Date.now = () => started + 20000;
    await panel.open();
    assert.equal(f.get('walletRetry').disabled, false);
    assert.doesNotMatch(f.get('walletStatus').textContent, /Próximo intento:/);
  } finally { Date.now = clock; panel.destroy(); }
});



test('a connected main-document wallet exposes a synchronous independent proof action', () => {
  const f = fixture(), panel = bindWalletPanel({ dialog: f.dialog, controller: f.controller });
  assert.equal(f.get('walletVerify').hidden, true);
  f.update({ status: 'ready', address: 'Cwallet', prepared: true, balance: '100', canVerifyPasskey: true });
  assert.equal(f.get('walletVerify').hidden, false); assert.equal(f.get('walletVerify').disabled, false);
  const status = f.get('walletStatus').textContent; f.get('walletVerify').click(); assert.deepEqual(f.calls, [['verify']]);
  f.update({ busy: true, verificationBusy: true });
  assert.equal(f.get('walletVerify').disabled, true); assert.equal(f.get('walletStatus').textContent, status);
  assert.match(f.get('walletVerification').textContent, /esta misma wallet/); assert.equal(f.get('walletVerification').attributes['aria-live'], 'polite');
  const card = f.dialog.children.find(node => node.className === 'wallet-account'); assert.equal(card.children[0].textContent, '100 USDC');
  f.update({ busy: false, verificationBusy: false, verificationError: { cancelled: true } });
  assert.match(f.get('walletVerification').textContent, /se canceló/); assert.equal(f.get('walletStatus').textContent, status); assert.equal(card.children[0].textContent, '100 USDC');
  panel.destroy();
});

test('a late completed proof updates state without reopening a closed panel', async () => {
  const f = fixture(), panel = bindWalletPanel({ dialog: f.dialog, controller: f.controller });
  await panel.open(); f.update({ status: 'ready', address: 'Cwallet', prepared: true, balance: '100', canVerifyPasskey: true });
  f.get('walletVerify').click(); panel.close(); const shows = f.dialog.shows;
  f.update({ passkeyProof: { address: 'Cwallet', credentialId: 'same-key', verifiedAt: Date.now() }, verificationBusy: false, busy: false });
  assert.equal(f.dialog.open, false); assert.equal(f.dialog.shows, shows); assert.match(f.get('walletVerification').textContent, /Passkey verificada/);
  panel.destroy(); f.get('walletVerify').click(); assert.deepEqual(f.calls.map(call => call[0]), ['prepare', 'verify']);
});

test('only the explicit Continue button acknowledges the current snapshot before closing', async () => {
 const f = fixture(), continued = [], closed = [];
 const panel = bindWalletPanel({dialog: f.dialog, controller: f.controller, onContinue: state => continued.push({state, open: f.dialog.open}), onClose: () => closed.push(true)});
 await panel.open();f.get('closeActivation').click();assert.equal(continued.length, 0);
 await panel.open();f.dialog.close();assert.equal(continued.length, 0);
 await panel.open();f.update({status: 'pending', address: 'Cwallet'});f.get('walletContinue').click();
 assert.equal(continued.length, 1);assert.equal(continued[0].state.status, 'pending');assert.equal(continued[0].open, true);
 await panel.open();f.update({status: 'ready', balance: '100'});f.get('walletContinue').click();
 assert.equal(continued[1].state.status, 'ready');assert.equal(closed.length, 4);
 panel.destroy();f.get('walletContinue').click();assert.equal(continued.length, 2);
});
