import test from "node:test";
import assert from "node:assert/strict";
import { QUADRANTS, SLOT_MS, parseQuadrant, scheduleOrder, screenState } from "../lib/screen.mjs";

const T0 = Date.parse("2026-10-26T10:00:00Z");
const order = (n, quadrant, paidAt = T0) => ({ id: `o${n}`, quadrant, paidAt, advertiser: `A${n}`, tx: "a".repeat(64) });

test("the main-stage screen has four sections of five minutes each", () => {
  assert.deepEqual(QUADRANTS, ["A", "B", "C", "D"]);
  assert.equal(SLOT_MS, 300000);
  assert.equal(parseQuadrant("b"), "B");
  assert.equal(parseQuadrant(" D "), "D");
  assert.equal(parseQuadrant(undefined), null);
  assert.equal(parseQuadrant(""), null);
  assert.throws(() => parseQuadrant("E"), /section/);
});

test("a paid order starts now if its section is free, or right after the last order there", () => {
  let s = [];
  s = scheduleOrder(s, order(1, "A"));
  assert.deepEqual([s[0].quadrant, s[0].start, s[0].end], ["A", T0, T0 + SLOT_MS]);
  s = scheduleOrder(s, order(2, "A", T0 + 1000));
  assert.deepEqual([s[1].start, s[1].end], [T0 + SLOT_MS, T0 + 2 * SLOT_MS]);
  // a section that freed up in the past starts at payment time, not at the old end
  s = scheduleOrder(s, order(3, "A", T0 + 20 * 60000));
  assert.equal(s[2].start, T0 + 20 * 60000);
});

test("without a chosen section, the order takes the one that is free first", () => {
  let s = [];
  for (const q of ["A", "B", "C"]) s = scheduleOrder(s, order(q, q));
  s = scheduleOrder(s, order(4, null));
  assert.equal(s[3].quadrant, "D");
  assert.equal(s[3].start, T0);
  s = scheduleOrder(s, order(5, null, T0 + 1000));
  assert.equal(s[4].quadrant, "A"); // all busy: earliest end wins, ties go to A
  assert.equal(s[4].start, T0 + SLOT_MS);
});

test("scheduling never edits earlier orders and refuses duplicates", () => {
  const s1 = scheduleOrder([], order(1, "B"));
  const s2 = scheduleOrder(s1, order(2, "B"));
  assert.equal(s1.length, 1);
  assert.equal(s2[0], s1[0]);
  assert.throws(() => scheduleOrder(s2, order(1, "C")), /already scheduled/);
});

test("the screen shows, per section, what plays at a moment and what comes next", () => {
  let s = [];
  s = scheduleOrder(s, order(1, "A"));
  s = scheduleOrder(s, order(2, "A"));
  s = scheduleOrder(s, order(3, "C"));
  const now = screenState(s, T0 + 60000);
  assert.equal(now.A.current.id, "o1");
  assert.equal(now.A.next.id, "o2");
  assert.equal(now.A.remainingMs, SLOT_MS - 60000);
  assert.equal(now.B.current, null);
  assert.equal(now.C.current.id, "o3");
  const later = screenState(s, T0 + SLOT_MS + 1);
  assert.equal(later.A.current.id, "o2");
  assert.equal(later.C.current, null);
});
