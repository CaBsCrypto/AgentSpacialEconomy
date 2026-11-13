// Offline child process used to interrupt a payment after its durable intent.
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { openRunState } from '../../lib/run-store.mjs';
import { createPurchaseExecutor } from '../../lib/payment-executor.mjs';
import { ROOT_AGENT } from '../../ledger.mjs';

const [directory, runId, serializedMandate] = process.argv.slice(2);
const mandate = JSON.parse(serializedMandate);
const state = await openRunState({ directory, runId, mandate });
state.ledger.allocate(ROOT_AGENT, 'stage-agent', '0.20');
const buy = createPurchaseExecutor({
  ...state, save: () => state.save(), servicesUrl: 'https://offline.invalid',
  catalog: [{ id: 'venue-feed', path: '/venue-feed', priceUsdc: '0.01' }],
  fetchImpl: async () => new Response(JSON.stringify({ accepts: [{ network: 'stellar:testnet', amount: '100000' }] }), { status: 402 }),
  payFetch: async () => {
    await appendFile(path.join(directory, 'simulated-submissions.txt'), 'submitted\n');
    process.send({ phase: 'submitted' });
    await new Promise(() => setInterval(() => {}, 1000));
  },
});
await buy(1, 'stage-agent', 'venue-feed');
