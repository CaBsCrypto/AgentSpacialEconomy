import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "../dist/vendor/three/examples/jsm/loaders/GLTFLoader.js";
import {
  PALTA_DEFAULTS, NODE, fitLogoPlane, logoScale, yawToward, angleDelta, proximityStep, paltaObstacle, mountPaltaReveal,
} from "../dist/palta-reveal.mjs";

const GLB = new URL("../dist/assets/palta-reveal.glb", import.meta.url);

function glbJson(path) {
  const b = readFileSync(path);
  assert.equal(b.readUInt32LE(0), 0x46546c67, "glTF magic");
  assert.equal(b.readUInt32LE(4), 2, "glTF version 2");
  const len = b.readUInt32LE(12);
  assert.equal(b.readUInt32LE(16), 0x4e4f534a, "first chunk is JSON");
  return JSON.parse(b.subarray(20, 20 + len).toString("utf8"));
}

test("logo plane stays inside the medallion for square, wide and tall logos", () => {
  for (const a of [1, 3, 0.4, 8]) {
    const { width, height } = fitLogoPlane(a, 0.29);
    assert.ok(Math.hypot(width, height) / 2 <= 0.29 * 0.82 + 1e-9);
    assert.ok(Math.abs(width / height - a) < 1e-9);
  }
  assert.deepEqual(logoScale(1, 1), [1, 1]);
  const [sx, sy] = logoScale(1, 3);
  assert.ok(sx > 1 && sy < 1);
  assert.deepEqual(fitLogoPlane(NaN), fitLogoPlane(1));
});

test("yaw turns local +Z toward the visitor and angle deltas take the short way", () => {
  assert.equal(yawToward([0, 0], [0, 5]), 0);
  assert.ok(Math.abs(yawToward([0, 0], [5, 0]) - Math.PI / 2) < 1e-12);
  assert.ok(Math.abs(angleDelta(3, -3) - (2 * Math.PI - 6)) < 1e-12);
  assert.ok(Math.abs(angleDelta(0, Math.PI)) <= Math.PI);
});

test("opens on approach, closes far away, and a manual close waits until the visitor leaves", () => {
  const o = { autoOpenDistance: 3.2, resetDistance: 7 };
  let s = { mode: "closed", armed: true };
  let n = proximityStep(s, 5, o); assert.equal(n.action, null);
  n = proximityStep(s, 3, o); assert.equal(n.action, "open"); assert.equal(n.mode, "open");
  n = proximityStep({ mode: "open", armed: true }, 4, o); assert.equal(n.action, null);
  n = proximityStep({ mode: "open", armed: true }, 8, o); assert.equal(n.action, "close");
  // tapped closed while standing next to it: stays closed until the visitor walks away
  n = proximityStep({ mode: "closed", armed: false }, 2, o); assert.equal(n.action, null);
  n = proximityStep({ mode: "closed", armed: false }, 8, o); assert.equal(n.armed, true);
  // tapped open from far away (overview): distance does not close it until the visitor came near
  n = proximityStep({ mode: "open", armed: true, manual: true }, 20, o); assert.equal(n.action, null); assert.equal(n.mode, "open");
  n = proximityStep({ mode: "open", armed: true, manual: true }, 2, o); assert.equal(n.manual, false);
  n = proximityStep(n, 8, o); assert.equal(n.action, "close");
});

test("collision square matches the venue's obstacle format", () => {
  const b = paltaObstacle([5.3, 0, -5.0], 0.35);
  assert.deepEqual(b, { minX: 4.95, maxX: 5.65, minZ: -5.35, maxZ: -4.65, id: "palta-reveal" });
});

test("default spot is inside the activation area and clear of the kiosk and Passport", () => {
  const layout = JSON.parse(readFileSync(new URL("../dist/assets/layout.json", import.meta.url), "utf8"));
  const b = paltaObstacle(PALTA_DEFAULTS.position);
  const overlaps = layout.obstacles.filter((o) => o.minX < b.maxX && o.maxX > b.minX && o.minZ < b.maxZ && o.maxZ > b.minZ);
  assert.deepEqual(overlaps, []);
  const act = layout.zones.find((z) => z.id === "activation");
  const xs = act.polygon.map((p) => p[0]), zs = act.polygon.map((p) => p[1]);
  const [x, , z] = PALTA_DEFAULTS.position;
  assert.ok(x >= Math.min(...xs) && x <= Math.max(...xs) && z >= Math.min(...zs) && z <= Math.max(...zs));
});

test("GLB has the nodes and animations the module relies on", { skip: !existsSync(GLB) }, () => {
  const g = glbJson(GLB);
  const names = g.nodes.map((n) => n.name);
  for (const n of Object.values(NODE)) assert.ok(names.includes(n), `missing node ${n}`);
  const anims = Object.fromEntries(g.animations.map((a) => [a.name, a]));
  assert.ok(anims.open && anims.idle);
  const turn = names.indexOf(NODE.turntable);
  for (const a of g.animations) for (const c of a.channels) assert.notEqual(c.target.node, turn, "turntable must stay unanimated");
  const openNodes = new Set(anims.open.channels.map((c) => c.target.node));
  for (const c of anims.idle.channels) assert.ok(!openNodes.has(c.target.node), "idle and open must not share nodes");
  const slot = g.nodes[names.indexOf(NODE.logo)];
  assert.ok(slot.extras && slot.extras.aspect > 0);
  assert.ok(g.materials.some((m) => m.alphaMode === "BLEND" && m.pbrMetallicRoughness.baseColorTexture));
  assert.ok(readFileSync(GLB).length < 2.5e6, "keep the asset light for phones");
});

async function mountHeadless(reducedMotion) {
  const bytes = readFileSync(GLB);
  class HeadlessGLTFLoader {
    loadAsync() {
      const loader = new GLTFLoader();
      // Node has no image decoder. Keep the real GLB loader, meshes and clips; replace only textures.
      loader.register(() => ({ name: "headless-textures", loadTexture: () => Promise.resolve(new THREE.Texture()) }));
      return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
    }
  }
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.6, 12);
  const layout = { obstacles: [] };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "matchMedia");
  Object.defineProperty(globalThis, "matchMedia", { configurable: true, value: () => ({ matches: reducedMotion }) });
  try {
    const palta = await mountPaltaReveal(THREE, scene, { GLTFLoader: HeadlessGLTFLoader, position: [0, 0, 0], yaw: 0, camera, layout });
    return { palta, scene, camera, layout };
  } finally {
    if (previous) Object.defineProperty(globalThis, "matchMedia", previous);
    else delete globalThis.matchMedia;
  }
}

function animationPose(root) {
  return ["palta_half_right", NODE.medallion, "palta_medallion_float", "palta_glow_spin"].map((name) => {
    const node = root.getObjectByName(name);
    return [...node.position, ...node.quaternion, ...node.scale];
  });
}

test("reduced motion opens immediately, stays still, closes and reopens with the real GLB", async (t) => {
  const { palta } = await mountHeadless(true);
  t.after(() => palta.dispose());
  palta.open();
  assert.equal(palta.isOpen, true);
  assert.ok(palta.root.getObjectByName("palta_half_right").rotation.y > 1);
  const opened = animationPose(palta.root);
  for (let i = 0; i < 30; i++) palta.update(0.2);
  assert.deepEqual(animationPose(palta.root), opened, "the idle clip must not move the medallion or ring");
  palta.close();
  assert.equal(palta.isOpen, false);
  assert.ok(Math.abs(palta.root.getObjectByName("palta_half_right").rotation.y) < 1e-8);
  palta.open();
  assert.deepEqual(animationPose(palta.root), opened, "reopening restores the same final pose");
});

test("real GLB closes manually, rearms away, and opens on returning", async (t) => {
  const { palta, scene, camera, layout } = await mountHeadless(false);
  t.after(() => palta.dispose());
  palta.update(0.1);
  assert.equal(palta.isOpen, false);
  camera.position.z = 3;
  for (let i = 0; i < 35; i++) palta.update(0.1);
  assert.equal(palta.isOpen, true);
  assert.ok(palta.root.getObjectByName("palta_half_right").rotation.y > 1);
  palta.toggle();
  for (let i = 0; i < 35; i++) palta.update(0.1);
  assert.equal(palta.isOpen, false);
  assert.ok(Math.abs(palta.root.getObjectByName("palta_half_right").rotation.y) < 1e-8);
  camera.position.z = 12;
  palta.update(0.1);
  camera.position.z = 3;
  for (let i = 0; i < 35; i++) palta.update(0.1);
  assert.equal(palta.isOpen, true);
  assert.ok(palta.root.getObjectByName("palta_half_right").rotation.y > 1);
  palta.dispose();
  assert.equal(scene.children.includes(palta.root), false);
  assert.deepEqual(layout.obstacles, []);
});

test("setLogo fits a wide image and darkens only the medallion face after loading succeeds", async (t) => {
  const { palta } = await mountHeadless(false);
  t.after(() => palta.dispose());
  const texture = new THREE.Texture({ width: 300, height: 100 });
  t.mock.method(THREE.TextureLoader.prototype, "loadAsync", async (url) => {
    if (url === "missing.png") throw new Error("Logo unavailable");
    return texture;
  });
  const slot = palta.root.getObjectByName(NODE.logo);
  const placeholder = slot.material;
  const meshes = [];
  palta.root.getObjectByName("palta_medallion_body").traverse((node) => { if (node.isMesh) meshes.push(node); });
  const face = meshes.find((node) => node.material.name.startsWith("Medallion face"));
  const originalFace = face.material, originalColor = originalFace.color.toArray();
  const rim = meshes.filter((node) => node !== face).map((node) => [node, node.material]);
  await assert.rejects(palta.setLogo("missing.png"), /Logo unavailable/);
  assert.equal(slot.material, placeholder, "a failed logo keeps the neutral marker");
  assert.equal(face.material, originalFace, "a failed logo keeps the neutral face");
  assert.equal(await palta.setLogo("official-wide.png"), true);
  assert.equal(slot.material.map, texture);
  assert.equal(slot.material.emissiveMap, texture);
  assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
  assert.equal(texture.flipY, false);
  const bounds = new THREE.Box3().setFromBufferAttribute(slot.geometry.getAttribute("position"));
  const width = (bounds.max.x - bounds.min.x) * slot.scale.x;
  const height = (bounds.max.y - bounds.min.y) * slot.scale.y;
  assert.ok(Math.abs(width / height - 3) < 1e-6, "the displayed logo preserves its 3:1 aspect");
  assert.ok(Math.hypot(width, height) / 2 <= 0.29 * 0.82 + 1e-7, "the logo stays inside the face");
  assert.notEqual(face.material, originalFace, "the face material is cloned");
  assert.equal(face.material.color.getHexString(), "07121f");
  assert.equal(face.material.emissive.getHexString(), "07121f");
  assert.deepEqual(originalFace.color.toArray(), originalColor, "the original GLB material is untouched");
  for (const [node, material] of rim) assert.equal(node.material, material, "the metal rim is untouched");
});
