import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mountWalletDirect } from '../dist/wallet-direct.mjs';
import { createWalletController, TESTNET_PASSPHRASE } from '../dist/wallet-controller.mjs';
import { bindWalletPanel } from '../dist/wallet-panel.mjs';

class Element extends EventTarget {
  constructor(tag = 'div') { super(); this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.open = false; this.hidden = false; this.disabled = false; this.classList = { add() {} }; }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
  focus() { this.focused = true; }
}
function fixture({ restored = false, importFailure = false } = {}) {
  const nodes = [], requests = [], routes = [], calls = { imports: 0, restore: 0, ceremony: 0, verify: 0 };
  const doc = { head: new Element('head'), getElementById: id => nodes.find(node => node.id === id), createElement: tag => { const node = new Element(tag); nodes.push(node); return node; } };
  for (const id of ['activationDialog', 'walletDirectStatus', 'walletDirectRetry', 'walletStyles']) { const node = doc.createElement(id === 'activationDialog' ? 'dialog' : 'div'); node.id = id; node.ownerDocument = doc; }
  const provider = {
    restore: async () => { calls.restore++; return restored ? { address: 'C-existing-wallet' } : null; },
    readWallet: async () => ({ deployed: true, balanceUnits: '1000000000' }),
    create() { calls.ceremony++; throw Error('opening must not create'); }, connect() { calls.ceremony++; throw Error('opening must not authenticate'); }, verifyPasskey() { calls.verify++; throw Error('opening must not verify'); },
  };
  const fetcher = async (url, options) => {
    requests.push({ url, method: options?.method || 'GET' });
    assert.notEqual(options?.method, 'POST', 'opening cannot fund or relay');
    const value = url === '/api/wallet/config' ? { enabled: true, networkPassphrase: TESTNET_PASSPHRASE } : { available: true };
    return { ok: true, json: async () => value };
  };
  const loadModules = async () => {
    calls.imports++; if (importFailure && calls.imports === 1) throw Error('offline');
    return [{ createWalletController: () => createWalletController({ fetcher, loadProvider: async () => provider }) }, { bindWalletPanel }];
  };
  const app = mountWalletDirect({ documentRef: doc, locationRef: { assign: route => routes.push(route) }, loadModules });
  return { app, doc, calls, requests, routes, get: id => doc.getElementById(id) };
}

test('direct wallet HTML is light, canonical and contains no venue, Passport or camera graph', () => {
  const html = fs.readFileSync(new URL('../dist/wallet.html', import.meta.url), 'utf8');
  const source = fs.readFileSync(new URL('../dist/wallet-direct.mjs', import.meta.url), 'utf8');
  assert.match(html, /canonical" href="https:\/\/agenticreality.space\/wallet.html/);
  assert.match(html, /name="viewport"/); assert.match(html, /href="\/one16\?lang=es"/); assert.match(html, /href="\/"/);
  assert.deepEqual([...source.matchAll(/import\(['"]([^'"]+)/g)].map(match => match[1]), ['./wallet-controller.mjs', './wallet-panel.mjs']);
  assert.doesNotMatch(html + source, /Three|GLTFLoader|viewer\.js|entry\.mjs|Passport|\.glb|getUserMedia|requestSession|credentials\.(?:get|create)/);
  assert.match(html, /aria-live="polite"/);
});

test('automatic opening uses the real shared panel/controller and only prepares or silently restores', async () => {
  for (const restored of [false, true]) {
    const f = fixture({ restored }); await f.app.ready;
    assert.equal(f.get('activationDialog').open, true); assert.equal(f.calls.restore, 1); assert.equal(f.calls.ceremony, 0); assert.equal(f.calls.verify, 0); assert.equal(f.routes.length, 0);
    assert.ok(f.requests.length > 0); assert.ok(f.requests.every(request => request.method === 'GET'));
    assert.equal(f.app.controller.state.status, restored ? 'ready' : 'available');
    assert.equal(f.get('walletCreate').disabled, restored); assert.equal(f.get('walletVerify').hidden, !restored);
    f.app.dispose();
  }
});

test('only an explicit close or continue action navigates to the existing ONE16 route', async () => {
  const f = fixture(); await f.app.ready; assert.deepEqual(f.routes, []);
  f.get('walletContinue').click(); assert.deepEqual(f.routes, ['/one16?lang=es']);
  await f.app.open(); assert.equal(f.get('activationDialog').open, true);
  f.get('activationDialog').close(); assert.deepEqual(f.routes, ['/one16?lang=es', '/one16?lang=es']);
  assert.equal(f.calls.ceremony, 0); f.app.dispose();
});

test('module loading failure offers a retry without initiating any wallet action', async () => {
  const f = fixture({ importFailure: true }); await f.app.ready;
  assert.match(f.get('walletDirectStatus').textContent, /No se pudo preparar/); assert.equal(f.get('walletDirectRetry').hidden, false); assert.equal(f.calls.restore, 0);
  f.get('walletDirectRetry').click(); f.get('walletDirectRetry').click(); await f.app.open();
  assert.equal(f.calls.imports, 2); assert.equal(f.get('activationDialog').open, true); assert.equal(f.calls.ceremony, 0); assert.equal(f.calls.verify, 0);
  f.app.dispose();
});
