import { HEX_ID } from './reservations-state.mjs';

export const TESTNET = 'Test SDF Network ; September 2015';
const RPC = 'https://soroban-testnet.stellar.org';
const encoded = value => value.toXDR('base64');
const bytesHex = value => {
  if (value.switch().name !== 'scvBytes' || value.bytes().length !== 32) throw Error('La operación contiene un identificador inválido.');
  return Array.from(value.bytes(), byte => byte.toString(16).padStart(2, '0')).join('');
};
function credentials(entry) {
  const value = entry.credentials();
  if (!['sorobanCredentialsAddress', 'sorobanCredentialsAddressV2'].includes(value.switch().name)) throw Error('La autorización no es de esta wallet.');
  return value.value();
}
export function assertReservationConfig(config, browser) {
  if (config?.network !== 'stellar:testnet' || config.networkPassphrase !== TESTNET || config.rpcUrl !== RPC || config.origin !== browser.location?.origin || config.rpId !== browser.location?.hostname) throw Error('Abre el origen oficial configurado para usar tu passkey de Testnet.');
  if (!browser.isSecureContext || !browser.navigator?.credentials || !browser.PublicKeyCredential) throw Error('La passkey requiere un navegador compatible y un origen seguro.');
}

/** Verify the function and its only authorization against the review already shown to this actor. */
export function validateReservationPreparation(sdk, prepared, config, expected, now = Date.now()) {
  const { attempt, review, signing } = prepared || {};
  if (!['publish', 'reserve'].includes(expected?.operation) || attempt?.state !== 'PREPARED' || !HEX_ID.test(attempt?.id || '') || attempt.operation !== expected.operation || attempt.actorAddress !== expected.actorAddress || !Number.isFinite(Date.parse(attempt.expiresAt)) || Date.parse(attempt.expiresAt) <= now) throw Error('La intención no está lista para esta cuenta. Consulta su estado.');
  const snapshot = expected.snapshot;
  if (!snapshot || ![snapshot.id, snapshot.projectId, snapshot.spaceId, attempt.offerId].every(id => HEX_ID.test(id || '')) || snapshot.projectId !== config.projectId || attempt.snapshotId !== snapshot.id || snapshot.space?.id !== snapshot.spaceId || expected.offerId && expected.offerId !== attempt.offerId) throw Error('La intención no corresponde a la versión revisada.');
  if (!review || review.operation !== expected.operation || review.offerId !== attempt.offerId || review.snapshotId !== snapshot.id || review.projectId !== snapshot.projectId || review.spaceId !== snapshot.spaceId || review.actorAddress !== expected.actorAddress || review.title !== snapshot.title || review.spaceName !== snapshot.space.name || review.network !== 'stellar:testnet' || review.paymentRequired !== false || review.contractId !== config.contractId) throw Error('El resumen cambió respecto de tu revisión.');
  if (!signing || signing.signerAddress !== expected.actorAddress || signing.networkPassphrase !== TESTNET || config.networkPassphrase !== TESTNET || signing.rpcUrl !== RPC || config.rpcUrl !== RPC || signing.contractId !== config.contractId || signing.method !== expected.operation || JSON.stringify(signing.contextRuleIds) !== '[0]' || !Number.isSafeInteger(signing.expirationLedger) || signing.expirationLedger < 1 || signing.expirationLedger > 0xffffffff || typeof signing.func !== 'string' || signing.func.length > 8192 || !Array.isArray(signing.auth) || signing.auth.length !== 1 || typeof signing.auth[0] !== 'string' || signing.auth[0].length > 32768) throw Error('La preparación de firma no es válida.');
  if (!sdk.StrKey.isValidContract(config.contractId) || !sdk.StrKey.isValidContract(expected.actorAddress)) throw Error('La cuenta o el contrato no son válidos.');
  const func = sdk.xdr.HostFunction.fromXDR(signing.func, 'base64');
  if (func.switch().name !== 'hostFunctionTypeInvokeContract') throw Error('Sólo se admite una llamada al contrato de reservas.');
  const invocation = func.invokeContract(), args = invocation.args();
  if (sdk.Address.fromScAddress(invocation.contractAddress()).toString() !== config.contractId || invocation.functionName().toString() !== expected.operation) throw Error('El contrato o la acción cambiaron.');
  if (expected.operation === 'publish') {
    if (args.length !== 3 || bytesHex(args[0]) !== snapshot.projectId || bytesHex(args[1]) !== attempt.offerId || bytesHex(args[2]) !== snapshot.spaceId) throw Error('La publicación no coincide con proyecto, oferta y espacio.');
  } else if (args.length !== 2 || bytesHex(args[0]) !== attempt.offerId || args[1].switch().name !== 'scvAddress' || sdk.Address.fromScAddress(args[1].address()).toString() !== expected.actorAddress) throw Error('La reserva no coincide con la oferta y la cuenta.');
  const entry = sdk.xdr.SorobanAuthorizationEntry.fromXDR(signing.auth[0], 'base64');
  const auth = credentials(entry), root = entry.rootInvocation();
  if (sdk.Address.fromScAddress(auth.address()).toString() !== expected.actorAddress || auth.signatureExpirationLedger() !== signing.expirationLedger || auth.signature().switch().name !== 'scvVoid' || root.subInvocations().length || root.function().switch().name !== 'sorobanAuthorizedFunctionTypeContractFn' || encoded(root.function().contractFn()) !== encoded(invocation)) throw Error('La autorización contiene cambios u operaciones adicionales.');
  return entry;
}

export async function createReservationsWallet(config, { loadSdk = () => import('./vendor/reservations-wallet/kit.mjs'), browser = globalThis, api } = {}) {
  assertReservationConfig(config, browser);
  const sdk = await loadSdk();
  if (!/^[a-f0-9]{64}$/.test(config.accountWasmHash || '') || !sdk.StrKey.isValidContract(config.webauthnVerifierAddress || '')) throw Error('Falta la configuración verificada de la wallet.');
  const kit = new sdk.SmartAccountKit({
    rpcUrl: config.rpcUrl, networkPassphrase: TESTNET,
    accountWasmHash: config.accountWasmHash, acceptedWasmHashes: [config.accountWasmHash],
    webauthnVerifierAddress: config.webauthnVerifierAddress,
    // No deployment or submit method is exposed by this adapter.
    relayerUrl: '/api/wallet/relay', rpId: config.rpId, rpName: 'ONE16 Testnet',
    storage: new sdk.IndexedDBStorage(),
    webAuthn: { startAuthentication: sdk.startAuthentication, startRegistration: async () => { throw Error('Conecta una wallet existente desde ONE16.'); } },
  });
  let address = null, busy = false, challenge = null;
  const prepared = new WeakMap();
  return {
    get address() { return address; },
    async connect() {
      if (busy) throw Error('Ya hay una interacción de passkey en curso.');
      busy = true; challenge = null;
      try {
        const session = await kit.connectWallet({ fresh: true });
        const candidate = session?.contractId || kit.contractId;
        if (!sdk.StrKey.isValidContract(candidate || '') || !kit.credentialId) throw Error('No pudimos verificar una wallet existente.');
        address = candidate; return { address, credentialId: kit.credentialId };
      } finally { busy = false; }
    },
    async prepareAuthentication() {
      if (!address || !kit.credentialId) throw Error('Conecta tu wallet antes de verificar el acceso.');
      challenge = null;
      const value = await api.request('/auth/challenge', { method: 'POST', body: { address, credentialId: kit.credentialId } });
      if (!HEX_ID.test(value.challengeId || '') || value.options?.rpId !== config.rpId || value.options.userVerification !== 'required' || value.options.allowCredentials?.length !== 1 || value.options.allowCredentials[0].id !== kit.credentialId || !/^[A-Za-z0-9_-]{43}$/.test(value.options.challenge || '') || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) throw Error('El reto de acceso no corresponde a esta passkey.');
      challenge = value; return { expiresAt: value.expiresAt };
    },
    async authenticate() {
      if (busy || !challenge || Date.parse(challenge.expiresAt) <= Date.now()) throw Error('La verificación venció. Conecta de nuevo para preparar otra.');
      busy = true; const pending = challenge; challenge = null;
      try {
        const response = await sdk.startAuthentication({ optionsJSON: pending.options });
        const session = await api.request('/auth/verify', { method: 'POST', body: { challengeId: pending.challengeId, response } });
        if (session.identity?.address !== address || !['host', 'brand'].includes(session.identity.role)) throw Error('La sesión no corresponde a tu wallet.');
        return session;
      } finally { busy = false; }
    },
    prepare(preparation, expected) {
      if (!address || expected.actorAddress !== address) throw Error('Conecta la misma wallet que inició esta sesión.');
      validateReservationPreparation(sdk, preparation, config, expected);
      const token = Object.freeze({});
      prepared.set(token, { preparation: JSON.parse(JSON.stringify(preparation)), expected: JSON.parse(JSON.stringify(expected)), credentialId: kit.credentialId });
      return token;
    },
    async sign(token) {
      const saved = prepared.get(token);
      if (busy || !saved || saved.expected.actorAddress !== address || saved.credentialId !== kit.credentialId) throw Error('La firma requiere una intención revisada y la misma passkey.');
      prepared.delete(token); busy = true;
      try {
        const entry = validateReservationPreparation(sdk, saved.preparation, config, saved.expected);
        const unsigned = encoded(entry), signing = saved.preparation.signing;
        const signed = await kit.signAuthEntry(entry, { credentialId: saved.credentialId, expiration: signing.expirationLedger, contextRuleIds: [0] });
        const signature = credentials(signed).signature();
        if (signature.switch().name === 'scvVoid') throw Error('No se recibió una autorización firmada.');
        const signatureValue = sdk.scValToNative(signature);
        if (JSON.stringify(signatureValue?.context_rule_ids?.map(Number)) !== '[0]') throw Error('La firma cambió la regla de autorización.');
        const copy = sdk.xdr.SorobanAuthorizationEntry.fromXDR(encoded(signed), 'base64');
        credentials(copy).signature(sdk.xdr.ScVal.scvVoid());
        if (encoded(copy) !== unsigned) throw Error('La firma cambió la intención, nonce o expiración.');
        return { func: signing.func, auth: [encoded(signed)] };
      } finally { busy = false; }
    },
  };
}
