import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { screenPaymentReport, SCREEN_USDC_ASSET } from "../dist/screen-payment-report.mjs";

function fixture() {
  const state = JSON.parse(readFileSync(new URL("../dist/state/screen.json", import.meta.url), "utf8"));
  const checkedAt = "2026-10-26T12:00:00.000Z";
  state.sourceCommit = "a".repeat(40);
  state.verification = {
    verified: true, runId: state.runId, sourceCommit: "a".repeat(40), checkedAt,
    expectedOrders: 6, verifiedOrders: 6, totalUnits: "300000000", totalUsdc: "30",
    payments: state.orders.map((order, index) => ({
      verified: true, network: "stellar:testnet", tx: order.tx, payer: order.account,
      payTo: state.treasury.account, asset: SCREEN_USDC_ASSET, amountUnits: "50000000",
      ledger: 100 + index, checkedAt, source: "horizon-xdr",
    })),
  };
  return state;
}

test("the dated verifier report counts six unique exact payments without changing the recording", () => {
  const state = fixture(), before = JSON.stringify(state), report = screenPaymentReport(state);
  assert.equal(report.verified, true);
  assert.equal(report.verifiedOrders, 6);
  assert.equal(report.totalUnits, "300000000");
  assert.equal(report.totalUsdc, "30");
  assert.equal(report.checkedAt, state.verification.checkedAt);
  assert.equal(JSON.stringify(state), before);
});

test("a recorded balance flag or transaction-success flag cannot stand in for payment verification", () => {
  const state = fixture();
  delete state.verification;
  state.treasury.verified = true;
  assert.equal(screenPaymentReport(state).verified, false);
  state.verification = { verified: true };
  assert.equal(screenPaymentReport(state).verified, false);
});

test("duplicated, missing, mismatched or incomplete transfer evidence fails closed", () => {
  const mutations = [
    state => state.verification.payments.pop(),
    state => state.verification.payments[1] = state.verification.payments[0],
    state => state.verification.payments[0].payTo = state.orders[0].account,
    state => state.verification.payments[0].payer = state.treasury.account,
    state => state.verification.payments[0].asset = "another-asset",
    state => state.verification.payments[0].amountUnits = "49999999",
    state => state.verification.payments[0].network = "stellar:pubnet",
    state => state.verification.payments[0].verified = false,
    state => state.verification.payments[0].source = "successful-transaction",
    state => state.verification.payments[0].checkedAt = "unknown",
    state => state.verification.payments[0].ledger = 0,
    state => state.verification.totalUsdc = "35",
    state => state.verification.totalUnits = "350000000",
    state => state.verification.runId = "a-different-run",
    state => state.verification.sourceCommit = "",
    state => state.sourceCommit = "b".repeat(40),
    state => state.verification.checkedAt = "unknown",
    state => state.orders[0].priceUsdc = "6",
    state => state.orders[1].tx = state.orders[0].tx,
  ];
  for (const mutate of mutations) {
    const state = fixture(); mutate(state);
    const report = screenPaymentReport(state);
    assert.equal(report.verified, false, mutate.toString());
    assert.equal(report.totalUnits, "0", mutate.toString());
  }
});

test("dashboard keeps experiment evidence dated, isolated, and linked to the explicit preview", () => {
  const html = readFileSync(new URL("../dist/dashboard.html", import.meta.url), "utf8");
  const block = html.split("// ---- four-section main-stage screen:")[1].split("// ---- paid screen time:")[0];
  assert.match(block, /href="\/one16\?sections"/);
  assert.match(block, /screenPaymentReport\(split\)/);
  assert.match(block, /not a current balance/);
  assert.match(block, /not the pilot wallet balance or agent budget/);
  assert.doesNotMatch(block, /split\.treasury\?\.verified/);
});
