import test from "node:test";
import assert from "node:assert/strict";
import { LEDGERS_PER_DAY, liveUntilLedger, drawPlan, probeAbove, sumAllocations, onchainSummary } from "../lib/allowance.mjs";
import { toUnits } from "../lib/money.mjs";
import { Ledger, ROOT_AGENT } from "../ledger.mjs";

const mandate = {
  id: "t", objective: "t", network: "stellar:testnet", budgetUsdc: "0.50", perCallCapUsdc: "0.10",
  requiresApprovalAboveUsdc: "0.10", allocations: { "stage-agent": "0.20" }, allowedServices: ["venue-feed"],
};

test("approval stays live for whole days and never below the current ledger", () => {
  assert.equal(liveUntilLedger(1000), 1000 + LEDGERS_PER_DAY);
  assert.equal(liveUntilLedger(1000, 0.5), 1000 + LEDGERS_PER_DAY / 2);
  assert.throws(() => liveUntilLedger(0));
  assert.throws(() => liveUntilLedger(10, 0));
});

test("the agent draws exactly its allocations and the probe is one cent above what is left", () => {
  const needed = sumAllocations(mandate.allocations);
  assert.equal(needed, toUnits("0.20"));
  const plan = drawPlan(toUnits("0.50"), needed);
  assert.deepEqual([plan.ok, plan.drawUnits, plan.remainingUnits], [true, toUnits("0.20"), toUnits("0.30")]);
  assert.equal(plan.probeUnits, toUnits("0.31"));
  assert.equal(probeAbove(toUnits("0.30")), toUnits("0.31"));
});

test("an allowance below the allocations means no draw at all", () => {
  const plan = drawPlan(toUnits("0.10"), toUnits("0.20"));
  assert.equal(plan.ok, false);
  assert.equal(plan.drawUnits, 0n);
  assert.throws(() => drawPlan(toUnits("1"), 0n));
});

test("the on-chain summary the dashboard reads uses decimal USDC strings", () => {
  const s = onchainSummary({
    network: "stellar:testnet", sac: "CSAC", treasury: "GT", spender: "GA",
    approvedUnits: toUnits("0.50"), liveUntil: 123, approveTx: "a1", drawTx: "d1",
    drawUnits: toUnits("0.20"), remainingUnits: toUnits("0.30"),
    probe: { units: toUnits("0.31"), refused: true, reason: "HostError" },
  });
  assert.deepEqual(
    [s.mode, s.approvedUsdc, s.drawnUsdc, s.remainingUsdc, s.probe.amountUsdc, s.probe.refused],
    ["sep41-allowance", "0.5", "0.2", "0.3", "0.31", true],
  );
});

test("network events are recorded as rows without touching the off-chain budget", () => {
  const l = new Ledger(mandate, { runId: "r", clock: () => "t" });
  l.allocate(ROOT_AGENT, "stage-agent", "0.20");
  const before = l.available("stage-agent");
  const row = l.note({ type: "onchain-draw", agent: ROOT_AGENT, service: "draw", priceUsdc: "0.20", status: "settled", tx: "abc" });
  assert.equal(row.explorer, "https://stellar.expert/explorer/testnet/tx/abc");
  l.note({ type: "onchain-draw", agent: ROOT_AGENT, service: "draw", priceUsdc: "0.31", status: "blocked", reason: "refused by the network" });
  assert.equal(l.available("stage-agent"), before);
  assert.throws(() => l.note({ type: "x" }));
  l.onchain = { mode: "sep41-allowance" };
  const json = JSON.parse(JSON.stringify(l.toJSON()));
  assert.equal(json.onchain.mode, "sep41-allowance");
  assert.equal(Ledger.restore(mandate, json).toJSON().onchain.mode, "sep41-allowance");
});
