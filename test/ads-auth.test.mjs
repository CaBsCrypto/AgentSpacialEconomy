import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash, sign } from 'node:crypto';
import { createAuthService } from '../server/ads/auth.mjs';
import { validateAuthority, p256ToCose, createWalletAuthority } from '../server/ads/wallet-authority.mjs';

const address = 'C' + 'A'.repeat(55);
const credentialId = Buffer.from('advertiser-auth-test').toString('base64url');
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = publicKey.export({ format: 'jwk' });
const rawKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
const config = { network: 'stellar:testnet', origin: 'https://ads.example.com', rpId: 'ads.example.com', accountWasmHash: 'a'.repeat(64), webauthnVerifier: 'C' + 'B'.repeat(55), authChallengeMs: 60000, sessionMs: 300000, operators: [] };
function snapshot() { return { address, credentialId, publicKey: rawKey.toString('base64url'), authorityHash: 'b'.repeat(64) }; }

class MemoryAuthDb {
  challenges = new Map(); identities = new Map(); sessions = new Map(); tail = Promise.resolve();
  transaction(fn) { const result = this.tail.then(() => fn(this)); this.tail = result.catch(() => {}); return result; }
  async query(sql, p) {
    if (sql.startsWith('SELECT count')) return { rows: [{ count: [...this.challenges.values()].filter(r => r.address === p[0] && !r.consumed_at && r.expires_at > p[1]).length }] };
    if (sql.startsWith('INSERT INTO ads_auth_challenges')) { this.challenges.set(p[0], { id: p[0], address: p[1], credential_id: p[2], challenge_hash: p[3], authority_hash: p[4], expires_at: p[5] }); return { rows: [] }; }
    if (sql.startsWith('SELECT * FROM ads_auth_challenges')) return { rows: [this.challenges.get(p[0])].filter(Boolean) };
    if (sql.startsWith('UPDATE ads_auth_challenges')) { this.challenges.get(p[0]).consumed_at = p[1]; return { rows: [] }; }
    if (sql.startsWith('SELECT pg_advisory')) return { rows: [] };
    if (sql.startsWith('SELECT * FROM ads_identities')) return { rows: [this.identities.get(p[0])].filter(Boolean) };
    if (sql.startsWith('INSERT INTO ads_identities')) { this.identities.set(p[0], { owner_id: p[0], address: p[1], credential_id: p[2], authority_hash: p[3], sign_count: p[4] }); return { rows: [] }; }
    if (sql.startsWith('UPDATE ads_sessions') && sql.includes('owner_id')) { for (const row of this.sessions.values()) if (row.owner_id === p[0] && row.authority_hash !== p[2]) row.revoked_at = p[1]; return { rows: [] }; }
    if (sql.startsWith('INSERT INTO ads_sessions')) { this.sessions.set(p[0], { token_hash: p[0], owner_id: p[1], authority_hash: p[2], expires_at: p[3] }); return { rows: [] }; }
    if (sql.startsWith('SELECT s.*')) { const row = this.sessions.get(p[0]); return { rows: row ? [{ ...this.identities.get(row.owner_id), ...row }] : [] }; }
    if (sql.startsWith('UPDATE ads_sessions')) { const row = this.sessions.get(p[0]); if (row) row.revoked_at = p[1]; return { rows: [] }; }
    throw new Error('Unexpected auth SQL: ' + sql);
  }
}
function assertion(challenge, { origin = config.origin, count = 1, id = credentialId, flags = 5 } = {}) {
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
  const authenticatorData = Buffer.alloc(37);
  createHash('sha256').update(config.rpId).digest().copy(authenticatorData);
  authenticatorData[32] = flags;
  authenticatorData.writeUInt32BE(count, 33);
  const signature = sign('sha256', Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]), privateKey);
  return { id, rawId: id, type: 'public-key', response: { authenticatorData: authenticatorData.toString('base64url'), clientDataJSON: clientDataJSON.toString('base64url'), signature: signature.toString('base64url') }, clientExtensionResults: {} };
}
function setup() {
  const db = new MemoryAuthDb(); let current = snapshot(); let time = Date.now();
  return { db, setSnapshot(value) { current = value; }, advance(ms) { time += ms; }, auth: createAuthService({ db, config, authority: { read: async () => current }, now: () => time }) };
}
test('onchain authority only admits one Default External passkey with the exact credential', () => {
  const base = { address, credentialId, codeHash: config.accountWasmHash, ledger: 100, rules: [{ id: 0, context_type: { tag: 'Default' }, signers: [{ tag: 'External', values: [config.webauthnVerifier, Buffer.concat([rawKey, Buffer.from(credentialId, 'base64url')])] }], policies: [], valid_until: undefined }] };
  assert.equal(validateAuthority(base, config).credentialId, credentialId);
  assert.equal(p256ToCose(rawKey).length, 77);
  assert.throws(() => validateAuthority({ ...base, codeHash: 'c'.repeat(64) }, config), /code/);
  assert.throws(() => validateAuthority({ ...base, credentialId: 'd3Jvbmc' }, config), /credential/);
  assert.throws(() => validateAuthority({ ...base, rules: [...base.rules, ...base.rules] }, config), /one active/);
  assert.throws(() => validateAuthority({ ...base, rules: [{ ...base.rules[0], policies: ['policy'] }] }, config), /unsupported/);
  assert.throws(() => validateAuthority({ ...base, rules: [{ ...base.rules[0], valid_until: 99 }] }, config), /one active/);
});
test('real WebAuthn verification creates an opaque secure session and consumes its challenge once', async () => {
  const { auth, db } = setup();
  const challenge = await auth.challenge({ address, credentialId });
  const result = await auth.verify({ challengeId: challenge.challengeId, response: assertion(challenge.options.challenge) });
  assert.equal(result.identity.ownerId, 'stellar:testnet:' + address);
  assert.match(result.cookie, /HttpOnly; Secure; SameSite=Strict/);
  assert.ok(![...db.sessions.keys()].includes(result.token), 'only the token hash is stored');
  const user = await auth.authenticate({ method: 'POST', headers: { cookie: result.cookie, origin: config.origin } });
  assert.equal(user.address, address);
  await assert.rejects(auth.verify({ challengeId: challenge.challengeId, response: assertion(challenge.options.challenge) }), /already used/);
  await assert.rejects(auth.authenticate({ method: 'POST', headers: { cookie: result.cookie, origin: 'https://evil.example' } }), /origin/);
  await auth.logout({ headers: { cookie: result.cookie } });
  await assert.rejects(auth.authenticate({ headers: { cookie: result.cookie } }), /expired/);
});
test('wrong origin, absent user verification, changed authority and expiry fail without reusable challenges', async () => {
  for (const options of [{ origin: 'https://evil.example' }, { flags: 1 }]) {
    const { auth, db } = setup(); const challenge = await auth.challenge({ address, credentialId });
    await assert.rejects(auth.verify({ challengeId: challenge.challengeId, response: assertion(challenge.options.challenge, options) }));
    assert.ok(db.challenges.get(challenge.challengeId).consumed_at);
  }
  const { auth, setSnapshot, advance } = setup();
  const changed = await auth.challenge({ address, credentialId });
  setSnapshot({ ...snapshot(), authorityHash: 'c'.repeat(64) });
  await assert.rejects(auth.verify({ challengeId: changed.challengeId, response: assertion(changed.options.challenge) }), /authority changed/);
  const expired = await auth.challenge({ address, credentialId });
  advance(config.authChallengeMs + 1);
  await assert.rejects(auth.verify({ challengeId: expired.challengeId, response: assertion(expired.options.challenge) }), /expired/);
});
test('concurrent replay admits one session, counter rollback fails and signer removal invalidates session', async () => {
  const { auth, setSnapshot } = setup();
  const challenge = await auth.challenge({ address, credentialId });
  const input = { challengeId: challenge.challengeId, response: assertion(challenge.options.challenge, { count: 10 }) };
  const results = await Promise.allSettled([auth.verify(input), auth.verify(input)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const session = results.find(result => result.status === 'fulfilled').value;
  const replay = await auth.challenge({ address, credentialId });
  await assert.rejects(auth.verify({ challengeId: replay.challengeId, response: assertion(replay.options.challenge, { count: 9 }) }));
  setSnapshot({ ...snapshot(), authorityHash: 'c'.repeat(64) });
  await assert.rejects(auth.authenticate({ headers: { cookie: session.cookie } }), /authority changed/);
});


test('wallet authority reads the public bindings and current RPC data, never a browser public key', async () => {
  const sdk = await import('@stellar/stellar-sdk');
  const { Client } = await import('smart-account-kit-bindings');
  const wallet = sdk.StrKey.encodeContract(Buffer.alloc(32, 1));
  const verifierAddress = sdk.StrKey.encodeContract(Buffer.alloc(32, 2));
  const chainConfig = { ...config, webauthnVerifier: verifierAddress, rpcUrl: 'https://soroban-testnet.stellar.org' };
  const binding = new Client({ contractId: wallet, rpcUrl: chainConfig.rpcUrl, networkPassphrase: 'Test SDF Network ; September 2015' });
  const rule = { context_type: { tag: 'Default', values: undefined }, id: 0, name: 'Default', policies: [], policy_ids: [], signer_ids: [0], signers: [{ tag: 'External', values: [verifierAddress, Buffer.concat([rawKey, Buffer.from(credentialId, 'base64url')])] }], valid_until: undefined };
  const encodedRule = binding.spec.nativeToScVal(rule, binding.spec.getFunc('get_context_rule').outputs()[0]);
  const rpc = {
    getNetwork: async () => ({ passphrase: 'Test SDF Network ; September 2015' }),
    getLedgerEntries: async () => ({ entries: [{ val: { contractData: () => ({ val: () => ({ instance: () => ({ executable: () => ({ wasmHash: () => Buffer.from(config.accountWasmHash, 'hex') }) }) }) }) } }] }),
    simulateTransaction: async tx => ({ result: { retval: tx.operations[0].func.invokeContract().functionName().toString() === 'get_context_rules_count' ? sdk.xdr.ScVal.scvU32(1) : encodedRule } }),
    getLatestLedger: async () => ({ sequence: 100 }),
  };
  const authority = createWalletAuthority({ config: chainConfig, rpc });
  const current = await authority.read({ address: wallet, credentialId });
  assert.equal(current.publicKey, rawKey.toString('base64url'));
  assert.equal(current.ruleId, 0);
  rpc.getNetwork = async () => ({ passphrase: 'Public Global Stellar Network ; September 2015' });
  await assert.rejects(authority.read({ address: wallet, credentialId }), /not Stellar Testnet/);
});
test('auth SQL persists one-use challenges and opaque sessions in a real PostgreSQL engine', async () => {
  const { createTestDatabase } = await import('./helpers/ads-db.mjs');
  const db = await createTestDatabase();
  try {
    const auth = createAuthService({ db, config, authority: { read: async () => snapshot() }, now: Date.now });
    const challenge = await auth.challenge({ address, credentialId });
    const response = assertion(challenge.options.challenge);
    const result = await auth.verify({ challengeId: challenge.challengeId, response });
    assert.equal((await db.query('SELECT owner_id FROM ads_identities')).rowCount, 1);
    assert.equal((await db.query('SELECT token_hash FROM ads_sessions')).rowCount, 1);
    assert.equal((await auth.authenticate({ headers: { cookie: result.cookie } })).address, address);
    await assert.rejects(auth.verify({ challengeId: challenge.challengeId, response }), /already used/);
    const bad = await auth.challenge({ address, credentialId });
    await assert.rejects(auth.verify({ challengeId: bad.challengeId, response: assertion(bad.options.challenge, { origin: 'https://evil.example', count: 2 }) }));
    assert.ok((await db.query('SELECT consumed_at FROM ads_auth_challenges WHERE id=$1', [bad.challengeId])).rows[0].consumed_at);
  } finally { await db.close(); }
});
