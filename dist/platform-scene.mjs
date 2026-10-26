import * as THREE from './vendor/three/build/three.module.js';
import { RoundedBoxGeometry } from './vendor/three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from './vendor/three/examples/jsm/environments/RoomEnvironment.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const PLATFORM_VIEWS = Object.freeze(['space', 'entry', 'experiences']);
const VIEW_PRESETS = {
  space: { position: [10, 9.5, 13], target: [-.7, .8, .5] },
  entry: { position: [6, 6.4, 15], target: [-.65, .75, .65] },
  experiences: { position: [11, 8.1, 6.8], target: [-.6, .8, .2] },
};

/** An owned, deliberately small architectural maquette, with no backdrop geometry. */
export function createSpatialArchitecture(T = THREE) {
  const root = new T.Group(); root.name = 'Agentic Reality Space architectural maquette';
  const materials = {
    floor: new T.MeshStandardMaterial({ color: 0xdcded3, roughness: .84, metalness: .03 }),
    ivory: new T.MeshStandardMaterial({ color: 0xf4f0e5, roughness: .72, metalness: .04 }),
    metal: new T.MeshStandardMaterial({ color: 0x294653, roughness: .36, metalness: .58 }),
    navy: new T.MeshStandardMaterial({ color: 0x173442, roughness: .46, metalness: .25 }),
    seat: new T.MeshStandardMaterial({ color: 0xc1c9bf, roughness: .8, metalness: .04 }),
    cyan: new T.MeshStandardMaterial({ color: 0x41b5bf, roughness: .35, metalness: .15, emissive: 0x09616c, emissiveIntensity: .12 }),
    glass: new T.MeshPhysicalMaterial({ color: 0xa4d8d3, transparent: true, opacity: .27, roughness: .12, metalness: 0, clearcoat: 1, clearcoatRoughness: .1, depthWrite: false }),
    route: new T.MeshBasicMaterial({ color: 0x289eaa }),
    hit: new T.MeshBasicMaterial({ visible: false }),
  };
  const geometries = new Set(), ownedMaterials = new Set(Object.values(materials));
  const own = geometry => { geometries.add(geometry); return geometry; };
  function box(name, x, y, z, width, height, depth, material, { bevel = .035, segments = 1, receive = false, cast = true } = {}) {
    const geometry = own(bevel ? new RoundedBoxGeometry(width, height, depth, segments, bevel) : new T.BoxGeometry(width, height, depth));
    const object = new T.Mesh(geometry, material); object.name = name; object.position.set(x, y, z);
    object.castShadow = cast; object.receiveShadow = receive; root.add(object); return object;
  }
  function beam(name, a, b, width, depth, material = materials.metal) {
    const start = new T.Vector3(...a), end = new T.Vector3(...b), direction = end.clone().sub(start);
    const object = box(name, 0, 0, 0, width, direction.length(), depth, material, { bevel: .025 });
    object.position.copy(start).add(end).multiplyScalar(.5);
    object.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), direction.normalize()); return object;
  }

  box('Open hall floor', 0, .03, 0, 4.8, .2, 6, materials.floor, { bevel: .055, segments: 2, receive: true, cast: false });
  box('Entrance walkway', 0, .02, 3.72, 1.5, .18, 1.55, materials.floor, { bevel: .045, segments: 2, receive: true, cast: false });
  box('Brand pavilion floor', -3.3, .03, -.12, 1.85, .2, 2.95, materials.floor, { bevel: .05, segments: 2, receive: true, cast: false });
  box('Pavilion connection', -2.48, .025, .55, 1.2, .17, .78, materials.floor, { bevel: .035, receive: true, cast: false });
  for (let i = 0; i < 3; i++) box('Arrival step ' + i, 0, -.075 - i * .055, 4.5 + i * .19, 1.53 + i * .14, .1, .28, materials.ivory, { bevel: .025, receive: true, cast: false });

  // Three substantial pitched portals establish the venue's architectural rhythm.
  for (const [index, z] of [-2.4, 0, 2.4].entries()) {
    for (const x of [-2.15, 2.15]) beam('Portal ' + index + ' column', [x, .13, z], [x, 1.85, z], .14, .17);
    beam('Portal ' + index + ' left roof', [-2.15, 1.85, z], [0, 2.7, z], .14, .17);
    beam('Portal ' + index + ' right roof', [0, 2.7, z], [2.15, 1.85, z], .14, .17);
  }
  beam('Left eave', [-2.15, 1.85, -2.4], [-2.15, 1.85, 2.4], .065, .075);
  beam('Right eave', [2.15, 1.85, -2.4], [2.15, 1.85, 2.4], .065, .075);
  for (const z of [-1.23, 1.23]) box('Hall glass', -2.16, .88, z, .024, 1.42, 2.12, materials.glass, { bevel: 0, cast: false });
  box('Low perimeter wall', 2.17, .35, -.2, .12, .45, 5.18, materials.ivory, { bevel: .035 });

  box('Stage platform', 0, .29, -2.1, 3.5, .34, 1.4, materials.navy, { bevel: .065, segments: 2, receive: true });
  box('Stage back wall', 0, 1.05, -2.76, 3.58, 1.5, .15, materials.ivory, { bevel: .05, segments: 2 });
  box('Screen frame', 0, 1.18, -2.65, 1.98, .87, .065, materials.navy, { bevel: .025 });
  box('Concept screen', 0, 1.18, -2.605, 1.76, .65, .035, materials.cyan, { bevel: .018, cast: false });

  // Repeated seating is instanced: three draw calls for twelve complete chairs.
  const chairs = [];
  for (let row = 0; row < 3; row++) for (const x of [-1.26, -.77, .77, 1.26]) chairs.push({ x, z: -.72 + row * .58 });
  function instances(name, geometry, material, transforms) {
    const object = new T.InstancedMesh(own(geometry), material, transforms.length); object.name = name; object.castShadow = true;
    const dummy = new T.Object3D();
    transforms.forEach((pose, index) => { dummy.position.set(...pose); dummy.updateMatrix(); object.setMatrixAt(index, dummy.matrix); });
    object.instanceMatrix.needsUpdate = true; object.computeBoundingBox(); object.computeBoundingSphere(); root.add(object); return object;
  }
  instances('Chair seats', new RoundedBoxGeometry(.27, .075, .3, 1, .025), materials.seat, chairs.map(p => [p.x, .34, p.z]));
  instances('Chair backs', new RoundedBoxGeometry(.27, .29, .055, 1, .02), materials.ivory, chairs.map(p => [p.x, .49, p.z + .13]));
  instances('Chair legs', new T.BoxGeometry(.025, .21, .025), materials.metal, chairs.flatMap(p => [-.1, .1].flatMap(x => [-.1, .1].map(z => [p.x + x, .215, p.z + z]))));

  // The smaller pavilion carries a translucent enclosure and a contrasting display.
  for (const x of [-4.06, -2.55]) for (const z of [-1.36, 1.12]) beam('Pavilion post', [x, .14, z], [x, 1.43, z], .055, .055);
  box('Pavilion canopy', -3.3, 1.46, -.12, 1.84, .12, 2.87, materials.ivory, { bevel: .04, segments: 2 });
  box('Pavilion back glass', -3.3, .82, -1.38, 1.43, 1.16, .022, materials.glass, { bevel: 0, cast: false });
  box('Pavilion display', -3.3, .43, -.15, .68, .61, .68, materials.ivory, { bevel: .07, segments: 2 });
  box('Pavilion display top', -3.3, .76, -.15, .7, .075, .7, materials.cyan, { bevel: .025 });
  box('Check-in counter', 1.37, .44, 1.97, .92, .62, .48, materials.ivory, { bevel: .065, segments: 2 });
  box('Check-in surface', 1.37, .78, 1.97, .99, .075, .53, materials.navy, { bevel: .03 });
  beam('Digital entry left', [-.63, .12, 3.88], [-.63, 1.24, 3.88], .075, .075);
  beam('Digital entry right', [.63, .12, 3.88], [.63, 1.24, 3.88], .075, .075);
  box('Digital entry header', 0, 1.24, 3.88, 1.34, .11, .11, materials.cyan, { bevel: .025 });

  const routes = [];
  for (const [name, points, segments] of [
    ['Discovery route', [[0, .16, 4.45], [0, .16, 3.1], [.28, .16, 2.15], [.28, .16, .6], [-1.1, .16, .55], [-3.3, .16, .55]], 42],
    ['Stage route', [[.28, .165, .6], [.28, .165, -.45], [.28, .165, -1.35]], 16],
  ]) {
    const route = new T.Mesh(own(new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p)), false, 'catmullrom', .1), segments, .026, 6, false)), materials.route);
    route.name = name; root.add(route); routes.push(route);
  }
  const beaconSpecs = [
    { viewId: 'entry', point: [0, .18, 3.2] },
    { viewId: 'space', point: [-3.3, .83, -.15] },
    { viewId: 'experiences', point: [.98, .49, -1.98] },
  ];
  const beacons = beaconSpecs.map(({ viewId, point }) => {
    const group = new T.Group(); group.name = viewId + ' beacon'; group.position.set(...point);
    const material = materials.cyan.clone(); ownedMaterials.add(material);
    const ring = new T.Mesh(own(new T.TorusGeometry(.17, .018, 6, 24)), material); ring.rotation.x = -Math.PI / 2; group.add(ring);
    const stem = new T.Mesh(own(new T.CylinderGeometry(.013, .013, .29, 7)), material); stem.position.y = .15; group.add(stem);
    const dot = new T.Mesh(own(new T.SphereGeometry(.064, 12, 8)), material); dot.position.y = .31; group.add(dot);
    const target = new T.Mesh(own(new T.SphereGeometry(.27, 8, 6)), materials.hit); target.position.y = .21; target.userData.viewId = viewId; target.visible = false; group.add(target);
    root.add(group); return { viewId, group, material, ring, target, anchor: new T.Vector3(...point) };
  });
  let disposed = false;
  return {
    root, beacons, routes,
    setSelected(viewId) {
      for (const beacon of beacons) {
        const selected = beacon.viewId === viewId;
        beacon.ring.scale.setScalar(selected ? 1.25 : 1);
        beacon.material.color.set(selected ? 0x087084 : 0x41b5bf);
        beacon.material.emissiveIntensity = selected ? .25 : .12;
      }
    },
    dispose() {
      if (disposed) return; disposed = true;
      root.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
      for (const geometry of geometries) geometry.dispose();
      for (const material of ownedMaterials) material.dispose();
      root.clear();
    },
  };
}

/** Bake a small local lighting environment; its render target remains owned until disposal. */
export function createPlatformEnvironment(renderer) {
  const room = new RoomEnvironment(), generator = new THREE.PMREMGenerator(renderer);
  let target;
  try { target = generator.fromScene(room, 0, .1, 100, { size: 128 }); }
  finally { room.dispose(); generator.dispose(); }
  let disposed = false;
  return { texture: target.texture, dispose() { if (!disposed) { disposed = true; target.dispose(); } } };
}

/** Camera-only interaction preserves the one-time shadow bake and stops when settled. */
export function mountPlatformScene(host, {
  documentRef = host.ownerDocument,
  windowRef = documentRef.defaultView || globalThis,
  createRenderer = options => new THREE.WebGLRenderer(options),
  createEnvironment = createPlatformEnvironment,
  onSelectView = () => {},
  requestFrame = callback => windowRef.requestAnimationFrame(callback),
  cancelFrame = id => windowRef.cancelAnimationFrame(id),
  ResizeObserverClass = windowRef.ResizeObserver,
  IntersectionObserverClass = windowRef.IntersectionObserver,
  reducedMotion,
} = {}) {
  const motionQuery = windowRef.matchMedia?.('(prefers-reduced-motion: reduce)');
  let reduceMotion = reducedMotion ?? !!motionQuery?.matches;
  const fallback = host.querySelector('[data-scene-fallback]'), hint = host.parentElement?.querySelector('[data-scene-hint]');
  let renderer, canvas, scene, camera, architecture, environment, frame = 0, disposed = false, lost = false, inView = true, last = 0, viewId = 'space', transition, pointerDown;
  const position = new THREE.Vector3(...VIEW_PRESETS.space.position), lookTarget = new THREE.Vector3(...VIEW_PRESETS.space.target);
  const pointer = { x: 0, y: 0 }, currentPointer = { x: 0, y: 0 }, cleanups = [];
  const setState = state => {
    host.dataset.sceneState = state;
    if (fallback) { if (state === 'ready') fallback.setAttribute('hidden', ''); else fallback.removeAttribute('hidden'); }
    if (canvas) canvas.hidden = state === 'fallback';
    if (hint) hint.hidden = state !== 'ready';
  };
  setState('loading'); canvas = documentRef.createElement('canvas'); canvas.className = 'platform-scene-canvas'; canvas.setAttribute('aria-hidden', 'true'); canvas.style.touchAction = 'pan-y';
  const bakeEnvironment = () => {
    scene.environment = null; environment?.dispose(); environment = null;
    environment = createEnvironment(renderer); scene.environment = environment.texture;
    renderer.shadowMap.needsUpdate = true;
  };
  try {
    renderer = createRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setClearColor(0x000000, 0); renderer.setPixelRatio(Math.min(windowRef.devicePixelRatio || 1, 1.6));
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
    scene = new THREE.Scene(); scene.background = null; scene.environmentIntensity = .55;
    camera = new THREE.OrthographicCamera(-6, 6, 6, -6, .1, 100);
    scene.add(new THREE.HemisphereLight(0xf7f5e9, 0x6e7e83, 1.05));
    const sun = new THREE.DirectionalLight(0xfff5e4, 3.1); sun.position.set(-4, 9, 7); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: .5, far: 25 });
    sun.shadow.bias = -.0003; sun.shadow.normalBias = .025; scene.add(sun);
    const fill = new THREE.DirectionalLight(0xd0edf0, .55); fill.position.set(6, 4, -5); scene.add(fill);
    architecture = createSpatialArchitecture(); architecture.setSelected(viewId); scene.add(architecture.root);
    bakeEnvironment(); host.append(canvas);
  } catch {
    environment?.dispose(); architecture?.dispose(); renderer?.dispose(); canvas.remove?.(); setState('fallback');
    return { setView() { return false; }, dispose() {}, get state() { return 'fallback'; }, get view() { return viewId; } };
  }
  host.dataset.selectedView = viewId;
  // These points stay in world space: neither pointer nor guided views mutate the maquette.
  const fitPoints = [];
  architecture.root.updateMatrixWorld(true);
  architecture.root.traverse(object => {
    if (!object.geometry || !object.visible) return;
    if (object.isInstancedMesh) object.computeBoundingBox(); else object.geometry.computeBoundingBox();
    const bounds = object.isInstancedMesh ? object.boundingBox : object.geometry.boundingBox;
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) fitPoints.push(new THREE.Vector3(x, y, z).applyMatrix4(object.matrixWorld));
  });
  const canRender = () => !disposed && !lost && inView && documentRef.visibilityState !== 'hidden';
  function pause() { if (frame) cancelFrame(frame); frame = 0; last = 0; pointerDown = null; }
  function invalidate() { if (canRender() && !frame) frame = requestFrame(render); }
  const fitCamera = () => {
    const { width, height } = host.getBoundingClientRect(); if (!width || !height) return false;
    camera.position.copy(position);
    const direction = position.clone().sub(lookTarget), right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
    camera.position.addScaledVector(right, currentPointer.x * .55); camera.position.y += currentPointer.y * .3; camera.lookAt(lookTarget); camera.updateMatrixWorld(true);
    const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity), point = new THREE.Vector3();
    for (const source of fitPoints) { point.copy(source).applyMatrix4(camera.matrixWorldInverse); min.min(point); max.max(point); }
    const viewHeight = Math.max((max.y - min.y) * 1.12, (max.x - min.x) * 1.12 * height / width), viewWidth = viewHeight * width / height;
    const x = (min.x + max.x) / 2, y = (min.y + max.y) / 2;
    camera.left = x - viewWidth / 2; camera.right = x + viewWidth / 2; camera.top = y + viewHeight / 2; camera.bottom = y - viewHeight / 2; camera.updateProjectionMatrix(); return true;
  };
  function render(time) {
    frame = 0; if (!canRender()) return;
    const dt = last ? clamp(time - last, 0, 60) : 0; last = time;
    if (transition) {
      transition.elapsed += dt; const t = reduceMotion ? 1 : Math.min(1, transition.elapsed / 600), ease = t * t * (3 - 2 * t);
      position.lerpVectors(transition.from, transition.to, ease); lookTarget.lerpVectors(transition.fromTarget, transition.toTarget, ease);
      if (t === 1) transition = null;
    }
    const blend = reduceMotion ? 1 : 1 - Math.exp(-11 * Math.max(dt, 16) / 1000);
    currentPointer.x += (pointer.x - currentPointer.x) * blend; currentPointer.y += (pointer.y - currentPointer.y) * blend;
    if (!fitCamera()) return;
    try { renderer.render(scene, camera); setState('ready'); }
    catch { lost = true; pause(); setState('fallback'); return; }
    if (transition || Math.abs(pointer.x - currentPointer.x) + Math.abs(pointer.y - currentPointer.y) > .0005) invalidate();
  }
  const resize = () => {
    if (disposed || lost) return;
    const { width, height } = host.getBoundingClientRect(); if (!width || !height) return;
    renderer.setSize(width, height, false); invalidate();
  };
  function setView(next) {
    if (disposed || !PLATFORM_VIEWS.includes(next)) return false;
    viewId = next; host.dataset.selectedView = next; architecture.setSelected(next);
    const preset = VIEW_PRESETS[next]; pointer.x = pointer.y = 0;
    if (reduceMotion) { position.set(...preset.position); lookTarget.set(...preset.target); currentPointer.x = currentPointer.y = 0; transition = null; }
    else transition = { from: position.clone(), to: new THREE.Vector3(...preset.position), fromTarget: lookTarget.clone(), toTarget: new THREE.Vector3(...preset.target), elapsed: 0 };
    invalidate(); return true;
  }
  const listen = (element, name, callback, options) => { element.addEventListener(name, callback, options); cleanups.push(() => element.removeEventListener(name, callback, options)); };
  if (motionQuery?.addEventListener && reducedMotion === undefined) listen(motionQuery, 'change', event => {
    reduceMotion = !!event.matches;
    if (reduceMotion) setView(viewId); else invalidate();
  });
  listen(host, 'pointermove', event => {
    if (reduceMotion || event.pointerType === 'touch') return;
    const rect = host.getBoundingClientRect();
    pointer.x = clamp((event.clientX - rect.left) / rect.width - .5, -.5, .5);
    pointer.y = clamp((event.clientY - rect.top) / rect.height - .5, -.5, .5); invalidate();
  }, { passive: true });
  listen(host, 'pointerleave', () => { pointer.x = pointer.y = 0; invalidate(); }, { passive: true });
  listen(canvas, 'pointerdown', event => { pointerDown = { x: event.clientX, y: event.clientY, id: event.pointerId }; }, { passive: true });
  listen(canvas, 'pointerup', event => {
    const down = pointerDown; pointerDown = null;
    if (!down || lost || down.id !== event.pointerId || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 8) return;
    const rect = host.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    const hit = ray.intersectObjects(architecture.beacons.map(beacon => beacon.target), false)[0];
    if (hit) { const selected = hit.object.userData.viewId; setView(selected); onSelectView(selected); }
  }, { passive: true });
  listen(canvas, 'pointercancel', () => { pointerDown = null; }, { passive: true });
  listen(documentRef, 'visibilitychange', () => { if (documentRef.visibilityState === 'hidden') pause(); else invalidate(); });
  listen(canvas, 'webglcontextlost', event => { event.preventDefault(); lost = true; pause(); setState('fallback'); });
  listen(canvas, 'webglcontextrestored', () => {
    if (disposed) return;
    try { bakeEnvironment(); lost = false; setState('loading'); resize(); }
    catch { lost = true; setState('fallback'); }
  });
  const resizeObserver = ResizeObserverClass ? new ResizeObserverClass(resize) : null; resizeObserver?.observe(host);
  if (!resizeObserver) listen(windowRef, 'resize', resize);
  const intersection = IntersectionObserverClass ? new IntersectionObserverClass(entries => {
    inView = entries.some(entry => entry.isIntersecting); if (inView) invalidate(); else pause();
  }, { rootMargin: '60px' }) : null; intersection?.observe(host);
  resize();
  return {
    setView,
    get view() { return viewId; },
    get state() { return host.dataset.sceneState; },
    dispose() {
      if (disposed) return; disposed = true; pause(); resizeObserver?.disconnect(); intersection?.disconnect();
      for (const cleanup of cleanups) cleanup();
      scene.environment = null; environment?.dispose(); architecture.dispose();
      scene.traverse(object => { if (object.isLight && object.shadow) object.shadow.dispose(); });
      renderer.dispose(); canvas.remove(); setState('fallback');
    },
  };
}
