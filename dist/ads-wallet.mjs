import { TESTNET_PASSPHRASE } from './wallet-controller.mjs';
export const ADS_USDC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
export function selectPaymentRuleIds(rules, { credentialId, asset, ledger, credentialOf, verifierAddress }) {
  const eligible = rules.filter(rule => (!rule.valid_until || rule.valid_until > ledger) && !rule.policies?.length && rule.signers?.length === 1 && (!verifierAddress || rule.signers[0].tag === 'External' && rule.signers[0].values[0] === verifierAddress) && credentialOf(rule.signers[0]) === credentialId && (rule.context_type?.tag === 'Default' || rule.context_type?.tag === 'CallContract' && rule.context_type.values[0] === asset));
  const specific = eligible.filter(rule => rule.context_type.tag === 'CallContract');
  const chosen = specific.length ? specific : eligible.filter(rule => rule.context_type.tag === 'Default');
  if (chosen.length !== 1 || !Number.isSafeInteger(chosen[0].id)) throw Error('No hay una única regla de firma admitida para este pago.');
  return [chosen[0].id];
}
export function validatePaymentRequirements(challenge, expected) {
  const requirements = challenge?.accepts?.find(item => item.network === 'stellar:testnet' && item.scheme === 'exact' && item.asset === ADS_USDC);
  if (!requirements || requirements.amount !== String(expected.amountUnits) || requirements.payTo !== expected.payTo || requirements.asset !== expected.asset || expected.network !== 'stellar:testnet' || !/^[1-9][0-9]*$/.test(requirements.amount) || !Number.isSafeInteger(requirements.maxTimeoutSeconds) || requirements.maxTimeoutSeconds <= 0 || requirements.maxTimeoutSeconds > 300) throw Error('La solicitud de pago no coincide con la cotización autorizada.');
  if (challenge.x402Version !== 2 || requirements.extra?.areFeesSponsored !== true) throw Error('Este pago requiere x402 v2 y comisiones patrocinadas.');
  return requirements;
}
export function assertTransferEntry(sdk, entry, { address, asset, payTo, amount }) {
  if (!['sorobanCredentialsAddress', 'sorobanCredentialsAddressV2'].includes(entry.credentials().switch().name)) throw Error('Tipo de autorización no permitido.');
  const credentials = entry.credentials().value();
  if (sdk.Address.fromScAddress(credentials.address()).toString() !== address) throw Error('La autorización pertenece a otra wallet.');
  const root = entry.rootInvocation();
  if (root.subInvocations().length || root.function().switch().name !== 'sorobanAuthorizedFunctionTypeContractFn') throw Error('La firma contiene operaciones adicionales.');
  const fn = root.function().contractFn(), args = fn.args();
  if (sdk.Address.fromScAddress(fn.contractAddress()).toString() !== asset || fn.functionName().toString() !== 'transfer' || args.length !== 3 || sdk.scValToNative(args[0]) !== address || sdk.scValToNative(args[1]) !== payTo || String(sdk.scValToNative(args[2])) !== amount) throw Error('La invocación no es la transferencia autorizada.');
}
export async function createAdsWallet(config, { loadSdk = () => import('./vendor/ads-wallet/kit.mjs'), fetchImpl = fetch, browser = globalThis } = {}) {
  if (config.networkPassphrase !== TESTNET_PASSPHRASE || config.tokenContract !== ADS_USDC) throw Error('La wallet debe estar configurada para USDC en Stellar Testnet.');
  if (!browser.isSecureContext || !browser.navigator?.credentials || !browser.PublicKeyCredential) throw Error('La passkey requiere un navegador compatible y un origen seguro.');
  if (config.origin && browser.location?.origin !== config.origin) throw Error('Abre la publicidad desde el dominio de tu wallet.');
  const sdk = await loadSdk();
  const storage = new sdk.IndexedDBStorage();
  let connectionProof = null, connecting = false;
  const webAuthn = {
    startRegistration: async () => { throw Error('Crea tu wallet desde la entrada de ONE16.'); },
    startAuthentication: async options => {
      const response = await sdk.startAuthentication(options);
      if (connecting) connectionProof = { response, challenge: options.optionsJSON.challenge };
      return response;
    },
  };
  const kit = new sdk.SmartAccountKit({ rpcUrl: config.rpcUrl, networkPassphrase: config.networkPassphrase, accountWasmHash: config.accountWasmHash, acceptedWasmHashes: config.acceptedWasmHashes || [config.accountWasmHash], webauthnVerifierAddress: config.webauthnVerifierAddress, relayerUrl: config.relayerUrl || '/api/wallet/relay', rpId: config.rpId, rpName: 'ONE16 Testnet', storage, webAuthn, ...(config.indexerUrl ? { indexerUrl: config.indexerUrl } : {}) });
  const server = new sdk.rpc.Server(config.rpcUrl);
  let address, signing = false;
  const preparations = new WeakMap();
  const transferSnapshot = expected => {
    if (!address || !kit.credentialId) throw Error('Conecta tu wallet para preparar el pago.');
    const amount = String(expected?.amountUnits || '');
    if (expected?.network !== 'stellar:testnet' || expected?.asset !== ADS_USDC || !/^[1-9][0-9]*$/.test(amount) || BigInt(amount) >= 2n ** 127n || !(sdk.StrKey.isValidEd25519PublicKey(expected?.payTo || '') || sdk.StrKey.isValidContract(expected?.payTo || ''))) throw Error('La preparación requiere una transferencia USDC válida de Testnet.');
    return { address, credentialId: kit.credentialId, amount, asset: expected.asset, payTo: expected.payTo, network: expected.network };
  };
  const buildTransfer = (snapshot, timeout) => new sdk.TransactionBuilder(new sdk.Account(SOURCE, '0'), { fee: sdk.BASE_FEE, networkPassphrase: TESTNET_PASSPHRASE }).addOperation(new sdk.Contract(snapshot.asset).call('transfer', new sdk.Address(snapshot.address).toScVal(), new sdk.Address(snapshot.payTo).toScVal(), sdk.nativeToScVal(BigInt(snapshot.amount), { type: 'i128' }))).setTimeout(timeout).build();
  const preparePayment = async ({ expected }) => {
    const snapshot = transferSnapshot(expected), transaction = buildTransfer(snapshot, 300);
    const [simulation, rules] = await Promise.all([server.simulateTransaction(transaction), kit.rules.list()]);
    if (simulation.error || simulation.restorePreamble || simulation.result?.auth?.length !== 1) throw Error('Stellar no pudo simular la transferencia autorizada.');
    const entry = simulation.result.auth[0];
    assertTransferEntry(sdk, entry, snapshot);
    const token = Object.freeze({});
    preparations.set(token, { snapshot, entryXdr: entry.toXDR('base64'), rules, createdAt: Date.now() });
    return token;
  };
  const post = async (path, body) => {
    const response = await fetchImpl(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) throw Error(value.message || value.error?.message || (typeof value.error === 'string' ? value.error : null) || 'No se pudo autenticar la sesión.');
    return value;
  };
  return {
    get address() { return address; },
    async connect() {
      if (connecting) throw Error('Ya hay una conexion de passkey en curso.');
      connecting = true; connectionProof = null;
      try {
        let session;
        try { session = await kit.connectWallet({ fresh: true }); }
        catch (error) {
          const candidateAddress = error?.context?.contractId, proof = connectionProof;
          // Only an incomplete indexer lookup can enter recovery. Ownership,
          // code-identity and constructor failures keep their original error.
          if (error?.name !== 'WalletProvenanceError' || error.code !== 2005 || !/indexer/i.test(error.message) || !sdk.StrKey.isValidContract(candidateAddress || '') || !proof?.response?.id || typeof proof.challenge !== 'string') throw error;
          const response = await fetchImpl('/api/wallet/birth-receipt', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: candidateAddress, credentialId: proof.response.id }), signal: AbortSignal.timeout(15000) });
          const receipt = await response.json();
          if (!response.ok) throw Error(receipt.message || 'El historial de esta wallet no se pudo verificar.');
          const fields = ['address','credentialId','publicKeyBase64Url','birthWasmHash','creationTransactionHash','creationLedger','network'];
          if (Object.keys(receipt).some(field => !fields.includes(field)) || receipt.address !== candidateAddress || receipt.credentialId !== proof.response.id || receipt.network !== 'testnet' || receipt.birthWasmHash !== config.accountWasmHash || !/^[0-9a-f]{64}$/.test(receipt.creationTransactionHash || '') || !Number.isSafeInteger(receipt.creationLedger) || receipt.creationLedger < 1 || !/^[A-Za-z0-9_-]{87}$/.test(receipt.publicKeyBase64Url || '')) throw Error('El recibo no corresponde a esta passkey y su wallet de prueba.');
          const publicKey = Uint8Array.from(atob(receipt.publicKeyBase64Url.replace(/-/g,'+').replace(/_/g,'/') + '='), value => value.charCodeAt(0));
          if (publicKey.length !== 65 || publicKey[0] !== 4) throw Error('La clave publica del recibo no es valida.');
          const original = await storage.get(proof.response.id);
          if (original && (original.contractId && original.contractId !== candidateAddress || original.isPrimary === false || original.birthConstructorArgsHash || original.publicKey && (original.publicKey.length !== publicKey.length || !publicKey.every((byte,index) => original.publicKey[index] === byte)))) throw Error('La asociacion local de esta passkey requiere una revision.');
          const candidate = { ...(original || {}), credentialId: proof.response.id, publicKey, contractId: candidateAddress, createdAt: original?.createdAt || Date.now(), birthWasmHash: receipt.birthWasmHash, creationTransactionHash: receipt.creationTransactionHash, creationLedger: receipt.creationLedger, deploymentStatus: 'pending' };
          // Do not copy a constructor hash or approval flag from a server receipt.
          // The public SDK verifies birth and live signer, then requests a NEW
          // ownership assertion. The first prompt only selected the credential.
          delete candidate.birthConstructorArgsHash; delete candidate.associationVerified;
          await storage.save(candidate);
          try { session = await kit.connectWallet({ credentialId: proof.response.id, contractId: candidateAddress }); if ((session?.contractId || kit.contractId) !== candidateAddress || kit.credentialId !== proof.response.id) throw Error('La wallet verificada no corresponde al intento de conexion.'); }
          catch (failure) { if (original) await storage.save(original); else await storage.delete(proof.response.id); throw failure; }
        }
        const connectedAddress = session?.contractId || kit.contractId;
        if (!connectedAddress || !sdk.StrKey.isValidContract(connectedAddress) || !kit.credentialId) throw Error('Primero crea o conecta la wallet passkey de ONE16.');
        address = connectedAddress;
        return { address, credentialId: kit.credentialId };
      } finally { connectionProof = null; connecting = false; }
    },
    async authenticate() {
      if (!address || !kit.credentialId) throw Error('Conecta tu wallet antes de continuar.');
      const challenge = await post('/api/ads/auth/challenge', { address, credentialId: kit.credentialId });
      const options = challenge.options || challenge.publicKey || Object.fromEntries(Object.entries(challenge).filter(([key]) => key !== 'challengeId'));
      if (!challenge.challengeId || options.rpId !== config.rpId || options.userVerification !== 'required') throw Error('El reto de autenticación no es válido.');
      const response = await sdk.startAuthentication({ optionsJSON: options });
      const session = await post('/api/ads/auth/verify', { challengeId: challenge.challengeId, response });
      return { address, identity: session.identity, ...(session.purchaseEligibility?{purchaseEligibility:session.purchaseEligibility}:{}) };

    },
    preparePayment,
    async signPayment({ challenge, expected, prepared }) {
      if (signing) throw Error('Ya hay una autorización de pago en curso.');
      signing = true;
      try {
        const accepted = validatePaymentRequirements(challenge, expected);
        const resource = new URL(challenge.resource?.url, browser.location.origin);
        if (resource.origin !== browser.location.origin || expected.resourceUrl && resource.href !== new URL(expected.resourceUrl, browser.location.origin).href) throw Error('El recurso de pago no corresponde a esta orden.');
        const snapshot = transferSnapshot(expected);
        const token = prepared === undefined ? await preparePayment({ expected }) : prepared;
        const state = token && typeof token === 'object' ? preparations.get(token) : null;
        if (!state || Date.now() - state.createdAt > 300000 || JSON.stringify(state.snapshot) !== JSON.stringify(snapshot)) throw Error('La preparación del pago venció o no corresponde a esta transferencia.');
        preparations.delete(token);
        const entry = sdk.xdr.SorobanAuthorizationEntry.fromXDR(state.entryXdr, 'base64');
        assertTransferEntry(sdk, entry, snapshot);
        const rootXdr = entry.rootInvocation().toXDR('base64'), nonce = entry.credentials().value().nonce().toString();
        // Refresh immediately before WebAuthn: preparation can precede the server challenge.
        const latest = await server.getLatestLedger();
        if (!Number.isSafeInteger(latest.sequence) || latest.sequence < 1) throw Error('No se pudo comprobar el ledger antes de firmar.');
        const contextRuleIds = selectPaymentRuleIds(state.rules, { credentialId: kit.credentialId, asset: accepted.asset, ledger: latest.sequence, credentialOf: sdk.getCredentialIdFromSigner, verifierAddress: config.webauthnVerifierAddress });
        const expiration = latest.sequence + Math.ceil(accepted.maxTimeoutSeconds / 5);
        if (expiration > 0xffffffff) throw Error('La expiración de la autorización no es válida.');
        const signed = await kit.signAuthEntry(entry, { credentialId: kit.credentialId, expiration, contextRuleIds });
        assertTransferEntry(sdk, signed, snapshot);
        const credentials = signed.credentials().value(), signature = credentials.signature();
        if (signed.rootInvocation().toXDR('base64') !== rootXdr || credentials.nonce().toString() !== nonce || credentials.signatureExpirationLedger() !== expiration || signature.switch().name === 'scvVoid' || signature.switch().name === 'scvVec' && !signature.vec()?.length) throw Error('La autorización firmada no conserva la transferencia preparada.');
        const authXdr = signed.toXDR('base64'), transaction = buildTransfer(snapshot, accepted.maxTimeoutSeconds), envelope = transaction.toEnvelope();
        envelope.v1().tx().operations()[0].body().invokeHostFunctionOp().auth([signed]);
        const signedTx = sdk.TransactionBuilder.fromXDR(envelope.toXDR('base64'), TESTNET_PASSPHRASE);
        // __check_auth and its footprint only exist after the real passkey payload is attached.
        const simulation = await server.simulateTransaction(signedTx, undefined, 'enforce');
        if (simulation.error || simulation.restorePreamble || typeof simulation.transactionData?.build !== 'function' || !/^[0-9]+$/.test(simulation.minResourceFee || '') || !simulation.result || Number.isSafeInteger(simulation.latestLedger) && simulation.latestLedger >= expiration) throw Error('Stellar no pudo verificar los recursos de la autorización firmada.');
        const assembled = sdk.rpc.assembleTransaction(signedTx, simulation).build();
        const operation = assembled.operations[0];
        if (assembled.operations.length !== 1 || operation?.type !== 'invokeHostFunction' || operation.source !== signedTx.operations[0].source || operation.func.toXDR('base64') !== signedTx.operations[0].func.toXDR('base64') || operation.auth?.length !== 1 || operation.auth[0].toXDR('base64') !== authXdr || assembled.signatures.length || assembled.source !== signedTx.source || assembled.sequence !== signedTx.sequence || assembled.networkPassphrase !== TESTNET_PASSPHRASE || JSON.stringify(assembled.timeBounds) !== JSON.stringify(signedTx.timeBounds) || BigInt(assembled.fee) < BigInt(simulation.minResourceFee) + BigInt(sdk.BASE_FEE) || assembled.toEnvelope().v1().tx().ext().value()?.toXDR('base64') !== simulation.transactionData.build().toXDR('base64')) throw Error('La preparación final alteró la autorización o la comisión de la transferencia.');
        return { x402Version: 2, resource: challenge.resource, accepted, payload: { transaction: assembled.toXDR() } };
      } finally { signing = false; }
    },
  };
}
