import test from "node:test";
import assert from "node:assert/strict";
import { Ledger, ROOT_AGENT, explorerUrl } from "../ledger.mjs";

const mandate = {
  id: "t",
  objective: "test",
  network: "stellar:testnet",
  budgetUsdc: "0.50",
  perCallCapUsdc: "0.10",
  requiresApprovalAboveUsdc: "0.10",
  allocations: { "stage-agent": "0.20" },
  allowedServices: ["venue-feed", "screen-card", "premium-render"],
};
const clock = () => "2026-10-26T08:00:00.000Z";

function fresh() {
  const l = new Ledger(mandate, { runId: "r1", clock });
  assert.equal(l.allocate(ROOT_AGENT, "stage-agent", "0.20").ok, true);
  return l;
}

test("allocation moves budget from the venue agent to the stage agent", () => {
  const l = fresh();
  assert.equal(l.available(ROOT_AGENT), 3_000_000n); // 0.30 USDC
  assert.equal(l.available("stage-agent"), 2_000_000n);
  assert.equal(l.allocate(ROOT_AGENT, "stage-agent", "0.20").unchanged, true);
  assert.throws(() => l.allocate(ROOT_AGENT, "stage-agent", "0.25"));
});

test("allocation above the venue budget is refused", () => {
  const l = new Ledger(mandate, { runId: "r", clock });
  assert.equal(l.allocate(ROOT_AGENT, "stage-agent", "0.60").ok, false);
});

test("an allowed call within cap and budget is reserved, then settled with an explorer link", () => {
  const l = fresh();
  const a = l.authorize({ agent: "stage-agent", service: "venue-feed", priceUsdc: "0.01", key: "r1#1" });
  assert.equal(a.ok, true);
  assert.equal(l.available("stage-agent"), 1_900_000n);
  const row = l.settle("r1#1", { tx: "abc123" });
  assert.equal(row.status, "settled");
  assert.equal(row.explorer, "https://stellar.expert/explorer/testnet/tx/abc123");
  const t = l.toJSON().totals["stage-agent"];
  assert.deepEqual([t.spent, t.reserved, t.available], ["0.01", "0", "0.19"]);
});

test("a call above the per-call cap is blocked before any reservation and flagged for approval", () => {
  const l = fresh();
  const a = l.authorize({ agent: "stage-agent", service: "premium-render", priceUsdc: "0.25", key: "r1#3" });
  assert.equal(a.ok, false);
  assert.equal(a.row.status, "blocked");
  assert.equal(a.row.needsApproval, true);
  assert.match(a.reason, /per-call cap/);
  assert.equal(l.available("stage-agent"), 2_000_000n);
});

test("a service outside the mandate is blocked", () => {
  const l = fresh();
  const a = l.authorize({ agent: "stage-agent", service: "camera-feed", priceUsdc: "0.01", key: "r1#9" });
  assert.equal(a.ok, false);
  assert.match(a.reason, /not allowed/);
});

test("a call larger than what is left in the allocation is blocked", () => {
  const small = { ...mandate, perCallCapUsdc: "1", requiresApprovalAboveUsdc: "1" };
  const l = new Ledger(small, { runId: "r", clock });
  l.allocate(ROOT_AGENT, "stage-agent", "0.05");
  const a = l.authorize({ agent: "stage-agent", service: "screen-card", priceUsdc: "0.06", key: "k" });
  assert.equal(a.ok, false);
  assert.match(a.reason, /not enough budget/);
});

test("a failed payment releases the reservation", () => {
  const l = fresh();
  l.authorize({ agent: "stage-agent", service: "screen-card", priceUsdc: "0.05", key: "r1#2" });
  assert.equal(l.available("stage-agent"), 1_500_000n);
  const row = l.release("r1#2", "HTTP 500");
  assert.equal(row.status, "failed");
  assert.equal(l.available("stage-agent"), 2_000_000n);
});

test("the same idempotency key is never paid twice, even after a restore", () => {
  const l = fresh();
  l.authorize({ agent: "stage-agent", service: "venue-feed", priceUsdc: "0.01", key: "r1#1" });
  l.settle("r1#1", { tx: "abc" });
  const again = l.authorize({ agent: "stage-agent", service: "venue-feed", priceUsdc: "0.01", key: "r1#1" });
  assert.equal(again.duplicate, true);

  const restored = Ledger.restore(mandate, JSON.parse(JSON.stringify(l.toJSON())), { clock });
  const third = restored.authorize({ agent: "stage-agent", service: "venue-feed", priceUsdc: "0.01", key: "r1#1" });
  assert.equal(third.duplicate, true);
  assert.equal(restored.available("stage-agent"), 1_900_000n);
});

test("an interrupted reservation is never retried automatically after a restore", () => {
  const l = fresh();
  l.authorize({ agent: "stage-agent", service: "screen-card", priceUsdc: "0.05", key: "r1#2" });
  const restored = Ledger.restore(mandate, JSON.parse(JSON.stringify(l.toJSON())), { clock });
  const row = restored.rows.find((r) => r.key === "r1#2");
  assert.equal(row.status, "needs-reconciliation");
  assert.equal(restored.authorize({ agent: "stage-agent", service: "screen-card", priceUsdc: "0.05", key: "r1#2" }).duplicate, true);
  // counted as spent until someone checks the payer account
  assert.equal(restored.available("stage-agent"), 1_500_000n);
});

test("a blocked key may be tried again later (e.g. after the operator raises the cap)", () => {
  const l = fresh();
  l.authorize({ agent: "stage-agent", service: "premium-render", priceUsdc: "0.25", key: "k" });
  const again = l.authorize({ agent: "stage-agent", service: "premium-render", priceUsdc: "0.25", key: "k" });
  assert.equal(again.duplicate, undefined);
  assert.equal(again.ok, false);
});

test("the ledger is append-only: every attempt stays as a row", () => {
  const l = fresh();
  l.authorize({ agent: "stage-agent", service: "venue-feed", priceUsdc: "0.01", key: "a" });
  l.settle("a", { tx: "t1" });
  l.authorize({ agent: "stage-agent", service: "premium-render", priceUsdc: "0.25", key: "b" });
  const statuses = l.toJSON().rows.map((r) => r.status);
  assert.deepEqual(statuses, ["allocated", "settled", "blocked"]);
});

test("mandates other than testnet are rejected", () => {
  assert.throws(() => new Ledger({ ...mandate, network: "stellar:pubnet" }), /testnet/);
});

test("explorer links point at testnet and are absent without a hash", () => {
  assert.equal(explorerUrl("stellar:testnet", null), null);
  assert.match(explorerUrl("stellar:testnet", "x"), /explorer\/testnet\/tx\/x$/);
});
