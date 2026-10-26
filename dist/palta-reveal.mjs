// Palta reveal: an avocado on a pedestal in the activation area of the ONE16 twin. When a visitor
// walks up (or taps it) it splits in half and the seed turns into a medallion with the partner's
// logo. Asset: ./assets/palta-reveal.glb (built by model/palta_reveal.py).
//
// Like stage-screen.mjs, this module never imports three.js: THREE and GLTFLoader are passed in.
// If the GLB or the logo file is missing, nothing breaks: the venue keeps its current look.
//
// Viewer integration (dist/viewer.js), two lines:
//   after the venue model is added:  import('./palta-reveal.mjs?v=1').then(m=>m.mountPaltaReveal(THREE,scene,{GLTFLoader,camera,canvas,layout})).then(p=>palta=p).catch(e=>console.warn('palta skipped',e));
//   inside loop(), before render:     palta?.update(dt);

export const PALTA_DEFAULTS = Object.freeze({
  url: "./assets/palta-reveal.glb",
  logoUrl: null,                 // official logo file, e.g. "./assets/palta-reveal/logo.png"
  position: [5.3, 0, -5.0],      // three.js metres: activation area, left of the kiosk
  yaw: 0.138,                    // resting orientation: faces the activation viewpoint
  autoOpenDistance: 4,           // opens when the camera comes this close (XZ distance); the
                                 // activation zone viewpoint is 3.6 m away
  resetDistance: 8,              // closes again once the visitor walks this far away
  faceCamera: true,              // the fruit turns toward the visitor as it opens
  obstacleHalfSize: 0.35,        // collision square around the pedestal
});

// Plain names on purpose: GLTFLoader turns spaces into "_" and drops "/" ":" "." "[" "]".
export const NODE = Object.freeze({
  root: "palta_reveal",
  turntable: "palta_turntable",
  logo: "palta_logo_slot",
  pedestal: "palta_pedestal",
  medallion: "palta_medallion",
});

const MEDAL_R = 0.29; // must match model/palta_reveal.py

/** Largest rectangle with this aspect inside 82 % of the medallion face. */
export function fitLogoPlane(aspect, radius = MEDAL_R) {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const rho = radius * 0.82;
  return { width: (2 * rho * a) / Math.hypot(1, a), height: (2 * rho) / Math.hypot(1, a) };
}

/** Scale to apply to the baked logo plane when a logo with another aspect is loaded. */
export function logoScale(bakedAspect, newAspect) {
  const a = fitLogoPlane(bakedAspect), b = fitLogoPlane(newAspect);
  return [b.width / a.width, b.height / a.height];
}

/** Yaw (rotation about Y) that turns local +Z from `from` toward `to`; both are [x, z]. */
export function yawToward(from, to) {
  return Math.atan2(to[0] - from[0], to[1] - from[1]);
}

/** Shortest signed angle from a to b, in (-π, π]. */
export function angleDelta(a, b) {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Proximity state machine with hysteresis. Returns the next state and what to do.
 * mode: "closed" | "open". armed=false after a manual close, until the visitor walks away.
 * manual=true after a tap-open from afar (e.g. overview mode): distance does not close it until
 * the visitor has come near once.
 */
export function proximityStep(state, distance, { autoOpenDistance, resetDistance }) {
  const s = { mode: state.mode, armed: state.armed !== false, manual: state.manual === true };
  if (distance <= autoOpenDistance) {
    if (s.mode === "closed" && s.armed) return { ...s, mode: "open", manual: false, action: "open" };
    return { ...s, manual: false, action: null };
  }
  if (distance >= resetDistance) {
    if (s.mode === "open" && !s.manual) return { mode: "closed", armed: true, manual: false, action: "close" };
    return { ...s, armed: true, action: null };
  }
  return { ...s, action: null };
}

/** Collision square for layout.obstacles, in the same shape the venue uses. */
export function paltaObstacle(position = PALTA_DEFAULTS.position, half = PALTA_DEFAULTS.obstacleHalfSize) {
  const [x, , z] = position;
  const r = (v) => Math.round(v * 1000) / 1000;
  return { minX: r(x - half), maxX: r(x + half), minZ: r(z - half), maxZ: r(z + half), id: "palta-reveal" };
}

function prefersReducedMotion() {
  try { return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true; } catch { return false; }
}

async function applyLogo(THREE, root, logoUrl) {
  const slot = root.getObjectByName(NODE.logo);
  if (!slot || !logoUrl) return false;
  const texture = await new THREE.TextureLoader().loadAsync(logoUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false; // glTF UV convention, like the textures GLTFLoader creates
  texture.anisotropy = 4;
  const img = texture.image, aspect = img && img.width && img.height ? img.width / img.height : 1;
  const baked = Number(slot.userData?.aspect) || 1;
  const [sx, sy] = logoScale(baked, aspect);
  slot.scale.set(sx, sy, 1);
  const m = slot.material.clone();
  m.map = texture; m.emissiveMap = texture; m.transparent = true; m.needsUpdate = true;
  slot.material = m;
  // The official white wordmark needs contrast; retain the neutral face until a logo loads.
  root.getObjectByName("palta_medallion_body")?.traverse((node) => {
    if (!node.isMesh || !node.material.name.startsWith("Medallion face")) return;
    const face = node.material.clone();
    face.color.set("#07121f"); face.emissive.set("#07121f");
    node.material = face;
  });
  return true;
}

export async function mountPaltaReveal(THREE, scene, options = {}) {
  const o = { ...PALTA_DEFAULTS, ...options };
  if (!o.GLTFLoader) throw new Error("mountPaltaReveal needs { GLTFLoader }");
  const gltf = await new o.GLTFLoader().loadAsync(o.url);
  const root = gltf.scene;
  root.name = "Palta reveal (Palta Labs activation)";
  root.position.set(...o.position);
  root.rotation.y = o.yaw;
  root.traverse((n) => { if (n.isMesh) n.frustumCulled = true; });
  scene.add(root);

  if (o.logoUrl) applyLogo(THREE, root, o.logoUrl).catch((e) => console.warn("palta logo skipped", e));
  if (o.layout?.obstacles && !o.layout.obstacles.some((b) => b.id === "palta-reveal")) {
    o.layout.obstacles.push(paltaObstacle(o.position, o.obstacleHalfSize));
  }

  const mixer = new THREE.AnimationMixer(root);
  const clip = (name) => THREE.AnimationClip.findByName(gltf.animations, name);
  const openAction = mixer.clipAction(clip("open"));
  const idleAction = mixer.clipAction(clip("idle"));
  openAction.setLoop(THREE.LoopOnce, 1);
  openAction.clampWhenFinished = true;
  const turntable = root.getObjectByName(NODE.turntable) ?? root;
  const reduced = prefersReducedMotion();
  let prox = { mode: "closed", armed: true, manual: false }, targetYaw = 0, isOpen = false;

  mixer.addEventListener("finished", (e) => {
    if (!reduced && e.action === openAction && openAction.timeScale > 0) idleAction.reset().fadeIn(0.4).play();
  });

  function facing() {
    if (!o.faceCamera || !o.camera) return 0;
    const world = new THREE.Vector3(); root.getWorldPosition(world);
    const want = yawToward([world.x, world.z], [o.camera.position.x, o.camera.position.z]);
    return Math.max(-1.2, Math.min(1.2, angleDelta(o.yaw, want))); // stay roughly front-on
  }

  function open({ manual = false } = {}) {
    if (isOpen) return; isOpen = true; prox = { mode: "open", armed: true, manual };
    targetYaw = facing();
    openAction.timeScale = 1; openAction.paused = false;
    if (!openAction.isRunning()) openAction.reset();
    openAction.play();
    if (reduced) { mixer.setTime(openAction.getClip().duration); turntable.rotation.y = targetYaw; }
  }

  function close() {
    if (!isOpen) return; isOpen = false; prox = { ...prox, mode: "closed" };
    idleAction.fadeOut(0.2);
    openAction.paused = false; openAction.timeScale = -1;
    if (openAction.time === 0) openAction.time = openAction.getClip().duration;
    openAction.play();
    targetYaw = 0;
    if (reduced) { openAction.stop(); idleAction.stop(); }
  }

  // Tap / click to toggle, with the same 8 px tap tolerance as the Passport.
  let tap = null; const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const down = (e) => { tap = { id: e.pointerId, x: e.clientX, y: e.clientY }; };
  const up = (e) => {
    const t = tap; tap = null;
    if (!t || t.id !== e.pointerId || Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8 || !o.camera) return;
    const r = o.canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, o.camera);
    if (ray.intersectObject(root, true).length) toggle();
  };
  if (o.canvas) { o.canvas.addEventListener("pointerdown", down); o.canvas.addEventListener("pointerup", up); }

  function update(dt = 0.016) {
    const step = Math.min(Math.max(dt, 0), 0.25); // keeps time on slow phones, ignores tab-switch gaps
    if (o.camera && o.autoOpenDistance > 0) {
      const d = Math.hypot(o.camera.position.x - root.position.x, o.camera.position.z - root.position.z);
      const next = proximityStep(prox, d, o);
      prox = { mode: next.mode, armed: next.armed, manual: next.manual };
      if (next.action === "open") open();
      else if (next.action === "close") close();
    }
    const cur = turntable.rotation.y;
    turntable.rotation.y = reduced ? targetYaw : cur + angleDelta(cur, targetYaw) * (1 - Math.exp(-6 * step));
    mixer.update(step);
  }

  // Manual toggle (tap, button, or a call from elsewhere in the app).
  function toggle() {
    if (isOpen) { close(); prox = { mode: "closed", armed: false, manual: false }; }
    else open({ manual: true });
  }

  function dispose() {
    if (o.canvas) { o.canvas.removeEventListener("pointerdown", down); o.canvas.removeEventListener("pointerup", up); }
    mixer.stopAllAction(); scene.remove(root);
    if (o.layout?.obstacles) {
      const i = o.layout.obstacles.findIndex((b) => b.id === "palta-reveal");
      if (i >= 0) o.layout.obstacles.splice(i, 1);
    }
  }

  return {
    root, update, dispose, toggle,
    open: () => open({ manual: true }),
    close: () => { close(); prox = { mode: "closed", armed: false, manual: false }; },
    setLogo: (url) => applyLogo(THREE, root, url),
    get isOpen() { return isOpen; },
  };
}
