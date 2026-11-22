// Shared by the offline CLI and the isolated operator page. No network or signing here.
export const PINS = Object.freeze({
  network: 'stellar:testnet', networkPassphrase: 'Test SDF Network ; September 2015',
  rpcUrl: 'https://soroban-testnet.stellar.org', origin: 'https://agenticreality.space', rpId: 'agenticreality.space',
  wasmHash: 'df9a9dc25bdb38cc538ef48522350d8fed06d3d63f06b421d3fffdd80536cd07',
  accountWasmHash: 'c514d35ea67eaea9bfc1fb3327854c0c06111bc1ddebd4fe217c504c1004b9e1',
  webauthnVerifierAddress: 'CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F',
});
const HEX = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const enc = value => value.toXDR('base64');
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const bytes = value => Uint8Array.from(value.match(/../g), pair => parseInt(pair, 16));
const requireThat = (value, message) => { if (!value) throw Error(message); };
const keys = (value, required, optional = []) => requireThat(value && typeof value === 'object' && !Array.isArray(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key)), 'Campos ausentes o no permitidos.');
export const canonical = value => JSON.stringify(sort(value));
function sort(value) { return Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value; }
export async function digest(value) { return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value))); }
export function parseBoundedJson(text) {
  requireThat(typeof text === 'string' && new TextEncoder().encode(text).length <= 262144, 'El archivo supera 256 KiB.');
  try { return JSON.parse(text); } catch { throw Error('El archivo no contiene JSON válido.'); }
}
const publicConfig = plan => Object.fromEntries([...Object.keys(PINS), 'sourceSha', 'hostAddress', 'projectId', 'contractId'].map(key => [key, plan[key]]));
const scBytes = (sdk, value) => sdk.xdr.ScVal.scvBytes(bytes(value));
export async function contractId(sdk, hostAddress, salt) {
  requireThat(sdk.StrKey.isValidContract(hostAddress || '') && HEX.test(salt || ''), 'Host C o salt inválidos.');
  const preimage = sdk.xdr.ContractIdPreimage.contractIdPreimageFromAddress(new sdk.xdr.ContractIdPreimageFromAddress({ address: new sdk.Address(hostAddress).toScAddress(), salt: bytes(salt) }));
  const id = sdk.xdr.HashIdPreimage.envelopeTypeContractId(new sdk.xdr.HashIdPreimageContractId({ networkId: bytes(await digest(PINS.networkPassphrase)), contractIdPreimage: preimage }));
  return sdk.StrKey.encodeContract(bytes(await digest(id.toXDR())));
}
function expectedFunction(sdk, plan) {
  if (plan.kind === 'bootstrap') return sdk.xdr.HostFunction.hostFunctionTypeCreateContractV2(new sdk.xdr.CreateContractArgsV2({
    executable: sdk.xdr.ContractExecutable.contractExecutableWasm(bytes(PINS.wasmHash)),
    contractIdPreimage: sdk.xdr.ContractIdPreimage.contractIdPreimageFromAddress(new sdk.xdr.ContractIdPreimageFromAddress({ address: new sdk.Address(plan.hostAddress).toScAddress(), salt: bytes(plan.salt) })),
    constructorArgs: [scBytes(sdk, plan.projectId), new sdk.Address(plan.hostAddress).toScVal()],
  }));
  return sdk.xdr.HostFunction.hostFunctionTypeInvokeContract(new sdk.xdr.InvokeContractArgs({ contractAddress: new sdk.Address(plan.contractId).toScAddress(), functionName: 'maintain', args: [sdk.xdr.ScVal.scvVec(plan.offers.map(id => scBytes(sdk, id)))] }));
}
function credentials(entry) {
  requireThat(['sorobanCredentialsAddress', 'sorobanCredentialsAddressV2'].includes(entry.credentials().switch().name), 'Se requiere autorización directa de la wallet C.');
  return entry.credentials().value();
}
function restorationMetadata(data) {
  const ext = data.ext();
  requireThat([0, 1].includes(ext.switch()), 'Extensión de recursos no admitida.');
  if (ext.switch() === 0) return false;
  const indices = ext.resourceExt().archivedSorobanEntries(), keys = data.resources().footprint().readWrite();
  requireThat(new Set(indices).size === indices.length && indices.every(index => index < keys.length && ['contractCode', 'contractData'].includes(keys[index].switch().name) && (keys[index].switch().name !== 'contractData' || keys[index].contractData().durability().name === 'persistent')), 'Índices de restauración inválidos.');
  return indices.length > 0;
}
function validateAuth(sdk, plan, encodedEntry, signed = false) {
  requireThat(typeof encodedEntry === 'string' && encodedEntry.length <= 65536, 'Autorización demasiado grande.');
  const entry = sdk.xdr.SorobanAuthorizationEntry.fromXDR(encodedEntry, 'base64');
  const auth = credentials(entry), root = entry.rootInvocation(), func = expectedFunction(sdk, plan);
  requireThat(sdk.Address.fromScAddress(auth.address()).toString() === plan.hostAddress, 'La autorización no pertenece al host C.');
  if (plan.kind === 'bootstrap') {
    requireThat(root.function().switch().name === 'sorobanAuthorizedFunctionTypeCreateContractV2HostFn' && enc(root.function().createContractV2HostFn()) === enc(func.createContractV2()), 'La creación no coincide con WASM, host, salt y proyecto.');
    requireThat(root.subInvocations().length === 1, 'La creación debe autorizar exactamente su constructor.');
    const child = root.subInvocations()[0];
    const ctor = new sdk.xdr.InvokeContractArgs({ contractAddress: new sdk.Address(plan.contractId).toScAddress(), functionName: '__constructor', args: func.createContractV2().constructorArgs() });
    requireThat(child.function().switch().name === 'sorobanAuthorizedFunctionTypeContractFn' && enc(child.function().contractFn()) === enc(ctor) && child.subInvocations().length === 0, 'Constructor o subinvocaciones no permitidos.');
  } else requireThat(root.function().switch().name === 'sorobanAuthorizedFunctionTypeContractFn' && enc(root.function().contractFn()) === enc(func.invokeContract()) && root.subInvocations().length === 0, 'Mantenimiento distinto del lote revisado.');
  requireThat(auth.signatureExpirationLedger() === plan.simulation.expirationLedger, 'La expiración fue alterada.');
  if (!signed) requireThat(auth.signature().switch().name === 'scvVoid', 'La preparación debe estar sin firmar.');
  else {
    requireThat(auth.signature().switch().name === 'scvMap', 'Falta la firma de la passkey.');
    const fields = auth.signature().map();
    requireThat(fields.length === 2 && fields[0].key().switch().name === 'scvSymbol' && fields[0].key().sym().toString() === 'context_rule_ids' && fields[1].key().switch().name === 'scvSymbol' && fields[1].key().sym().toString() === 'signers', 'Formato de firma no permitido.');
    requireThat(enc(fields[0].val()) === enc(sdk.xdr.ScVal.scvVec([sdk.xdr.ScVal.scvU32(0)])) && fields[1].val().switch().name === 'scvMap' && fields[1].val().map().length === 1, 'Se requiere una firma de la regla original 0.');
    const signer = fields[1].val().map()[0];
    requireThat(signer.key().switch().name === 'scvVec' && signer.key().vec().length === 3 && signer.val().switch().name === 'scvBytes' && signer.val().bytes().length > 0, 'Falta el firmante WebAuthn.');
    const [tag, verifier, keyData] = signer.key().vec();
    requireThat(tag.switch().name === 'scvSymbol' && tag.sym().toString() === 'External' && verifier.switch().name === 'scvAddress' && sdk.Address.fromScAddress(verifier.address()).toString() === PINS.webauthnVerifierAddress && keyData.switch().name === 'scvBytes' && keyData.bytes().length > 65, 'Verificador o clave de passkey no permitidos.');
  }
  return entry;
}
export async function createPlan(sdk, input) {
  keys(input, ['kind', 'intentId', 'sourceSha', 'hostAddress', 'projectId'], ['salt', 'contractId', 'offers']);
  requireThat(['bootstrap', 'maintain'].includes(input.kind) && HEX.test(input.intentId || '') && SHA.test(input.sourceSha || '') && HEX.test(input.projectId || '') && sdk.StrKey.isValidContract(input.hostAddress || ''), 'Identidad, SHA, proyecto o intención inválidos.');
  requireThat(!Object.hasOwn(input, 'offers') || Array.isArray(input.offers), 'Ofertas debe ser una lista.');
  const plan = { schema: 'reservation-operation/v1', ...PINS, ...input, salt: input.salt ?? null, offers: input.offers ?? [], simulation: null };
  if (plan.kind === 'bootstrap') {
    requireThat(HEX.test(plan.salt || '') && plan.offers.length === 0, 'Bootstrap requiere salt de 32 bytes y ninguna oferta.');
    plan.contractId = await contractId(sdk, plan.hostAddress, plan.salt);
    requireThat(!Object.hasOwn(input, 'contractId') || input.contractId === plan.contractId, 'Contract ID esperado incorrecto.');
  } else requireThat(plan.salt === null && sdk.StrKey.isValidContract(plan.contractId || '') && Array.isArray(plan.offers) && plan.offers.length <= 20 && plan.offers.every(id => HEX.test(id)) && new Set(plan.offers).size === plan.offers.length, 'Mantenimiento requiere contrato y hasta 20 IDs distintos.');
  plan.configFingerprint = await digest(canonical(publicConfig(plan)));
  plan.func = enc(expectedFunction(sdk, plan));
  return plan;
}
export async function validatePlan(sdk, plan, now = Date.now()) {
  keys(plan, ['schema', ...Object.keys(PINS), 'kind', 'intentId', 'sourceSha', 'hostAddress', 'projectId', 'contractId', 'salt', 'offers', 'configFingerprint', 'func', 'simulation']);
  requireThat(plan.schema === 'reservation-operation/v1' && Object.entries(PINS).every(([key, value]) => plan[key] === value), 'Red, origen o código ajenos al candidato.');
  const rebuilt = await createPlan(sdk, Object.fromEntries(['kind', 'intentId', 'sourceSha', 'hostAddress', 'projectId', 'contractId', 'salt', 'offers'].map(key => [key, plan[key]])));
  requireThat(plan.func === rebuilt.func && plan.configFingerprint === rebuilt.configFingerprint, 'El plan no coincide con su función o fingerprint.');
  if (plan.simulation !== null) {
    const s = plan.simulation;
    keys(s, ['observedAt', 'expiresAt', 'latestLedger', 'expirationLedger', 'coverageId', 'transactionData', 'minResourceFee', 'auth', 'restorationRequired']);
    requireThat(Number.isSafeInteger(s.latestLedger) && s.latestLedger > 0 && s.expirationLedger === s.latestLedger + 36 && s.expirationLedger <= 0xffffffff, 'Ledger inválido.');
    requireThat(Number.isFinite(Date.parse(s.observedAt)) && Number.isFinite(Date.parse(s.expiresAt)) && Date.parse(s.observedAt) <= now && Date.parse(s.expiresAt) > now && Date.parse(s.expiresAt) - Date.parse(s.observedAt) <= 120000, 'La preparación de firma venció o tiene fechas inválidas.');
    requireThat(/^[a-zA-Z0-9_-]{1,80}$/.test(s.coverageId) && /^\d{1,18}$/.test(s.minResourceFee) && typeof s.transactionData === 'string' && s.transactionData.length <= 65536 && Array.isArray(s.auth) && s.auth.length === 1, 'Simulación incompleta.');
    const data = sdk.xdr.SorobanTransactionData.fromXDR(s.transactionData, 'base64');
    requireThat(BigInt(data.resourceFee().toString()) >= BigInt(s.minResourceFee), 'Recursos inferiores a la tarifa simulada.');
    requireThat(s.restorationRequired === restorationMetadata(data), 'Metadatos de restauración inconsistentes.');
    validateAuth(sdk, plan, s.auth[0]);
  }
  return plan;
}
/** Import an RPC simulation capture; never generates a nonce or claims to simulate. */
export async function attachSimulation(sdk, plan, capture, now = Date.now()) {
  await validatePlan(sdk, plan, now);
  requireThat(plan.simulation === null, 'Cada captura se adjunta a un plan original sin firma.');
  keys(capture, ['intentId', 'func', 'networkPassphrase', 'observedAt', 'expiresAt', 'coverageId', 'result']);
  requireThat(capture.intentId === plan.intentId && capture.func === plan.func && capture.networkPassphrase === PINS.networkPassphrase, 'La captura pertenece a otra operación.');
  const r = capture.result;
  requireThat(r && !r.error && !r.restorePreamble && r.results?.length === 1 && r.results[0].auth?.length === 1, 'La captura no contiene una simulación válida; restauración manual requiere revisión separada.');
  const entry = sdk.xdr.SorobanAuthorizationEntry.fromXDR(r.results[0].auth[0], 'base64'), auth = credentials(entry);
  requireThat(auth.signature().switch().name === 'scvVoid', 'La captura ya contiene una firma.');
  auth.signatureExpirationLedger(r.latestLedger + 36);
  const data = sdk.xdr.SorobanTransactionData.fromXDR(r.transactionData, 'base64');
  const s = { observedAt: capture.observedAt, expiresAt: capture.expiresAt, latestLedger: r.latestLedger, expirationLedger: r.latestLedger + 36, coverageId: capture.coverageId, transactionData: r.transactionData, minResourceFee: r.minResourceFee, auth: [enc(entry)], restorationRequired: restorationMetadata(data) };
  const reviewed = { ...plan, simulation: s };
  await validatePlan(sdk, reviewed, now); return reviewed;
}
export async function assertSigningPolicy(sdk, plan, policy, browser, now = Date.now()) {
  await validatePlan(sdk, plan, now);
  requireThat(policy.enabled === true && plan.simulation, 'Firma deshabilitada: faltan candidato, host, cobertura o simulación vigente.');
  requireThat(browser.isSecureContext && browser.navigator?.credentials && browser.PublicKeyCredential && browser.location?.origin === PINS.origin && browser.location?.hostname === PINS.rpId, 'Usa el origen oficial y un navegador compatible con passkeys.');
  requireThat(['sourceSha', 'hostAddress', 'projectId', 'contractId', 'configFingerprint'].every(key => policy[key] === plan[key]), 'El plan no corresponde al candidato habilitado.');
  requireThat(policy.coverageId === plan.simulation.coverageId && Date.parse(policy.coverageVerifiedUntil) > now && policy.zeroAdditionalSpend === true && policy.platformHardCapsVerified === true && /^\d{1,18}$/.test(policy.maxResourceFeeStroops || ''), 'Cobertura operativa no verificada.');
  const fee = sdk.xdr.SorobanTransactionData.fromXDR(plan.simulation.transactionData, 'base64').resourceFee();
  requireThat(BigInt(fee.toString()) <= BigInt(policy.maxResourceFeeStroops), 'La tarifa de recursos excede el límite revisado.');
  if (plan.simulation.restorationRequired) requireThat(policy.allowRestoration === true && plan.kind === 'maintain', 'Restauración pendiente de revisión explícita.');
}
export async function validateSignedExport(sdk, plan, signed, now = Date.now()) {
  await validatePlan(sdk, plan, now);
  requireThat(plan.simulation, 'Falta la preparación revisada.');
  keys(signed, ['schema', 'intentId', 'configFingerprint', 'func', 'auth']);
  requireThat(signed.schema === 'reservation-signed-authorization/v1' && signed.intentId === plan.intentId && signed.configFingerprint === plan.configFingerprint && signed.func === plan.func && Array.isArray(signed.auth) && signed.auth.length === 1, 'La exportación pertenece a otro plan.');
  const entry = validateAuth(sdk, plan, signed.auth[0], true);
  credentials(entry).signature(sdk.xdr.ScVal.scvVoid());
  requireThat(enc(entry) === plan.simulation.auth[0], 'La firma cambió nonce, expiración o autorización.');
  return { status: 'STRUCTURE_VALID_SIGNATURE_UNVERIFIED', intentId: plan.intentId, configFingerprint: plan.configFingerprint, note: 'Requiere simulación enforce, cobertura y aprobación antes de transmitir; no prueba despliegue.' };
}
