import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { GLTFLoader } from '../dist/vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { mountPaltaReveal } from '../dist/palta-reveal.mjs';

const viewer = readFileSync(new URL('../dist/viewer.js', import.meta.url), 'utf8');
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  const result = {};
  result.promise = new Promise((resolve, reject) => Object.assign(result, { resolve, reject }));
  return result;
}
class HeadlessGLTFLoader {
  loadAsync() {
    const bytes = readFileSync(new URL('../dist/assets/palta-reveal.glb', import.meta.url));
    const loader = new GLTFLoader();
    loader.register(() => ({ name: 'headless-textures', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
    return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  }
}
async function mount(scene = new THREE.Scene(), layout = { obstacles: [] }, options = {}) {
  return mountPaltaReveal(THREE, scene, { GLTFLoader: HeadlessGLTFLoader, layout, autoOpenDistance: 0, ...options });
}
function watchResources(root) {
  const counts = new Map();
  const watch = resource => {
    if (!resource?.dispose || counts.has(resource)) return;
    counts.set(resource, 0);
    resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
  };
  root.traverse(node => {
    watch(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      watch(material);
      if (material) for (const value of Object.values(material)) if (value?.isTexture) watch(value);
    }
  });
  return counts;
}

test('overlapping Palta mounts remove only their own collision object and dispose once', async () => {
  const scene = new THREE.Scene(), unrelated = { id: 'existing' }, layout = { obstacles: [unrelated] };
  const first = await mount(scene, layout), firstObstacle = layout.obstacles[1];
  const second = await mount(scene, layout), secondObstacle = layout.obstacles[2];
  const resources = watchResources(first.root);
  assert.notEqual(firstObstacle, secondObstacle);
  assert.equal(scene.children.length, 2);
  first.dispose(); first.dispose();
  assert.deepEqual(layout.obstacles, [unrelated, secondObstacle]);
  assert.deepEqual(scene.children, [second.root]);
  assert.ok(resources.size > 20);
  for (const count of resources.values()) assert.equal(count, 1, 'geometry, materials and textures dispose exactly once');
  second.dispose();
  assert.deepEqual(layout.obstacles, [unrelated]);
  assert.equal(scene.children.length, 0);
});

test('an optional logo never blocks mounting and a texture arriving after disposal is released', { timeout: 3000 }, async t => {
  const pending = deferred(), texture = new THREE.Texture({ width: 300, height: 100 });
  let disposed = 0, requests = 0;
  texture.addEventListener('dispose', () => disposed++);
  t.mock.method(THREE.TextureLoader.prototype, 'loadAsync', () => { requests++; return pending.promise; });
  const controller = await mount(undefined, undefined, { logoUrl: 'delayed.png' });
  const slot = controller.root.getObjectByName('palta_logo_slot'), original = slot.material;
  assert.equal(requests, 1, 'mount resolves while the optional texture remains pending');
  controller.dispose();
  pending.resolve(texture); await turn();
  assert.equal(disposed, 1, 'late texture is released instead of assigned to a destroyed model');
  assert.equal(slot.material, original);
  assert.equal(await controller.setLogo('ignored.png'), false);
  assert.equal(requests, 1, 'disposed controller makes no further texture request');
});

test('disposal also frees replaced logo materials, the original placeholder and new textures', async t => {
  const controller = await mount();
  const resources = watchResources(controller.root);
  const texture = new THREE.Texture({ width: 300, height: 100 });
  let textureDisposals = 0;
  texture.addEventListener('dispose', () => textureDisposals++);
  t.mock.method(THREE.TextureLoader.prototype, 'loadAsync', async () => texture);
  await controller.setLogo('official.png');
  const clones = watchResources(controller.root);
  controller.dispose(); controller.dispose();
  for (const count of resources.values()) assert.equal(count, 1, 'retired original resources are still owned');
  for (const count of clones.values()) assert.equal(count, 1, 'active cloned resources are released');
  assert.equal(textureDisposals, 1);
  controller.open(); controller.toggle(); controller.update(1);
  assert.equal(controller.isOpen, false, 'disposed controller stays inert');
});

function viewerHarness(loadPaltaModule) {
  const warnings = [];
  const context = {
    scene: {}, camera: {}, layout: { obstacles: [] }, THREE, GLTFLoader: HeadlessGLTFLoader,
    attempt: 1, active: true, venueRenderUntil: 0, performance: { now: () => 100 },
    console: { warn: (...args) => warnings.push(args) }, loadPaltaModule,
  };
  context.venueLoading = { isCurrent: attempt => attempt === context.attempt };
  const begin = viewer.indexOf('function discardPalta()'), end = viewer.indexOf('function discardVenueScene()');
  assert.ok(begin > 0 && end > begin);
  const helpers = viewer.slice(begin, end).replace(/import\('\.\/palta-reveal\.mjs\?v=[^']+'\)/, 'loadPaltaModule()');
  const api = vm.runInNewContext(`let palta,paltaMount=0;\n${helpers}\n({mountVenuePalta,discardPalta,getPalta:()=>palta})`, context);
  return { ...api, context, warnings };
}
function fakeController() {
  return { root: {}, disposed: 0, dispose() { this.disposed++; } };
}

test('a discarded scene prevents even starting a delayed optional Palta import', async () => {
  const imported = deferred(); let mounts = 0;
  const harness = viewerHarness(() => imported.promise);
  const work = harness.mountVenuePalta(1);
  harness.discardPalta(); harness.context.scene = {};
  imported.resolve({ mountPaltaReveal() { mounts++; } });
  await work;
  assert.equal(mounts, 0);
  assert.equal(harness.getPalta(), null);
});

for (const changed of ['scene', 'camera', 'attempt']) test(`a late mount is disposed after its owner ${changed} changes`, async () => {
  const mounted = deferred(), controller = fakeController();
  const harness = viewerHarness(async () => ({ mountPaltaReveal: () => mounted.promise }));
  const work = harness.mountVenuePalta(1); await turn();
  harness.context[changed] = changed === 'attempt' ? 2 : {};
  mounted.resolve(controller); await work;
  assert.equal(controller.disposed, 1);
  assert.equal(harness.getPalta(), undefined);
});

test('current Palta mounts share the cached venue lifetime and optional failures do not fail Welcome', async () => {
  const controller = fakeController(); let options;
  const harness = viewerHarness(async () => ({ mountPaltaReveal: (_three, owner, opts) => {
    assert.equal(owner, harness.context.scene); options = opts; return controller;
  } }));
  harness.context.active = false; // Leaving hides this cached scene; its attempt remains valid.
  await harness.mountVenuePalta(1);
  assert.equal(harness.getPalta(), controller);
  assert.equal(options.camera, harness.context.camera);
  assert.equal(options.canvas, null, 'the viewer uses one shared closest-hit picker');
  assert.equal(options.logoUrl, './assets/palta-reveal/logo.png');
  harness.discardPalta(); harness.discardPalta();
  assert.equal(controller.disposed, 1);
  const failed = viewerHarness(async () => { throw Error('optional asset unavailable'); });
  await failed.mountVenuePalta(1);
  assert.equal(failed.warnings.length, 1);
  assert.equal(failed.context.attempt, 1);
});

test('the unified picker respects Palta occlusion and retains wallet selection behind it', () => {
  const picker = viewer.match(/canvas\.addEventListener\('pointerup',e=>\{const tap=passportTap;passportTap=null;[\s\S]*?\}\);/)[0];
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100); camera.position.z = 5; camera.updateMatrixWorld();
  const model = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const root = new THREE.Group(), fruit = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  root.add(fruit); root.position.z = 1; root.updateMatrixWorld(true); model.updateMatrixWorld(true);
  const calls = { palta: 0, wallet: 0 };
  let onPointerUp;
  const context = {
    THREE, camera, model, renderer: {}, mode: 'walk',
    palta: { root, toggle: () => calls.palta++ },
    canvas: { addEventListener: (_type, handler) => { onPointerUp = handler; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) },
    isActivationObject: () => true, openActivation: () => calls.wallet++, isPassportObject: () => false, worldPassport: {},
  };
  const api = vm.runInNewContext(`let passportTap;${picker};({tap:value=>passportTap=value})`, context);
  const event = { pointerId: 1, clientX: 50, clientY: 50 };
  api.tap({ id: 1, x: 50, y: 50 }); onPointerUp(event);
  assert.deepEqual(calls, { palta: 1, wallet: 0 }, 'front Palta consumes the tap');
  root.position.z = -1; root.updateMatrixWorld(true);
  api.tap({ id: 1, x: 50, y: 50 }); onPointerUp(event);
  assert.deepEqual(calls, { palta: 1, wallet: 1 }, 'closer venue object keeps its original wallet action');
  let passportOpens = 0;
  context.isActivationObject = () => false;
  context.isPassportObject = () => true;
  context.worldPassport = { open: () => passportOpens++ };
  api.tap({ id: 1, x: 50, y: 50 }); onPointerUp(event);
  assert.equal(passportOpens, 1, 'closer Passport keeps its original inspector action');
  model.geometry.dispose(); model.material.dispose(); fruit.geometry.dispose(); fruit.material.dispose();
});

test('cache revisions reach the optional activation through the existing entry chain', () => {
  const entry = readFileSync(new URL('../dist/entry.mjs', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const preview = readFileSync(new URL('../dist/palta-reveal.html', import.meta.url), 'utf8');
  const entryVersion = html.match(/src="\.\/entry\.mjs\?v=([^"]+)"/)?.[1];
  const viewerVersion = entry.match(/import\('\.\/viewer\.js\?v=([^']+)'\)/)?.[1];
  const paltaVersion = viewer.match(/import\('\.\/palta-reveal\.mjs\?v=([^']+)'\)/)?.[1];
  const previewVersion = preview.match(/from '\.\/palta-reveal\.mjs\?v=([^']+)'/)?.[1];
  assert.ok(entryVersion && !entryVersion.startsWith('welcome-'));
  assert.equal(entryVersion, viewerVersion, 'HTML and entry invalidate the same viewer publication');
  assert.ok(paltaVersion);
  assert.equal(paltaVersion, previewVersion, 'both viewers load the same activation module');
  assert.match(viewer, /scene\.add\(model\);\s+await applyStageCard[\s\S]*?if\(!venueLoading\.isCurrent\(attempt\)\)return;\s+mountVenuePalta\(attempt\);venueLoading\.progress/);
  assert.match(viewer, /function discardVenueScene\(\)\{discardPalta\(\);/);
  assert.ok(viewer.indexOf('palta?.update(dt);') < viewer.indexOf('venueLoading.renderFrame('));
  assert.match(viewer, /import \{ applyStageCard \} from '\.\/stage-screen\.mjs\?v=2'/);
});


function stageIntegrationHarness() {
  const pending = deferred(), draws = [], mounts = [], fetches = [];
  const prepared = { name: 'prepared venue' };
  const context = {
    THREE, gltf: { scene: { name: 'raw venue' } }, model: null,
    scene: { add: model => draws.push(model) },
    prepareVenueModel: () => prepared,
    controller: new AbortController(), AbortSignal, attempt: 1,
    fetch: async (url, options) => { fetches.push({ url, options }); return { ok: true }; },
    applyStageCard: async (_three, model, options) => {
      assert.equal(model, prepared, 'the card receives the prepared model');
      await options.fetchImpl('./state/stage.json', { cache: 'no-store' });
      return pending.promise;
    },
    mountVenuePalta: attempt => mounts.push(attempt),
  };
  context.venueLoading = { isCurrent: attempt => attempt === context.attempt };
  const begin = viewer.indexOf('  model=prepareVenueModel(gltf.scene,THREE);scene.add(model);');
  const end = viewer.indexOf("venueLoading.progress(attempt,'textures');", begin);
  assert.ok(begin > 0 && end > begin);
  const work = vm.runInNewContext(`(async () => {const attempt = 1;${viewer.slice(begin, end)}})()`, context);
  return { context, pending, draws, mounts, fetches, prepared, work };
}

test('the purchased card is awaited on the prepared model before the current Palta mount', async () => {
  const harness = stageIntegrationHarness();
  await turn();
  assert.deepEqual(harness.draws, [harness.prepared]);
  assert.deepEqual(harness.mounts, [], 'Palta does not race the stage-card request');
  assert.equal(harness.fetches.length, 1);
  assert.equal(harness.fetches[0].options.cache, 'no-store');
  assert.equal(harness.fetches[0].options.signal.aborted, false);
  harness.pending.resolve(true); await harness.work;
  assert.deepEqual(harness.mounts, [1]);
});

test('an obsolete attempt aborts the stage request and cannot start a Palta mount', async () => {
  const harness = stageIntegrationHarness();
  await turn();
  harness.context.attempt = 2;
  harness.context.controller.abort();
  assert.equal(harness.fetches[0].options.signal.aborted, true, 'stage fetch inherits the scene controller');
  harness.pending.resolve(false); await harness.work;
  assert.deepEqual(harness.mounts, []);
});
