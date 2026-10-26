import { ADS_USDC, createAdsWallet, validatePaymentRequirements } from './ads-wallet.mjs';
export const COMPATIBILITY_AMOUNT = '50000000';
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hashPattern = /^[a-f0-9]{64}$/i;
const rejectionMessages=Object.freeze({
 invalid_exact_stellar_payload_fee_exceeds_maximum:'La comisión estimada supera el límite del facilitador.',
 invalid_exact_stellar_payload_simulation_failed:'El facilitador no pudo simular esta autorización.',
 invalid_exact_stellar_signature_expiration_too_far:'La vigencia de la firma supera el límite del facilitador.',
});
const failure = (code, message) => Object.assign(new Error(message), { code });
export function validateCompatibilityConfig(config) {
  if (config.network !== 'stellar:testnet' || config.asset !== ADS_USDC || !/^G[A-Z2-7]{55}$/.test(config.payTo || '') || !config.offers?.some(offer => offer.id === 'main-stage-test-5m' && offer.amountUnits === COMPATIBILITY_AMOUNT)) throw failure('configuration_mismatch', 'El diagnóstico requiere el receptor y los 5 USDC de prueba publicados para Stellar Testnet.');
  return { network: config.network, asset: config.asset, payTo: config.payTo, amountUnits: COMPATIBILITY_AMOUNT, checkoutEnabled: config.enabled === true };
}
export function validateCompatibilityChallenge(value, config, address, origin, now = Date.now()) {
  const expected = value?.expected;
  if (!idPattern.test(value?.id || '') || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= now || Date.parse(value.expiresAt) > now + 300000 || expected?.payer !== address || expected.amountUnits !== COMPATIBILITY_AMOUNT || expected.network !== config.network || expected.asset !== config.asset || expected.payTo !== config.payTo) throw failure('challenge_mismatch', 'El reto no coincide con tu wallet, el receptor y el importe de esta prueba.');
  let resource;
  try { resource = new URL(expected.resourceUrl, origin); } catch { throw failure('challenge_mismatch', 'El recurso del reto no es válido.'); }
  if (resource.origin !== origin || resource.pathname !== '/api/ads/compatibility/' + value.id + '/verify' || resource.search || resource.hash || new URL(value.challenge?.resource?.url, origin).href !== resource.href) throw failure('challenge_mismatch', 'El reto debe pertenecer al verificador de este mismo dominio.');
  const requirement = validatePaymentRequirements(value.challenge, expected);
  if (requirement.maxTimeoutSeconds > 60) throw failure('challenge_mismatch', 'La autorización del diagnóstico debe tener una duración breve.');
  return value;
}
export function compatibilityVerdict(value, id, address) {
  const waiting = ['VERIFYING', 'RECONCILIATION_REQUIRED'].includes(value?.status);
  if (value?.id !== id || value.gateChanged !== false || !['VERIFIED', 'REJECTED', 'VERIFYING', 'RECONCILIATION_REQUIRED'].includes(value.status) || (waiting ? value.isValid !== null : value.isValid !== (value.status === 'VERIFIED')) || value.isValid === true && value.payer !== address) throw failure('unverifiable_result', 'No se pudo verificar la respuesta del diagnóstico.');
  const evidence = {};
  for (const key of ['authHash', 'payloadHash', 'requirementsHash', 'verificationHash']) if (hashPattern.test(value.evidence?.[key] || '')) evidence[key] = value.evidence[key].toLowerCase();
  if (value.isValid && (!evidence.authHash || !evidence.payloadHash)) throw failure('unverifiable_result', 'La respuesta aceptada no incluye los hashes de evidencia.');
  const reason=value.status==='REJECTED'&&value.errorCode==='facilitator_rejected'&&Object.hasOwn(rejectionMessages,value.verificationReason)?value.verificationReason:null;
  return { isValid: value.isValid, waiting, evidence, ...(reason?{verificationReason:reason}:{}) };
}
export function createCompatibilityApi({ fetchImpl = fetch } = {}) {
  return async (path, { method = 'GET', body, key } = {}) => {
    const response = await fetchImpl(path, { method, credentials: 'same-origin', cache: 'no-store', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let value;
    try { value = await response.json(); } catch { throw failure('unverifiable_result', 'El servidor no devolvió una respuesta verificable.'); }
    if (!response.ok) {
      const code = /^[a-z0-9_-]{1,80}$/i.test(value.error?.code || '') ? value.error.code : 'request_failed';
      throw Object.assign(failure(code, response.status === 401 ? 'La sesión caducó. Conecta otra vez tu passkey.' : response.status === 403 ? 'Esta sesión no tiene acceso al diagnóstico de este dominio.' : 'El diagnóstico no pudo completarse. Código: ' + code + '. No se solicitó liquidación.'), { status: response.status });
    }
    return value;
  };
}
/** Signed payloads stay in this closure only. No settlement, storage or wallet provisioning APIs are used. */
export function createCompatibilityController({ api = createCompatibilityApi(), walletFactory = createAdsWallet, origin = globalThis.location?.origin, now = Date.now, newKey = () => crypto.randomUUID(), onState = () => {} } = {}) {
  let config, wallet, address, busy = false, draft = null, pending = null, challengeKey = null;
  let view = { phase: 'loading', connected: false, retry: false, config: null, address: null, evidence: null, isValid: null, message: 'Comprobando configuración…' };
  const emit = patch => { view = { ...view, ...patch }; onState({ ...view }); };
  async function loadConfig() { config = validateCompatibilityConfig(await api('/api/ads/config')); emit({ config: { ...config } }); return config; }
  async function action(work) {
    if (busy) return;
    busy = true;
    try { return await work(); }
    catch (error) { if (pending) pending.uncertain = true; emit({ phase: 'error', retry: !!pending, message: error.name === 'NotAllowedError' ? 'La confirmación de passkey se canceló. Puedes volver a intentarlo.' : error.message }); }
    finally { busy = false; }
  }
  return {
    get state() { return { ...view }; },
    async load() { return action(async () => { await loadConfig(); emit({ phase: 'ready', message: 'Diagnóstico disponible. Las compras conservan su configuración actual.' }); }); },
    async connect() { return action(async () => {
      emit({ phase: 'connecting', connected: false, retry: false, evidence: null, isValid: null, message: 'Selecciona la passkey de tu wallet existente de ONE16.' });
      draft = null; pending = null; challengeKey = null; address = null;
      await loadConfig();
      const walletConfig = await api('/api/wallet/config');
      wallet = await walletFactory(walletConfig);
      const connection = await wallet.connect(), session = await wallet.authenticate();
      if (!/^C[A-Z2-7]{55}$/.test(connection?.address || '') || session.identity?.address !== connection.address || wallet.address !== connection.address) throw failure('identity_mismatch', 'La sesión debe corresponder a la misma wallet C conectada con tu passkey.');
      address = connection.address;
      emit({ phase: 'connected', connected: true, address, message: 'Wallet autenticada. Revisa el importe y el receptor antes de autorizar la prueba.' });
    }); },
    async verify() { return action(async () => {
      if (!address || !view.connected || !wallet) throw failure('authentication_required', 'Conecta primero tu passkey existente.');
      emit({ phase: 'verifying', retry: false, evidence: null, isValid: null, message: pending ? 'Reintentando verificar la misma autorización…' : 'Solicitando un reto de verificación de 5 USDC de prueba…' });
      if (pending && !pending.uncertain && Date.parse(pending.expiresAt) <= now()) { pending = null; draft = null; challengeKey = null; }
      if (!pending) {
        await loadConfig();
        if (draft && Date.parse(draft.expiresAt) <= now()) { draft = null; challengeKey = null; }
        if (!draft) {
          challengeKey ||= newKey();
          draft = validateCompatibilityChallenge(await api('/api/ads/compatibility/challenge', { method: 'POST', body: {}, key: challengeKey }), config, address, origin, now());
        }
        draft = validateCompatibilityChallenge(draft, config, address, origin, now());
        emit({ message: 'Confirma con tu passkey una autorización de 5 USDC de prueba. Este diagnóstico sólo verificará su validez.' });
        const payload = await wallet.signPayment({ challenge: draft.challenge, expected: draft.expected });
        if (Date.parse(draft.expiresAt) <= now()) { draft = null; challengeKey = null; throw failure('challenge_expired', 'El reto caducó durante la confirmación. Inicia otra prueba explícitamente.'); }
        pending = { id: draft.id, payload, expiresAt: draft.expiresAt, key: newKey() };
      }
      const result = compatibilityVerdict(await api('/api/ads/compatibility/' + pending.id + '/verify', { method: 'POST', body: { payload: pending.payload }, key: pending.key }), pending.id, address);
      if (result.waiting) { pending.uncertain = true; emit({ phase: 'pending', retry: true, isValid: null, evidence: result.evidence, message: 'La verificación original sigue pendiente. Puedes consultar el mismo intento; no se pedirá otra firma ni se solicitará liquidación.' }); return; }
      pending = null; draft = null; challengeKey = null;
      emit({ phase: result.isValid ? 'verified' : 'rejected', retry: false, isValid: result.isValid, evidence: result.evidence, message: result.isValid ? 'Verificación aceptada. La autorización no se envió a liquidación. Un operador debe revisar la evidencia antes de habilitar compras.' : 'Verificación rechazada. La autorización no se envió a liquidación; las compras conservan su configuración.'+(result.verificationReason?' '+rejectionMessages[result.verificationReason]:'') });
    }); },
  };
}
export function initCompatibilityPage(documentRef = document, options = {}) {
  const $ = id => documentRef.getElementById(id);
  const controller = createCompatibilityController({ ...options, onState: state => {
    const busy = ['loading', 'connecting', 'verifying'].includes(state.phase);
    $('diagnosticStatus').textContent = state.message;
    $('diagnosticStatus').dataset.phase = state.phase;
    $('connectWallet').disabled = busy || !state.config;
    $('verifyWallet').disabled = busy || !state.connected || !state.config;
    $('verifyWallet').textContent = state.retry ? 'Reintentar la misma verificación' : 'Autorizar 5 USDC de prueba y verificar';
    $('connectedAddress').textContent = state.address || 'Passkey sin conectar';
    $('recipientAddress').textContent = state.config?.payTo || 'Pendiente de confirmar';
    $('tokenAddress').textContent = state.config?.asset || 'Pendiente de confirmar';
    $('checkoutStatus').textContent = state.config ? state.config.checkoutEnabled ? 'El checkout está habilitado por su configuración. Este diagnóstico no modifica ese estado.' : 'El checkout sigue deshabilitado. Este diagnóstico no cambia su configuración.' : 'Sin configuración verificable';
    $('evidencePanel').hidden = !state.evidence;
    $('verdict').textContent = state.isValid === true ? 'VERIFICACIÓN ACEPTADA' : state.isValid === false ? 'VERIFICACIÓN RECHAZADA' : state.phase === 'pending' ? 'VERIFICACIÓN PENDIENTE' : '';
    $('authHash').textContent = state.evidence?.authHash || 'Sin evidencia de autorización';
    $('payloadHash').textContent = state.evidence?.payloadHash || 'Sin evidencia del payload';
    $('requirementsHash').textContent = state.evidence?.requirementsHash || 'Pendiente';
    $('verificationHash').textContent = state.evidence?.verificationHash || 'Pendiente';
  } });
  $('connectWallet').addEventListener('click', () => { void controller.connect(); });
  $('verifyWallet').addEventListener('click', () => { void controller.verify(); });
  void controller.load();
  return controller;
}
if (typeof document !== 'undefined') initCompatibilityPage();
