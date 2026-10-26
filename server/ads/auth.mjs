import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AdsError, sha256, uuid } from './common.mjs';
import { createWalletAuthority, p256ToCose } from './wallet-authority.mjs';

export const ADS_SESSION_COOKIE = '__Host-ads_session';
function header(request, name) { return request?.headers?.get?.(name) ?? request?.headers?.[name.toLowerCase()] ?? null; }
function cookieToken(request) {
  const found = String(header(request, 'cookie') ?? '').split(';').map(x => x.trim()).filter(x => x.startsWith(ADS_SESSION_COOKIE + '='));
  if (found.length !== 1) return null;
  const token = found[0].slice(ADS_SESSION_COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/u.test(token) ? token : null;
}
export function sessionCookie(token, maxAgeSeconds) {
  return ADS_SESSION_COOKIE + '=' + token + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + maxAgeSeconds;
}
function equalHash(value, expected) {
  const a = Buffer.from(sha256(value), 'hex'), b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createAuthService({ db, config, authority = createWalletAuthority({ config }), verifier, now = Date.now }) {
  let verifierPromise;
  const webauthn = () => verifier ? Promise.resolve(verifier) : verifierPromise ??= import('@simplewebauthn/server');
  function configured() {
    let origin;
    try { origin = new URL(config.origin); } catch { throw new AdsError(503, 'AUTH_UNCONFIGURED', 'Configure the advertiser origin and RP ID.'); }
    if (config.network !== 'stellar:testnet' || !config.rpId || origin.hostname !== config.rpId || origin.origin !== config.origin || (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) throw new AdsError(503, 'AUTH_UNCONFIGURED', 'Advertiser login requires an exact origin, RP ID and Testnet configuration.');
    if (!Number.isFinite(config.authChallengeMs) || config.authChallengeMs <= 0 || !Number.isFinite(config.sessionMs) || config.sessionMs <= 0) throw new AdsError(503, 'AUTH_UNCONFIGURED', 'Configure authentication expiry limits.');
  }
  function identity(address) {
    const ownerId = 'stellar:testnet:' + address;
    const role = (config.operators ?? []).some(operator => operator === address || operator === ownerId) ? 'operator' : 'advertiser';
    return { ownerId, address, role };
  }
  async function challenge({ address, credentialId }) {
    configured();
    if (!/^C[A-Z2-7]{55}$/u.test(address ?? '') || typeof credentialId !== 'string' || !/^[A-Za-z0-9_-]{1,1366}$/u.test(credentialId)) throw new AdsError(422, 'INVALID_WALLET_CREDENTIAL', 'Select a deployed Testnet wallet and passkey.');
    const snapshot = await authority.read({ address, credentialId });
    const value = randomBytes(32).toString('base64url');
    const challengeId = uuid();
    const expiresAt = new Date(now() + config.authChallengeMs);
    const options = await (await webauthn()).generateAuthenticationOptions({
      rpID: config.rpId, challenge: new Uint8Array(Buffer.from(value, 'base64url')),
      timeout: config.authChallengeMs, allowCredentials: [{ id: credentialId }], userVerification: 'required',
    });
    // A verifier implementation must not silently replace our persisted challenge.
    if (options.challenge !== value) throw new AdsError(503, 'AUTH_CHALLENGE_MISMATCH', 'The authentication verifier changed the challenge.');
    await db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['auth-challenge:' + address]);
      const active = await tx.query('SELECT count(*)::int AS count FROM ads_auth_challenges WHERE address=$1 AND consumed_at IS NULL AND expires_at>$2', [address, new Date(now())]);
      if (Number(active.rows[0]?.count ?? 0) >= 5) throw new AdsError(429, 'AUTH_CHALLENGE_LIMIT', 'Finish or wait for the outstanding login challenge.');
      await tx.query('INSERT INTO ads_auth_challenges(id,address,credential_id,challenge_hash,authority_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6)', [challengeId, address, credentialId, sha256(value), snapshot.authorityHash, expiresAt]);
    });
    return { challengeId, options, expiresAt: expiresAt.toISOString() };
  }
  async function verify({ challengeId, response }) {
    configured();
    const result = await db.transaction(async tx => {
      const row = (await tx.query('SELECT * FROM ads_auth_challenges WHERE id=$1 FOR UPDATE', [challengeId])).rows[0];
      if (!row || row.consumed_at || new Date(row.expires_at).getTime() <= now()) return { error: new AdsError(401, 'AUTH_CHALLENGE_EXPIRED', 'The login challenge has expired or was already used.') };
      // Commit consumption even when verification fails; never leave a challenge reusable.
      await tx.query('UPDATE ads_auth_challenges SET consumed_at=$2 WHERE id=$1', [challengeId, new Date(now())]);
      try {
        if (response?.id !== row.credential_id || response?.type !== 'public-key') throw new AdsError(401, 'AUTH_CREDENTIAL_MISMATCH', 'The response does not match the selected passkey.');
        const snapshot = await authority.read({ address: row.address, credentialId: row.credential_id });
        if (snapshot.authorityHash !== row.authority_hash) throw new AdsError(401, 'WALLET_AUTHORITY_CHANGED', 'The wallet authority changed. Start a new login.');
        const owner = identity(row.address);
        // Serialize all sign-counter/session mutations for a wallet.
        await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [owner.ownerId]);
        const existing = (await tx.query('SELECT * FROM ads_identities WHERE owner_id=$1 FOR UPDATE', [owner.ownerId])).rows[0];
        const previousCounter = existing?.credential_id === row.credential_id && existing?.authority_hash === row.authority_hash ? Number(existing.sign_count) : 0;
        const validation = await (await webauthn()).verifyAuthenticationResponse({
          response, expectedChallenge: value => equalHash(value, row.challenge_hash),
          expectedOrigin: config.origin, expectedRPID: config.rpId, requireUserVerification: true,
          credential: { id: row.credential_id, publicKey: p256ToCose(Buffer.from(snapshot.publicKey, 'base64url')), counter: previousCounter },
        });
        if (!validation?.verified || !validation.authenticationInfo?.userVerified) throw new AdsError(401, 'AUTH_INVALID', 'The passkey response could not be verified.');
        const counter = Number(validation.authenticationInfo.newCounter);
        if (!Number.isSafeInteger(counter) || counter < 0 || (previousCounter > 0 && counter <= previousCounter)) throw new AdsError(401, 'AUTH_COUNTER_REPLAY', 'The passkey counter did not advance.');
        await tx.query('INSERT INTO ads_identities(owner_id,address,credential_id,authority_hash,sign_count) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id) DO UPDATE SET credential_id=EXCLUDED.credential_id,authority_hash=EXCLUDED.authority_hash,sign_count=EXCLUDED.sign_count,updated_at=now()', [owner.ownerId, row.address, row.credential_id, row.authority_hash, counter]);
        // Authority changes invalidate older sessions, including counter-less synced passkeys.
        await tx.query('UPDATE ads_sessions SET revoked_at=$2 WHERE owner_id=$1 AND authority_hash<>$3 AND revoked_at IS NULL', [owner.ownerId, new Date(now()), row.authority_hash]);
        const token = randomBytes(32).toString('base64url');
        const expiresAt = new Date(now() + config.sessionMs);
        await tx.query('INSERT INTO ads_sessions(token_hash,owner_id,authority_hash,expires_at) VALUES($1,$2,$3,$4)', [sha256(token), owner.ownerId, row.authority_hash, expiresAt]);
        return { token, identity: owner, expiresAt: expiresAt.toISOString(), cookie: sessionCookie(token, Math.floor(config.sessionMs / 1000)) };
      } catch (error) {
        return { error: error instanceof AdsError ? error : new AdsError(401, 'AUTH_INVALID', 'The passkey response could not be verified.') };
      }
    });
    if (result.error) throw result.error;
    return result;
  }
  async function authenticate(request) {
    configured();
    const origin = header(request, 'origin');
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(String(request?.method ?? 'GET').toUpperCase());
    if ((unsafe && origin !== config.origin) || (origin && origin !== config.origin)) throw new AdsError(403, 'ORIGIN_REJECTED', 'The request origin does not match this application.');
    const token = cookieToken(request);
    if (!token) throw new AdsError(401, 'AUTH_REQUIRED', 'Sign in with your wallet passkey.');
    const row = (await db.query('SELECT s.*,i.address,i.credential_id FROM ads_sessions s JOIN ads_identities i ON i.owner_id=s.owner_id WHERE s.token_hash=$1', [sha256(token)])).rows[0];
    if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= now()) throw new AdsError(401, 'SESSION_EXPIRED', 'The advertiser session has expired.');
    const snapshot = await authority.read({ address: row.address, credentialId: row.credential_id });
    if (snapshot.authorityHash !== row.authority_hash) {
      await db.query('UPDATE ads_sessions SET revoked_at=$2 WHERE token_hash=$1', [sha256(token), new Date(now())]);
      throw new AdsError(401, 'WALLET_AUTHORITY_CHANGED', 'The wallet authority changed. Sign in again.');
    }
    return identity(row.address);
  }
  async function logout(request) {
    const token = cookieToken(request);
    if (token) await db.query('UPDATE ads_sessions SET revoked_at=$2 WHERE token_hash=$1', [sha256(token), new Date(now())]);
    return { cookie: sessionCookie('', 0) };
  }
  return Object.freeze({ challenge, verify, authenticate, logout });
}
