import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWorldWallet } from '../dist/world-wallet.mjs';
import { createWalletController, TESTNET_PASSPHRASE } from '../dist/wallet-controller.mjs';
import { bindWalletPanel } from '../dist/wallet-panel.mjs';
import { createVenueLoadingController } from '../dist/venue-loading.mjs';

class Element extends EventTarget {
  constructor(doc, tag = 'div') { super(); this.ownerDocument = doc; this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.hidden = false; this.open = false; this.className = ''; this.classList = { add: name => { if (!this.className.split(' ').includes(name)) this.className += ' ' + name; } }; }
  append(...nodes) { for (const node of nodes) { if (node.parentElement) node.parentElement.children = node.parentElement.children.filter(child => child !== node); node.parentElement = this; this.children.push(node); } }
  insertBefore(node, before) { if (node.parentElement) node.parentElement.children = node.parentElement.children.filter(child => child !== node); node.parentElement = this; this.children.splice(this.children.indexOf(before), 0, node); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = value; }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (selector === '.toolbar' && node.className.split(' ').includes('toolbar')) return node; return null; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
  focus() { this.ownerDocument.activeElement = this; }
}
function fixture({ direct = false, balance = '1000000000' } = {}) {
  const doc = new EventTarget(); doc.createElement = tag => new Element(doc, tag); doc.head = doc.createElement('head'); doc.body = doc.createElement('body'); doc.defaultView = { CustomEvent };
  const all = () => { const nodes = []; const visit = node => { nodes.push(node); node.children.forEach(visit); }; visit(doc.body); visit(doc.head); return nodes; };
  doc.getElementById = id => all().find(node => node.id === id);
  const viewer = doc.createElement('section'); viewer.id = 'viewer'; viewer.hidden = direct; doc.body.append(viewer);
  const toolbar = doc.createElement('nav'); toolbar.className = 'toolbar'; viewer.append(toolbar);
  for (const id of ['return', 'restart', 'help']) { const button = doc.createElement('button'); button.id = id; toolbar.append(button); }
  const map = doc.createElement('div'); map.id = 'walkMinimap'; viewer.append(map);
  const idle = [], requests = [], calls = { imports: 0, restore: 0, reads: 0, ceremony: 0 }, state = { balance };
  const address = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK3M';
  const provider = {
    restore: async () => { calls.restore++; return { address }; },
    readWallet: async () => { calls.reads++; return { deployed: true, balanceUnits: state.balance }; },
    create() { calls.ceremony++; throw Error('no creation from access control'); }, connect() { calls.ceremony++; throw Error('no ceremony from access control'); },
  };
  let controller;
  const flow = createWorldWallet({ documentRef: doc, idle: callback => idle.push(callback), loadModules: async () => {
    calls.imports++;
    return [{ createWalletController() { controller = createWalletController({ fetcher: async (url, options) => {
      requests.push({ url, method: options?.method || 'GET' }); assert.notEqual(options?.method, 'POST');
      return { ok: true, json: async () => url === '/api/wallet/config' ? { enabled: true, networkPassphrase: TESTNET_PASSPHRASE } : { available: true } };
    }, loadProvider: async () => provider }); return controller; } }, { bindWalletPanel }];
  } });
  return { doc, viewer, toolbar, map, flow, idle, calls, requests, state, address, all, get controller() { return controller; } };
}

test('access waits for the successful 3D frame, then restores the existing balance beside Help without claims', async () => {
  const f = fixture(), loading = createVenueLoadingController({ onReady: () => f.flow.afterFirstFrame() });
  const attempt = loading.begin(); loading.prepared(attempt);
  assert.equal(f.doc.getElementById('walletQuickOpen'), undefined); assert.equal(f.calls.imports, 0);
  loading.renderFrame(attempt, { width: 0, height: 400, render() {} }); assert.equal(f.idle.length, 0);
  loading.renderFrame(attempt, { width: 320, height: 600, render() {} });
  const button = f.doc.getElementById('walletQuickOpen'), help = f.doc.getElementById('help');
  assert.equal(button.parentElement, help.parentElement); assert.equal(button.className, 'wallet-toolbar-open'); assert.equal(button.parentElement.parentElement, f.toolbar);
  assert.equal(f.calls.imports, 0); assert.equal(f.idle.length, 1); assert.equal(button.attributes['aria-busy'], 'true');
  f.idle[0](); await f.flow.prepare();
  assert.equal(button.children[0].textContent, 'Mi wallet · 100 USDC'); assert.equal(button.children[1].textContent, f.address.slice(0, 5) + '…' + f.address.slice(-4));
  assert.match(button.title, /100 USDC/); assert.ok(button.title.includes(f.address)); assert.equal(button.attributes['aria-busy'], 'false');
  assert.equal(f.calls.restore, 1); assert.equal(f.calls.ceremony, 0); assert.ok(f.requests.every(request => request.method === 'GET'));
});

test('repeated frames and NFC return reuse the same button and warm-up without a floating duplicate', async () => {
  const f = fixture({ direct: true }); f.flow.afterFirstFrame(); const button = f.doc.getElementById('walletQuickOpen');
  assert.equal(button.parentElement, f.doc.body); assert.equal(button.dataset.walletPlacement, 'direct');
  f.viewer.hidden = false; f.flow.afterFirstFrame(); f.flow.afterFirstFrame();
  assert.equal(f.doc.getElementById('walletQuickOpen'), button); assert.equal(button.dataset.walletPlacement, 'toolbar'); assert.equal(button.parentElement, f.doc.getElementById('help').parentElement);
  assert.equal(f.all().filter(node => node.id === 'walletQuickOpen').length, 1); assert.equal(f.idle.length, 1);
  f.idle[0](); await f.flow.prepare(); assert.equal(f.calls.imports, 1);
});

test('label and balance updates retain button identity, focus and existing scene position', async () => {
  const f = fixture(); f.flow.afterFirstFrame(); f.idle[0](); await f.flow.prepare();
  const button = f.doc.getElementById('walletQuickOpen'), pose = { x: 8.1, z: -15, yaw: 1.2 }, initial = { ...pose };
  button.focus(); f.state.balance = '825000000'; await f.controller.refresh();
  assert.equal(button.children[0].textContent, 'Mi wallet · 82.5 USDC'); assert.equal(f.doc.activeElement, button); assert.equal(f.doc.getElementById('walletQuickOpen'), button);
  button.click(); await f.flow.open();
  assert.equal(f.doc.getElementById('activationDialog').open, true); assert.equal(f.flow.controller, f.controller); assert.equal(f.calls.imports, 1); assert.equal(f.calls.ceremony, 0); assert.deepEqual(pose, initial);
});

test('a fresh document restores its own public wallet and confirmed balance without requesting an address', async () => {
  for (let reload = 0; reload < 2; reload++) {
    const f = fixture(); f.flow.afterFirstFrame(); f.idle[0](); await f.flow.prepare();
    assert.equal(f.controller.state.address, f.address); assert.equal(f.doc.getElementById('walletQuickOpen').children[0].textContent, 'Mi wallet · 100 USDC');
    assert.equal(f.calls.restore, 1); assert.equal(f.calls.ceremony, 0); assert.equal(f.requests.filter(request => request.method === 'POST').length, 0);
  }
});

test('toolbar layout overrides only the hidden legacy access and keeps map and mobile controls separate', () => {
  const viewer = fs.readFileSync(new URL('../dist/viewer.js', import.meta.url), 'utf8');
  assert.match(viewer, /venueLoading\.renderFrame\([^]*?venueLoading\.state\.phase==='ready'[^]*?walletExperience\.afterFirstFrame\(\)/);
  const css = fs.readFileSync(new URL('../dist/wallet.css', import.meta.url), 'utf8');
  assert.match(css, /#viewer \.toolbar #walletQuickOpen\.wallet-toolbar-open\{display:flex!important;position:static/);
  assert.match(css, /grid-template-areas:"exit access" "reset modes"/); assert.match(css, /minmax\(0,1fr\)/);
  assert.match(css, /@media\(max-width:1100px\)/); assert.doesNotMatch(css, /#walkMinimap[^{}]*\{/);
});
