import { fail, sha256 } from '../identity/common.mjs';
import { consumeLimits } from './db.mjs';
/** Coverage-scoped cumulative counters, shared by processes and never reset by a request. */
export function createResourceBudget({ db,config,now = Date.now }) {
  return { async reserve(items) {
    const coverage=config.coverage;
    if (!coverage?.id || !/^[a-zA-Z0-9_-]{1,80}$/.test(coverage.id) || !Number.isFinite(Date.parse(coverage.verifiedUntil)) || Date.parse(coverage.verifiedUntil)<=now()) fail(503,'COVERAGE_UNVERIFIED','A current quantitative resource allowance is required.');
    const entries=items.map(({resource,amount=1})=>{
      const limit=coverage.quotas?.[resource];
      if (!Number.isSafeInteger(limit)||limit<=0||!Number.isSafeInteger(amount)||amount<1) fail(503,'RESOURCE_QUOTA_UNVERIFIED','The required resource allowance is unavailable.');
      return { key:'coverage:'+coverage.id+':'+resource,amount,limit };
    });
    await consumeLimits(db,entries);
  }, async auth(context) {
    const minute=Math.floor(now()/60000);
    const ipHash=sha256(String(context?.ip || 'unknown'));
    // Existing sessions still revalidate their on-chain authority, but routine
    // project reads and recovery must not consume the login-attempt allowance.
    if(context?.kind==='session'){
      if(typeof context.ownerId!=='string'||!context.ownerId)fail(503,'AUTH_LIMITS_UNAVAILABLE','A server-validated session owner is required.');
      await consumeLimits(db,[{key:'identity:session:ip:'+minute+':'+ipHash,limit:60},{key:'identity:session:owner:'+minute+':'+sha256(context.ownerId),limit:60},{key:'identity:session:global:'+minute,limit:120}]);
      return;
    }
    await consumeLimits(db,[{key:'identity:ip:'+minute+':'+ipHash,limit:10},{key:'identity:global:'+minute,limit:60}]);
  } };
}
