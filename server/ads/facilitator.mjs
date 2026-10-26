import { AdsError } from './common.mjs';

export const OPENZEPPELIN_TESTNET_FACILITATOR = 'https://channels.openzeppelin.com/x402/testnet';
export const PUBLIC_TESTNET_FACILITATOR = 'https://x402.org/facilitator';
const NETWORK = 'stellar:testnet', LIMIT = 1_048_576;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message, status = 503) => { throw new AdsError(status, code, message); };

function providerConfiguration(config) {
  if (config?.network !== NETWORK) fail('facilitator_network_invalid', 'Only Stellar Testnet is available.');
  const value = config.facilitatorUrl ?? PUBLIC_TESTNET_FACILITATOR;
  let url;
  try { url = new URL(value); } catch { fail('facilitator_invalid', 'Select an approved Testnet facilitator.'); }
  // Exact spelling also excludes credentials, encoded paths, dot segments,
  // explicit ports, query/fragment and production/mainnet route confusion.
  if (typeof value !== 'string' || url.href !== value || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || ![OPENZEPPELIN_TESTNET_FACILITATOR, PUBLIC_TESTNET_FACILITATOR].includes(value)) fail('facilitator_invalid', 'Select an approved Testnet facilitator.');
  return { url: value, provider: value === OPENZEPPELIN_TESTNET_FACILITATOR ? 'openzeppelin' : 'x402.org' };
}

/** Same path-keyed authentication shape documented by the public x402 SDK. */
export function facilitatorHttpOptions({ config, env = process.env } = {}) {
  const { url, provider } = providerConfiguration(config);
  const configuredTimeout = Number(config.paymentRequestTimeoutMs ?? 20000);
  const timeoutMs = Number.isSafeInteger(configuredTimeout) && configuredTimeout > 0 ? Math.min(configuredTimeout, 20000) : 20000;
  if (provider === 'x402.org') return { url, timeoutMs };
  const key = env.CHANNELS_API_KEY;
  if (typeof key !== 'string' || key.length < 1 || key.length > 4096 || key.trim() !== key || /[^\x21-\x7e]/.test(key)) fail('facilitator_credential_missing', 'Configure the existing Testnet Channels server credential.');
  return { url, timeoutMs, createAuthHeaders: async () => ({ verify: { Authorization: 'Bearer ' + key }, settle: { Authorization: 'Bearer ' + key }, supported: { Authorization: 'Bearer ' + key } }) };
}

async function boundedJson(response) {
  if (response.redirected || Number(response.headers.get('content-length') || 0) > LIMIT) fail('facilitator_response_invalid', 'The facilitator response was not accepted.');
  const reader = response.body?.getReader();
  if (!reader) fail('facilitator_response_invalid', 'The facilitator response was not accepted.');
  let bytes = 0; const chunks = [];
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.length;
      if (bytes > LIMIT) { await reader.cancel(); fail('facilitator_response_invalid', 'The facilitator response exceeded its limit.'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (object(value)) return value; } catch {}
  fail('facilitator_response_invalid', 'The facilitator response was not accepted.');
}
const optionalString = (value, max) => value == null || typeof value === 'string' && value.length <= max;
function verificationResponse(value) {
  if (typeof value.isValid !== 'boolean' || !optionalString(value.invalidReason, 256) || !optionalString(value.invalidMessage, 1024) || !optionalString(value.payer, 128)) fail('facilitator_response_invalid', 'The facilitator verification response was not accepted.');
  return { isValid: value.isValid, ...(value.invalidReason == null ? {} : { invalidReason: value.invalidReason }), ...(value.invalidMessage == null ? {} : { invalidMessage: value.invalidMessage }), ...(value.payer == null ? {} : { payer: value.payer }) };
}
function settlementResponse(value) {
  if (typeof value.success !== 'boolean' || value.network !== NETWORK || typeof value.transaction !== 'string' || !(value.transaction === '' || /^[a-f0-9]{64}$/i.test(value.transaction)) || value.success && !value.transaction || !optionalString(value.errorReason, 256) || !optionalString(value.errorMessage, 1024) || !optionalString(value.payer, 128)) fail('facilitator_response_invalid', 'The facilitator settlement response was not accepted.');
  return { success: value.success, transaction: value.transaction, network: NETWORK, ...(value.errorReason == null ? {} : { errorReason: value.errorReason }), ...(value.errorMessage == null ? {} : { errorMessage: value.errorMessage }), ...(value.payer == null ? {} : { payer: value.payer }) };
}
function supportedResponse(value) {
  if (!Array.isArray(value.kinds) || value.kinds.length > 100 || !value.kinds.every(kind => object(kind) && Number.isSafeInteger(kind.x402Version) && typeof kind.scheme === 'string' && typeof kind.network === 'string' && (kind.extra == null || object(kind.extra))) || value.extensions != null && (!Array.isArray(value.extensions) || !value.extensions.every(item => typeof item === 'string')) || value.signers != null && (!object(value.signers) || !Object.values(value.signers).every(signers => Array.isArray(signers) && signers.every(signer => typeof signer === 'string')))) fail('facilitator_response_invalid', 'The facilitator supported response was not accepted.');
  return { kinds: value.kinds.map(kind => ({ x402Version: kind.x402Version, scheme: kind.scheme, network: kind.network, ...(kind.extra == null ? {} : { extra: kind.extra }) })), extensions: value.extensions || [], signers: value.signers || {} };
}

/** Public FacilitatorClient interface; strict redirects prevent credential forwarding. */
export function createConfiguredFacilitatorClient({ config, env = process.env, fetchImpl = fetch } = {}) {
  const options = facilitatorHttpOptions({ config, env });
  async function request(path, payload, requirements) {
    if (path !== 'supported' && (payload?.x402Version !== 2 || payload?.accepted?.network !== NETWORK || payload.accepted.scheme !== 'exact' || requirements?.network !== NETWORK || requirements.scheme !== 'exact')) fail('facilitator_payment_invalid', 'Only explicit exact Stellar Testnet requests are available.', 422);
    const auth = options.createAuthHeaders ? (await options.createAuthHeaders())[path] : {};
    let response;
    try {
      response = await fetchImpl(options.url + '/' + path, { method: path === 'supported' ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...auth }, redirect: 'error', signal: AbortSignal.timeout(path === 'supported' ? 12000 : options.timeoutMs), ...(path === 'supported' ? {} : { body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements }) }) });
    } catch { fail('facilitator_request_unavailable', 'The configured Testnet facilitator is unavailable.'); }
    if (response.status >= 300 && response.status < 400) fail('facilitator_redirect_rejected', 'Facilitator redirects are not accepted.');
    const value = await boundedJson(response);
    if (path === 'verify' && (response.ok || value.isValid === false)) return verificationResponse(value);
    if (path === 'settle' && (response.ok || value.success === false)) return settlementResponse(value);
    if (path === 'supported' && response.ok) return supportedResponse(value);
    fail('facilitator_request_rejected', 'The configured Testnet facilitator rejected the request.');
  }
  return Object.freeze({ verify: (payload, requirements) => request('verify', payload, requirements), settle: (payload, requirements) => request('settle', payload, requirements), getSupported: () => request('supported') });
}

/** Discovery only; no transaction, authorization, signer list or key is returned. */
export async function probeConfiguredFacilitator({ config, env = process.env, fetchImpl = fetch } = {}) {
  const { provider } = providerConfiguration(config);
  const base = { check: 'facilitator', provider, network: NETWORK, x402Version: 2, scheme: 'exact' };
  try {
    const supported = await createConfiguredFacilitatorClient({ config, env, fetchImpl }).getSupported();
    const match = supported.kinds.find(kind => kind.x402Version === 2 && kind.network === NETWORK && kind.scheme === 'exact' && kind.extra?.areFeesSponsored === true);
    return { ...base, ok: !!match, areFeesSponsored: !!match, supportsTestnet: !!match };
  } catch { return { ...base, ok: false, areFeesSponsored: false, supportsTestnet: false }; }
}
