import { StrKey } from '@stellar/stellar-sdk';
import { ACCOUNT_WASM, WEBAUTHN_VERIFIER, DEFAULT_ORIGIN, RPC_URL, TESTNET, CHANNELS_URL } from '../wallet/config.mjs';
import { fail } from '../identity/common.mjs';
export const LIMITS = Object.freeze({ spaces:20, uploadBytes:2097152, imageWidth:2048, imageHeight:2048, conversationPerDay:30, inputTokens:8000, outputTokens:1024 });
const NEEDS = { maintenance:['database','blob'], offerReading:['database','rpc'], mediaRead:['database','blob'], authentication:['database','rpc'], reading:['database'], recovery:['database','rpc'], project:['database'], media:['database','blob'], publication:['database','rpc','channels'], reservation:['database','rpc','channels'], conversation:['database','gateway'] };
const QUOTAS = { maintenance:['blobDeleteCalls'], offerReading:['rpcCalls'], mediaRead:['blobReadBytes'], authentication:['rpcAuthCalls'], reading:[], recovery:['rpcRecoveryCalls'], project:[], media:['blobWriteBytes','blobReadBytes'], publication:['rpcCalls','channelsSubmissions'], reservation:['rpcCalls','channelsSubmissions'], conversation:['gatewayReadCalls'] };
const descriptions = { DISABLED:'The reservation pilot is disabled.', CONFIGURATION_MISSING:'A required backend configuration is missing or invalid.', COVERAGE_UNVERIFIED:'Existing resource coverage has not been verified.', COVERAGE_EXPIRED:'Existing resource coverage must be verified again.' };
export function readConfig(env = process.env) {
  let coverage = {}; try { coverage = JSON.parse(env.RESERVATIONS_RESOURCE_COVERAGE || '{}'); } catch {}
  const origin = env.WALLET_ORIGIN || DEFAULT_ORIGIN;
  let rpId; try { const url = new URL(origin); if (url.origin === origin && (url.protocol === 'https:' || env.NODE_ENV === 'test' && url.hostname === 'localhost')) rpId = url.hostname; } catch {}
  return { enabled:env.RESERVATIONS_ENABLED === 'true', intakeEnabled:env.RESERVATIONS_INTAKE_ENABLED === 'true', network:'stellar:testnet', origin, rpId,
    mode:['DISABLED','CONTROLLED','PUBLIC'].includes(env.RESERVATIONS_MODE)?env.RESERVATIONS_MODE:'DISABLED',
    allowedBrands:(env.RESERVATIONS_ALLOWED_BRANDS||'').split(',').map(value=>value.trim()).filter(value=>StrKey.isValidContract(value)),
    rpcUrl:RPC_URL, networkPassphrase:TESTNET, channelsUrl:CHANNELS_URL,
    accountWasmHash:env.WALLET_ACCOUNT_WASM_HASH || ACCOUNT_WASM, webauthnVerifier:env.WALLET_WEBAUTHN_VERIFIER || WEBAUTHN_VERIFIER,
    hostAddress:env.RESERVATIONS_HOST_ADDRESS, projectId:env.RESERVATIONS_PROJECT_ID, contractId:env.RESERVATIONS_CONTRACT_ID,
    contractWasmHash:env.RESERVATIONS_CONTRACT_WASM_HASH, databaseUrl:env.RESERVATIONS_DATABASE_URL,
    blobToken:env.BLOB_READ_WRITE_TOKEN, blobRetriesDisabled:env.VERCEL_BLOB_RETRIES==='0', channelsKey:env.CHANNELS_API_KEY,
    coverage, limits:LIMITS, authChallengeMs:120000, sessionMs:1800000,
    model:{ id:'google/gemini-2.5-flash-lite', inputUsdPerToken:'0.0000001', outputUsdPerToken:'0.0000004', maxInputTokens:8000, maxOutputTokens:1024, maxCostMicrousd:1210, timeoutMs:45000 },
  };
}
export function capabilityReason(config, capability, now = Date.now()) {
  if (!['authentication','reading','recovery','offerReading','mediaRead','maintenance'].includes(capability) && (!config.enabled || !config.intakeEnabled || config.mode==='DISABLED')) return 'DISABLED';
  if (config.network !== 'stellar:testnet' || config.networkPassphrase !== TESTNET || config.rpcUrl !== RPC_URL || !config.rpId || !StrKey.isValidContract(config.hostAddress || '') || !/^[a-f0-9]{64}$/.test(config.projectId || '') || !config.databaseUrl) return 'CONFIGURATION_MISSING';
  if (['publication','reservation','recovery','offerReading'].includes(capability) && (!StrKey.isValidContract(config.contractId || '') || !/^[a-f0-9]{64}$/.test(config.contractWasmHash || ''))) return 'CONFIGURATION_MISSING';
  if (['publication','reservation'].includes(capability) && (!config.channelsKey || config.channelsUrl !== CHANNELS_URL)) return 'CONFIGURATION_MISSING';
  if (['media','mediaRead','maintenance'].includes(capability) && (!config.blobToken || !config.blobRetriesDisabled)) return 'CONFIGURATION_MISSING';
  const c = config.coverage;
  if (!c || c.zeroAdditionalSpend !== true || !Number.isFinite(Date.parse(c.verifiedUntil))) return 'COVERAGE_UNVERIFIED';
  if (Date.parse(c.verifiedUntil) <= now) return 'COVERAGE_EXPIRED';
  if (!c.id || !/^[a-zA-Z0-9_-]{1,80}$/.test(c.id) || c.platformHardCapsVerified!==true || !['functions','transfer',...(NEEDS[capability] || [])].every(resource => c.resources?.[resource] === true)) return 'COVERAGE_UNVERIFIED';
  const recovery=['authentication','reading','recovery'].includes(capability);
  if (![...(recovery?['recoveryRequests','recoveryTransferBytes']:['functionRequests','transferBytes']),...(QUOTAS[capability] || [])].every(resource => Number.isSafeInteger(c.quotas?.[resource]) && c.quotas[resource]>0)) return 'COVERAGE_UNVERIFIED';
  if (capability === 'conversation' && (c.autoTopupDisabled !== true || c.byokDisabled !== true || c.exclusiveGatewayBudget !== true || !Number.isSafeInteger(c.gatewayBudgetMicrousd) || c.gatewayBudgetMicrousd < 1210)) return 'COVERAGE_UNVERIFIED';
  return null;
}
export function requireCapability(config, capability, now) {
  const code = capabilityReason(config, capability, now); if (code) fail(503, code, descriptions[code]);
}
export function mayReserve(config,identity) {
  return identity?.role==='brand' && config.enabled && config.intakeEnabled && (config.mode==='PUBLIC' || config.mode==='CONTROLLED'&&config.allowedBrands.includes(identity.address));
}
export function requireBrandAdmission(config,identity) {
  if (!mayReserve(config,identity)) fail(403,'BRAND_NOT_ADMITTED','This wallet is not admitted for a new reservation in the current pilot mode.');
}
export function publicConfig(config, now) {
  const capabilities = {}, reasons = [];
  for (const name of Object.keys(NEEDS)) { const code = capabilityReason(config, name, now); capabilities[name] = !code; if (code) reasons.push({ capability:name, code, message:descriptions[code] }); }
  return { enabled:config.enabled, intakeEnabled:config.intakeEnabled, mode:config.mode, network:config.network, origin:config.origin, rpId:config.rpId ?? null, rpcUrl:config.rpcUrl, networkPassphrase:config.networkPassphrase, accountWasmHash:config.accountWasmHash, webauthnVerifierAddress:config.webauthnVerifier, contractId:StrKey.isValidContract(config.contractId || '') ? config.contractId : null, projectId:/^[a-f0-9]{64}$/.test(config.projectId || '') ? config.projectId : null, capabilities, reasons, limits:LIMITS };
}
