import test from "node:test";
import assert from "node:assert/strict";
import { toUnits, fromUnits, toDollarPrice } from "../lib/money.mjs";
import { decodeHeader, requestedUnits, withinReservation, settlementTx, paymentRequiredFrom, settlementFrom } from "../lib/x402-headers.mjs";
import { nextSession } from "../lib/plan.mjs";
import { CATALOG } from "../catalog.mjs";
import { readFileSync } from "node:fs";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const headers = (h) => ({ headers: new Headers(h) });

test("money: 7-decimal USDC round-trips without floating point", () => {
  assert.equal(toUnits("0.05"), 500_000n);
  assert.equal(toUnits("$0.01"), 100_000n);
  assert.equal(fromUnits(toUnits("0.1") + toUnits("0.2")), "0.3");
  assert.equal(toDollarPrice("0.050"), "$0.05");
  assert.throws(() => toUnits("0.00000001"));
  assert.throws(() => toUnits("-1"));
});

test("x402: reads the v2 PAYMENT-REQUIRED header and compares the asked amount", () => {
  const req = { x402Version: 2, accepts: [{ scheme: "exact", network: "stellar:testnet", amount: "500000" }] };
  const res = headers({ "PAYMENT-REQUIRED": b64(req) });
  const parsed = paymentRequiredFrom(res);
  assert.equal(requestedUnits(parsed, "stellar:testnet"), 500_000n);
  assert.equal(withinReservation(parsed, "stellar:testnet", "0.05"), true);
  assert.equal(withinReservation(parsed, "stellar:testnet", "0.04"), false);
  assert.equal(withinReservation(parsed, "stellar:pubnet", "1"), false);
});

test("x402: accepts the v1 body shape and field name", () => {
  const body = { accepts: [{ network: "stellar:testnet", maxAmountRequired: "100000" }] };
  const parsed = paymentRequiredFrom(headers({}), body);
  assert.equal(requestedUnits(parsed, "stellar:testnet"), 100_000n);
});

test("x402: settlement transaction from PAYMENT-RESPONSE or X-PAYMENT-RESPONSE", () => {
  const v2 = settlementFrom(headers({ "PAYMENT-RESPONSE": b64({ success: true, transaction: "aa", payer: "G1" }) }));
  assert.deepEqual(settlementTx(v2).tx, "aa");
  const v1 = settlementFrom(headers({ "X-PAYMENT-RESPONSE": b64({ success: true, transaction: "bb" }) }));
  assert.equal(settlementTx(v1).tx, "bb");
  assert.equal(settlementTx(null).tx, null);
  assert.equal(decodeHeader("not base64 json"), null);
});

test("plan: next session after now, last one when the event is over", () => {
  const items = JSON.parse(readFileSync(new URL("../fixtures/schedule.json", import.meta.url))).items;
  assert.equal(nextSession(items, "2026-10-26T08:10:00Z").title, "Morning briefing");
  assert.equal(nextSession(items, "2026-10-26T12:01:00Z").title, "Pathways post hackathon");
  assert.equal(nextSession(items, "2026-10-30T00:00:00Z").title, "Closing ceremony");
  assert.equal(nextSession([], "2026-10-26T00:00:00Z"), null);
});

test("catalog: the demo call that should be blocked is priced above the mandate cap", () => {
  const mandate = JSON.parse(readFileSync(new URL("../mandates/main-stage.json", import.meta.url)));
  const premium = CATALOG.find((c) => c.id === "premium-render");
  assert.ok(toUnits(premium.priceUsdc) > toUnits(mandate.perCallCapUsdc));
  for (const id of ["venue-feed", "screen-card"]) {
    assert.ok(toUnits(CATALOG.find((c) => c.id === id).priceUsdc) <= toUnits(mandate.perCallCapUsdc));
  }
});
