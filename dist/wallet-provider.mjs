import { TESTNET_PASSPHRASE } from './wallet-controller.mjs';

const toBase64Url = value => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));
const sameBytes = (a, b) => a?.length === b?.length && a.every((byte, index) => byte === b[index]);
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
  let address, pendingCredential, connectedCredential;
  const proofError = (message, code = 'passkey_verification_failed') => Object.assign(new Error(message), { code });
  const sessionAddress = session => {
    const candidate = session?.contractId || session?.address || kit.contractId;
    if (!candidate || !sdk.StrKey.isValidContract(candidate)) throw new Error('No se pudo confirmar la dirección de la wallet.');
    address = candidate;
    return { address };
  };
  const sessionReady = async session => {
    const wallet = sessionAddress(session), credentialId = session?.credentialId || kit.credentialId;
    connectedCredential = null;
    if (credentialId) {
      const credential = await storage.get(credentialId);
      if (credential?.contractId === address && credential.publicKey?.length === 65 && credential.publicKey[0] === 4) {
        connectedCredential = { address, credentialId, publicKey: new Uint8Array(credential.publicKey) };
      }
    }
    return { ...wallet, ...(credentialId ? { credentialId } : {}) };
  };
  const confirmDeployment = result => {
    if (!result.submitResult?.success) throw Object.assign(new Error('No se pudo confirmar la creación de la wallet. Tu passkey se conserva; puedes retomar la creación o conectar para comprobarla.'), { code: result.submitResult?.error?.code || 'deployment_failed' });
    pendingCredential = null;
    return sessionReady(result);
  };
  const pendingError = (message, code = 'deployment_pending') => Object.assign(new Error(message), { code });
  const reconnectPending = async credential => {
    // Only resume an already approved local passkey. This path never starts a new ceremony.
    if (!credential.birthConstructorArgsHash) throw pendingError('La wallet existe, pero todavía falta verificar su creación. Elige conectar con tu passkey.', 'wallet_provenance_pending');
    const session = await kit.connectWallet({ credentialId: credential.credentialId, contractId: credential.contractId });
    if (!session) throw pendingError('La creación todavía no se pudo verificar. Puedes comprobarla otra vez.');
    pendingCredential = null;
    return sessionReady(session);
  };
  const resumePending = async () => {
    // The credentialCreated event predates the SDK's persisted birth/receipt metadata.
    const credential = await storage.get(pendingCredential.credentialId) || pendingCredential;
    pendingCredential = credential;
    if (credential.deploymentStatus === 'occupied') throw pendingError('Hay una wallet pendiente de verificar. Elige conectar con tu passkey para comprobarla.', 'wallet_provenance_pending');
    if (sdk.StrKey.isValidContract(credential.contractId)) {
      let receipt;
      if (credential.deploymentTransactionHash) {
        receipt = await rpc.getTransaction(credential.deploymentTransactionHash);
        if (receipt.status === 'SUCCESS') {
          if (!Number.isSafeInteger(receipt.ledger) || receipt.ledger < 1) throw pendingError('La creación sigue pendiente de una confirmación válida.');
          // Metadata is not ownership: the SDK still verifies immutable birth and the live signer.
          await storage.update(credential.credentialId, { creationTransactionHash: credential.deploymentTransactionHash, creationLedger: receipt.ledger });
          return reconnectPending(credential);
        }
      }
      // Empty entries mean absence; an RPC failure must never be treated as permission to redeploy.
      const footprint = await rpc.getLedgerEntries(new sdk.Contract(credential.contractId).getFootprint());
      if (footprint.entries.length) return reconnectPending(credential);
      if (credential.deploymentTransactionHash && receipt?.status !== 'FAILED') throw pendingError('La transacción de creación todavía no está confirmada. Puedes volver a comprobarla sin crear otra wallet.');
    }
    const result = await kit.credentials.deploy(credential.credentialId, { autoSubmit: true });
    const session = await confirmDeployment(result);
    await storage.saveSession({ contractId: session.address, credentialId: credential.credentialId, connectedAt: Date.now(), expiresAt: Date.now() + 7 * 86400000 });
    return session;
  };
  return {
    get hasPendingDeployment() { return !!pendingCredential; },
    get credentialId() { return connectedCredential?.credentialId || kit.credentialId; },
    get credentialKey() { return connectedCredential ? toBase64Url(connectedCredential.publicKey) : null; },
    get canVerifyPasskey() { return !!connectedCredential; },
    async restore() {
      const session = await kit.connectWallet();
      if (session) return sessionReady(session);
      const pending = await kit.credentials.getPending();
      pendingCredential = pending.filter(credential => credential.isPrimary).sort((a, b) => b.createdAt - a.createdAt)[0];
      return pendingCredential ? { pendingDeployment: true } : null;
    },
    create({ onState = () => {} } = {}) {
      if (pendingCredential) {
        onState('deploying');
        return resumePending();
      }
      const unsubscribe = kit.events.on('credentialCreated', ({ credential }) => { pendingCredential = credential; onState('deploying'); });
      return kit.createWallet('ONE16 Testnet', 'Visitante ONE16', { autoSubmit: true, authenticatorSelection: { residentKey: 'required' } }).then(confirmDeployment).finally(unsubscribe);
    },
    // fresh avoids an asynchronous IndexedDB lookup before the explicit passkey prompt.
    connect() { return kit.connectWallet({ fresh: true }).then(session => { if (!session) return null; pendingCredential = null; return sessionReady(session); }); },
    verifyPasskey() {
      const expected = connectedCredential;
      if (!expected || expected.address !== address) throw proofError('Conecta esta wallet antes de verificar su passkey.', 'passkey_verification_unavailable');
      if (browser.top && browser.top !== browser) throw proofError('Verifica tu passkey desde la página principal de la experiencia.', 'wrong_context');
      if (!browser.crypto?.getRandomValues || !browser.navigator.credentials.get || !sdk.verifyFreshAssertion || !kit.connectWithCredentials) throw proofError('La verificación de passkey no está disponible en este navegador.', 'passkey_verification_unavailable');
      const challenge = browser.crypto.getRandomValues(new Uint8Array(32));
      const rpId = config.rpId || browser.location.hostname, origin = config.origin || browser.location.origin;
      // This native request runs in the original button click, before any storage or network await.
      const authentication = browser.navigator.credentials.get({ publicKey: {
        challenge, rpId, allowCredentials: [{ type: 'public-key', id: fromBase64Url(expected.credentialId) }],
        userVerification: 'required', timeout: 60000,
      } });
      return Promise.resolve(authentication).then(async credential => {
        if (!credential) throw proofError('La confirmación se canceló.', 'cancelled');
        if (credential.type !== 'public-key' || credential.id !== expected.credentialId) throw proofError('La passkey elegida no corresponde a esta wallet.', 'passkey_credential_mismatch');
        const raw = { id: credential.id, response: {
          clientDataJSON: toBase64Url(credential.response.clientDataJSON),
          authenticatorData: toBase64Url(credential.response.authenticatorData),
          signature: toBase64Url(credential.response.signature),
        } };
        const verified = await sdk.verifyFreshAssertion(raw, {
          expectedChallenge: toBase64Url(challenge), expectedCredentialId: expected.credentialId,
          rpId, publicKey: expected.publicKey, allowedOrigins: [origin], requireUserVerification: true,
        });
        if (!verified.ok) throw proofError('No se pudo verificar la firma de esta passkey.', 'passkey_' + verified.reason);
        // Pinned 0.9.1 runtime method: false prevents a second, asynchronous WebAuthn prompt.
        const session = await kit.connectWithCredentials(expected.credentialId, expected.address, undefined, false);
        const current = session?.credential || await storage.get(expected.credentialId);
        if ((session?.contractId || kit.contractId) !== expected.address || (session?.credentialId || kit.credentialId) !== expected.credentialId || !sameBytes(expected.publicKey, current?.publicKey)) throw proofError('La asociación de esta passkey cambió. Conecta la wallet otra vez.', 'passkey_identity_changed');
        if (connectedCredential !== expected || address !== expected.address) throw proofError('La wallet cambió durante la verificación.', 'passkey_identity_changed');
        return { address: expected.address, credentialId: expected.credentialId, credentialKey: toBase64Url(expected.publicKey), origin, rpId, verifiedAt: Date.now() };
      });
    },
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


