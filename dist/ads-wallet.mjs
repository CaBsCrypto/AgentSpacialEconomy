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
  if (!requirements || requirements.amount !== String(expected.amountUnits) || requirements.payTo !== expected.payTo || requirements.asset !== expected.asset || expected.network !== 'stellar:testnet' || !/^[1-9][0-9]*$/.test(requirements.amount) || !Number.isFinite(requirements.maxTimeoutSeconds) || requirements.maxTimeoutSeconds <= 0 || requirements.maxTimeoutSeconds > 300) throw Error('La solicitud de pago no coincide con la cotización autorizada.');
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
  const kit = new sdk.SmartAccountKit({ rpcUrl: config.rpcUrl, networkPassphrase: config.networkPassphrase, accountWasmHash: config.accountWasmHash, acceptedWasmHashes: config.acceptedWasmHashes || [config.accountWasmHash], webauthnVerifierAddress: config.webauthnVerifierAddress, relayerUrl: config.relayerUrl || '/api/wallet/relay', rpId: config.rpId, rpName: 'ONE16 Testnet', storage: new sdk.IndexedDBStorage(), ...(config.indexerUrl ? { indexerUrl: config.indexerUrl } : {}) });
  const server = new sdk.rpc.Server(config.rpcUrl);
  let address;
  const post = async (path, body) => {
    const response = await fetchImpl(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) throw Error(value.message || value.error?.message || (typeof value.error === 'string' ? value.error : null) || 'No se pudo autenticar la sesión.');
    return value;
  };
  return {
    get address() { return address; },
    async connect() {
      const session = await kit.connectWallet({ fresh: true });
      address = session?.contractId || kit.contractId;
      if (!address || !sdk.StrKey.isValidContract(address) || !kit.credentialId) throw Error('Primero crea o conecta la wallet passkey de ONE16.');
      return { address, credentialId: kit.credentialId };
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
    async signPayment({ challenge, expected }) {
      if (!address || !kit.credentialId) throw Error('Conecta tu wallet para autorizar el pago.');
      const accepted = validatePaymentRequirements(challenge, expected);
      const resource = new URL(challenge.resource?.url, browser.location.origin);
      if (resource.origin !== browser.location.origin || expected.resourceUrl && resource.href !== new URL(expected.resourceUrl, browser.location.origin).href) throw Error('El recurso de pago no corresponde a esta orden.');
      const latest = await server.getLatestLedger();
      const contextRuleIds = selectPaymentRuleIds(await kit.rules.list(), { credentialId: kit.credentialId, asset: accepted.asset, ledger: latest.sequence, credentialOf: sdk.getCredentialIdFromSigner, verifierAddress: config.webauthnVerifierAddress });
      const transfer = new sdk.Contract(accepted.asset).call('transfer', new sdk.Address(address).toScVal(), new sdk.Address(accepted.payTo).toScVal(), sdk.nativeToScVal(BigInt(accepted.amount), { type: 'i128' }));
      const transaction = new sdk.TransactionBuilder(new sdk.Account(SOURCE, '0'), { fee: sdk.BASE_FEE, networkPassphrase: TESTNET_PASSPHRASE }).addOperation(transfer).setTimeout(accepted.maxTimeoutSeconds).build();
      const simulation = await server.simulateTransaction(transaction);
      if (simulation.error || !simulation.result?.auth?.length) throw Error('Stellar no pudo simular la transferencia autorizada.');
      const entries = simulation.result.auth;
      if (entries.length !== 1) throw Error('La transferencia requiere una autorización no admitida.');
      const expiration = latest.sequence + Math.ceil(accepted.maxTimeoutSeconds / 5);
      const signed = [];
      for (const entry of entries) {
        assertTransferEntry(sdk, entry, { address, asset: accepted.asset, payTo: accepted.payTo, amount: accepted.amount });
        signed.push(await kit.signAuthEntry(entry, { credentialId: kit.credentialId, expiration, contextRuleIds }));
      }
      const assembled = sdk.rpc.assembleTransaction(transaction, simulation).build();
      const envelope = assembled.toEnvelope();
      envelope.v1().tx().operations()[0].body().invokeHostFunctionOp().auth(signed);
      return { x402Version: 2, resource: challenge.resource, accepted, payload: { transaction: envelope.toXDR('base64') } };
    },
  };
}
