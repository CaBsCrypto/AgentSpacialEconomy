import test from "node:test";
import assert from "node:assert/strict";
import { cardText, sponsorLine, drawCard } from "../dist/stage-screen.mjs";

const card = { title: "Morning briefing", start: "2026-10-26T09:00:00Z", location: "Main stage" };

test("the stage card shows a sponsor line only when the sponsor actually paid", () => {
  const paid = { label: "Presented by", name: "Demo Sponsor (testnet)", message: "Your brand here", tx: "f".repeat(64) };
  assert.equal(cardText({ card, tx: "abc", sponsor: paid }).sponsor, "Presented by Demo Sponsor (testnet) · Your brand here");
  assert.equal(cardText({ card, tx: "abc" }).sponsor, null);
  assert.equal(sponsorLine({ ...paid, tx: null }), null);
  assert.equal(sponsorLine({ ...paid, name: "  " }), null);
  assert.equal(sponsorLine({ name: "X", tx: "t" }), "Presented by X");
});

test("drawing a card with a sponsor writes the sponsor line last, and without one never mentions it", () => {
  const calls = [];
  const ctx = { fillRect() {}, measureText: (s) => ({ width: s.length * 10 }), fillText: (s) => calls.push(s), set fillStyle(v) {}, set font(v) {}, set textBaseline(v) {} };
  drawCard(ctx, 1024, 576, cardText({ card, tx: "abc", sponsor: { name: "Demo Sponsor (testnet)", tx: "t" } }));
  assert.equal(calls.at(-1), "Presented by Demo Sponsor (testnet)");
  calls.length = 0;
  drawCard(ctx, 1024, 576, cardText({ card, tx: "abc" }));
  assert.ok(!calls.some((s) => /Presented by/.test(s)));
});
