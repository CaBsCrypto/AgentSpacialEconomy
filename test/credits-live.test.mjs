import test from "node:test";
import assert from "node:assert/strict";
import { toCredits, creditPool } from "../dist/credits.mjs";
import { confirmTx, usdcBalance, txHashes, confirmationLabel, horizonFor, trimAmount } from "../dist/live-chain.mjs";

const H = "a".repeat(64);
const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ACCOUNT = "GDNNKSLTL43WDLRXLRU6HWW6Q6GGL4BWU45WZF5AG3ME4WHPTK6JWCZK";
const recorded = {
  network: "stellar:testnet",
  mandate: { budgetUsdc: "0.50" },
  rows: [{ tx: H }, { tx: null }, { tx: H }],
  totals: { "venue-agent": { spent: "0" }, "stage-agent": { spent: "0.06" } },
  onchain: { mode: "sep41-allowance", approvedUsdc: "0.5", drawnUsdc: "0.2", remainingUsdc: "0.3", approveTx: "b".repeat(64), drawTx: "c".repeat(64) },
};
const reply = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test("credits: 1 credit = 0.01 USDC by default, exact and never floating point", () => {
  assert.equal(toCredits("0.5"), "50");
  assert.equal(toCredits("0.06"), "6");
  assert.equal(toCredits("0.125"), "12.5");
  assert.equal(toCredits("0.10", "0.05"), "2");
  assert.throws(() => toCredits("abc"));
  assert.throws(() => toCredits("1", "0"));
});

test("credit pool reads the allowance, the draw, the spend and a sponsor deposit", () => {
  const pool = creditPool(recorded);
  assert.deepEqual([pool.approved, pool.drawn, pool.spent, pool.left, pool.deposited, pool.leftAfterDeposit], ["50", "20", "6", "30", "0", null]);
  const topped = creditPool({ ...recorded, onchain: { ...recorded.onchain, recharge: { incomeUsdc: "0.1", afterUsdc: "0.4", verified: true } } });
  assert.deepEqual([topped.deposited, topped.leftAfterDeposit, topped.depositVerified], ["10", "40", true]);
  assert.equal(creditPool({ ...recorded, onchain: undefined }), null);
});

test("live reads are testnet only and report each state without throwing", async () => {
  assert.throws(() => horizonFor("stellar:pubnet"));
  assert.deepEqual(await confirmTx("stellar:testnet", H, { fetcher: reply(200, { successful: true, ledger: 42, created_at: "t" }) }), { state: "confirmed", ledger: 42, closedAt: "t" });
  assert.equal((await confirmTx("stellar:testnet", H, { fetcher: reply(404) })).state, "not-found");
  assert.equal((await confirmTx("stellar:testnet", H, { fetcher: async () => { throw new Error("offline"); } })).state, "unavailable");
  assert.equal((await confirmTx("stellar:testnet", "nope")).state, "invalid");
  assert.equal((await confirmTx("stellar:pubnet", H, { fetcher: reply(200, {}) })).state, "unavailable");
});

test("live USDC balance comes from the right trustline only", async () => {
  const body = { balances: [{ asset_code: "USDC", asset_issuer: "GOTHER", balance: "9.0000000" }, { asset_code: "USDC", asset_issuer: ISSUER, balance: "0.1400000" }] };
  assert.deepEqual(await usdcBalance("stellar:testnet", ACCOUNT, ISSUER, { fetcher: reply(200, body) }), { state: "ok", balance: "0.14" });
  assert.equal((await usdcBalance("stellar:testnet", ACCOUNT, ISSUER, { fetcher: reply(200, { balances: [] }) })).state, "no-trustline");
  assert.equal((await usdcBalance("stellar:testnet", "SBAD", ISSUER)).state, "invalid");
  assert.deepEqual(["0.1400000", "10.0000000", "100", "0.0000000"].map(trimAmount), ["0.14", "10", "100", "0"]);
});

test("every distinct recorded hash is checked once, and labels never claim more than Horizon said", () => {
  const hashes = txHashes(recorded, { tx: H, sponsor: { tx: "d".repeat(64) } });
  assert.equal(hashes.length, 4);
  assert.match(confirmationLabel({ state: "confirmed", ledger: 7 }), /ledger 7/);
  assert.match(confirmationLabel({ state: "unavailable" }), /recorded/);
  assert.equal(confirmationLabel({ state: "invalid" }), "");
});
