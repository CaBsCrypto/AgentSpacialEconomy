import test from "node:test";
import assert from "node:assert/strict";
import { validScreen, screenNow, sectionsAt, clock } from "../dist/screen-schedule.mjs";
import { drawQuadrants } from "../dist/stage-screen.mjs";

const T0 = Date.parse("2026-10-26T10:00:00Z");
const M = 300000;
const tx = "a".repeat(64);
const order = (id, q, start) => ({ id, quadrant: q, start, end: start + M, advertiser: `Adv ${id}`, headline: "Hello", tx });
const state = { network: "stellar:testnet", orders: [order(1, "A", T0), order(2, "B", T0), order(3, "A", T0 + M)] };

test("only a recorded testnet run with well-formed paid orders is shown", () => {
  assert.equal(validScreen(state), true);
  assert.equal(validScreen({ ...state, network: "stellar:pubnet" }), false);
  assert.equal(validScreen({ ...state, orders: [] }), false);
  assert.equal(validScreen({ ...state, orders: [{ ...order(9, "E", T0) }] }), false);
  assert.equal(validScreen({ ...state, orders: [{ ...order(9, "A", T0), tx: null }] }), false);
  assert.equal(screenNow({}), null);
});

test("each section shows its current order, the next one and the time left", () => {
  const s = sectionsAt(state.orders, T0 + 60000);
  assert.equal(s.A.current.id, 1);
  assert.equal(s.A.next.id, 3);
  assert.equal(clock(s.A.remainingMs), "4:00");
  assert.equal(s.B.current.id, 2);
  assert.equal(s.C.current, null);
});

test("after the recorded window the rotation is replayed on a loop and labelled as a replay", () => {
  const live = screenNow(state, T0 + 1000);
  assert.equal(live.mode, "live");
  const replay = screenNow(state, T0 + 2 * M + 61000); // 61 s into the second loop
  assert.equal(replay.mode, "replay");
  assert.equal(replay.sections.A.current.id, 1);
  const later = screenNow(state, T0 + 3 * M + 1000); // second half of the loop: A rotated
  assert.equal(later.sections.A.current.id, 3);
  assert.equal(later.sections.B.current, null);
  assert.equal(screenNow(state, T0 - 5000).mode, "upcoming");
});

test("the four sections are drawn without errors, with free sections offered for sale", () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_t, k) => (k === "measureText" ? (s) => ({ width: String(s).length * 12 }) : (...a) => calls.push([k, ...a])), set: () => true });
  const view = screenNow(state, T0 + 1000);
  drawQuadrants(ctx, 1024, 576, view, { label: "Next on the main stage", title: "Morning briefing" });
  const text = calls.filter(([k]) => k === "fillText").map(([, s]) => s).join(" | ");
  assert.match(text, /Adv 1/);
  assert.match(text, /Adv 2/);
  assert.match(text, /Morning briefing/); // host content in a free section
  assert.match(text, /5 USDC · 5 min/); // a free section is offered for sale
});
