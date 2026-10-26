import test from "node:test";
import assert from "node:assert/strict";
import {
  INCOME_TYPE, sponsorKey, sponsorSlot, sponsorPreflight, incomeUnits, rechargePlan, rechargeSummary,
} from "../lib/income.mjs";
import { toUnits } from "../lib/money.mjs";
import { Ledger } from "../ledger.mjs";

const TREASURY = "GDNNKSLTL43WDLRXLRU6HWW6Q6GGL4BWU45WZF5AG3ME4WHPTK6JWCZK";
const OTHER = "GCK6CKDDDRVGZNHE2LMJSF6YQKJDQVGPCE7TXOWNNGWUSHTRYXPK6BF6";
const required = (amount, payTo = TREASURY, network = "stellar:testnet") => ({
  x402Version: 2, accepts: [{ scheme: "exact", network, amount: String(amount), payTo }],
});
const mandate = {
  id: "t", objective: "t", network: "stellar:testnet", budgetUsdc: "0.50", perCallCapUsdc: "0.10",
  requiresApprovalAboveUsdc: "0.10", allocations: { "stage-agent": "0.20" }, allowedServices: ["venue-feed"],
};

test("a sponsor slot needs a name, trims text and never carries markup or control characters", () => {
  const s = sponsorSlot({ name: "  Demo Sponsor (testnet) ", message: "Your brand here\u0007 <b>now</b>" });
  assert.equal(s.name, "Demo Sponsor (testnet)");
  assert.equal(s.message, "Your brand here now");
  assert.equal(s.label, "Presented by");
  assert.equal(sponsorSlot({ name: "   " }), null);
  assert.equal(sponsorSlot({}), null);
  assert.ok(sponsorSlot({ name: "x".repeat(200) }).name.length <= 40);
  assert.ok(sponsorSlot({ name: "x", message: "y".repeat(500) }).message.length <= 80);
});

test("the sponsor signs only for at most its maximum, on testnet, paid to the venue treasury", () => {
  const opts = { network: "stellar:testnet", maxUsdc: "0.10", treasury: TREASURY };
  assert.equal(sponsorPreflight(required(toUnits("0.10")), opts).ok, true);
  assert.match(sponsorPreflight(required(toUnits("0.11")), opts).reason, /maximum/);
  assert.match(sponsorPreflight(required(toUnits("0.10"), OTHER), opts).reason, /treasury/);
  assert.match(sponsorPreflight(required(toUnits("0.10"), TREASURY, "stellar:pubnet"), opts).reason, /network/);
  assert.equal(sponsorPreflight(null, opts).ok, false);
});

test("income counts settled sponsor payments only", () => {
  const state = { rows: [
    { type: INCOME_TYPE, priceUsdc: "0.1", status: "settled" },
    { type: INCOME_TYPE, priceUsdc: "0.1", status: "failed" },
    { type: "payment", priceUsdc: "0.05", status: "settled" },
  ] };
  assert.equal(incomeUnits(state), toUnits("0.10"));
  assert.equal(incomeUnits({}), 0n);
});

test("SEP-41 approve sets the allowance, so a recharge approves what is left plus the income", () => {
  const plan = rechargePlan(toUnits("0.30"), toUnits("0.10"));
  assert.deepEqual([plan.ok, plan.newAllowanceUnits], [true, toUnits("0.40")]);
  const none = rechargePlan(toUnits("0.30"), 0n);
  assert.equal(none.ok, false);
  assert.equal(none.newAllowanceUnits, toUnits("0.30"));
  assert.throws(() => rechargePlan(-1n, toUnits("0.10")));
});

test("the recharge summary is verified only when the allowance read back matches", () => {
  const base = { beforeUnits: toUnits("0.30"), incomeUnits: toUnits("0.10"), afterUnits: toUnits("0.40"), approveTx: "ab", liveUntil: 10 };
  const ok = rechargeSummary({ ...base, verifiedUnits: toUnits("0.40") });
  assert.deepEqual([ok.beforeUsdc, ok.incomeUsdc, ok.afterUsdc, ok.verified], ["0.3", "0.1", "0.4", true]);
  assert.equal(rechargeSummary({ ...base, verifiedUnits: toUnits("0.30") }).verified, false);
  assert.equal(rechargeSummary({ ...base, verifiedUnits: null }).verified, false);
});

test("income rows are append-only notes: they never change any agent's budget", () => {
  const ledger = new Ledger(mandate, { runId: "r1" });
  ledger.allocate("venue-agent", "stage-agent", "0.20");
  const before = JSON.stringify(ledger.toJSON().totals);
  ledger.note({ type: INCOME_TYPE, agent: "sponsor", service: "sponsor-slot", priceUsdc: "0.10", status: "settled", tx: "f".repeat(64), key: sponsorKey("r1") });
  const after = ledger.toJSON();
  assert.equal(JSON.stringify(after.totals), before);
  assert.equal(after.rows.at(-1).key, "r1#S:sponsor-slot");
  assert.match(after.rows.at(-1).explorer, /stellar\.expert\/explorer\/testnet\/tx\//);
  const restored = Ledger.restore(mandate, after);
  assert.equal(incomeUnits(restored.toJSON()), toUnits("0.10"));
});
