import { createHash } from 'node:crypto';
import { readConfig, publicConfig } from './config.mjs';
import { assertAddress, createRuntime } from './runtime.mjs';
import { validateDeployment } from './deployment.mjs';
import { versionClaim, compareAndSetClaim, claimResultState } from './claim-store.mjs';
import { assertOrigin, assertReady, json, readBody, WalletApiError, withErrors } from './http.mjs';

const PENDING_TIMEOUT = 130_000;
const RATE_SCRIPT = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n";
const friendlyReason = reason => ({
  user_cooldown: 'La wallet está en el período de espera del faucet.',
  global_cooldown: 'El faucet está en período de espera.',
  empty_today: 'El cupo diario del faucet está agotado.',
  insufficient_vault: 'El faucet no tiene fondos disponibles.',
  ip_lifetime_cap: 'Se alcanzó el cupo de esta conexión para el piloto.',
  ip_limit: 'Se alcanzó el cupo de esta conexión para el piloto.',
}[reason] || 'El faucet no pudo entregar USDC. Comprueba el estado antes de reintentar.');

export function createWalletHandlers({ env = process.env, config = readConfig(env), runtime = createRuntime(config, env), now = Date.now } = {}) {
  const keyFor = address => `wallet:${config.campaign}:testnet:claim:${address}`;
  const sendState = (address, record, balance = 0n) => ({
    state: record?.state || (balance > 0n ? 'confirmed' : 'none'), address,
    balance: balance.toString(), ...(record?.hash ? { hash: record.hash } : {}),
    ...(record?.reason ? { reason: record.reason } : {}),
    ...(record?.nextAvailableAt ? { nextAvailableAt: record.nextAvailableAt } : {}),
    message: balance > 0n ? 'USDC de prueba confirmado en Stellar Testnet.' : record?.state === 'unknown' ? 'La solicitud puede haberse enviado. Estamos verificando su resultado; no solicitaremos fondos otra vez.' : record?.state === 'failed' ? friendlyReason(record.reason) : 'Verificando la recepción de USDC de prueba.',
  });
  async function limit(request, action) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const client = createHash('sha256').update(`${config.campaign}:${ip}`).digest('hex');
    const perIp = action === 'read' ? 90 : action === 'relay' ? 5 : 8;
    const globalLimit = action === 'read' ? 300 : action === 'relay' ? 15 : 25;
    const counts = await Promise.all([
      runtime.redis.eval(RATE_SCRIPT, [`wallet:${config.campaign}:rate:${action}:${client}`], [60]),
      runtime.redis.eval(RATE_SCRIPT, [`wallet:${config.campaign}:rate:${action}:global`], [60]),
    ]);
    if (Number(counts[0]) > perIp || Number(counts[1]) > globalLimit) throw new WalletApiError(429, 'rate_limited', 'Demasiadas solicitudes. Espera un minuto antes de volver a comprobar.');
  }
  async function inspect(address) {
    if (!(await runtime.walletAllowed(address))) throw new WalletApiError(409, 'wallet_not_deployed', 'La smart wallet todavía no está desplegada con el código esperado.');
    let [record, balance] = await Promise.all([runtime.redis.get(keyFor(address)), runtime.balance(address)]);
    for (let attempt = 0; attempt < 3; attempt++) {
      let next;
      if (balance > 0n && record?.state !== 'confirmed') {
        next = versionClaim({ ...record, address, state: 'confirmed', createdAt: record?.createdAt || now(), updatedAt: now(), confirmedAt: now() });
        delete next.reason; delete next.nextAvailableAt;
      } else if (record?.state === 'pending' && now() - record.updatedAt > PENDING_TIMEOUT) {
        next = versionClaim({ ...record, state: 'unknown', updatedAt: now() });
      } else return { record, balance };
      const changed = record ? await compareAndSetClaim(runtime.redis, keyFor(address), record, next) : await runtime.redis.set(keyFor(address), next, { nx: true });
      if (changed) return { record: next, balance };
      record = await runtime.redis.get(keyFor(address));
    }
    return { record, balance };
  }
  async function finishClaim(address, pending, outcome) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await runtime.redis.get(keyFor(address));
      if (latest?.state === 'confirmed') return latest;
      let next;
      if (!latest || latest.version === pending.version || outcome.state === 'confirmed') next = versionClaim(outcome);
      else if (latest.attempt === pending.attempt && latest.state === 'unknown' && outcome.hash) next = versionClaim({ ...latest, hash: outcome.hash, updatedAt: now() });
      else return latest;
      const changed = latest ? await compareAndSetClaim(runtime.redis, keyFor(address), latest, next) : await runtime.redis.set(keyFor(address), next, { nx: true });
      if (changed) return next;
    }
    return await runtime.redis.get(keyFor(address)) || { ...pending, state: 'unknown' };
  }
  const onlyGet = request => { if (request.method !== 'GET') throw new WalletApiError(405, 'method_not_allowed', 'Método no permitido.'); };
  return {
    config: request => withErrors(async () => { onlyGet(request); return json(publicConfig(config, request)); }),
    relay: request => withErrors(async () => {
      if (request.method !== 'POST') throw new WalletApiError(405, 'method_not_allowed', 'Método no permitido.');
      assertOrigin(request, config); assertReady(config);
      const body = await readBody(request), parsed = validateDeployment(body, config);
      await limit(request, 'relay');
      await runtime.simulateDeployment(parsed);
      return json(await runtime.relay(body));
    }),
    faucet: request => withErrors(async () => {
      if (!['GET', 'POST'].includes(request.method)) throw new WalletApiError(405, 'method_not_allowed', 'Método no permitido.');
      const url = new URL(request.url);
      if (request.method === 'GET' && !url.searchParams.has('address')) {
        const availability = await runtime.availability();
        return json(availability);
      }
      if (request.method === 'POST') assertOrigin(request, config);
      assertReady(config);
      let body;
      if (request.method === 'POST') {
        body = await readBody(request, 512);
        if (Object.keys(body).some(key => key !== 'address' && key !== 'retry') || (body.retry !== undefined && typeof body.retry !== 'boolean')) throw new WalletApiError(400, 'invalid_request', 'La solicitud de fondos no es válida.');
      }
      const address = assertAddress(body?.address || url.searchParams.get('address'));
      await limit(request, request.method === 'GET' ? 'read' : 'claim');
      let current = await inspect(address);
      if (request.method === 'GET' || current.balance > 0n || (current.record && !(current.record.state === 'failed' && body?.retry === true))) return json(sendState(address, current.record, current.balance));
      if (current.record?.nextAvailableAt) {
        const retryAt = Date.parse(current.record.nextAvailableAt);
        if (!Number.isFinite(retryAt) || retryAt > now()) return json(sendState(address, current.record, current.balance));
      }
      // Keep every initial claim record through the campaign; no TTL can silently re-enable it.
      const pending = versionClaim({ state: 'pending', address, createdAt: current.record?.createdAt || now(), updatedAt: now(), attempt: (current.record?.attempt || 0) + 1 });
      let acquired;
      if (current.record?.state === 'failed') {
        // Retry only a definite provider failure, through an explicit user action and CAS.
        acquired = await compareAndSetClaim(runtime.redis, keyFor(address), current.record, pending);
      } else acquired = await runtime.redis.set(keyFor(address), pending, { nx: true });
      if (!acquired) { current = await inspect(address); return json(sendState(address, current.record, current.balance)); }
      let result;
      try { result = await runtime.claim(address); }
      catch { result = { unknown: true }; }
      let record = { ...pending, updatedAt: now(), state: claimResultState(result),
        ...(typeof result.hash === 'string' && /^[0-9a-f]{64}$/i.test(result.hash) ? { hash: result.hash } : {}),
        ...(typeof result.reason === 'string' ? { reason: result.reason.slice(0, 80) } : {}),
        ...(typeof result.nextAvailableAt === 'string' ? { nextAvailableAt: result.nextAvailableAt.slice(0, 40) } : {}),
      };
      let balance = 0n;
      try { balance = await runtime.balance(address); if (balance > 0n) { record.state = 'confirmed'; record.confirmedAt = now(); delete record.reason; } }
      catch { if (record.state === 'pending') record.state = 'unknown'; }
      // Every transition is conditional, including a delayed child-process completion.
      record = await finishClaim(address, pending, record);
      return json(sendState(address, record, balance));
    }),
  };
}

