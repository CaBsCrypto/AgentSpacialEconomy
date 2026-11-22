import { PINS, assertSigningPolicy, validatePlan, validateSignedExport } from './reservations-operator-core.mjs';

/** The only exposed actions are import, connect, sign and export. No submission method. */
export function createOperatorController({ sdk, policy, browser = globalThis, now = Date.now, makeKit = options => new sdk.SmartAccountKit(options) }) {
  const pinnedPolicy = Object.freeze(structuredClone(policy));
  let plan = null, kit = null, credentialId = null, busy = false, signedExport = null;
  return {
    async load(value) {
      if (busy) throw Error('Espera a que termine la interacción actual.');
      busy = true; plan = null; kit = null; credentialId = null; signedExport = null;
      try {
        const copy = structuredClone(value);
        await validatePlan(sdk, copy, now());
        plan = copy;
        return structuredClone(plan);
      } finally { busy = false; }
    },
    async readiness() { if (!plan) throw Error('Carga un plan revisado.'); await assertSigningPolicy(sdk, plan, pinnedPolicy, browser, now()); },
    async connect() {
      if (busy) throw Error('Ya hay una interacción en curso.');
      busy = true; credentialId = null; signedExport = null;
      try {
        await this.readiness();
        kit = makeKit({ rpcUrl: PINS.rpcUrl, networkPassphrase: PINS.networkPassphrase, accountWasmHash: PINS.accountWasmHash, acceptedWasmHashes: [PINS.accountWasmHash], webauthnVerifierAddress: PINS.webauthnVerifierAddress, rpId: PINS.rpId, rpName: 'Agentic Realities · Operación Testnet', allowedOrigins: [PINS.origin], storage: new sdk.IndexedDBStorage(), webAuthn: { startAuthentication: sdk.startAuthentication, startRegistration: async () => { throw Error('Conecta una passkey existente.'); } } });
        const result = await kit.connectWallet({ fresh: true });
        if ((result?.contractId || kit.contractId) !== plan.hostAddress || kit.contractId !== plan.hostAddress || !kit.credentialId) throw Error('La wallet conectada no es el host C revisado.');
        await this.readiness(); credentialId = kit.credentialId;
        return { address: plan.hostAddress };
      } finally { busy = false; }
    },
    async sign() {
      if (busy || signedExport || !kit || !credentialId || kit.credentialId !== credentialId || kit.contractId !== plan?.hostAddress) throw Error('Conecta el host correcto antes de firmar una vez.');
      busy = true;
      try {
        await this.readiness();
        const entry = sdk.xdr.SorobanAuthorizationEntry.fromXDR(plan.simulation.auth[0], 'base64');
        const signed = await kit.signAuthEntry(entry, { credentialId, expiration: plan.simulation.expirationLedger, contextRuleIds: [0] });
        if (kit.credentialId !== credentialId || kit.contractId !== plan.hostAddress) throw Error('La wallet cambió durante la firma.');
        const exported = { schema: 'reservation-signed-authorization/v1', intentId: plan.intentId, configFingerprint: plan.configFingerprint, func: plan.func, auth: [signed.toXDR('base64')] };
        await this.readiness();
        await validateSignedExport(sdk, plan, exported, now());
        signedExport = exported; return structuredClone(exported);
      } finally { busy = false; }
    },
    export() { if (!signedExport) throw Error('Todavía no existe una autorización firmada.'); return structuredClone(signedExport); },
  };
}
