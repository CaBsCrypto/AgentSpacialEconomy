import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three/build/three.module.js';
import { createSpatialArchitecture, mountPlatformScene, PLATFORM_VIEWS } from '../dist/platform-scene.mjs';
import { deferPlatformScene } from '../dist/platform.mjs';

class Element extends EventTarget {
  attributes = new Map(); style = {}; dataset = {}; children = [];
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); }
  append(...nodes) { this.children.push(...nodes); }
  remove() { this.removed = true; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 455 }; }
}
function fixture({ reducedMotion = false, unsupported = false, environmentFailure = false } = {}) {
  const frames = new Map(), renderCalls = [], constructors = [], environments = [], observers = { resize: [], intersection: [] }, selections = [];
  let nextFrame = 1, disposedRenderer = 0, shadowBakes = 0;
  const fallback = new Element(), hint = { hidden: true }, host = new Element(), motion = new EventTarget(); motion.matches = reducedMotion;
  const windowRef = new EventTarget(); Object.assign(windowRef, { devicePixelRatio: 3, matchMedia: () => motion });
  const documentRef = new EventTarget(); Object.assign(documentRef, { defaultView: windowRef, visibilityState: 'visible', createElement: () => new Element() });
  Object.assign(host, { ownerDocument: documentRef, parentElement: { querySelector: () => hint }, querySelector: () => fallback });
  class ResizeObserver { constructor(callback) { this.callback = callback; observers.resize.push(this); } observe() {} disconnect() { this.disconnected = true; } }
  class IntersectionObserver { constructor(callback) { this.callback = callback; observers.intersection.push(this); } observe() {} disconnect() { this.disconnected = true; } }
  const renderer = {
    shadowMap: {},
    setClearColor: (...args) => { renderer.clear = args; }, setPixelRatio: value => { renderer.pixelRatio = value; }, setSize: (...args) => { renderer.size = args; },
    render(scene, camera) { if (renderer.shadowMap.needsUpdate) { shadowBakes++; renderer.shadowMap.needsUpdate = false; } renderCalls.push({ scene, camera, position: camera.position.clone(), quaternion: scene.children.find(o => o.name.includes('maquette')).quaternion.clone() }); },
    dispose: () => disposedRenderer++,
  };
  const options = {
    documentRef, windowRef, onSelectView: value => selections.push(value),
    requestFrame: callback => { const id = nextFrame++; frames.set(id, callback); return id; }, cancelFrame: id => frames.delete(id),
    ResizeObserverClass: ResizeObserver, IntersectionObserverClass: IntersectionObserver,
    createRenderer: value => { constructors.push(value); if (unsupported) throw new Error('WebGL unavailable'); return renderer; },
    createEnvironment: () => { if (environmentFailure) throw Error('bake failed'); const environment = { texture: new THREE.Texture(), disposed: 0, dispose() { this.disposed++; this.texture.dispose(); } }; environments.push(environment); return environment; },
  };
  const flush = (time = 16) => { const [id, callback] = frames.entries().next().value || []; if (callback) { frames.delete(id); callback(time); } };
  const settle = (start = 32) => { let time = start, count = 0; while (frames.size && count++ < 100) { flush(time); time += 16; } assert.ok(count < 100, 'rendering settles rather than running forever'); return time; };
  return { host, fallback, hint, motion, documentRef, renderer, frames, renderCalls, constructors, environments, observers, options, selections, flush, settle, disposedRenderer: () => disposedRenderer, shadowBakes: () => shadowBakes };
}
function pointer(target, type, properties = {}) {
  const event = new Event(type, { cancelable: true }); Object.assign(event, { clientX: 500, clientY: 100, pointerType: 'mouse', pointerId: 1, ...properties }); target.dispatchEvent(event); return event;
}

test('the real maquette stays within geometry/draw budgets using bevels and instanced seating', () => {
  const architecture = createSpatialArchitecture(), size = new THREE.Box3().setFromObject(architecture.root).getSize(new THREE.Vector3());
  assert.ok(size.x > 6 && size.z > 7 && size.z < 8.5 && size.y > 2.5);
  for (const name of ['Open hall floor', 'Brand pavilion floor', 'Stage platform', 'Entrance walkway', 'Discovery route']) assert.ok(architecture.root.getObjectByName(name), name);
  let draws = 0, triangles = 0, portals = 0, instanced = 0, outlines = 0;
  architecture.root.traverseVisible(object => {
    if (object.isLineSegments) outlines++;
    if (!object.isMesh || object.material.visible === false) return;
    draws++; triangles += (object.geometry.index?.count || object.geometry.attributes.position.count) / 3 * (object.isInstancedMesh ? object.count : 1);
    if (object.name.startsWith('Portal ')) portals++; if (object.isInstancedMesh) instanced++;
  });
  assert.equal(portals, 12, 'three four-part pitched portals'); assert.equal(instanced, 3); assert.equal(outlines, 0);
  assert.ok(draws <= 80, `${draws} main-pass objects`); assert.ok(triangles <= 30000, `${triangles} triangles`);
  assert.equal(architecture.root.getObjectByName('Open hall floor').geometry.type, 'RoundedBoxGeometry');
  const glass = architecture.root.getObjectByName('Hall glass').material;
  assert.equal(glass.isMeshPhysicalMaterial, true); assert.equal(glass.transmission, 0); assert.equal(glass.depthWrite, false);
  assert.deepEqual(architecture.beacons.map(b => b.viewId), ['entry', 'space', 'experiences']);
  architecture.setSelected('experiences'); assert.equal(architecture.beacons[2].ring.scale.x, 1.25);
  const resources = new Set(), counts = [];
  architecture.root.traverse(object => { if (object.geometry) resources.add(object.geometry); if (object.material) resources.add(object.material); if (object.isInstancedMesh) resources.add(object); });
  for (const resource of resources) { const count = { value: 0 }; counts.push(count); resource.addEventListener('dispose', () => count.value++); }
  architecture.dispose(); architecture.dispose(); assert.ok(counts.every(count => count.value === 1)); assert.equal(architecture.root.children.length, 0);
});

test('transparent rendering owns an environment, bakes floor shadows once and has no idle loop', () => {
  const f = fixture(), controller = mountPlatformScene(f.host, f.options);
  assert.equal(controller.state, 'loading'); assert.equal(controller.view, 'space'); assert.equal(f.renderCalls.length, 0);
  assert.equal(f.constructors[0].alpha, true); assert.equal(f.constructors[0].powerPreference, 'low-power');
  assert.deepEqual(f.renderer.clear, [0, 0]); assert.equal(f.renderer.pixelRatio, 1.6);
  assert.equal(f.renderer.shadowMap.autoUpdate, false); assert.equal(f.renderer.shadowMap.type, THREE.PCFSoftShadowMap);
  f.flush(); const { scene } = f.renderCalls[0];
  assert.equal(controller.state, 'ready'); assert.equal(scene.background, null); assert.equal(scene.environment, f.environments[0].texture);
  assert.equal(f.fallback.getAttribute('hidden'), ''); assert.equal(f.hint.hidden, false); assert.equal(f.frames.size, 0); assert.equal(f.shadowBakes(), 1);
  const receivers = []; scene.traverse(o => { if (o.receiveShadow) receivers.push(o.name); });
  assert.ok(receivers.includes('Open hall floor')); assert.ok(receivers.includes('Stage platform')); assert.ok(receivers.every(name => /floor|walkway|connection|step|platform/i.test(name)));
  pointer(f.host, 'pointermove'); f.settle(); assert.equal(f.shadowBakes(), 1);
  assert.ok(f.renderCalls.every(call => call.quaternion.equals(new THREE.Quaternion())), 'parallax never rotates the model');
  assert.notDeepEqual(f.renderCalls.at(-1).position.toArray(), f.renderCalls[0].position.toArray());
  controller.dispose(); controller.dispose(); assert.equal(f.environments[0].disposed, 1); assert.equal(f.disposedRenderer(), 1);
  assert.equal(f.observers.resize[0].disconnected, true); assert.equal(f.observers.intersection[0].disconnected, true);
});

test('guided views run for 600ms, last selection wins and reduced motion settles instantly', () => {
  const f = fixture(), controller = mountPlatformScene(f.host, f.options); f.flush();
  assert.equal(controller.setView('arbitrary'), false); assert.deepEqual(PLATFORM_VIEWS, ['space', 'entry', 'experiences']);
  controller.setView('entry'); f.flush(32); f.flush(232); assert.equal(controller.view, 'entry');
  controller.setView('experiences'); assert.equal(f.host.dataset.selectedView, 'experiences');
  f.settle(248); assert.deepEqual(f.renderCalls.at(-1).position.toArray(), [11, 8.1, 6.8]); assert.equal(f.frames.size, 0);
  assert.deepEqual(f.selections, [], 'external controls do not recursively invoke the canvas callback');
  controller.dispose(); assert.equal(controller.setView('space'), false);
  const reduced = fixture({ reducedMotion: true }), instant = mountPlatformScene(reduced.host, reduced.options); reduced.flush();
  instant.setView('entry'); reduced.flush(32); assert.deepEqual(reduced.renderCalls.at(-1).position.toArray(), [6, 6.4, 15]); assert.equal(reduced.frames.size, 0); instant.dispose();
});

test('canvas beacon taps notify shared UI state without cancelling native touch scrolling', () => {
  const f = fixture({ reducedMotion: true }), controller = mountPlatformScene(f.host, f.options); f.flush();
  const canvas = f.host.children[0], { scene, camera } = f.renderCalls[0], target = scene.getObjectByName('entry beacon').children.find(o => o.userData.viewId);
  const point = target.getWorldPosition(new THREE.Vector3()).project(camera), clientX = (point.x + 1) * 300, clientY = (1 - point.y) * 227.5;
  const down = pointer(canvas, 'pointerdown', { clientX, clientY, pointerType: 'touch' }), up = pointer(canvas, 'pointerup', { clientX, clientY, pointerType: 'touch' });
  assert.equal(down.defaultPrevented, false); assert.equal(up.defaultPrevented, false); assert.equal(canvas.style.touchAction, 'pan-y');
  assert.deepEqual(f.selections, ['entry']); assert.equal(controller.view, 'entry'); controller.dispose();
});

test('hidden and offscreen transitions pause elapsed time and resume without jumping', () => {
  const f = fixture(), controller = mountPlatformScene(f.host, f.options); f.flush(); controller.setView('entry'); f.flush(32); f.flush(48);
  const pausedPosition = f.renderCalls.at(-1).position.clone();
  f.documentRef.visibilityState = 'hidden'; f.documentRef.dispatchEvent(new Event('visibilitychange')); assert.equal(f.frames.size, 0);
  f.documentRef.visibilityState = 'visible'; f.documentRef.dispatchEvent(new Event('visibilitychange')); f.flush(60000);
  assert.deepEqual(f.renderCalls.at(-1).position.toArray(), pausedPosition.toArray());
  f.observers.intersection[0].callback([{ isIntersecting: false }]); assert.equal(f.frames.size, 0);
  pointer(f.host, 'pointermove', { pointerType: 'touch' }); assert.equal(f.frames.size, 0);
  f.observers.intersection[0].callback([{ isIntersecting: true }]); f.settle(60016); assert.equal(f.frames.size, 0);
  controller.dispose(); assert.equal(f.frames.size, 0);
});

test('motion preference changes stop parallax and finish the selected guided view immediately', () => {
  const f = fixture(), controller = mountPlatformScene(f.host, f.options); f.flush(); controller.setView('experiences'); pointer(f.host, 'pointermove');
  const event = new Event('change'); event.matches = true; f.motion.dispatchEvent(event); f.flush(32);
  assert.deepEqual(f.renderCalls.at(-1).position.toArray(), [11, 8.1, 6.8]); assert.equal(f.frames.size, 0);
  pointer(f.host, 'pointermove'); assert.equal(f.frames.size, 0); controller.dispose();
});

test('GPU/environment failures keep fallback and context restoration rebakes owned targets and shadows', () => {
  for (const options of [{ unsupported: true }, { environmentFailure: true }]) {
    const f = fixture(options), controller = mountPlatformScene(f.host, f.options);
    assert.equal(controller.state, 'fallback'); assert.equal(f.fallback.getAttribute('hidden'), null); assert.equal(f.frames.size, 0); assert.equal(controller.setView('entry'), false);
  }
  const f = fixture(), controller = mountPlatformScene(f.host, f.options); f.flush(); const canvas = f.host.children[0];
  const lost = new Event('webglcontextlost', { cancelable: true }); canvas.dispatchEvent(lost);
  assert.equal(lost.defaultPrevented, true); assert.equal(controller.state, 'fallback'); assert.equal(canvas.hidden, true); assert.equal(f.frames.size, 0);
  controller.setView('entry'); canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(f.environments.length, 2); assert.equal(f.environments[0].disposed, 1); f.settle(32);
  assert.equal(controller.state, 'ready'); assert.equal(canvas.hidden, false); assert.equal(f.shadowBakes(), 2);
  assert.equal(f.renderCalls.at(-1).scene.environment, f.environments[1].texture);
  controller.dispose(); assert.equal(f.environments[1].disposed, 1);
  canvas.dispatchEvent(new Event('webglcontextrestored')); assert.equal(f.environments.length, 2, 'disposed scene removes restore handlers');
});

test('the scene dependency graph starts after two frame boundaries and can be cancelled', async () => {
  const frames = new Map(), host = { dataset: {}, ownerDocument: {} }; let next = 1, imports = 0, mounts = 0, disposals = 0;
  const requestFrame = callback => { const id = next++; frames.set(id, callback); return id; }, cancelFrame = id => frames.delete(id);
  const flush = () => { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(); };
  const controller = deferPlatformScene({ host, requestFrame, cancelFrame, loadScene: async () => { imports++; return { mountPlatformScene: () => { mounts++; return { setView() {}, dispose: () => disposals++ }; } }; } });
  assert.equal(imports, 0); flush(); assert.equal(imports, 0); flush(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(imports, 1); assert.equal(mounts, 1); controller.destroy(); assert.equal(disposals, 1);
  const cancelled = deferPlatformScene({ host, requestFrame, cancelFrame, loadScene: async () => { imports++; } }); cancelled.destroy(); assert.equal(frames.size, 0); assert.equal(imports, 1);
});

test('hero dependencies are local, isolated from venue/wallet and provide the 128px environment bake', () => {
  const source = fs.readFileSync(new URL('../dist/platform-scene.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/import\s+.*?from\s+['"]([^'"]+)/g)].map(match => match[1]);
  assert.equal(imports.length, 3); assert.ok(imports.every(path => path.startsWith('./vendor/three/')));
  assert.equal(/GLTFLoader|\.glb|\.usdz|wallet|fetch\(|getUserMedia|requestSession|EdgesGeometry|updateLabels/.test(source), false);
  assert.match(source, /fromScene\(room, 0, \.1, 100, \{ size: 128 \}\)/);
  for (const addon of ['geometries/RoundedBoxGeometry', 'environments/RoomEnvironment']) {
    const code = fs.readFileSync(new URL('../dist/vendor/three/examples/jsm/' + addon + '.js', import.meta.url), 'utf8');
    assert.match(code, /from '\.\.\/\.\.\/\.\.\/build\/three\.module\.js'/); assert.doesNotMatch(code, /from 'three'/);
  }
});
