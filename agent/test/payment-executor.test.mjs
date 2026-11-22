import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { openRunState, atomicWriteJson } from '../lib/run-store.mjs';
import { createPurchaseExecutor, executeDurableAction, recoverDurableAction } from '../lib/payment-executor.mjs';
import { Ledger, ROOT_AGENT } from '../ledger.mjs';

const mandate = { id: 'test', objective: 'offline fault injection', network: 'stellar:testnet', budgetUsdc: '0.50', perCallCapUsdc: '0.10', allocations: { 'stage-agent': '0.20' }, allowedServices: ['venue-feed'] };
const runId = 'payment-recovery', key = runId + '#1:venue-feed', hash = 'a'.repeat(64);
const catalog = [{ id: 'venue-feed', path: '/venue-feed', priceUsdc: '0.01' }];
const preflight = () => new Response(JSON.stringify({ accepts: [{ network: 'stellar:testnet', amount: '100000' }] }), { status: 402 });
const paid = (status = 200, body = { items: [] }) => new Response(JSON.stringify(body), { status, headers: { 'payment-response': Buffer.from(JSON.stringify({ success: true, network: 'stellar:testnet', transaction: hash })).toString('base64') } });
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'agent-payments-'));
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, async open() { const state = await openRunState({ directory, runId, mandate }); state.ledger.allocate(ROOT_AGENT, 'stage-agent', '0.20'); return state; } };
}
function buyer(state, payFetch, options = {}) {
  return createPurchaseExecutor({ ...state, save: () => state.save(), catalog, servicesUrl: 'https://offline.invalid', fetchImpl: async () => preflight(), payFetch, ...options });
}
const buy = fn => fn(1, 'stage-agent', 'venue-feed');

test('payment intent is durable before dispatch and a timeout after settlement never pays twice after restart', async t => {
  const f = await fixture(t); let state = await f.open(), sends = 0;
  await buy(buyer(state, async () => {
    const snapshot = JSON.parse(await readFile(state.files.state, 'utf8'));
    assert.equal(snapshot.ledger.rows.find(row => row.key === key).status, 'payment-pending');
    sends++; throw Error('timeout after simulated settlement');
  }));
  assert.equal(state.ledger.byKey.get(key).status, 'needs-reconciliation');
  assert.equal(state.ledger.available('stage-agent'), 1900000n);
  await state.close(); state = await f.open();
  await buy(buyer(state, async () => { sends++; return paid(); }));
  assert.equal(sends, 1); assert.equal(state.ledger.available('stage-agent'), 1900000n);
  await state.close();
});

test('HTTP failure after settlement retains evidence and prevents repayment', async t => {
  const f = await fixture(t); let state = await f.open(), sends = 0;
  await buy(buyer(state, async () => { sends++; return paid(500); }));
  assert.equal(state.ledger.byKey.get(key).status, 'needs-reconciliation');
  assert.equal(state.ledger.byKey.get(key).tx, hash);
  await state.close(); state = await f.open();
  await buy(buyer(state, async () => { sends++; return paid(); }));
  assert.equal(sends, 1); await state.close();
});

test('successful settlement and its result are recovered from one snapshot', async t => {
  const f = await fixture(t); let state = await f.open(), sends = 0;
  const expected = { items: [{ title: 'Recorded result' }] };
  assert.deepEqual(await buy(buyer(state, async () => { sends++; return paid(200, expected); })), expected);
  await state.close();
  // Legacy projections may be incomplete; the canonical pair remains authoritative.
  await writeFile(state.files.results, '{');
  state = await f.open();
  assert.deepEqual(await buy(buyer(state, async () => { sends++; return paid(); })), expected);
  assert.equal(sends, 1); await state.close();
});

test('a lost final save leaves a persisted pending intent that blocks restart', async t => {
  const f = await fixture(t); let state = await f.open(), saves = 0, sends = 0;
  const fn = buyer(state, async () => { sends++; return paid(); }, { save: async () => { if (++saves === 2) throw Error('disk unavailable'); await state.save(); } });
  await assert.rejects(buy(fn), /disk unavailable/); await state.close();
  state = await f.open(); await buy(buyer(state, async () => { sends++; return paid(); }));
  assert.equal(sends, 1); assert.equal(state.ledger.byKey.get(key).status, 'needs-reconciliation'); await state.close();
});

test('failure to persist the initial intent prevents dispatch', async t => {
  const f = await fixture(t), state = await f.open(); let sends = 0;
  await assert.rejects(buy(buyer(state, async () => { sends++; return paid(); }, { save: async () => { throw Error('disk unavailable'); } })), /disk unavailable/);
  assert.equal(sends, 0); await state.close();
});

test('same-run concurrent executors cannot acquire a second writer lock', async t => {
  const f = await fixture(t), state = await f.open();
  await assert.rejects(f.open(), error => error.code === 'RUN_LOCKED');
  let sends = 0;
  const fn = buyer(state, async () => { sends++; await new Promise(resolve => setTimeout(resolve, 10)); return paid(); });
  const [first, second] = await Promise.all([buy(fn), buy(fn)]);
  assert.deepEqual(first, second); assert.equal(sends, 1); await state.close();
});

test('a leftover crash lock fails closed instead of stealing payment authority', async t => {
  const f = await fixture(t), state = await f.open(); const lock = state.files.lock;
  await state.close(); await writeFile(lock, JSON.stringify({ pid: 0, note: 'simulated interrupted process' }));
  await assert.rejects(f.open(), error => error.code === 'RUN_LOCKED');
});

test('only pre-signing failures can be retried; dry run never dispatches', async t => {
  const f = await fixture(t); let state = await f.open(), sends = 0;
  await buy(buyer(state, async () => { sends++; return paid(); }, { dry: true }));
  assert.equal(state.ledger.byKey.get(key).retrySafe, true); assert.equal(sends, 0);
  await state.close(); state = await f.open();
  await buy(buyer(state, async () => { sends++; return paid(); }));
  assert.equal(sends, 1); await state.close();
});

test('network failure before signing is retryable and does not reserve spent budget', async t => {
  const f = await fixture(t), state = await f.open(); let sends = 0;
  await buy(buyer(state, async () => { sends++; return paid(); }, { fetchImpl: async () => { throw Error('preflight unavailable'); } }));
  assert.equal(state.ledger.available('stage-agent'), 2000000n);
  await buy(buyer(state, async () => { sends++; return paid(); }));
  assert.equal(sends, 1); await state.close();
});

test('HTTP success without a valid settlement receipt stays uncertain', async t => {
  const f = await fixture(t), state = await f.open(); let sends = 0;
  const fn = buyer(state, async () => { sends++; return new Response('{}'); });
  assert.equal(await buy(fn), null); assert.equal(await buy(fn), null);
  assert.equal(sends, 1); assert.equal(state.ledger.byKey.get(key).status, 'needs-reconciliation'); await state.close();
});

test('legacy failed payments migrate conservatively without automatic retries', async t => {
  const f = await fixture(t), state = await f.open(); const files = state.files; await state.close();
  const ledger = new Ledger(mandate, { runId }); ledger.allocate(ROOT_AGENT, 'stage-agent', '0.20');
  ledger.authorize({ agent: 'stage-agent', service: 'venue-feed', priceUsdc: '0.01', key });
  ledger.release(key, 'payment error: timeout'); delete ledger.byKey.get(key).retrySafe;
  await writeFile(files.ledger, JSON.stringify(ledger.toJSON())); await writeFile(files.results, '{}');
  const migrated = await f.open(); let sends = 0;
  await buy(buyer(migrated, async () => { sends++; return paid(); }));
  assert.equal(sends, 0); assert.equal(migrated.ledger.byKey.get(key).status, 'needs-reconciliation');
  assert.equal(migrated.ledger.available('stage-agent'), 1900000n); await migrated.close();
});

test('a partial legacy pair or malformed canonical state cannot become a fresh run', async t => {
  const f = await fixture(t), state = await f.open(), files = state.files; await state.close();
  await writeFile(files.results, JSON.stringify({ [key]: { items: [] } }));
  await assert.rejects(f.open(), /ledger/);
  await writeFile(files.state, '{');
  await assert.rejects(f.open(), /JSON/);
  await writeFile(files.state, 'null');
  await assert.rejects(f.open(), /snapshot/);
});

test('atomic replacement failure preserves the previous complete snapshot', async t => {
  const f = await fixture(t), file = path.join(f.directory, 'atomic.json');
  await atomicWriteJson(file, { version: 1 });
  await assert.rejects(atomicWriteJson(file, { version: 2 }, { renameFile: async () => { throw Error('rename failed'); } }), /rename failed/);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { version: 1 });
});

test('allowance draw is persisted before dispatch and never repeated after an uncertain response', async t => {
  const f = await fixture(t); let state = await f.open(), sends = 0;
  const args = () => ({ ...state, save: () => state.save(), key: runId + '#0:allowance-draw', metadata: { type: 'onchain-draw', agent: ROOT_AGENT, service: 'allowance', priceUsdc: '0.20' } });
  await assert.rejects(executeDurableAction({ ...args(), execute: async () => { sends++; throw Error('timeout'); } }), /reconciliation/i);
  await state.close(); state = await f.open();
  // The CLI checks this before an insufficient-allowance preflight could append `blocked`.
  assert.throws(() => recoverDurableAction(args()), /reconciliation/i);
  assert.equal(state.ledger.byKey.get(runId + '#0:allowance-draw').status, 'needs-reconciliation');
  await assert.rejects(executeDurableAction({ ...args(), execute: async () => { sends++; return { tx: hash }; } }), /reconciliation/i);
  assert.equal(sends, 1); await state.close();
});

test('settled legacy ledger and results resume without a new payment', async t => {
  const f = await fixture(t), state = await f.open(), files = state.files; await state.close();
  const ledger = new Ledger(mandate, { runId }); ledger.allocate(ROOT_AGENT, 'stage-agent', '0.20');
  ledger.authorize({ agent: 'stage-agent', service: 'venue-feed', priceUsdc: '0.01', key }); ledger.settle(key, { tx: hash });
  await writeFile(files.ledger, JSON.stringify(ledger.toJSON())); await writeFile(files.results, JSON.stringify({ [key]: { items: [] } }));
  const migrated = await f.open(); let sends = 0;
  assert.deepEqual(await buy(buyer(migrated, async () => { sends++; return paid(); })), { items: [] });
  assert.equal(sends, 0); await migrated.close();
});

test('inconsistent legacy results cannot become success or a new payment', async t => {
  const f = await fixture(t), state = await f.open(); let sends = 0;
  state.results[key] = { items: [] };
  await assert.rejects(buy(buyer(state, async () => { sends++; return paid(); })), /reconciliation/);
  assert.equal(sends, 0); await state.close();
});

test('a process killed after dispatch leaves an exclusive lock and a recoverable intent', async t => {
  const f = await fixture(t);
  const child = fork(new URL('./fixtures/payment-process.mjs', import.meta.url), [f.directory, runId, JSON.stringify(mandate)], { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
  const exited = once(child, 'exit'); let timer;
  try {
    const message = await Promise.race([once(child, 'message'), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Child did not submit its simulated payment')), 5000); })]);
    assert.equal(message[0].phase, 'submitted');
    await assert.rejects(f.open(), error => error.code === 'RUN_LOCKED');
    child.kill(); await exited;
    await assert.rejects(f.open(), error => error.code === 'RUN_LOCKED');
    const statePath = path.join(f.directory, 'run-' + runId + '.json');
    const snapshot = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(snapshot.ledger.rows.find(row => row.key === key).status, 'payment-pending');
    // Simulates an operator removing only the lock after confirming the owner is dead.
    await rm(path.join(f.directory, 'run-' + runId + '.lock'));
    const recovered = await f.open(); let sends = 0;
    await buy(buyer(recovered, async () => { sends++; return paid(); }));
    assert.equal(sends, 0); assert.equal(await readFile(path.join(f.directory, 'simulated-submissions.txt'), 'utf8'), 'submitted\n');
    await recovered.close();
  } finally {
    clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill(); await exited;
  }
});
