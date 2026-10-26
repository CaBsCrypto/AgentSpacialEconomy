/** Public session schema from Smart Account Kit 0.9.1; no SDK is loaded by this module. */
export const WALLET_BADGE_STORAGE = Object.freeze({ database: 'smart-account-kit', version: 2, session: 'session', credentials: 'credentials', current: 'current' });

export function isContractAddress(value) {
 if (typeof value !== 'string' || !/^C[A-Z2-7]{55}$/.test(value)) return false;
 const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', bytes = [];
 let bits = 0, buffer = 0;
 for (const letter of value) { buffer = (buffer << 5) | alphabet.indexOf(letter); bits += 5; if (bits >= 8) { bits -= 8; bytes.push((buffer >>> bits) & 255); buffer &= (1 << bits) - 1; } }
 if (bytes.length !== 35 || bytes[0] !== 16) return false;
 let crc = 0;
 for (const byte of bytes.slice(0, 33)) { crc ^= byte << 8; for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff; }
 return bytes[33] === (crc & 255) && bytes[34] === (crc >>> 8);
}

export function formatBadgeBalance(units) {
 if (typeof units !== 'string' || !/^\d{1,40}$/.test(units)) return null;
 const value = BigInt(units), scale = 10000000n;
 const decimals = (value % scale).toString().padStart(7, '0').replace(/0+$/, '');
 return `${value / scale}${decimals ? '.' + decimals : ''}`;
}

/** Read the one active session and its exact deployed association. No identity search or writes. */
export function readStoredWallet({ indexedDB, now = Date.now, timeoutMs = 1800, timer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout } = {}) {
 return new Promise(resolve => {
  let done = false, database, timeout;
  const finish = value => { if (done) return; done = true; clearTimer(timeout); database?.close(); resolve(value); };
  timeout = timer(() => finish(null), timeoutMs);
  void (async () => {
   if (indexedDB === undefined) { try { indexedDB = globalThis.indexedDB; } catch { return finish(null); } }
   if (!indexedDB?.open) return finish(null);
   if (typeof indexedDB.databases === 'function') {
    try { const names = await indexedDB.databases(); if (!names.some(item => item.name === WALLET_BADGE_STORAGE.database)) return finish(null); } catch { /* Some browsers deny enumeration but allow an existing database to be opened. */ }
   }
   if (done) return;
   // Omitting the version never upgrades an existing older/newer SDK database.
   const open = indexedDB.open(WALLET_BADGE_STORAGE.database);
   open.onupgradeneeded = () => { try { open.transaction.abort(); } catch {} };
   open.onblocked = open.onerror = () => finish(null);
   open.onsuccess = () => {
    database = open.result;
    if (done) { database.close(); return; }
    database.onversionchange = () => finish(null);
    const { session, credentials, current } = WALLET_BADGE_STORAGE;
    if (!database.objectStoreNames.contains(session) || !database.objectStoreNames.contains(credentials)) return finish(null);
    let selected = null;
    try {
     const transaction = database.transaction([session, credentials], 'readonly');
     transaction.onabort = transaction.onerror = () => finish(null);
     transaction.oncomplete = () => finish(selected);
     const active = transaction.objectStore(session).get(current);
     active.onerror = () => finish(null);
     active.onsuccess = () => {
      const record = active.result;
      const clock = now();
      if (!record || !isContractAddress(record.contractId) || typeof record.credentialId !== 'string' || !record.credentialId || !Number.isFinite(record.connectedAt) || record.connectedAt <= 0 || (record.expiresAt !== undefined && (!Number.isFinite(record.expiresAt) || record.expiresAt <= clock))) return;
      const association = transaction.objectStore(credentials).get(record.credentialId);
      association.onerror = () => finish(null);
      association.onsuccess = () => {
       const credential = association.result;
       if (credential?.credentialId !== record.credentialId || credential.contractId !== record.contractId || credential.deploymentStatus !== 'deployed') return;
       selected = { address: record.contractId, credentialId: record.credentialId, connectedAt: record.connectedAt, ...(record.expiresAt !== undefined ? { expiresAt: record.expiresAt } : {}) };
      };
     };
    } catch { finish(null); }
   };
  })().catch(() => finish(null));
 });
}

const mounted = new WeakMap();
/** A navigation badge only: no authentication, wallet creation or funding is started here. */
export function mountWalletBadge({ documentRef = globalThis.document, windowRef = documentRef?.defaultView || globalThis, indexedDB, fetcher = windowRef.fetch?.bind(windowRef), readSession = readStoredWallet, now = Date.now, timer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout } = {}) {
 const anchor = documentRef?.getElementById('platformWallet');
 if (!anchor) return { ready: Promise.resolve(null), refresh: async () => null, dispose() {}, get state() { return null; } };
 if (mounted.has(anchor)) return mounted.get(anchor);
 if (indexedDB === undefined) { try { indexedDB = windowRef.indexedDB; } catch { indexedDB = null; } }
 let generation = 0, requested = false, source, balanceTask = Promise.resolve(), requestController, refreshTimer, expiryTimer, disposed = false;
 let state = null;
 const group = anchor.parentElement?.classList?.contains('header-wallet-controls') ? anchor.parentElement : null;
 anchor.setAttribute('href', '/wallet.html'); anchor.setAttribute('target', '_top'); anchor.setAttribute('aria-live', 'polite');
 const clear = () => {
  anchor.hidden = true; anchor.replaceChildren(); anchor.removeAttribute('aria-label'); anchor.removeAttribute('title'); anchor.removeAttribute('data-address');
  group?.classList.remove('has-wallet'); state = null;
 };
 const show = (wallet, balance = null) => {
  const label = documentRef.createElement('span'), address = documentRef.createElement('span');
  label.className = 'wallet-badge-label'; label.textContent = balance === null ? 'Wallet · Testnet' : `${balance} USDC · Testnet`;
  address.className = 'wallet-badge-address'; address.textContent = `${wallet.address.slice(0, 4)}…${wallet.address.slice(-4)}`;
  const accessible = `${balance === null ? 'Wallet · Testnet' : 'Wallet · Testnet · ' + balance + ' USDC'} · ${wallet.address}`;
  anchor.replaceChildren(label, address); anchor.setAttribute('aria-label', accessible); anchor.setAttribute('title', accessible); anchor.setAttribute('data-address', wallet.address); anchor.hidden = false;
  group?.classList.add('has-wallet'); state = { address: wallet.address, balance, balanceVerified: balance !== null };
 };
 const active = (wallet, version) => !disposed && version === generation && (!wallet.expiresAt || wallet.expiresAt > now());
 async function readBalance(wallet, version) {
  if (!fetcher) return;
  const Controller = windowRef.AbortController || globalThis.AbortController;
  const controller = Controller ? new Controller() : null; requestController = controller;
  const timeout = timer(() => controller?.abort(), 12000);
  try {
   const response = await fetcher('/api/wallet/faucet?address=' + encodeURIComponent(wallet.address), { method: 'GET', cache: 'no-store', credentials: 'same-origin', ...(controller ? { signal: controller.signal } : {}) });
   if (!response.ok) return;
   const result = await response.json();
   if (!active(wallet, version) || result.address !== wallet.address || !['none','pending','unknown','confirmed','failed'].includes(result.state)) return;
   const balance = formatBadgeBalance(result.balance);
   if (balance !== null) show(wallet, balance);
  } catch { /* Keep the public address without claiming a verified balance. */ }
  finally { clearTimer(timeout); if (requestController === controller) requestController = null; if (!disposed && version === generation && wallet.expiresAt !== undefined && wallet.expiresAt <= now()) clear(); }
 }
 async function drain() {
  while (requested && !disposed) {
   requested = false; const version = generation;
   let wallet;
   try { wallet = await readSession({ indexedDB, now }); } catch { wallet = null; }
   if (disposed) return;
   if (version !== generation) { requested = true; continue; }
   if (!wallet || !isContractAddress(wallet.address) || (wallet.expiresAt !== undefined && wallet.expiresAt <= now())) { clear(); continue; }
   show(wallet);
   if (wallet.expiresAt) expiryTimer = timer(() => { void refresh(); }, Math.min(2147483647, Math.max(0, wallet.expiresAt - now())));
   balanceTask = readBalance(wallet, version);
  }
 }
 function refresh() {
  if (disposed) return Promise.resolve(null);
  generation++; requested = true; requestController?.abort(); clearTimer(expiryTimer); clear(); balanceTask = Promise.resolve();
  const startSource = () => source = drain().finally(() => { source = null; if (requested && !disposed) return startSource(); });
  if (!source) startSource();
  return source.then(() => balanceTask).then(() => state);
 }
 const schedule = () => { if (disposed) return; clearTimer(refreshTimer); refreshTimer = timer(() => { void refresh(); }, 80); };
 const visibility = () => { if (documentRef.visibilityState === 'visible') schedule(); };
 windowRef.addEventListener?.('focus', schedule); windowRef.addEventListener?.('pageshow', schedule); documentRef.addEventListener?.('visibilitychange', visibility);
 clear();
 const controller = { ready: null, refresh, get state() { return state ? { ...state } : null; }, dispose() {
  if (disposed) return; disposed = true; generation++; requestController?.abort(); clearTimer(refreshTimer); clearTimer(expiryTimer);
  windowRef.removeEventListener?.('focus', schedule); windowRef.removeEventListener?.('pageshow', schedule); documentRef.removeEventListener?.('visibilitychange', visibility); clear(); mounted.delete(anchor);
 }};
 mounted.set(anchor, controller); controller.ready = refresh(); return controller;
}

if (typeof document !== 'undefined' && document.getElementById('platformWallet')) mountWalletBadge({ documentRef: document });
