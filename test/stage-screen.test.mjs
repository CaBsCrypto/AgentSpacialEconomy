import test from "node:test";
import assert from "node:assert/strict";
import { cardText, screenPlacement, wrapLines, applyStageCard } from "../dist/stage-screen.mjs";

test("stage card text comes from the purchased card and is absent without one", () => {
  const t = cardText({ card: { title: "Morning briefing", start: "2026-10-26T09:00:00Z", location: "Main stage" }, tx: "abc" });
  assert.equal(t.title, "Morning briefing");
  assert.match(t.when, /09:00/);
  assert.equal(t.paid, true);
  assert.equal(cardText({}), null);
  assert.equal(cardText({ card: { title: "  " } }), null);
});

test("screen faces the middle of the venue on the backdrop's thin axis", () => {
  // backdrop thin along z, venue centre at larger z → screen on max z, facing +z
  const a = screenPlacement([-5, 0, -20], [5, 4, -19.8], [0, 0, 0]);
  assert.equal(a.rotationY, 0);
  assert.ok(a.position[2] > -19.8);
  // same backdrop, audience on the other side → faces -z
  const b = screenPlacement([-5, 0, -20], [5, 4, -19.8], [0, 0, -40]);
  assert.equal(b.rotationY, Math.PI);
  assert.ok(b.position[2] < -20);
  // thin along x
  const c = screenPlacement([10, 0, -5], [10.2, 4, 5], [0, 0, 0]);
  assert.equal(c.rotationY, -Math.PI / 2);
  assert.ok(a.width > 0 && a.height > 0 && a.height <= 4 * 0.6);
});

test("long titles wrap and are truncated to three lines", () => {
  const lines = wrapLines("one two three four five six seven eight", 9, (s) => s.length, 3);
  assert.equal(lines.length, 3);
  assert.ok(lines[2].endsWith("…"));
});

test("missing state file leaves the venue untouched", async () => {
  const model = { getObjectByName: () => { throw new Error("should not be called"); } };
  assert.equal(await applyStageCard({}, model, { fetchImpl: async () => ({ ok: false }) }), false);
  assert.equal(await applyStageCard({}, model, { fetchImpl: async () => { throw new Error("offline"); } }), false);
});
