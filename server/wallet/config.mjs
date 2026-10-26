import { createHash } from 'node:crypto';
import { Asset, Networks, StrKey } from '@stellar/stellar-sdk';

// Source: stellar/smart-account-kit demo/.env.example, stellar-accounts v0.8.0.
export const TESTNET = Networks.TESTNET;
export const RPC_URL = 'https://soroban-testnet.stellar.org';
export const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
export const USDC_TOKEN = new Asset('USDC', USDC_ISSUER).contractId(TESTNET);
export const ACCOUNT_WASM = 'c514d35ea67eaea9bfc1fb3327854c0c06111bc1ddebd4fe217c504c1004b9e1';
export const WEBAUTHN_VERIFIER = 'CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F';
export const DEFAULT_ORIGIN = 'https://agenticreality.space';
export const SOZU_ORIGIN = 'https://faucet.sozu.capital';
export const CHANNELS_URL = 'https://channels.openzeppelin.com/testnet/';
export const SHARED_DEPLOYER = 'GAAH4OT36RRCCAGKARGPN2HLHT2NOBVFHO4GUHA6CF7UKQ4MMV24WQ4N';

export function readConfig(env = process.env) {
  const origin = env.WALLET_ORIGIN || DEFAULT_ORIGIN;
  const missing = [];
  if (!env.CHANNELS_API_KEY) missing.push('CHANNELS_API_KEY');
  if (!(env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL)) missing.push('UPSTASH_REDIS_REST_URL');
  if (!(env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN)) missing.push('UPSTASH_REDIS_REST_TOKEN');
  const errors = [];
  let rpId;
  try {
    const url = new URL(origin);
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && env.VERCEL_ENV !== 'production';
    if (url.origin !== origin || (url.protocol !== 'https:' && !local)) throw Error();
    rpId = url.hostname;
  } catch { errors.push('WALLET_ORIGIN'); }
  const accountWasmHash = env.WALLET_ACCOUNT_WASM_HASH || ACCOUNT_WASM;
  if (!/^[a-f0-9]{64}$/.test(accountWasmHash)) errors.push('WALLET_ACCOUNT_WASM_HASH');
  const webauthnVerifierAddress = env.WALLET_WEBAUTHN_VERIFIER || WEBAUTHN_VERIFIER;
  if (!StrKey.isValidContract(webauthnVerifierAddress)) errors.push('WALLET_WEBAUTHN_VERIFIER');
  const campaign = env.WALLET_CAMPAIGN || 'one16-testnet-pilot-v1';
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(campaign)) errors.push('WALLET_CAMPAIGN');
  const allowedOrigins = new Set([origin]);
  const previewOrigin = env.VERCEL_ENV === 'preview' && /^[a-z0-9.-]+\.vercel\.app$/i.test(env.VERCEL_URL || '') ? 'https://' + env.VERCEL_URL : null;
  if (previewOrigin) allowedOrigins.add(previewOrigin);
  for (const value of (env.WALLET_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)) {
    try { if (new URL(value).origin !== value || !value.startsWith('https://')) throw Error(); allowedOrigins.add(value); }
    catch { errors.push('WALLET_ALLOWED_ORIGINS'); }
  }
  const configured = missing.length === 0 && errors.length === 0;
  return {
    configured, enabled: env.WALLET_ENABLED === 'true' && configured,
    missing: [...missing, ...errors], origin, allowedOrigins, previewOrigin, campaign,
    rpcUrl: RPC_URL, networkPassphrase: TESTNET, accountWasmHash,
    webauthnVerifierAddress, tokenContract: USDC_TOKEN, rpId,
    relayerUrl: '/api/wallet/relay', claimAmount: 100, cooldownMinutes: 60,
    maxResourceFee: 10_000_000n,
  };
}

export function publicConfig(config, request) {
  const requestedOrigin = request ? new URL(request.url).origin : config.origin;
  if (config.previewOrigin && requestedOrigin === config.previewOrigin) config = { ...config, origin: config.previewOrigin, rpId: new URL(config.previewOrigin).hostname };
  const { enabled, configured, missing, origin, rpcUrl, networkPassphrase, accountWasmHash,
    webauthnVerifierAddress, tokenContract, rpId, relayerUrl, claimAmount, cooldownMinutes } = config;
  const identity = { enabled, configured, origin, rpId, networkPassphrase, rpcUrl, accountWasmHash, webauthnVerifierAddress, tokenContract, relayerUrl };
  const configFingerprint = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return { enabled, configured, missing, configFingerprint, origin, rpcUrl, networkPassphrase, accountWasmHash,
    webauthnVerifierAddress, tokenContract, rpId, relayerUrl, claimAmount, cooldownMinutes,
    network: 'testnet', asset: { code: 'USDC', issuer: USDC_ISSUER, decimals: 7 },
    message: enabled ? 'Piloto Stellar Testnet' : 'La conexión de wallet está pendiente de configuración.' };
}


