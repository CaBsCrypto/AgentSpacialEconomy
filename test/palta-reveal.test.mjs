import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
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


test("asset URL tracks the GLB hash and both entrypoints load the same module revision", () => {
  const expectedVersion = createHash("sha256").update(readFileSync(GLB)).digest("hex").slice(0, 12);
  const assetUrl = new URL(PALTA_DEFAULTS.url, new URL("../dist/", import.meta.url));
  assert.equal(assetUrl.searchParams.get("v"), expectedVersion, "regenerating the GLB must invalidate its browser cache");
  assetUrl.search = "";
  assert.equal(assetUrl.href, GLB.href);
  const references = ["viewer.js", "palta-reveal.html"].map((name) => {
    const source = readFileSync(new URL(`../dist/${name}`, import.meta.url), "utf8");
    const imports = [...source.matchAll(/["'](\.\/palta-reveal\.mjs(?:\?[^"']*)?)["']/g)];
    assert.equal(imports.length, 1, `${name} loads the reveal module once`);
    const reference = new URL(imports[0][1], "https://example.invalid/");
    assert.ok(reference.searchParams.get("v"), `${name} versions the reveal module`);
    assert.ok(!/["'][^"']*palta-reveal\.glb(?:\?[^"']*)?["']/.test(source), `${name} uses the module's hash-versioned model URL`);
    return reference.href;
  });
  assert.equal(references[0], references[1], "viewer and preview use the same module revision");
});

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
  return ["palta_half_right", "palta_half_left", NODE.medallion, "palta_medallion_float", "palta_glow_ring", "palta_glow_spin", "palta_logo_soroswap", "palta_logo_defindex"].map((name) => {
    const node = root.getObjectByName(name);
    return [...node.position, ...node.quaternion, ...node.scale];
  });
}


function advance(palta, seconds, step = 0.05) {
  for (let elapsed = 0; elapsed < seconds - 1e-9;) {
    const dt = Math.min(step, seconds - elapsed);
    palta.update(dt);
    elapsed += dt;
  }
  palta.root.updateMatrixWorld(true);
}

function revealMetrics(root) {
  root.updateMatrixWorld(true);
  const left = new THREE.Box3().setFromObject(root.getObjectByName("palta_half_left"), true);
  const right = new THREE.Box3().setFromObject(root.getObjectByName("palta_half_right"), true);
  const medal = root.getObjectByName("palta_medallion_body");
  const ring = root.getObjectByName("palta_glow_spin");
  const medalBox = new THREE.Box3().setFromObject(medal, true);
  const ringBox = new THREE.Box3().setFromObject(ring, true);
  const halfTop = Math.max(left.max.y, right.max.y);
  return {
    halfTop,
    midX: (left.getCenter(new THREE.Vector3()).x + right.getCenter(new THREE.Vector3()).x) / 2,
    medal: medal.getWorldPosition(new THREE.Vector3()),
    ring: ring.getWorldPosition(new THREE.Vector3()),
    gap: Math.min(medalBox.min.y, ringBox.min.y) - halfTop,
  };
}

function assertAboveHalves(metrics) {
  assert.ok(metrics.gap >= 0.10 - 1e-6, `medallion and full glow ring need 10 cm clearance; got ${metrics.gap.toFixed(4)} m`);
  assert.ok(Math.abs(metrics.medal.x - metrics.midX) < 0.015, "medallion stays centered above both halves");
  assert.ok(Math.abs(metrics.ring.x - metrics.midX) < 0.015, "ring stays centered above both halves");
}

test("product names travel with their halves and read upright without mirrored UVs after opening", async (t) => {
  const { palta } = await mountHeadless(true);
  t.after(() => palta.dispose());
  palta.open();
  palta.root.updateMatrixWorld(true);
  for (const [name, text, parent] of [
    ["palta_label_soroswap", "SoroSwap", "palta_half_left"],
    ["palta_label_defindex", "DeFindex", "palta_half_right"],
  ]) {
    const label = palta.root.getObjectByName(name);
    assert.ok(label?.isMesh, `${text} has its own textured label mesh`);
    assert.equal(label.parent.name, parent, `${text} follows its half during opening and closing`);
    assert.equal(label.userData.text, text);
    assert.ok(label.material.map?.isTexture, `${text} is baked into the GLB texture`);
    const positions = label.geometry.getAttribute("position"), uv = label.geometry.getAttribute("uv");
    assert.ok(uv, `${text} has texture coordinates`);
    const corners = Array.from({ length: positions.count }, (_, i) => ({
      world: label.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, i)),
      u: uv.getX(i), v: uv.getY(i),
    }));
    const mean = (key, value) => {
      const points = corners.filter((p) => Math.abs(p[key] - value) < 1e-6);
      assert.ok(points.length >= 2, `${text}: expected a rectangular UV edge`);
      return points.reduce((sum, p) => sum.add(p.world), new THREE.Vector3()).divideScalar(points.length);
    };
    const horizontal = mean("u", 1).sub(mean("u", 0)).normalize();
    const vertical = mean("v", 0).sub(mean("v", 1)).normalize();
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(label.matrixWorld);
    assert.ok(horizontal.x > 0.8, `${text}: increasing U reads left to right from the activation viewpoint`);
    assert.ok(vertical.y > 0.95, `${text}: image top faces upward`);
    assert.ok(normal.z > 0.8, `${text}: printed side faces the visitor`);
    assert.ok(horizontal.clone().cross(vertical).dot(normal) > 0.99, `${text}: text plane has no reflected axes`);
  }
});

const PARTNER_LOGOS = [
  { id: "soroswap", brand: "SoroSwap", half: "palta_half_left", side: -1 },
  { id: "defindex", brand: "DeFindex", half: "palta_half_right", side: 1 },
];

function embeddedNodeImage(nodeName) {
  const bytes = readFileSync(GLB), g = glbJson(GLB);
  const node = g.nodes.find((n) => n.name === nodeName);
  assert.ok(node, `missing logo node ${nodeName}`);
  const primitive = g.meshes[node.mesh].primitives[0];
  const material = g.materials[primitive.material];
  const image = g.images[g.textures[material.pbrMetallicRoughness.baseColorTexture.index].source];
  assert.equal(image.mimeType, "image/png");
  assert.equal(image.uri, undefined, "partner logos are embedded, not network dependencies");
  const view = g.bufferViews[image.bufferView];
  const binHeader = 20 + bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(binHeader + 4), 0x004e4942, "second chunk is BIN");
  const start = binHeader + 8 + (view.byteOffset ?? 0);
  return { node, image, bytes: bytes.subarray(start, start + view.byteLength) };
}

test("official partner logos are embedded unchanged and retain the source PNG proportions", () => {
  for (const { id, brand } of PARTNER_LOGOS) {
    const source = readFileSync(new URL(`../dist/assets/palta-reveal/partners/${id}.png`, import.meta.url));
    assert.deepEqual(source.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), `${brand}: source is PNG`);
    const width = source.readUInt32BE(16), height = source.readUInt32BE(20);
    const embedded = embeddedNodeImage(`palta_logo_${id}`);
    assert.equal(embedded.node.extras.brand, brand);
    assert.equal(embedded.node.extras.source, `https://links.paltalabs.io/${id}.svg`);
    assert.ok(Math.abs(embedded.node.extras.aspect - width / height) < 1e-9);
    assert.deepEqual(embedded.bytes, source, `${brand}: use the official rasterization byte for byte`);
    assert.ok(width >= 512 && height >= 512, `${brand}: keep sufficient source resolution`);
  }
});

test("partner logos conform to their seed cavities and read upright without changing the source proportions", async (t) => {
  const { palta } = await mountHeadless(true);
  t.after(() => palta.dispose());
  palta.open();
  palta.root.updateMatrixWorld(true);
  for (const { id, brand, half, side } of PARTNER_LOGOS) {
    const cavity = palta.root.getObjectByName(`palta_cavity_${id}`);
    const logo = palta.root.getObjectByName(`palta_logo_${id}`);
    const backing = palta.root.getObjectByName(`palta_cavity_${id}_backing`);
    assert.equal(cavity?.parent.name, half, `${brand}: cavity follows the correct half`);
    assert.equal(logo?.parent, cavity);
    assert.equal(backing?.parent, cavity);
    assert.ok(logo.isMesh && backing.isMesh);
    assert.ok(Math.abs(cavity.position.y - 0.36) < 1e-6, `${brand}: logo is centered at the seed height`);
    assert.ok(Math.abs(cavity.position.z + cavity.parent.position.z) < 1e-6, `${brand}: cavity is centered on the cut face`);
    assert.ok(side * cavity.position.x > 0 && Math.abs(cavity.position.x) < 0.165, `${brand}: logo is recessed in its own cavity`);
    assert.ok(logo.material.map?.isTexture);
    assert.equal(logo.material.color.getHexString(), "ffffff", `${brand}: material does not recolor the source artwork`);
    const bounds = new THREE.Box3().setFromBufferAttribute(logo.geometry.getAttribute("position"));
    const size = bounds.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.x / size.y - logo.userData.aspect) < 1e-6, `${brand}: projected patch preserves the image aspect`);
    assert.equal(logo.userData.projection, "cavity-sphere");
    assert.ok(Math.hypot(size.x, size.y) / 2 <= 0.13 + 1e-6, `${brand}: full image stays within the cavity's central patch`);
    const sphereCenter = new THREE.Vector3(0, 0, 0.10), cavityRadius = 0.165 * 1.03;
    for (const [mesh, normalOffset] of [[backing, 0.0015], [logo, 0.003]]) {
      const points = mesh.geometry.getAttribute("position"), normals = mesh.geometry.getAttribute("normal");
      assert.ok(points.count > 20, `${brand}: use a curved surface instead of a flat quad`);
      const meshBounds = new THREE.Box3().setFromBufferAttribute(points);
      assert.ok(meshBounds.max.z - meshBounds.min.z > 0.01, `${brand}: surface has visible concave depth`);
      for (let i = 0; i < points.count; i++) {
        const point = new THREE.Vector3().fromBufferAttribute(points, i);
        const normal = new THREE.Vector3().fromBufferAttribute(normals, i);
        const inward = sphereCenter.clone().sub(point);
        assert.ok(point.z < sphereCenter.z, `${brand}: patch stays inside the seed hemisphere`);
        assert.ok(Math.abs(inward.length() - (cavityRadius - normalOffset)) < 3e-6, `${brand}: each vertex follows the cavity surface with an anti-z-fighting offset`);
        assert.ok(Math.abs(normal.length() - 1) < 1e-5, `${brand}: surface normals are normalized`);
        assert.ok(normal.dot(inward.normalize()) > 0.995, `${brand}: normals follow the concavity toward its open side`);
      }
    }
    const uv = logo.geometry.getAttribute("uv"), pos = logo.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      assert.ok(Math.abs(uv.getX(i) - (pos.getX(i) - bounds.min.x) / size.x) < 1e-6, `${brand}: UVs do not mirror horizontally`);
      assert.ok(Math.abs(uv.getY(i) - (bounds.max.y - pos.getY(i)) / size.y) < 1e-6, `${brand}: UVs do not invert vertically`);
    }
    const horizontal = new THREE.Vector3(1, 0, 0).transformDirection(logo.matrixWorld);
    const vertical = new THREE.Vector3(0, 1, 0).transformDirection(logo.matrixWorld);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(logo.matrixWorld);
    assert.ok(horizontal.x > 0.8 && vertical.y > 0.95 && normal.z > 0.8, `${brand}: artwork faces the visitor upright after opening`);
    const label = palta.root.getObjectByName(`palta_label_${id}`);
    const logoBox = new THREE.Box3().setFromObject(logo, true);
    const labelBox = new THREE.Box3().setFromObject(label, true);
    assert.ok(logoBox.max.y < labelBox.min.y - 0.01, `${brand}: logo sits beneath the product name`);
  }

});

test("partner logos appear outside, settle into the curved cavities, and reverse cleanly without touching the medallion", async (t) => {
  const { palta } = await mountHeadless(false);
  t.after(() => palta.dispose());
  const samples = new Map(PARTNER_LOGOS.map(({ id }) => [id, []]));
  for (const { id } of PARTNER_LOGOS) assert.ok(palta.root.getObjectByName(`palta_logo_${id}`).scale.x < 0.002);
  palta.open();
  for (let frame = 0; frame <= 52; frame++) {
    palta.root.updateMatrixWorld(true);
    const medal = palta.root.getObjectByName("palta_medallion_body");
    for (const { id, brand } of PARTNER_LOGOS) {
      const logo = palta.root.getObjectByName(`palta_logo_${id}`);
      const bounds = new THREE.Box3().setFromBufferAttribute(logo.geometry.getAttribute("position"));
      samples.get(id).push({
        scale: logo.scale.x, offset: logo.position.z,
        minDepth: bounds.min.z * logo.scale.z + logo.position.z,
        maxDepth: bounds.max.z * logo.scale.z + logo.position.z,
      });
      if (logo.scale.x >= 0.01) {
        const medalBox = new THREE.Box3().setFromObject(medal, true);
        const logoBox = new THREE.Box3().setFromObject(logo, true);
        assert.equal(medalBox.intersectsBox(logoBox), false, `${brand}: visible logo and medallion meshes have separate bounding boxes during entry`);
      }
    }
    if (frame < 52) advance(palta, 0.05);
  }
  for (const { id, brand } of PARTNER_LOGOS) {
    const visible = samples.get(id).filter((sample) => sample.scale >= 0.95);
    assert.ok(visible.length > 2, `${brand}: logo becomes fully visible before the end`);
    assert.ok(visible[0].minDepth > 0.11, `${brand}: logo first appears outside the cut face`);
    assert.ok(visible[0].offset - visible.at(-1).offset > 0.20, `${brand}: logo visibly enters from outside to inside`);
    for (let i = 1; i < visible.length; i++) assert.ok(visible[i].offset <= visible[i - 1].offset + 1e-6, `${brand}: entry settles smoothly inward`);
    assert.ok(Math.abs(visible.at(-1).offset) < 1e-6, `${brand}: final state sits on the curved cavity surface`);
    assert.ok(visible.at(-1).maxDepth < 0.10, `${brand}: the whole final patch is recessed inside the cut face`);
  }
  const settled = PARTNER_LOGOS.map(({ id }) => {
    const logo = palta.root.getObjectByName(`palta_logo_${id}`);
    return [...logo.position, ...logo.scale];
  });
  palta.close(); advance(palta, 2.8);
  for (const { id, brand } of PARTNER_LOGOS) {
    const logo = palta.root.getObjectByName(`palta_logo_${id}`);
    assert.ok(logo.scale.x < 0.002, `${brand}: logo disappears when the fruit closes`);
    assert.ok(Math.abs(logo.position.z - 0.25) < 1e-6, `${brand}: closing returns the logo to its entry position`);
  }
  palta.open(); advance(palta, 2.6);
  for (const [{ id }, expected] of PARTNER_LOGOS.map((partner, i) => [partner, settled[i]])) {
    const logo = palta.root.getObjectByName(`palta_logo_${id}`);
    assert.deepEqual([...logo.position, ...logo.scale], expected, "reopening restores the same seated logo pose");
  }
});

test("medallion and glow ring ascend together, finish centered above the halves, and keep 10 cm clearance through idle", async (t) => {
  const { palta } = await mountHeadless(false);
  t.after(() => palta.dispose());
  palta.open();
  advance(palta, 1.45);
  const start = revealMetrics(palta.root);
  let previousY = start.medal.y;
  const flight = [];
  for (let i = 0; i < 21; i++) {
    advance(palta, 0.05);
    const metrics = revealMetrics(palta.root);
    assert.ok(metrics.medal.y >= previousY - 1e-6, "the medallion ascends smoothly during the flight");
    assert.ok(Math.abs(metrics.medal.y - metrics.ring.y) < 0.002, "the ring follows the medallion height");
    assert.ok(Math.abs(metrics.medal.z - metrics.ring.z - 0.0225) < 0.002, "the ring follows the same depth arc behind the medallion");
    flight.push(metrics);
    previousY = metrics.medal.y;
  }
  assert.ok(previousY - start.medal.y > 0.60, "the medallion clearly flies upward from the seed");
  assert.ok(Math.max(...flight.map((sample) => sample.medal.z)) > flight.at(-1).medal.z + 0.03, "the flight has visible depth before settling");
  advance(palta, 0.10);
  const settled = revealMetrics(palta.root);
  assert.ok(Math.abs(settled.medal.y - 2.105) < 0.015, "medallion settles at approximately 2.1 m above the floor");
  assertAboveHalves(settled);
  let minimumGap = settled.gap;
  for (let i = 0; i < 64; i++) {
    advance(palta, 0.05);
    const metrics = revealMetrics(palta.root);
    assertAboveHalves(metrics);
    minimumGap = Math.min(minimumGap, metrics.gap);
  }
  t.diagnostic(`minimum real-mesh clearance over the full idle loop: ${(minimumGap * 100).toFixed(2)} cm`);
  palta.close();
  advance(palta, 2.8);
  assert.equal(palta.isOpen, false);
  assert.ok(palta.root.getObjectByName("palta_glow_ring").scale.x < 0.002, "ring hides again after closing");
  palta.open();
  advance(palta, 2.6);
  assertAboveHalves(revealMetrics(palta.root));
});

test("reduced motion opens immediately, stays still, closes and reopens with the real GLB", async (t) => {
  const { palta } = await mountHeadless(true);
  t.after(() => palta.dispose());
  palta.open();
  assert.equal(palta.isOpen, true);
  assert.ok(palta.root.getObjectByName("palta_half_right").rotation.y > 1);
  const opened = animationPose(palta.root);
  assertAboveHalves(revealMetrics(palta.root));
  for (let i = 0; i < 30; i++) palta.update(0.2);
  assert.deepEqual(animationPose(palta.root), opened, "the idle clip must not move the medallion or ring");
  palta.close();
  assert.equal(palta.isOpen, false);
  assert.ok(Math.abs(palta.root.getObjectByName("palta_half_right").rotation.y) < 1e-8);
  assert.ok(palta.root.getObjectByName("palta_glow_ring").scale.x < 0.002, "reduced motion also hides the ring immediately");
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
