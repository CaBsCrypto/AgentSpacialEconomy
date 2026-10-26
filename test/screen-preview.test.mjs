import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../dist/vendor/three/build/three.module.js";
import { applyStageCard, mountStageSections } from "../dist/stage-screen.mjs";
import { isSectionsPreview } from "../dist/screen-schedule.mjs";
import { readFileSync } from "node:fs";

const T0 = Date.parse("2026-10-26T10:00:00Z");
const recording = { network: "stellar:testnet", orders: [
  { id: "one", quadrant: "A", start: T0, end: T0 + 300000, tx: "a".repeat(64), advertiser: "Example" },
] };
function venue() {
  const model = new THREE.Group();
  const backdrop = new THREE.Mesh(new THREE.BoxGeometry(10, 4, .2), new THREE.MeshBasicMaterial());
  backdrop.name = "Yellow_event_backdrop"; backdrop.position.set(0, 2, -20);
  model.add(backdrop); return model;
}
function canvas(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const lines = [];
  const ctx = { fillRect() {}, fillText(value) { lines.push(value); }, measureText: value => ({ width: String(value).length * 10 }) };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else delete globalThis.document; });
  return lines;
}
const fetchRecording = async url => ({ ok: true, json: async () => url.includes("screen.json") ? recording : { card: { title: "Host" } } });

test("legacy host cards never read or mount the experimental recording", async t => {
  const lines = canvas(t), reads = [];
  const mounted = await applyStageCard(THREE, venue(), { fetchImpl: async url => {
    reads.push(url); return { ok: true, json: async () => ({ card: { title: "Host" } }) };
  } });
  assert.equal(mounted, true);
  assert.deepEqual(reads, ["./state/stage.json"]);
  assert.ok(lines.includes("Host"));
  assert.ok(!lines.some(line => String(line).includes("SECTION")));
});

test("preview timers stop on leave and dispose, and recreated scenes have one timer", async t => {
  const lines = canvas(t), active = new Map();
  let next = 0;
  const timer = callback => { active.set(++next, callback); return next; };
  const clearTimer = id => active.delete(id);
  const model = venue();
  const preview = await mountStageSections(THREE, model, { fetchImpl: fetchRecording, now: () => T0 + 1000, timer, clearTimer });
  assert.equal(active.size, 1);
  const oldTick = active.values().next().value;
  preview.suspend(); assert.equal(active.size, 0);
  const paused = lines.length; oldTick(); assert.equal(lines.length, paused);
  preview.resume(); preview.resume(); assert.equal(active.size, 1);
  let disposedTextures = 0;
  preview.mesh.material.map.addEventListener("dispose", () => disposedTextures++);
  preview.dispose(); preview.dispose();
  assert.equal(active.size, 0); assert.equal(disposedTextures, 1);
  assert.equal(model.getObjectByName("Stage agent screen"), undefined);
  const stopped = lines.length; oldTick(); preview.resume(); assert.equal(lines.length, stopped);
  const nextPreview = await mountStageSections(THREE, model, { fetchImpl: fetchRecording, now: () => T0 + 1000, timer, clearTimer });
  assert.equal(active.size, 1); nextPreview.dispose(); assert.equal(active.size, 0);
});

test("missing or malformed preview leaves the host fallback available without a timer or mesh", async () => {
  for (const state of [null, {}, { ...recording, orders: [...recording.orders, recording.orders[0]] }]) {
    const model = venue(); let timers = 0;
    const result = await mountStageSections(THREE, model, {
      fetchImpl: async () => ({ ok: true, json: async () => state }), timer: () => timers++,
    });
    assert.equal(result, null); assert.equal(timers, 0);
    assert.equal(model.getObjectByName("Stage agent screen"), undefined);
  }
});

test("the explicit preview is excluded from the live publisher and acknowledgement path", () => {
  assert.equal(isSectionsPreview("?sections"), true);
  assert.equal(isSectionsPreview("?x=1&sections=1"), true);
  assert.equal(isSectionsPreview("?othersections=1"), false);
  assert.equal(isSectionsPreview(""), false);
  const viewer = readFileSync(new URL("../dist/viewer.js", import.meta.url), "utf8");
  assert.match(viewer, /if\(!sectionsPreview\)\{const adsModel=model;void mountAdsSpatial/);
  assert.match(viewer, /function attestAdsFrame\(ack\)\{if\(sectionsPreview\|\|/);
  assert.match(viewer, /if\(!stageSections\)defaultStage=createDefaultStageLoop/);
  assert.match(viewer, /function discardVenueScene\(\)\{stageSections\?\.dispose\(\)/);
});
