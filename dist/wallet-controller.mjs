/** Testnet wallet lifecycle. Preparation is read-only; explicit actions create and fund. */
export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

/** Public configuration identity, never a cache of balances or financial outcomes. */
export function walletConfigurationFingerprint(config = {}) {
  return config.configFingerprint || JSON.stringify([
    config.enabled, config.configured, config.origin, config.rpId,
    config.networkPassphrase, config.rpcUrl, config.accountWasmHash,
    config.webauthnVerifierAddress, config.tokenContract, config.relayerUrl,
    config.acceptedWasmHashes, config.indexerUrl,
  ]);
}

export function formatWalletBalance(units, decimals = 7) {
  const value = BigInt(units || 0), scale = 10n ** BigInt(decimals);
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return String(value / scale) + (fraction ? '.' + fraction : '');
}

function publicError(error, duringAuthentication = false) {
  const code = error?.reason || error?.code || error?.name || 'wallet_error';
  // SimpleWebAuthn preserves the browser error as a cause while replacing its code.
  const ceremonyCause = duringAuthentication && /^(ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY|ERROR_CEREMONY_ABORTED)$/.test(String(code)) ? (error?.cause?.name || error?.name) : null;
  const cancelled = Number(code) === 4004 || /^(NotAllowedError|cancelled|passkey_cancelled|WEBAUTHN_CANCELLED)$/i.test(String(code)) || (code === 'AbortError' && duringAuthentication) || /^(NotAllowedError|AbortError)$/.test(String(ceremonyCause));
  return { code, cancelled, message: cancelled ? 'La confirmación se canceló. Puedes volver a intentarlo.' : (error?.message || 'No se pudo completar la activación. Puedes continuar el recorrido y reintentar.') };
}

export function createWalletController({
  fetcher = globalThis.fetch?.bind(globalThis),
  loadProvider = async config => (await import('./wallet-provider.mjs')).createWalletProvider(config),
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  pollAttempts = 6,
  pollIntervalMs = 1500,
  onMetric = () => {},
} = {}) {
  let provider, preparation, operation, configurationRefresh, queuedConfig, nextConfig;
  let configurationGeneration = 0;
  const listeners = new Set();
  let current = { status: 'idle', busy: false, prepared: false, address: null, balanceUnits: '0', balance: '0', receipt: null, error: null, requiresAction: false, config: null, availability: null, timings: {}, credentialId: null, credentialKey: null, canVerifyPasskey: false, verificationBusy: false, verificationError: null, passkeyProof: null };
  const snapshot = () => ({ ...current, timings: { ...current.timings }, passkeyProof: current.passkeyProof ? { ...current.passkeyProof } : null });
  const walletIdentity = (session = {}) => ({ credentialId: provider?.credentialId || session.credentialId || null, credentialKey: provider?.credentialKey || null, canVerifyPasskey: !!provider?.canVerifyPasskey });
  const emit = patch => {
    current = { ...current, ...patch };
    const proof = current.passkeyProof;
    if (proof && (proof.address !== current.address || proof.credentialId !== current.credentialId || proof.credentialKey !== current.credentialKey || proof.configFingerprint !== walletConfigurationFingerprint(current.config))) current.passkeyProof = null;
    const state = snapshot();
    for (const listener of listeners) { try { listener(state); } catch {} }
    return state;
  };
  const metric = (name, started) => {
    const milliseconds = Math.round(now() - started);
    emit({ timings: { ...current.timings, [name]: milliseconds } });
    try { onMetric({ name, milliseconds }); } catch {}
  };
  const request = async (url, options) => {
    const response = await fetcher(url, { cache: 'no-store', credentials: 'same-origin', ...(globalThis.AbortSignal?.timeout ? { signal: AbortSignal.timeout(options?.method === 'POST' ? 150000 : 25000) } : {}), ...options });
    let body;
    try { body = await response.json(); } catch { throw new Error('El servicio de activación no está disponible.'); }
    if (!response.ok) {
      const error = new Error(body.message || body.error?.message || 'El servicio de activación no está disponible.');
      error.code = body.reason || body.code || body.error?.code || ('http_' + response.status);
      error.result = body;
      throw error;
    }
    return body;
  };
  const readChain = async () => {
    if (!provider || !current.address) return false;
    const chain = await provider.readWallet(current.address);
    if (!chain.deployed) throw Object.assign(new Error('La wallet aún no está confirmada en Testnet.'), { code: 'deployment_pending' });
    const units = BigInt(chain.balanceUnits || 0);
    if (units < 0n) throw new Error('No se pudo verificar el saldo de la wallet.');
    emit({ balanceUnits: units.toString(), balance: formatWalletBalance(units), deployed: true, ...walletIdentity({ credentialId: current.credentialId }) });
    return units > 0n;
  };
  const ready = () => emit({ status: 'ready', busy: false, error: null, requiresAction: false });
  const claimStatus = () => request('/api/wallet/faucet?address=' + encodeURIComponent(current.address));
  const rememberClaim = claim => {
    emit({ receipt: claim.hash || claim.txHash || current.receipt, claimState: claim.state, nextAvailableAt: claim.nextAvailableAt || null });
  };
  const claimFailure = claim => {
    const error = new Error(claim.message || 'No se pudieron recibir los USDC de prueba. Puedes continuar el recorrido.');
    error.code = claim.reason || 'faucet_failed';
    error.result = claim;
    throw error;
  };
  const confirmReceipt = async initialClaim => {
    let claim = initialClaim;
    rememberClaim(claim);
    if (claim.state === 'failed') claimFailure(claim);
    emit({ status: 'receiving' });
    for (let attempt = 0; attempt <= pollAttempts; attempt++) {
      if (await readChain()) return ready();
      if (attempt === pollAttempts) break;
      await sleep(pollIntervalMs);
      claim = await claimStatus();
      rememberClaim(claim);
      if (claim.state === 'failed') claimFailure(claim);
    }
    return emit({ status: 'pending', busy: false, error: null, requiresAction: false });
  };
  const fail = error => {
    if (error.result?.state) rememberClaim(error.result);
    const detail = publicError(error, current.status === 'awaiting-passkey');
    return emit({ status: detail.cancelled ? 'available' : 'error', busy: false, error: detail, requiresAction: false, pendingDeployment: !!provider?.hasPendingDeployment });
  };
  const track = task => {
    const pending = Promise.resolve(task).catch(fail).finally(async () => {
      if (operation === pending) operation = null;
      if (current.busy) emit({ busy: false });
      await drainConfiguration();
    }).then(() => snapshot());
    operation = pending;
    return pending;
  };

  const applyConfiguration = config => {
    // The current passkey/deployment/funding operation owns its configuration until settled.
    if (operation || preparation) { queuedConfig = config; return Promise.resolve(snapshot()); }
    if (current.prepared && walletConfigurationFingerprint(current.config) === walletConfigurationFingerprint(config)) {
      return Promise.resolve(emit({ config, configurationError: null }));
    }
    ++configurationGeneration;
    provider = null;
    nextConfig = config;
    emit({ status: 'idle', busy: false, prepared: false, config: null, address: null,
      balanceUnits: '0', balance: '0', receipt: null, error: null, requiresAction: false,
      pendingDeployment: false, deployed: false, claimState: null, nextAvailableAt: null,
      availability: null, timings: {}, configurationError: null, credentialId: null, credentialKey: null, canVerifyPasskey: false, verificationBusy: false, verificationError: null, passkeyProof: null });
    // IndexedDB credentials are retained. A new provider may silently restore only valid mappings.
    return controller.prepare();
  };
  const drainConfiguration = () => {
    if (!queuedConfig || operation || preparation) return Promise.resolve(snapshot());
    const config = queuedConfig;
    queuedConfig = null;
    return applyConfiguration(config);
  };

  const controller = {
    get state() { return snapshot(); },
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    prepare() {
      if (preparation) return preparation;
      if (current.prepared) return Promise.resolve(snapshot());
      const started = now();
      emit({ status: 'preparing', busy: true, error: null });
      preparation = (async () => {
        const selected = nextConfig;
        nextConfig = null;
        const config = selected || await request('/api/wallet/config');
        if (config.networkPassphrase && config.networkPassphrase !== TESTNET_PASSPHRASE) throw Object.assign(new Error('La activación solo está disponible en Stellar Testnet.'), { code: 'wrong_network' });
        emit({ config });
        if (!config.enabled) return emit({ status: 'unavailable', prepared: false, busy: false, error: null, unavailableReason: config.message || 'La activación está en preparación. Puedes continuar la experiencia 3D.' });
        provider = await loadProvider(config);
        const session = await provider.restore();
        const address = session?.address || session?.contractId || null;
        emit({ prepared: true, address, ...walletIdentity(session || {}), pendingDeployment: !!session?.pendingDeployment, busy: false, status: 'available', error: null });
        if (address) {
          if (await readChain()) ready();
          else emit({ status: 'connected', busy: false });
        }
        const generation = configurationGeneration;
        void request('/api/wallet/faucet').then(availability => { if (generation === configurationGeneration) emit({ availability }); }).catch(() => {});
        metric('prepare', started);
        return snapshot();
      })().catch(fail).finally(async () => { preparation = null; await drainConfiguration(); });
      return preparation;
    },
    /** Revalidate public config only. No passkey, deployment or funding is started here. */
    refreshConfiguration() {
      if (configurationRefresh) return configurationRefresh;
      if (preparation) return preparation;
      configurationRefresh = request('/api/wallet/config').then(applyConfiguration).catch(error => {
        // A temporary config read failure must not interrupt an active ceremony or erase a wallet.
        if (current.prepared) return emit({ configurationError: publicError(error) });
        return fail(error);
      }).finally(() => { configurationRefresh = null; });
      return configurationRefresh;
    },
    connect() { return controller.ensureWalletReady({ create: false }); },
    ensureWalletReady({ create = true, retry = false } = {}) {
      if (operation) return operation;
      if (!current.prepared || !provider) {
        // Network preparation cannot replace a fresh WebAuthn user gesture.
        return controller.prepare().then(() => current.prepared ? emit({ requiresAction: true, busy: false }) : snapshot());
      }
      const started = now();
      emit({ busy: true, error: null, requiresAction: false, status: current.address ? 'checking' : 'awaiting-passkey' });
      let authentication;
      try {
        // Call synchronously in the click's task, before any await.
        authentication = current.address ? { address: current.address } : create ? provider.create({ onState: status => emit({ status }) }) : provider.connect();
      } catch (error) { return Promise.resolve(fail(error)); }
      return track((async () => {
        const session = await authentication;
        const address = session?.address || session?.contractId;
        if (!address) throw Object.assign(new Error('No se eligió una wallet.'), { code: 'cancelled' });
        emit({ address, ...walletIdentity(session), pendingDeployment: false, status: 'checking' });
        metric('wallet', started);
        if (await readChain()) return ready();
        let claim = await claimStatus();
        rememberClaim(claim);
        if (claim.state === 'none' || (claim.state === 'failed' && retry)) {
          emit({ status: 'funding' });
          claim = await request('/api/wallet/faucet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, ...(retry ? { retry: true } : {}) }) });
        }
        // Pending/unknown/confirmed are reconciled, never automatically submitted again.
        const result = await confirmReceipt(claim);
        metric('activation', started);
        return result;
      })());
    },
    /** A fresh proof of the same local passkey, without funding or transaction submission. */
    verifyPasskey() {
      if (operation) return operation;
      if (!current.prepared || !current.address || !provider?.canVerifyPasskey || !provider?.verifyPasskey) return Promise.resolve(emit({ verificationError: { code: 'passkey_verification_unavailable', cancelled: false, message: 'Conecta esta wallet antes de verificar su passkey.' }, passkeyProof: null }));
      const expected = { address: current.address, credentialId: current.credentialId, credentialKey: current.credentialKey, configFingerprint: walletConfigurationFingerprint(current.config) };
      emit({ busy: true, verificationBusy: true, verificationError: null, passkeyProof: null });
      let authentication;
      try { authentication = provider.verifyPasskey(); }
      catch (error) { return Promise.resolve(emit({ busy: false, verificationBusy: false, verificationError: publicError(error, true) })); }
      const pending = Promise.resolve(authentication).then(proof => {
        if (!proof || proof.address !== expected.address || proof.credentialId !== expected.credentialId || proof.credentialKey !== expected.credentialKey || current.address !== expected.address || walletConfigurationFingerprint(current.config) !== expected.configFingerprint) throw Object.assign(new Error('La wallet cambió durante la verificación. Vuelve a comprobar tu passkey.'), { code: 'passkey_identity_changed' });
        return emit({ passkeyProof: { ...proof, configFingerprint: expected.configFingerprint }, verificationError: null });
      }).catch(error => emit({ passkeyProof: null, verificationError: publicError(error, true) })).finally(async () => {
        if (operation === pending) operation = null;
        emit({ busy: false, verificationBusy: false });
        await drainConfiguration();
      }).then(() => snapshot());
      operation = pending;
      return pending;
    },
    retryFunding() { return controller.ensureWalletReady({ create: false, retry: true }); },
    refresh() {
      if (operation) return operation;
      if (!provider || !current.address) return controller.prepare();
      emit({ status: 'checking', busy: true, error: null });
      return track((async () => {
        if (await readChain()) return ready();
        const claim = await claimStatus();
        rememberClaim(claim);
        if (claim.state === 'none') return emit({ status: 'connected', busy: false });
        return confirmReceipt(claim);
      })());
    },
  };
  return controller;
}




