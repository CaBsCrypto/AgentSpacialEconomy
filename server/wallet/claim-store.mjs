import { randomUUID } from 'node:crypto';

// A revision changes on every state transition. Old readers and old CLI completions
// cannot overwrite a newer claim attempt or downgrade its onchain confirmation.
export const CLAIM_CAS_SCRIPT = `-- wallet:claim:cas:v1
local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end
local item=cjson.decode(raw); local expected=cjson.decode(ARGV[1])
if item.version~=expected.version or item.state~=expected.state or item.attempt~=expected.attempt or item.updatedAt~=expected.updatedAt then return 0 end
redis.call('SET',KEYS[1],ARGV[2]); return 1`;

export const versionClaim = record => ({ ...record, version: randomUUID() });
export async function compareAndSetClaim(redis, key, expected, next) {
 const identity = { version: expected.version, state: expected.state, attempt: expected.attempt, updatedAt: expected.updatedAt };
 return Number(await redis.eval(CLAIM_CAS_SCRIPT, [key], [JSON.stringify(identity), JSON.stringify(next)])) === 1;
}

const DEFINITE_REJECTIONS = new Set(['user_cooldown', 'global_cooldown', 'empty_today', 'insufficient_vault', 'ip_lifetime_cap', 'ip_limit']);
export function claimResultState(result) {
 if (result?.unknown) return 'unknown';
 if (result?.success === true) return 'pending';
 // A failed payment or a failure carrying a transaction hash can still have been
 // submitted. Only known pre-transfer rejections allow an explicit later retry.
 if (result?.success === false && !result.hash && DEFINITE_REJECTIONS.has(result.reason)) return 'failed';
 return 'unknown';
}
