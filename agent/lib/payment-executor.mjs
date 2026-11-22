import { findService } from '../catalog.mjs';
import { explorerTx } from '../config/networks.mjs';
import { paymentRequiredFrom, settlementFrom, settlementTx, withinReservation } from './x402-headers.mjs';

const transactionHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);

/** The paid transport is called only after its intent is durably saved. */
export function createPurchaseExecutor({ ledger, results, save, runId = ledger.runId, catalog, servicesUrl, fetchImpl = fetch, payFetch, dry = false, log = () => {} }) {
  let queue = Promise.resolve();
  async function buy(step, agent, serviceId, { method = 'GET', body } = {}) {
    const service = findService(catalog, serviceId), key = `${runId}#${step}:${serviceId}`;
    if (Object.hasOwn(results, key)) {
      if (ledger.byKey.get(key)?.status !== 'settled') throw Error('The saved result has no matching settled payment; reconciliation is required.');
      log(`  ${step}. ${serviceId}: reusing the recorded result; no new payment`);
      return results[key];
    }
    const auth = ledger.authorize({ agent, service: serviceId, priceUsdc: service.priceUsdc, key });
    if (!auth.ok) {
      log(`  ${step}. ${serviceId}: BLOCKED — ${auth.reason}`);
      await save(); return null;
    }
    const url = `${servicesUrl}/paid${service.path}`;
    const init = { method, headers: { 'content-type': 'application/json' }, ...(body && { body: JSON.stringify(body) }) };
    const release = async reason => {
      ledger.release(key, reason); await save();
      log(`  ${step}. ${serviceId}: stopped before signing — ${reason}`); return null;
    };
    let pre, preBody = null;
    try { pre = await fetchImpl(url, init); }
    catch { return release('preflight unavailable; no payment was sent'); }
    try { preBody = await pre.json(); } catch {}
    if (pre.status !== 402) return release(`preflight expected 402, received ${pre.status}`);
    if (!withinReservation(paymentRequiredFrom(pre, preBody), ledger.network, service.priceUsdc)) return release('preflight price or network differs from the reservation');
    if (dry) return release('dry run: stopped before signing');
    if (typeof payFetch !== 'function') return release('payment transport is not configured');

    ledger.beginPayment(key);
    await save(); // A failure here must abort before the transport can sign or submit anything.
    let res;
    try { res = await payFetch(url, init); }
    catch {
      ledger.uncertain(key, 'payment transport interrupted; reconcile before retrying');
      await save(); log(`  ${step}. ${serviceId}: NEEDS RECONCILIATION`); return null;
    }
    const receipt = settlementFrom(res), settlement = settlementTx(receipt);
    const evidence = { tx: transactionHash(settlement.tx) ? settlement.tx : null, payer: typeof settlement.payer === 'string' ? settlement.payer : null };
    const uncertain = async reason => {
      ledger.uncertain(key, reason, evidence); await save();
      log(`  ${step}. ${serviceId}: NEEDS RECONCILIATION`); return null;
    };
    // HTTP errors can occur after settlement. Even a negative/missing receipt cannot prove
    // that a transport retry never submitted an earlier payment.
    if (!res.ok || settlement.success !== true || !evidence.tx || receipt.network && receipt.network !== ledger.network) return uncertain('no complete successful payment response; reconcile before retrying');
    let data;
    try { data = await res.json(); }
    catch { return uncertain('payment receipt received but result unreadable; reconcile before retrying'); }
    ledger.settle(key, evidence); results[key] = data;
    await save();
    log(`  ${step}. ${serviceId}: SETTLED ${explorerTx(ledger.network, evidence.tx)}`);
    return data;
  }
  // One in-process executor also serializes different steps and their snapshots.
  return (...args) => (queue = queue.then(() => buy(...args)));
}

/** Check this before preflight code can append a new blocked row for the same action. */
export function recoverDurableAction({ ledger, results, key }) {
  const prior = ledger.byKey.get(key);
  if (Object.hasOwn(results, key)) {
    if (transactionHash(results[key]?.tx) && prior?.status === 'settled' && prior.tx === results[key].tx) return results[key];
    throw Error('The saved action result needs reconciliation before any retry.');
  }
  if (prior?.status === 'settled' && transactionHash(prior.tx)) return { tx: prior.tx };
  if (prior && prior.status !== 'blocked') throw Error('This action needs reconciliation before any retry.');
  return null;
}

/** Protect the separate treasury draw, which is not an expense in the agent budget. */
export async function executeDurableAction({ ledger, results, save, key, metadata, execute }) {
  const recorded = recoverDurableAction({ ledger, results, key });
  if (recorded) return recorded;
  ledger.note({ ...metadata, key, status: 'needs-reconciliation', reason: 'durable intent; this action may be submitted' });
  await save();
  let result;
  try { result = await execute(); }
  catch { throw Error('Action response is uncertain; reconciliation is required before retrying.'); }
  if (!transactionHash(result?.tx)) throw Error('Action has no confirmed transaction hash; reconciliation is required.');
  results[key] = result;
  ledger.note({ ...metadata, key, status: 'settled', tx: result.tx });
  await save(); return result;
}
