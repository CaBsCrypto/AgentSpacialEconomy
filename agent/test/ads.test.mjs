import test from "node:test";
import assert from "node:assert/strict";
import * as sdk from "@stellar/stellar-sdk";
import {
  adKey, adCreative, adTerms, adCommitment, registryCommitArgs, readBack, canonical, sha256Hex,
} from "../lib/ads.mjs";
import { AD_SLOT } from "../catalog.mjs";

const TREASURY = "GDNNKSLTL43WDLRXLRU6HWW6Q6GGL4BWU45WZF5AG3ME4WHPTK6JWCZK";
const ADVERTISER = "GCK6CKDDDRVGZNHE2LMJSF6YQKJDQVGPCE7TXOWNNGWUSHTRYXPK6BF6";
const TX = "a5378f6257a5e21c67d9d9f49c248e3af32f5170ba94fabbb2108ccd01387ac0";
const START = 1793000000000;

const order = () => {
  const creative = adCreative({ advertiser: "Demo Advertiser (testnet)", headline: "Five minutes on the main stage" });
  const terms = adTerms({ slot: AD_SLOT, payTo: TREASURY, network: "stellar:testnet" });
  return adCommitment({ runId: "r1", creative, terms, paymentTx: TX, claimant: ADVERTISER, startMs: START, durationMs: AD_SLOT.durationMs });
};

test("the ad slot is income for the treasury, never something the stage agent can buy", async () => {
  const { CATALOG } = await import("../catalog.mjs");
  assert.equal(CATALOG.some((s) => s.id === AD_SLOT.id), false);
  assert.equal(AD_SLOT.payee, "venue-treasury");
  assert.equal(AD_SLOT.placement, "main_stage_screen");
  assert.equal(AD_SLOT.durationMs, 300000);
});

test("an ad needs an advertiser, and its text is plain and short", () => {
  const c = adCreative({ advertiser: "  Acme <b>Labs</b>\u0007 ", headline: "y".repeat(300) });
  assert.equal(c.advertiser, "Acme Labs");
  assert.ok(c.headline.length <= 80);
  assert.equal(adCreative({ advertiser: " " }), null);
  assert.equal(adCreative({}), null);
});

test("hashes are deterministic: same order, same commitment; another run, another order id", () => {
  assert.equal(canonical({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  assert.match(sha256Hex("x"), /^[0-9a-f]{64}$/);
  const a = order();
  const b = order();
  assert.deepEqual(a, b);
  assert.equal(a.payment, TX);
  assert.equal(a.order, sha256Hex(adKey("r1")));
  assert.notEqual(a.order, adCommitment({ ...argsFor("r2") }).order);
});

function argsFor(runId) {
  return {
    runId,
    creative: adCreative({ advertiser: "A" }),
    terms: adTerms({ slot: AD_SLOT, payTo: TREASURY, network: "stellar:testnet" }),
    paymentTx: TX, claimant: ADVERTISER, startMs: START, durationMs: 300000,
  };
}

test("the commitment follows the contract's rules before anything is signed", () => {
  const c = order();
  const [p] = c.placements;
  assert.deepEqual([p.slot, p.plan, p.units, p.pass_ms], ["main_stage_screen", "Time", 300000, 0]);
  assert.ok(p.end - p.start >= p.units);
  assert.ok(c.deadline > p.end);
  assert.throws(() => adCommitment({ ...argsFor("r1"), paymentTx: "not-a-hash" }), /payment/);
  assert.throws(() => adCommitment({ ...argsFor("r1"), claimant: "SBAD" }), /claimant/);
  assert.throws(() => adCommitment({ ...argsFor("r1"), durationMs: 0 }), /duration/);
  assert.throws(() => adCommitment({ ...argsFor("r1"), slot: "lobby_wall" }), /slot/);
});

test("contract arguments use explicit XDR types with sorted struct keys", () => {
  const [arg] = registryCommitArgs(order(), sdk);
  assert.equal(arg.switch().name, "scvMap");
  const keys = arg.map().map((e) => e.key().sym().toString());
  assert.deepEqual(keys, [...keys].sort());
  assert.deepEqual(keys, ["claimant", "deadline", "manifest", "order", "payment", "placements", "revision", "terms"]);
  const placements = arg.map().find((e) => e.key().sym().toString() === "placements").val().vec();
  const plan = placements[0].map().find((e) => e.key().sym().toString() === "plan").val();
  assert.equal(plan.vec()[0].sym().toString(), "Time");
  const payment = arg.map().find((e) => e.key().sym().toString() === "payment").val();
  assert.equal(Buffer.from(payment.bytes()).toString("hex"), TX);
});

test("the read-back is verified only when the chain holds this payment, queued and undelivered", () => {
  const c = order();
  const onChain = { state: "Queued", delivered: [0n], commitment: { ...c, payment: Buffer.from(TX, "hex"), order: Buffer.from(c.order, "hex") } };
  assert.deepEqual(readBack(onChain, c), { verified: true, state: "Queued", deliveredMs: "0", requiredMs: "300000" });
  assert.equal(readBack({ ...onChain, commitment: { ...onChain.commitment, payment: Buffer.alloc(32) } }, c).verified, false);
  assert.equal(readBack(null, c).verified, false);
});
