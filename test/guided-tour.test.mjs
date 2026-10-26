import test from 'node:test';
import assert from 'node:assert/strict';
import {createGuidedTour} from '../dist/guided-tour.mjs';
import {TESTNET_PASSPHRASE} from '../dist/wallet-controller.mjs';

const address = 'C' + 'A'.repeat(55), otherAddress = 'C' + 'B'.repeat(55);
function wallet(patch = {}) {
 return {status: 'ready', prepared: true, busy: false, address, deployed: true, balanceUnits: '1000000000',
  error: null, config: {enabled: true, networkPassphrase: TESTNET_PASSPHRASE, configFingerprint: 'venue-testnet-v1'}, ...patch};
}
function memoryStorage() {
 const values = new Map(), calls = [];
 return {calls, getItem: key => values.get(key) || null,
  setItem(key, value) {calls.push(['set', key]);values.set(key, value);},
  removeItem(key) {calls.push(['remove', key]);values.delete(key);}};
}
const start = tour => assert.equal(tour.continueFromTotem(wallet(), 'totem'), true);

test('read-only wallet updates and generic wallet continuation never unlock the tour', () => {
 const tour = createGuidedTour({storage: null}), states = [];
 tour.subscribe(state => states.push(state));
 tour.updateWallet(wallet());assert.equal(tour.state.phase, 'entry');
 assert.equal(tour.continueFromTotem(wallet()), false);assert.equal(tour.continueFromTotem(wallet(), 'wallet'), false);
 assert.equal(tour.state.milestones.activated, false);
 assert.equal(states[0].identity, null);assert.equal(tour.state.identity.address, address);
 assert.equal(tour.completeDestination('passport'), false);
});

test('only funded deployed Testnet readiness plus explicit totem Continue unlocks', () => {
 for (const patch of [
  {status: 'connected', balanceUnits: '0'}, {status: 'pending'}, {status: 'receiving'},
  {status: 'error', error: {message: 'offline'}}, {status: 'available', error: {cancelled: true}},
  {deployed: false}, {busy: true}, {prepared: false}, {balanceUnits: '0'}, {balanceUnits: '-1'},
  {balanceUnits: 'invalid'}, {balanceUnits: undefined}, {balanceUnits: true}, {balanceUnits: '0x10'}, {address: null},
  {config: {enabled: false, networkPassphrase: TESTNET_PASSPHRASE}},
  {config: {enabled: true, networkPassphrase: 'Public Global Stellar Network ; September 2015'}},
  {config: {enabled: true}},
 ]) {
  const tour = createGuidedTour({storage: null});
  assert.equal(tour.continueFromTotem(wallet(patch), 'totem'), false, JSON.stringify(patch));
  assert.equal(tour.state.phase, 'entry');tour.dispose();
 }
 const tour = createGuidedTour({storage: null});start(tour);
 assert.deepEqual(tour.state.milestones, {activated: true, passport: false, palta: false});
 assert.equal(tour.state.phase, 'companies');
 assert.equal(tour.continueFromTotem(wallet(), 'totem'), false);
});

test('both destinations complete in either order, with idempotent duplicate and invalid signals', () => {
 for (const order of [['passport', 'palta'], ['palta', 'passport']]) {
  const tour = createGuidedTour({storage: null}), states = [];tour.subscribe(state => states.push(state));start(tour);
  assert.equal(tour.completeDestination('unknown'), false);
  assert.equal(tour.completeDestination(order[0]), true);assert.equal(tour.state.phase, 'companies');
  const count = states.length;assert.equal(tour.completeDestination(order[0]), false);assert.equal(states.length, count);
  assert.equal(tour.completeDestination(order[1]), true);assert.equal(tour.state.phase, 'completed');
  assert.deepEqual(tour.state.milestones, {activated: true, passport: true, palta: true});
  assert.equal(tour.completeDestination(order[1]), false);assert.equal(tour.continueFromTotem(wallet(), 'totem'), false);
 }
});

test('matching verified wallet restores session milestones without continuing or funding again', () => {
 const storage = memoryStorage(), first = createGuidedTour({storage});start(first);first.completeDestination('passport');first.dispose();
 const raw = JSON.parse(storage.getItem('one16-guided-tour'));
 assert.equal(raw.version, '1');assert.equal(raw.identity.address, address);
 assert.equal('balanceUnits' in raw, false);assert.equal('receipt' in raw, false);
 const restored = createGuidedTour({storage});assert.equal(restored.state.phase, 'entry');
 restored.updateWallet(wallet({deployed: false}));assert.equal(restored.state.phase, 'entry');
 restored.updateWallet(wallet({status: 'checking', busy: true}));assert.equal(restored.state.phase, 'entry');
 restored.updateWallet(wallet({status: 'connected', balanceUnits: '0'}));
 assert.equal(restored.state.phase, 'companies');assert.equal(restored.state.milestones.passport, true);
 assert.equal(restored.completeDestination('palta'), true);assert.equal(restored.state.phase, 'completed');
 const completed = createGuidedTour({storage});completed.updateWallet(wallet());assert.equal(completed.state.phase, 'completed');
 const pending = createGuidedTour({storage});pending.updateWallet(wallet({status: 'pending', balanceUnits: '0'}));assert.equal(pending.state.phase, 'completed','Historical milestones do not depend on a later pending funding state');
});

test('spent USDC and transient same-identity errors preserve earned milestones', () => {
 const tour = createGuidedTour({storage: null});start(tour);tour.completeDestination('palta');
 for (const state of [wallet({status: 'checking', busy: true, balanceUnits: '0'}),wallet({status: 'pending', balanceUnits: '0'}),wallet({status: 'error', error: {message: 'offline'}, balanceUnits: '0'})]) {
  tour.updateWallet(state);assert.equal(tour.state.phase, 'companies');assert.equal(tour.state.milestones.palta, true);
 }
 assert.equal(tour.completeDestination('passport'), true);assert.equal(tour.state.phase, 'completed');
});

test('another wallet, public configuration change or disabled configuration resets old progress', () => {
 for (const change of [wallet({address: otherAddress}),wallet({config: {...wallet().config, configFingerprint: 'venue-testnet-v2'}}),wallet({config: {...wallet().config, enabled: false}}),wallet({address: null, deployed: false})]) {
  const storage = memoryStorage(), tour = createGuidedTour({storage});start(tour);tour.completeDestination('passport');
  tour.updateWallet(change);assert.equal(tour.state.phase, 'entry');assert.deepEqual(tour.state.milestones, {activated: false, passport: false, palta: false});
  assert.equal(storage.getItem('one16-guided-tour'), null);assert.equal(tour.completeDestination('palta'), false);
 }
});

test('restore rejects another identity, tour version, malformed data and unverifiable snapshots', () => {
 const storage = memoryStorage(), tour = createGuidedTour({storage});start(tour);
 const valid = storage.getItem('one16-guided-tour');
 for (const options of [{version: '2'}, {}]) {
  storage.setItem('one16-guided-tour', valid);
  const restored = createGuidedTour({storage, ...options});restored.updateWallet(options.version ? wallet() : wallet({address: otherAddress}));
  assert.equal(restored.state.phase, 'entry');
 }
 for (const value of ['broken', JSON.stringify({version: '1', identity: {address}, milestones: {activated: true}})]) {
  storage.setItem('one16-guided-tour', value);const restored = createGuidedTour({storage});restored.updateWallet(wallet());assert.equal(restored.state.phase, 'entry');
 }
 storage.setItem('one16-guided-tour', valid);const restored = createGuidedTour({storage});
 restored.updateWallet(wallet({status: 'error', error: {message: 'offline'}}));assert.equal(restored.state.phase, 'entry');
 restored.updateWallet(wallet());assert.equal(restored.state.phase, 'companies');
});

test('scene rebuild subscriptions replay state; reset preserves wallet identity and never reconnects', () => {
 const storage = memoryStorage(), tour = createGuidedTour({storage});start(tour);tour.completeDestination('palta');
 const identity = tour.state.identity;let oldCalls = 0;const stop = tour.subscribe(() => oldCalls++);stop();
 let rebuilt;tour.subscribe(state => {rebuilt = state;});assert.equal(rebuilt.phase, 'companies');assert.equal(rebuilt.milestones.palta, true);
 tour.reset();assert.deepEqual(tour.state.identity, identity);assert.equal(tour.state.phase, 'entry');assert.equal(oldCalls, 1);
 assert.equal(storage.getItem('one16-guided-tour'), null);assert.equal(tour.completeDestination('passport'), false);start(tour);
});

test('snapshots are isolated and denied storage/dispose remain safe without DOM or network', () => {
 const storage = {getItem() {throw Error('denied');},setItem() {throw Error('denied');},removeItem() {throw Error('denied');}};
 const tour = createGuidedTour({storage}), states = [];
 tour.subscribe(state => {state.phase = 'corrupt';state.milestones.activated = true;});tour.subscribe(state => states.push(state));
 assert.equal(tour.state.phase, 'entry');assert.equal(tour.state.milestones.activated, false);start(tour);
 const snapshot = tour.getState();snapshot.identity.address = 'corrupt';snapshot.milestones.palta = true;
 assert.equal(tour.state.identity.address, address);assert.equal(tour.state.milestones.palta, false);
 const before = tour.state, count = states.length;tour.dispose();tour.dispose();tour.reset();tour.updateWallet(null);
 assert.equal(tour.continueFromTotem(wallet(), 'totem'), false);assert.equal(tour.completeDestination('passport'), false);
 assert.deepEqual(tour.state, before);assert.equal(states.length, count);
});
