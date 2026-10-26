import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { OrbitControls } from '../dist/vendor/three/examples/jsm/controls/OrbitControls.js';
import { mountOne16Preview } from '../dist/one16-preview.mjs';
import { prepareVenueModel, VENUE_PREPARATION_VERSION } from '../dist/venue-model.mjs';

class Element extends EventTarget {
  attributes = new Map(); style = {}; dataset = {}; children = []; hidden = false; disabled = false; clientWidth = 700; clientHeight = 450; captures = new Set();
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(child) { this.children.push(child); child.parent = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.removed = true; }
  focus() { this.focused = true; }
  getRootNode() { return this.ownerDocument; }
  setPointerCapture(id) { this.captures.add(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  getBoundingClientRect() { return { width: 700, height: 450 }; }
}
function makeModel() {
  const model = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(30, .2, 48), new THREE.MeshStandardMaterial());
  floor.name = 'Floor'; floor.position.z = 8; model.add(floor);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(30, .2, 48), new THREE.MeshStandardMaterial());
  roof.name = 'roofMain'; roof.position.set(0, 8, 8); model.add(roof);
  return model;
}
function fixture({ coarse = false, model = makeModel(), transfer, parse, engine, unsupported = false, badRender = false, realControls = false } = {}) {
  const host = new Element(), stage = new Element(), poster = new Element(), status = new Element(), selectors = new Map();
  for (const name of ['activate', 'done', 'reset', 'retry']) selectors.set('[data-preview-' + name + ']', new Element());
  selectors.set('[data-preview-zoom="in"]', new Element()); selectors.set('[data-preview-zoom="out"]', new Element());
  selectors.set('[data-preview-stage]', stage); selectors.set('[data-preview-poster]', poster); selectors.set('[data-preview-status]', status);
  host.querySelector = query => selectors.get(query);
  const windowRef = new EventTarget(), documentRef = new EventTarget(), query = new EventTarget();
  query.matches = coarse;
  const timers = new Map(), frames = new Map(), observers = {}, renders = [], constructors = [], controls = [], signals = [];
  let nextTimer = 1, nextFrame = 1, disposedRenderer = 0, rendersFail = badRender, parseCount = 0;
  Object.assign(windowRef, {
    devicePixelRatio: 3, matchMedia: () => query, CustomEvent,
    fetch: async (_url, options) => { signals.push(options.signal); return new Response(new Uint8Array([1, 2, 3])); },
  });
  Object.assign(documentRef, { defaultView: windowRef, visibilityState: 'visible', createElement: () => Object.assign(new Element(), { ownerDocument: documentRef }) });
  host.ownerDocument = documentRef;
  class ResizeObserver { constructor(callback) { this.callback = callback; observers.resize = this; } observe() {} disconnect() { this.disconnected = true; } }
  class IntersectionObserver { constructor(callback) { this.callback = callback; observers.intersection = this; } observe() {} disconnect() { this.disconnected = true; } }
  class Controls extends THREE.EventDispatcher {
    target = new THREE.Vector3(); connected = false; enabled = true; disposed = 0;
    constructor(camera, canvas) { super(); this.camera = camera; this.canvas = canvas; controls.push(this); this.connect(canvas); }
    connect(canvas) { this.connected = true; canvas.style.touchAction = 'none'; }
    disconnect() { this.connected = false; this.canvas.style.touchAction = 'auto'; }
    dispose() { this.disconnect(); this.disposed++; }
    update() { this.camera.lookAt(this.target); this.dispatchEvent({ type: 'change' }); }
  }
  class NativeControls extends OrbitControls { constructor(...args) { super(...args); controls.push(this); } }
  class GLTFLoader { async parseAsync(...args) { parseCount++; return parse ? parse(...args) : { scene: model }; } }
  const renderer = {
    shadowMap: {}, setClearColor: (...args) => { renderer.clear = args; },
    setPixelRatio: value => { renderer.pixelRatio = value; }, setSize: (...args) => { renderer.size = args; },
    render: (scene, camera) => { if (rendersFail) throw new Error('GPU lost'); renders.push({ scene, camera }); },
    dispose: () => { disposedRenderer++; },
  };
  const options = {
    documentRef, windowRef, loadEngine: engine || (async () => ({ THREE, GLTFLoader, OrbitControls: realControls ? NativeControls : Controls })),
    fetchModel: transfer || (async ({ fetcher, onProgress }) => { onProgress({ loaded: 1, total: 2 }); await fetcher('/model'); return new ArrayBuffer(4); }),
    createRenderer: (_three, args) => { constructors.push(args); if (unsupported) throw new Error('No GPU'); return renderer; },
    requestFrame: callback => { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelFrame: id => frames.delete(id), ResizeObserverClass: ResizeObserver, IntersectionObserverClass: IntersectionObserver,
    setTimer: callback => { const id = nextTimer++; timers.set(id, callback); return id; }, clearTimer: id => timers.delete(id),
  };
  const flush = () => { const [id, callback] = frames.entries().next().value || []; if (callback) { frames.delete(id); callback(); } };
  return { host, stage, poster, status, selectors, controls, signals, windowRef, documentRef, query, options, renderer, renders, constructors, frames, timers, observers, model, flush, get parseCount() { return parseCount; }, get rendererDisposals() { return disposedRenderer; }, set renderFailure(value) { rendersFail = value; } };
}
function click(f, selector) { f.selectors.get(selector).dispatchEvent(new Event('click')); }
async function loaded(f) { const controller = mountOne16Preview(f.host, f.options); await controller.prepared; return controller; }

test('preparation changes the corridor once, returns the scene and rejects an incompatible guard', () => {
  const scene = makeModel(), before = new THREE.Box3().setFromObject(scene);
  assert.equal(prepareVenueModel(scene, THREE), scene);
  assert.equal(scene.userData.one16VenuePreparation, VENUE_PREPARATION_VERSION);
  const after = new THREE.Box3().setFromObject(scene);
  assert.ok(after.max.z < before.max.z);
  const snapshots = scene.children.map(object => object.geometry.attributes.position.array.slice());
  prepareVenueModel(scene, THREE);
  scene.children.forEach((object, index) => assert.deepEqual(object.geometry.attributes.position.array, snapshots[index]));
  scene.userData.one16VenuePreparation = 'future-version';
  assert.throws(() => prepareVenueModel(scene, THREE), /different version/);
});

test('a ready real scene hides roofs, preserves its poster until first render and stays idle between changes', async () => {
  const f = fixture(), controller = await loaded(f);
  assert.equal(controller.state, 'loading'); assert.equal(f.poster.hidden, false);
  let settled = false; controller.ready.then(() => { settled = true; }); await Promise.resolve(); assert.equal(settled, false);
  assert.match(f.status.textContent, /Preparing/);
  assert.equal(f.renderer.pixelRatio, 1.6); assert.equal(f.renderer.shadowMap.enabled, false);
  assert.equal(f.constructors[0].alpha, true); assert.equal(f.constructors[0].powerPreference, 'low-power');
  assert.equal(f.model.getObjectByName('roofMain').visible, false);
  const orbit = f.controls[0]; assert.equal(orbit.connected, true); assert.equal(orbit.mouseButtons.LEFT, THREE.MOUSE.ROTATE); assert.equal(orbit.mouseButtons.RIGHT, THREE.MOUSE.PAN);
  let readyEvents = 0; f.host.addEventListener('one16-preview-ready', () => readyEvents++);
  f.flush(); assert.equal((await controller.ready).state, 'ready'); assert.equal(controller.state, 'ready'); assert.equal(readyEvents, 1); assert.equal(f.poster.hidden, true);
  assert.equal(f.frames.size, 0); assert.equal(f.renders.length, 1);
  const initialDistance = orbit.camera.position.distanceTo(orbit.target);
  click(f, '[data-preview-zoom="in"]'); assert.ok(orbit.camera.position.distanceTo(orbit.target) < initialDistance);
  f.flush(); assert.equal(f.frames.size, 0);
  click(f, '[data-preview-reset]'); assert.ok(Math.abs(orbit.camera.position.distanceTo(orbit.target) - initialDistance) < .001);
  controller.setLanguage('es'); assert.match(f.status.textContent, /Arrastra/); assert.equal(f.selectors.get('[data-preview-reset]').textContent, 'Restablecer vista');
  controller.dispose(); controller.dispose();
  assert.equal(f.rendererDisposals, 1); assert.equal(f.controls[0].disposed, 1); assert.equal(f.frames.size, 0);
  assert.equal(f.observers.resize.disconnected, true); assert.equal(f.observers.intersection.disconnected, true); assert.equal(f.stage.children.length, 0);
});

test('mobile activation connects gestures; Done, offscreen and document hiding restore native scrolling', async () => {
  const f = fixture({ coarse: true }), controller = await loaded(f); f.flush();
  const canvas = f.stage.children[0], orbit = f.controls[0], activate = f.selectors.get('[data-preview-activate]'), done = f.selectors.get('[data-preview-done]');
  assert.equal(f.renderer.pixelRatio, 1.25); assert.equal(f.constructors[0].antialias, false);
  assert.equal(canvas.style.touchAction, 'pan-y'); assert.equal(orbit.connected, false); assert.equal(activate.hidden, false); assert.equal(done.hidden, true);
  click(f, '[data-preview-activate]'); assert.equal(canvas.style.touchAction, 'none'); assert.equal(orbit.connected, true); assert.equal(activate.getAttribute('aria-pressed'), 'true'); assert.equal(done.hidden, false);
  click(f, '[data-preview-done]'); assert.equal(canvas.style.touchAction, 'pan-y'); assert.equal(orbit.connected, false); assert.equal(activate.focused, true);
  click(f, '[data-preview-activate]'); f.observers.intersection.callback([{ isIntersecting: false }]);
  assert.equal(canvas.style.touchAction, 'pan-y'); assert.equal(f.frames.size, 0);
  orbit.dispatchEvent({ type: 'change' }); assert.equal(f.frames.size, 0);
  f.observers.intersection.callback([{ isIntersecting: true }]); assert.equal(f.frames.size, 1); f.flush();
  click(f, '[data-preview-activate]'); f.documentRef.visibilityState = 'hidden'; f.documentRef.dispatchEvent(new Event('visibilitychange'));
  assert.equal(canvas.style.touchAction, 'pan-y'); assert.equal(orbit.connected, false); assert.equal(f.frames.size, 0);
  f.documentRef.visibilityState = 'visible'; f.documentRef.dispatchEvent(new Event('visibilitychange')); assert.equal(f.frames.size, 1);
  controller.dispose();
});

test('failed loads retain the image and retry obtains a fresh independent scene', async () => {
  let attempts = 0;
  const f = fixture({ transfer: async () => { if (++attempts === 1) throw new Error('offline'); return new ArrayBuffer(4); } });
  const controller = await loaded(f);
  assert.equal(controller.state, 'error'); assert.equal(f.poster.hidden, false);
  const retry = f.selectors.get('[data-preview-retry]'); assert.equal(retry.hidden, false); assert.equal(retry.disabled, false);
  controller.setLanguage('es'); assert.match(f.status.textContent, /No se pudo/);
  click(f, '[data-preview-retry]'); assert.equal(retry.disabled, true); await controller.prepared; f.flush();
  assert.equal(controller.state, 'ready'); assert.equal(attempts, 2); assert.equal(f.parseCount, 1); controller.dispose();
});

test('WebGL failure and context loss show a recoverable poster and dispose scene resources once', async () => {
  const unavailable = fixture({ unsupported: true }), a = await loaded(unavailable);
  assert.equal(a.state, 'error'); assert.equal(unavailable.poster.hidden, false); a.dispose();
  const f = fixture(), b = await loaded(f); f.flush();
  const counts = new Map(); f.model.traverse(object => { for (const resource of [object.geometry, object.material].filter(Boolean)) { counts.set(resource, 0); resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1)); } });
  const lost = new Event('webglcontextlost', { cancelable: true }); f.stage.children[0].dispatchEvent(lost);
  assert.equal(lost.defaultPrevented, true); assert.equal(b.state, 'error'); assert.equal(f.poster.hidden, false); assert.equal(f.frames.size, 0);
  assert.ok([...counts.values()].every(count => count === 1)); b.dispose(); assert.equal(f.rendererDisposals, 1);
  const broken = fixture({ badRender: true }), c = await loaded(broken); broken.flush();
  assert.equal(c.state, 'error'); assert.equal(broken.poster.hidden, false); c.dispose();
});

test('disposal aborts network work and a late parser result never reaches the GPU', async () => {
  let finishParse;
  const model = makeModel(), counts = [];
  model.traverse(object => { if (object.geometry) { const count = { value: 0 }; counts.push(count); object.geometry.addEventListener('dispose', () => count.value++); } });
  const f = fixture({ model, parse: () => new Promise(resolve => { finishParse = resolve; }) });
  const controller = mountOne16Preview(f.host, f.options);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.parseCount, 1);
  controller.dispose(); assert.equal(f.signals[0].aborted, true);
  finishParse({ scene: model }); await controller.prepared;
  assert.equal(controller.state, 'disposed'); assert.equal(f.constructors.length, 0); assert.equal(f.stage.children.length, 0);
  assert.ok(counts.every(count => count.value === 1)); assert.equal(f.timers.size, 0);
});

test('a transfer timeout aborts the original signal and ignores its late response', async () => {
  let finishTransfer, signal;
  const f = fixture({ transfer: async ({ fetcher }) => { await fetcher('/model'); return new Promise(resolve => { finishTransfer = resolve; }); } });
  const controller = mountOne16Preview(f.host, f.options);
  await new Promise(resolve => setImmediate(resolve)); signal = f.signals[0]; [...f.timers.values()][0]();
  assert.equal(controller.state, 'error'); assert.equal(signal.aborted, true);
  finishTransfer(new ArrayBuffer(4)); await controller.ready;
  assert.equal(f.parseCount, 0); assert.equal(f.constructors.length, 0); controller.dispose();
});

test('preview uses the current gzip transfer helper and cannot enter transaction, AR or camera runtimes', () => {
  const source = fs.readFileSync(new URL('../dist/one16-preview.mjs', import.meta.url), 'utf8');
  assert.match(source, /model-transfer\.mjs\?v=13/); assert.match(source, /prepareVenueModel\(model, THREE\)/);
  assert.equal(/viewer\.js|world-wallet|passport|requestSession|getUserMedia|model-viewer|share\(/i.test(source), false);
  assert.equal(/requestAnimationFrame\(loop\)|autoRotate\s*=\s*true|shadowMap\.enabled\s*=\s*true/.test(source), false);
});




test('native OrbitControls cancels a held mobile gesture before disconnecting and accepts the next gesture', async () => {
  const f = fixture({ coarse: true, realControls: true }), controller = await loaded(f); f.flush();
  const canvas = f.stage.children[0], orbit = f.controls[0];
  function pointer(type, id, x) { const event = new Event(type); Object.assign(event, { pointerId: id, pointerType: 'touch', clientX: x, clientY: 70, pageX: x, pageY: 70 }); canvas.dispatchEvent(event); }
  click(f, '[data-preview-activate]'); pointer('pointerdown', 1, 50); pointer('pointermove', 1, 90);
  assert.equal(canvas.hasPointerCapture(1), true);
  click(f, '[data-preview-done]'); assert.equal(canvas.hasPointerCapture(1), false); assert.equal(canvas.style.touchAction, 'pan-y');
  const before = orbit.getAzimuthalAngle();
  click(f, '[data-preview-activate]'); pointer('pointerdown', 2, 50); pointer('pointermove', 2, 110); pointer('pointerup', 2, 110);
  assert.notEqual(orbit.getAzimuthalAngle(), before); controller.dispose();
});

test('the perspective fit fills desktop and narrow stages without clipping and refits only on actual size changes', async () => {
  const f = fixture(); let size = { width: 1320, height: 620 };
  f.stage.getBoundingClientRect = () => size;
  const controller = await loaded(f); f.flush();
  function assertFit() {
    const camera = f.controls[0].camera; camera.updateMatrixWorld(true); f.model.updateMatrixWorld(true);
    const extent = new THREE.Box2();
    f.model.traverseVisible(object => {
      if (!object.isMesh) return;
      object.geometry.computeBoundingBox(); const box = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const projected = new THREE.Vector3(x, y, z).project(camera);
        assert.ok(Math.abs(projected.x) <= .912 && Math.abs(projected.y) <= .912, 'every visible corner retains the projected padding');
        assert.ok(projected.z > -1 && projected.z < 1, 'near/far planes contain all visible geometry');
        extent.expandByPoint(new THREE.Vector2(projected.x, projected.y));
      }
    });
    const occupied = extent.getSize(new THREE.Vector2());
    assert.ok(Math.max(occupied.x, occupied.y) / 2 > .69, 'projected occupancy: ' + occupied.toArray());
  }
  assertFit();
  click(f, '[data-preview-zoom="in"]'); f.flush();
  const orbit = f.controls[0], userPosition = orbit.camera.position.clone();
  f.observers.intersection.callback([{ isIntersecting: false }]); f.observers.intersection.callback([{ isIntersecting: true }]); f.flush();
  f.observers.resize.callback(); f.flush(); assert.ok(orbit.camera.position.distanceTo(userPosition) < .00001, 'scroll and unchanged dimensions preserve the user view');
  size = { width: 340, height: 340 }; f.observers.resize.callback(); f.flush(); assertFit();
  size = { width: 296, height: 300 }; f.observers.resize.callback(); f.flush(); assertFit();
  controller.dispose();
});



test('the current venue GLB fills at least three quarters of the desktop preview height with the roof hidden', async () => {
  globalThis.self = globalThis; globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const bytes = fs.readFileSync(new URL('../dist/assets/one16.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const f = fixture({ model: gltf.scene }); f.stage.getBoundingClientRect = () => ({ width: 1320, height: 620 });
  const controller = await loaded(f); f.flush(); const camera = f.controls[0].camera, extent = new THREE.Box2(); camera.updateMatrixWorld(true);
  f.model.traverseVisible(object => {
    if (!object.isMesh) return;
    const box = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const point = new THREE.Vector3(x, y, z).project(camera);
      assert.ok(Math.abs(point.x) <= .912 && Math.abs(point.y) <= .912);
      extent.expandByPoint(new THREE.Vector2(point.x, point.y));
    }
  });
  const height = extent.getSize(new THREE.Vector2()).y / 2;
  assert.ok(height >= .75 && height <= .85, 'the real venue fills 75–85% of the stage height');
  controller.dispose();
});
