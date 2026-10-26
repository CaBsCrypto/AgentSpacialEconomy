import {TESTNET_PASSPHRASE, walletConfigurationFingerprint} from './wallet-controller.mjs';

const DESTINATIONS = new Set(['passport', 'palta']);
const emptyMilestones = () => ({activated: false, passport: false, palta: false});
const validAddress = address => typeof address === 'string' && /^C[A-Z2-7]{55}$/.test(address);
const sameIdentity = (a, b) => !!a && !!b && a.address === b.address && a.fingerprint === b.fingerprint;

function walletIdentity(state) {
  if (state?.prepared !== true || !validAddress(state.address) || state.config?.enabled !== true ||
      state.config.networkPassphrase !== TESTNET_PASSPHRASE) return null;
  const fingerprint = walletConfigurationFingerprint(state.config);
  return typeof fingerprint === 'string' && fingerprint ? {address: state.address, fingerprint} : null;
}

function verifiedWallet(state) {
  return !!walletIdentity(state) && state.deployed === true && !state.busy && !state.error &&
    ['ready', 'connected', 'pending'].includes(state.status);
}

function fundedWallet(state) {
  if (!verifiedWallet(state) || state.status !== 'ready' || typeof state.balanceUnits !== 'string' || !/^[0-9]+$/.test(state.balanceUnits)) return false;
  try {return BigInt(state.balanceUnits) > 0n;} catch {return false;}
}

/** Pure, local visitor progress. It never prepares, connects, funds or writes a
 * wallet. Session storage contains visual milestones, never balances/receipts.
 *
 * state / getState() -> {phase, identity, milestones:{activated,passport,palta}}
 * subscribe(listener) immediately replays a fresh snapshot and returns a stop.
 * continueFromTotem(walletSnapshot, source) accepts only the explicit Continue
 * event from source='totem' with a verified funded Testnet wallet.
 */
export function createGuidedTour({storage, storageKey = 'one16-guided-tour', version = '1'} = {}) {
  if (storage === undefined) {
    try {storage = globalThis.sessionStorage;} catch {storage = null;}
  }
  version = String(version);
  const listeners = new Set();
  let disposed = false;
  let current = {phase: 'entry', identity: null, milestones: emptyMilestones()};
  const snapshot = () => ({phase: current.phase, identity: current.identity ? {...current.identity} : null,
    milestones: {...current.milestones}});
  function readCheckpoint() {
    try {
      const saved = JSON.parse(storage?.getItem(storageKey) || 'null');
      if (saved?.version !== version || !validAddress(saved.identity?.address) ||
          typeof saved.identity.fingerprint !== 'string' || !saved.identity.fingerprint ||
          saved.milestones?.activated !== true ||
          typeof saved.milestones.passport !== 'boolean' || typeof saved.milestones.palta !== 'boolean') return null;
      return {identity: {address: saved.identity.address, fingerprint: saved.identity.fingerprint},
        milestones: {activated: true, passport: saved.milestones.passport, palta: saved.milestones.palta}};
    } catch {return null;}
  }
  let checkpoint = readCheckpoint();
  function removeCheckpoint() {
    checkpoint = null;
    try {storage?.removeItem(storageKey);} catch {}
  }
  function saveCheckpoint() {
    checkpoint = {identity: {...current.identity}, milestones: {...current.milestones}};
    try {storage?.setItem(storageKey, JSON.stringify({version, ...checkpoint}));} catch {}
  }
  function emit() {
    for (const listener of listeners) {try {listener(snapshot());} catch {}}
  }
  function phaseFor(milestones) {
    return !milestones.activated ? 'entry' : milestones.passport && milestones.palta ? 'completed' : 'companies';
  }
  function updateWallet(state) {
    if (disposed) return snapshot();
    const before = JSON.stringify(current), identity = walletIdentity(state);
    // A configuration/address change invalidates this journey. Temporary errors
    // with the same public identity retain milestones already earned.
    if (current.identity && !sameIdentity(current.identity, identity)) {
      removeCheckpoint();
      current = {phase: 'entry', identity: null, milestones: emptyMilestones()};
    }
    if (verifiedWallet(state) && !current.identity) {
      const milestones = sameIdentity(checkpoint?.identity, identity) ? {...checkpoint.milestones} : emptyMilestones();
      if (checkpoint && !sameIdentity(checkpoint.identity, identity)) removeCheckpoint();
      current = {phase: phaseFor(milestones), identity, milestones};
    }
    if (before !== JSON.stringify(current)) emit();
    return snapshot();
  }
  function continueFromTotem(state, source = 'wallet') {
    if (disposed) return false;
    updateWallet(state);
    if (source !== 'totem' || !fundedWallet(state) || current.milestones.activated) return false;
    current = {...current, phase: 'companies', milestones: {...current.milestones, activated: true}};
    saveCheckpoint();emit();return true;
  }
  function completeDestination(id) {
    if (disposed || current.phase !== 'companies' || !DESTINATIONS.has(id) || current.milestones[id]) return false;
    const milestones = {...current.milestones, [id]: true};
    current = {...current, milestones, phase: phaseFor(milestones)};
    saveCheckpoint();emit();return true;
  }
  function reset() {
    if (disposed) return snapshot();
    removeCheckpoint();
    current = {...current, phase: 'entry', milestones: emptyMilestones()};
    emit();return snapshot();
  }
  return {
    get state() {return snapshot();}, getState: snapshot,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);try {listener(snapshot());} catch {}
      return () => listeners.delete(listener);
    },
    updateWallet, continueFromTotem, completeDestination, reset,
    dispose() {disposed = true;listeners.clear();},
  };
}
