import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { createWalletProvider } from '../dist/wallet-provider.mjs';
import { TESTNET_PASSPHRASE } from '../dist/wallet-controller.mjs';
import * as bundle from '../dist/vendor/wallet/kit.mjs';

const address = bundle.StrKey.encodeContract(new Uint8Array(32).fill(9));
const token = bundle.StrKey.encodeContract(new Uint8Array(32).fill(8));
const credentialBytes = new Uint8Array([21, 43, 65, 87, 109, 131, 153, 175]);
const credentialId = Buffer.from(credentialBytes).toString('base64url');
const config = { networkPassphrase: TESTNET_PASSPHRASE, rpcUrl: 'https://soroban-testnet.stellar.org', accountWasmHash: 'ab'.repeat(32), webauthnVerifierAddress: token, tokenContract: token, origin: 'https://agenticreality.space', rpId: 'agenticreality.space', relayerUrl: '/api/wallet/relay' };
const encode = value => Buffer.from(value).toString('base64url');
const bytes = value => new TextEncoder().encode(value);
const concatenate = (...arrays) => { const value = new Uint8Array(arrays.reduce((sum, a) => sum + a.length, 0)); let offset = 0; for (const a of arrays) { value.set(a, offset); offset += a.length; } return value; };
function derSignature(raw) {
  const integer = input => { let first = 0; while (first < input.length - 1 && input[first] === 0) first++; let value = input.slice(first); if (value[0] & 128) value = concatenate(new Uint8Array([0]), value); return concatenate(new Uint8Array([2, value.length]), value); };
  const data = concatenate(integer(raw.slice(0, 32)), integer(raw.slice(32)));
  return concatenate(new Uint8Array([48, data.length]), data);
}
async function fixture() {
  const key = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = new Uint8Array(await webcrypto.subtle.exportKey('raw', key.publicKey));
  const stored = { credentialId, contractId: address, publicKey, isPrimary: true, birthConstructorArgsHash: 'cd'.repeat(32) };
  const calls = [], requests = []; let mode = 'valid', signerCurrent = true;
  class Storage {
    async get(id) { calls.push(['storage', id]); return stored; }
    async saveSession() { throw Error('verification must not manually save a new session'); }
    async clear() { throw Error('verification must not clear storage'); }
  }
  class Kit {
    contractId = address; credentialId = credentialId;
    async connectWallet(options) { calls.push(['restore', options]); return { contractId: address, credentialId }; }
    async connectWithCredentials(id, contract, proof, allowAuthentication) {
      calls.push(['current-signer', id, contract, proof, allowAuthentication]);
      if (!signerCurrent) throw Object.assign(Error('The passkey is not a current signer'), { code: 'signer_revoked' });
      return { contractId: address, credentialId, credential: stored };
    }
    createWallet() { throw Error('verification must not create a wallet'); }
    credentials = { getPending: async () => [], deploy() { throw Error('verification must not deploy'); } };
  }
  const browser = {
    isSecureContext: true, PublicKeyCredential: class {}, crypto: webcrypto,
    location: { origin: config.origin, hostname: config.rpId },
    navigator: { credentials: { get(options) { calls.push(['native-get']); requests.push(options); return makeAssertion(options.publicKey); } } },
  };
  browser.top = browser;
  async function makeAssertion(request) {
    if (mode === 'cancel') throw new DOMException('Cancelled', 'NotAllowedError');
    const clientData = bytes(JSON.stringify({ type: 'webauthn.get', challenge: mode === 'challenge' ? encode(bytes('another challenge')) : encode(request.challenge), origin: mode === 'origin' ? 'https://another.example' : config.origin }));
    const rpHash = new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes(mode === 'rp_id' ? 'another.example' : config.rpId)));
    const authData = new Uint8Array(37); authData.set(rpHash); authData[32] = mode === 'user_verification' ? 1 : mode === 'user_presence' ? 4 : 5;
    const clientHash = new Uint8Array(await webcrypto.subtle.digest('SHA-256', clientData));
    let signingKey = key.privateKey;
    if (mode === 'signature') signingKey = (await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])).privateKey;
    const signature = derSignature(new Uint8Array(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, concatenate(authData, clientHash))));
    return { id: mode === 'credential' ? encode(bytes('another credential')) : credentialId, type: 'public-key', response: { clientDataJSON: clientData.buffer, authenticatorData: authData.buffer, signature: signature.buffer } };
  }
  const provider = await createWalletProvider(config, { browser, loadKit: async () => ({ ...bundle, SmartAccountKit: Kit, IndexedDBStorage: Storage, rpc: { Server: class {} } }) });
  await provider.restore(); calls.length = 0;
  return { provider, calls, requests, browser, stored, publicKey, setMode: value => { mode = value; }, revokeSigner: () => { signerCurrent = false; } };
}

test('fresh native verification starts synchronously for the same cached credential and validates a real P-256 assertion', async () => {
  const f = await fixture(); assert.equal(f.provider.canVerifyPasskey, true);
  const pending = f.provider.verifyPasskey();
  assert.deepEqual(f.calls, [['native-get']], 'the document gesture reaches native WebAuthn before storage or RPC work');
  const request = f.requests[0].publicKey;
  assert.equal(request.challenge.byteLength, 32); assert.equal(request.rpId, config.rpId); assert.equal(request.userVerification, 'required');
  assert.equal(request.allowCredentials.length, 1); assert.equal(request.allowCredentials[0].type, 'public-key'); assert.deepEqual(request.allowCredentials[0].id, credentialBytes);
  const proof = await pending;
  assert.equal(proof.address, address); assert.equal(proof.credentialId, credentialId); assert.equal(proof.credentialKey, encode(f.publicKey));
  assert.equal(proof.origin, config.origin); assert.equal(proof.rpId, config.rpId); assert.ok(Number.isFinite(proof.verifiedAt));
  const revalidation = f.calls.find(call => call[0] === 'current-signer');
  assert.deepEqual(revalidation.slice(1), [credentialId, address, undefined, false], 'SDK must not prompt for a second assertion');
  await f.provider.verifyPasskey(); assert.notEqual(encode(f.requests[0].publicKey.challenge), encode(f.requests[1].publicKey.challenge), 'each proof has a new random challenge');
});

for (const [mode, code] of [
  ['signature', 'passkey_signature'], ['challenge', 'passkey_challenge'], ['origin', 'passkey_origin'],
  ['rp_id', 'passkey_rp_id'], ['user_verification', 'passkey_user_verification'], ['user_presence', 'passkey_user_presence'],
  ['credential', 'passkey_credential_mismatch'],
]) test('fresh proof rejects ' + mode + ' without invoking any wallet operation', async () => {
  const f = await fixture(); f.setMode(mode);
  await assert.rejects(f.provider.verifyPasskey(), error => error.code === code);
  assert.equal(f.calls.filter(call => call[0] === 'current-signer').length, 0, 'invalid assertions fail before chain revalidation');
  assert.equal(f.requests.length, 1);
});

test('fresh proof also fails if the same credential is no longer an authorized onchain signer', async () => {
  const f = await fixture(); f.revokeSigner();
  await assert.rejects(f.provider.verifyPasskey(), error => error.code === 'signer_revoked');
  assert.equal(f.requests.length, 1); assert.equal(f.calls.filter(call => call[0] === 'current-signer').length, 1);
});

test('a changing public-key association cannot turn a signature from the old key into a current proof', async () => {
  const f = await fixture(); f.stored.publicKey = new Uint8Array(f.publicKey); f.stored.publicKey[12] ^= 1;
  await assert.rejects(f.provider.verifyPasskey(), error => error.code === 'passkey_identity_changed');
});

test('verification is main-document only and cancellation neither clears credentials nor creates a wallet', async () => {
  const f = await fixture(); f.browser.top = {};
  assert.throws(() => f.provider.verifyPasskey(), error => error.code === 'wrong_context'); assert.equal(f.requests.length, 0);
  f.browser.top = f.browser; f.setMode('cancel'); await assert.rejects(f.provider.verifyPasskey(), error => error.name === 'NotAllowedError');
  assert.equal(f.provider.credentialId, credentialId); assert.equal(f.provider.canVerifyPasskey, true);
});

test('the browser bundle exports the exact pinned SDK verifier and retains its license notices', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../node_modules/smart-account-kit/package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, '0.9.1'); assert.equal(typeof bundle.verifyFreshAssertion, 'function');
  assert.equal(typeof bundle.SmartAccountKit.prototype.connectWithCredentials, 'function');
  const entry = fs.readFileSync(new URL('../src/wallet-entry.mjs', import.meta.url), 'utf8');
  assert.match(entry, /verifyFreshAssertion.*smart-account-kit\/dist\/kit\/wallet-provenance\.js/);
  const license = fs.readFileSync(new URL('../dist/vendor/wallet/kit.mjs.LEGAL.txt', import.meta.url), 'utf8');
  assert.match(license, /smart-account-kit@0\.9\.1.*Apache-2\.0/);
  assert.equal(fs.readFileSync(new URL('../dist/vendor/wallet/SMART-ACCOUNT-KIT-LICENSE.txt', import.meta.url), 'utf8'), fs.readFileSync(new URL('../node_modules/smart-account-kit/LICENSE', import.meta.url), 'utf8'));
});


test('the real bundled SDK silent restore never invokes native authentication for absent, expired or failed sessions', async () => {
  let session = null, authentications = 0, clears = 0;
  const storage = { getSession: async () => session, clearSession: async () => { clears++; session = null; }, get: async () => undefined };
  const kit = new bundle.SmartAccountKit({ ...config, storage, indexerUrl: false, webAuthn: {
    startAuthentication() { authentications++; throw Error('silent restore must never prompt'); },
    startRegistration() { throw Error('silent restore must never register'); },
  } });
  assert.equal(await kit.connectWallet(), null); assert.equal(authentications, 0);
  session = { credentialId, contractId: address, expiresAt: Date.now() - 1 };
  assert.equal(await kit.connectWallet(), null); assert.equal(clears, 1); assert.equal(authentications, 0);
  session = { credentialId, contractId: address, expiresAt: Date.now() + 60000 };
  kit.rpc.getContractData = async () => { throw Error('RPC unavailable'); };
  await assert.rejects(kit.connectWallet(), /not found|may not have been deployed/i); assert.equal(authentications, 0);
});
