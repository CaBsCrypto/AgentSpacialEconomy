import { TESTNET_PASSPHRASE } from './wallet-controller.mjs';

const SIMULATION_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

/** The authenticator owns private passkeys; IndexedDB stores public credential/session mappings. */
export async function createWalletProvider(config, { loadKit = () => import('./vendor/wallet/kit.mjs'), browser = globalThis } = {}) {
  if (config.networkPassphrase !== TESTNET_PASSPHRASE) throw Object.assign(new Error('Solo se admite Stellar Testnet.'), { code: 'wrong_network' });
  if (!browser.isSecureContext || !browser.navigator?.credentials || !browser.PublicKeyCredential) throw Object.assign(new Error('Para usar una passkey, abre esta experiencia en Chrome o Safari mediante HTTPS.'), { code: 'passkey_unavailable' });
  if (config.origin && browser.location?.origin && browser.location.origin !== config.origin) throw Object.assign(new Error('Abre el enlace oficial de activación para usar tu wallet en este dominio.'), { code: 'wrong_origin' });
  if (config.rpId && browser.location?.hostname !== config.rpId && !browser.location?.hostname.endsWith('.' + config.rpId)) throw Object.assign(new Error('Abre la experiencia desde su enlace de activación para conectar tu wallet.'), { code: 'wrong_origin' });
  const sdk = await loadKit();
  const rpc = new sdk.rpc.Server(config.rpcUrl);
  const storage = new sdk.IndexedDBStorage();
  const kit = new sdk.SmartAccountKit({
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    accountWasmHash: config.accountWasmHash,
    acceptedWasmHashes: config.acceptedWasmHashes || [config.accountWasmHash],
    webauthnVerifierAddress: config.webauthnVerifierAddress,
    relayerUrl: config.relayerUrl || '/api/wallet/relay',
    rpId: config.rpId || browser.location.hostname,
    rpName: 'ONE16 Testnet',
    storage,
    ...(config.indexerUrl ? { indexerUrl: config.indexerUrl } : {}),
  });
  let address, pendingCredential;
  const sessionAddress = session => {
    const candidate = session?.contractId || session?.address || kit.contractId;
    if (!candidate || !sdk.StrKey.isValidContract(candidate)) throw new Error('No se pudo confirmar la dirección de la wallet.');
    address = candidate;
    return { address };
  };
  const confirmDeployment = result => {
    if (!result.submitResult?.success) throw Object.assign(new Error('No se pudo confirmar la creación de la wallet. Tu passkey se conserva; puedes retomar la creación o conectar para comprobarla.'), { code: result.submitResult?.error?.code || 'deployment_failed' });
    pendingCredential = null;
    return sessionAddress(result);
  };
  return {
    get hasPendingDeployment() { return !!pendingCredential; },
    async restore() {
      const session = await kit.connectWallet();
      if (session) return sessionAddress(session);
      const pending = await kit.credentials.getPending();
      pendingCredential = pending.filter(credential => credential.isPrimary).sort((a, b) => b.createdAt - a.createdAt)[0];
      return pendingCredential ? { pendingDeployment: true } : null;
    },
    create({ onState = () => {} } = {}) {
      if (pendingCredential) {
        if (pendingCredential.deploymentStatus === 'occupied') throw Object.assign(new Error('Hay una wallet pendiente de verificar. Elige conectar con tu passkey para comprobarla.'), { code: 'wallet_provenance_pending' });
        const credential = pendingCredential;
        onState('deploying');
        return kit.credentials.deploy(credential.credentialId, { autoSubmit: true }).then(async result => {
          const session = confirmDeployment(result);
          await storage.saveSession({ contractId: session.address, credentialId: credential.credentialId, connectedAt: Date.now(), expiresAt: Date.now() + 7 * 86400000 });
          return session;
        });
      }
      const unsubscribe = kit.events.on('credentialCreated', ({ credential }) => { pendingCredential = credential; onState('deploying'); });
      return kit.createWallet('ONE16 Testnet', 'Visitante ONE16', { autoSubmit: true, authenticatorSelection: { residentKey: 'required' } }).then(confirmDeployment).finally(unsubscribe);
    },
    // fresh avoids an asynchronous IndexedDB lookup before the explicit passkey prompt.
    connect() { return kit.connectWallet({ fresh: true }).then(session => { if (!session) return null; pendingCredential = null; return sessionAddress(session); }); },
    async readWallet(walletAddress = address) {
      if (!sdk.StrKey.isValidContract(walletAddress)) throw new Error('La dirección de la wallet no es válida.');
      const entry = await rpc.getContractData(walletAddress, sdk.xdr.ScVal.scvLedgerKeyContractInstance(), 'persistent');
      const executable = entry.val.contractData().val().instance().executable();
      const wasmHash = executable.switch().name === 'contractExecutableWasm' ? Array.from(executable.wasmHash(), byte => byte.toString(16).padStart(2, '0')).join('') : null;
      if (!(config.acceptedWasmHashes || [config.accountWasmHash]).includes(wasmHash)) throw Object.assign(new Error('No se pudo verificar el contrato de esta wallet.'), { code: 'wallet_code_mismatch' });
      const tx = new sdk.TransactionBuilder(new sdk.Account(SIMULATION_SOURCE, '0'), { fee: sdk.BASE_FEE, networkPassphrase: TESTNET_PASSPHRASE })
        .addOperation(new sdk.Contract(config.tokenContract).call('balance', new sdk.Address(walletAddress).toScVal())).setTimeout(30).build();
      const simulation = await rpc.simulateTransaction(tx);
      if (simulation.error || !simulation.result?.retval) throw new Error('No se pudo comprobar el saldo en Testnet.');
      return { deployed: true, balanceUnits: BigInt(sdk.scValToNative(simulation.result.retval)).toString() };
    },
  };
}


