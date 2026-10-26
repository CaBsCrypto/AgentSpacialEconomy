import { createPublicKey } from 'node:crypto';
import { AdsError, canonical, sha256 } from './common.mjs';

export function p256ToCose(raw) {
  const bytes = Buffer.from(raw);
  if (bytes.length !== 65 || bytes[0] !== 4) throw new AdsError(401, 'INVALID_CREDENTIAL', 'The wallet credential is not an uncompressed P-256 key.');
  try { createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: bytes.subarray(1, 33).toString('base64url'), y: bytes.subarray(33).toString('base64url') }, format: 'jwk' }); }
  catch { throw new AdsError(401, 'INVALID_CREDENTIAL', 'The wallet credential is not a valid P-256 point.'); }
  return new Uint8Array(Buffer.concat([Buffer.from('a5010203262001215820', 'hex'), bytes.subarray(1, 33), Buffer.from('225820', 'hex'), bytes.subarray(33)]));
}

/** Restrict backend login to the pilot's single Default External WebAuthn signer. */
export function validateAuthority({ address, credentialId, codeHash, rules, ledger }, config) {
  if (config.network !== 'stellar:testnet' || !config.accountWasmHash || codeHash !== config.accountWasmHash.toLowerCase() || !config.webauthnVerifier) throw new AdsError(401, 'WALLET_CODE_NOT_ALLOWED', 'This wallet code is not admitted for advertiser login.');
  const active = rules.filter(rule => rule.valid_until == null || Number(rule.valid_until) >= ledger);
  if (active.length !== 1) throw new AdsError(401, 'WALLET_AUTHORITY_UNSUPPORTED', 'Advertiser login currently requires one active Default passkey rule.');
  const rule = active[0];
  if (rule.context_type?.tag !== 'Default' || rule.signers?.length !== 1 || (rule.policies?.length ?? rule.policies?.size ?? 0) !== 0 || (rule.policy_ids?.length ?? 0) !== 0) throw new AdsError(401, 'WALLET_AUTHORITY_UNSUPPORTED', 'The wallet has an unsupported authorization policy.');
  const signer = rule.signers[0];
  if (signer.tag !== 'External' || signer.values?.[0] !== config.webauthnVerifier) throw new AdsError(401, 'WALLET_AUTHORITY_UNSUPPORTED', 'The wallet signer is not the configured WebAuthn verifier.');
  const keyData = Buffer.from(signer.values[1]);
  const rawKey = keyData.subarray(0, 65);
  p256ToCose(rawKey);
  const chainCredential = keyData.subarray(65).toString('base64url');
  if (!chainCredential || chainCredential !== credentialId || Buffer.from(credentialId, 'base64url').toString('base64url') !== credentialId) throw new AdsError(401, 'WALLET_CREDENTIAL_MISMATCH', 'The selected credential is not the current wallet signer.');
  const snapshot = { address, credentialId, publicKey: rawKey.toString('base64url'), codeHash, ruleId: Number(rule.id), validUntil: rule.valid_until ?? null, verifier: config.webauthnVerifier };
  return { ...snapshot, authorityHash: sha256(canonical(snapshot)), ledger };
}

export function createWalletAuthority({ config, rpc } = {}) {
  return {
    async read({ address, credentialId }) {
      const sdk = await import('@stellar/stellar-sdk');
      const { Client } = await import('smart-account-kit-bindings');
      if (config.network !== 'stellar:testnet' || !sdk.StrKey.isValidContract(address)) throw new AdsError(401, 'WALLET_NETWORK', 'A Stellar Testnet contract wallet is required.');
      const server = rpc ?? new sdk.rpc.Server(config.rpcUrl);
      const network = await server.getNetwork();
      const passphrase = 'Test SDF Network ; September 2015';
      if (network.passphrase !== passphrase) throw new AdsError(503, 'RPC_NETWORK_MISMATCH', 'The wallet RPC is not Stellar Testnet.');
      const key = sdk.xdr.LedgerKey.contractData(new sdk.xdr.LedgerKeyContractData({ contract: new sdk.Address(address).toScAddress(), key: sdk.xdr.ScVal.scvLedgerKeyContractInstance(), durability: sdk.xdr.ContractDataDurability.persistent() }));
      const { entries } = await server.getLedgerEntries(key);
      if (entries.length !== 1) throw new AdsError(401, 'WALLET_NOT_FOUND', 'The wallet is not deployed on Testnet.');
      let codeHash;
      try { codeHash = entries[0].val.contractData().val().instance().executable().wasmHash().toString('hex'); }
      catch { throw new AdsError(401, 'WALLET_CODE_NOT_ALLOWED', 'The wallet executable is unsupported.'); }
      if (codeHash !== config.accountWasmHash?.toLowerCase()) throw new AdsError(401, 'WALLET_CODE_NOT_ALLOWED', 'The current wallet code is not admitted.');
      const client = new Client({ contractId: address, rpcUrl: config.rpcUrl, networkPassphrase: passphrase });
      const read = async (method, args = []) => {
        const source = new sdk.Account(sdk.StrKey.encodeEd25519PublicKey(Buffer.alloc(32)), '0');
        const tx = new sdk.TransactionBuilder(source, { fee: sdk.BASE_FEE, networkPassphrase: passphrase }).addOperation(new sdk.Contract(address).call(method, ...args)).setTimeout(15).build();
        const result = await server.simulateTransaction(tx);
        if (sdk.rpc.Api.isSimulationError(result) || !result.result?.retval) throw new AdsError(503, 'WALLET_AUTHORITY_UNVERIFIED', 'The wallet authorization could not be verified.');
        return client.spec.funcResToNative(method, result.result.retval.toXDR('base64'));
      };
      const count = Number(await read('get_context_rules_count'));
      if (count !== 1) throw new AdsError(401, 'WALLET_AUTHORITY_UNSUPPORTED', 'This pilot supports wallets with exactly one original Default passkey rule.');
      const rules = [await read('get_context_rule', [sdk.xdr.ScVal.scvU32(0)])];
      return validateAuthority({ address, credentialId, codeHash, rules, ledger: (await server.getLatestLedger()).sequence }, config);
    },
  };
}
