import { fetchModel } from './model-transfer.mjs?v=13';
import { prepareVenueModel } from './venue-model.mjs?v=1';

const COPY = {
  en: {
    loading: 'Loading the ONE16 space…', geometry: 'Preparing the 3D space…',
    progress: percent => 'Loading ONE16: ' + percent + '%',
    ready: 'Drag to rotate · right drag to pan · wheel to zoom.',
    touch: 'Explore the space in 3D. Activate the controls when you are ready.',
    active: 'Drag to rotate · two fingers to pan and zoom. Done restores page scrolling.',
    error: 'The 3D preview could not load. The image and full experience are still available.',
    activate: 'Explore 3D map', done: 'Done', in: 'Zoom in', out: 'Zoom out', reset: 'Reset view', retry: 'Retry 3D',
    canvas: 'Interactive 3D overview of the ONE16 venue',
  },
  es: {
    loading: 'Cargando el espacio ONE16…', geometry: 'Preparando el espacio 3D…',
    progress: percent => 'Cargando ONE16: ' + percent + '%',
    ready: 'Arrastra para girar · botón derecho para desplazar · rueda para acercar.',
    touch: 'Explora el espacio en 3D. Activa los controles cuando quieras.',
    active: 'Arrastra para girar · dos dedos para desplazar y acercar. Listo restaura el desplazamiento de la página.',
    error: 'No se pudo cargar la vista 3D. La imagen y la experiencia completa siguen disponibles.',
    activate: 'Explorar mapa 3D', done: 'Listo', in: 'Acercar', out: 'Alejar', reset: 'Restablecer vista', retry: 'Reintentar 3D',
    canvas: 'Vista 3D interactiva del espacio ONE16',
  },
};

async function loadEngine() {
  const [THREE, loader, controls] = await Promise.all([
    import('three'),
    import('./vendor/three/examples/jsm/loaders/GLTFLoader.js'),
    import('./vendor/three/examples/jsm/controls/OrbitControls.js'),
  ]);
  return { THREE, GLTFLoader: loader.GLTFLoader, OrbitControls: controls.OrbitControls };
}

function modelResources(model) {
  const resources = new Set();
  model?.traverse(object => {
    if (object.geometry) resources.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
  });
  return resources;
}

/** Each mount owns its parser, scene, controls and GPU resources. Only HTTP bytes are cached. */
export function mountOne16Preview(host, {
  language = 'en',
  documentRef = host.ownerDocument,
  windowRef = documentRef.defaultView || globalThis,
  loadEngine: engineLoader = loadEngine,
  fetchModel: transfer = fetchModel,
  createRenderer = (THREE, options) => new THREE.WebGLRenderer(options),
  requestFrame = callback => windowRef.requestAnimationFrame(callback),
  cancelFrame = id => windowRef.cancelAnimationFrame(id),
  ResizeObserverClass = windowRef.ResizeObserver,
  IntersectionObserverClass = windowRef.IntersectionObserver,
  setTimer = (callback, ms) => windowRef.setTimeout(callback, ms),
  clearTimer = id => windowRef.clearTimeout(id),
  timeout = 45000,
  onReady = () => {},
} = {}) {
  const stage = host.querySelector('[data-preview-stage]');
  if (!stage) throw new Error('ONE16 preview requires a stage');
  const poster = host.querySelector('[data-preview-poster]'), status = host.querySelector('[data-preview-status]');
  const buttons = Object.fromEntries(['activate', 'done', 'reset', 'retry'].map(name => [name, host.querySelector('[data-preview-' + name + ']')]));
  buttons.in = host.querySelector('[data-preview-zoom="in"]'); buttons.out = host.querySelector('[data-preview-zoom="out"]');
  let lang = language === 'es' ? 'es' : 'en', state = 'loading', progress, geometry = false;
  const coarseQuery = windowRef.matchMedia?.('(pointer: coarse), (max-width: 820px)');
  let coarse = !!coarseQuery?.matches, interaction = false, inView = true, disposed = false, frame = 0, generation = 0;
  let renderer, canvas, scene, camera, controls, THREE, bounds, resetPosition, resetTarget, radius, fitPoints, lastSize;
  let transferController, transferTimer, readyPromise, preparedPromise, settleReady, canvasCleanups = [], controlChange, firstFrame = false, cameraFitted = false;
  const resources = new Set(), cleanups = [], activePointers = new Map();
  const listen = (target, name, handler, options, bucket = cleanups) => {
    target?.addEventListener(name, handler, options);
    if (target) bucket.push(() => target.removeEventListener(name, handler, options));
  };
  function updateUI() {
    const copy = COPY[lang], ready = state === 'ready';
    host.dataset.previewState = state; host.dataset.previewInteractive = String(ready && interaction);
    host.setAttribute('aria-busy', String(state === 'loading'));
    if (poster) poster.hidden = ready;
    if (canvas) { canvas.hidden = state === 'error'; canvas.setAttribute('aria-label', copy.canvas); }
    if (status) status.textContent = state === 'error' ? copy.error : state === 'loading' ? geometry ? copy.geometry : Number.isFinite(progress) ? copy.progress(progress) : copy.loading : coarse ? interaction ? copy.active : copy.touch : copy.ready;
    for (const [name, button] of Object.entries(buttons)) {
      if (!button) continue;
      button.textContent = name === 'in' ? '+' : name === 'out' ? '−' : copy[name]; button.setAttribute('aria-label', copy[name]);
      button.disabled = name === 'retry' ? state !== 'error' : !ready;
      button.hidden = name === 'retry' ? state !== 'error' : name === 'activate' ? !coarse || !ready || interaction : name === 'done' ? !coarse || !ready || !interaction : !ready;
    }
    buttons.activate?.setAttribute('aria-pressed', String(ready && interaction));
    buttons.done?.setAttribute('aria-pressed', 'false');
  }
  function pause() { if (frame) cancelFrame(frame); frame = 0; }
  function canRender() { return !disposed && state !== 'error' && renderer && scene && camera && inView && documentRef.visibilityState !== 'hidden'; }
  function invalidate() { if (canRender() && !frame) frame = requestFrame(render); }
  function render() {
    frame = 0; if (!canRender()) return;
    const rect = stage.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    try {
      renderer.render(scene, camera);
      if (!firstFrame) {
        firstFrame = true; state = 'ready'; updateUI();
        settleReady?.({ state }); settleReady = null;
        onReady(controller);
        const EventClass = windowRef.CustomEvent || globalThis.CustomEvent;
        if (EventClass) host.dispatchEvent(new EventClass('one16-preview-ready', { bubbles: true }));
      }
    } catch { fail(); }
  }
  function cancelGesture() {
    if (!canvas) return;
    // OrbitControls retains active pointer ids on disconnect; send cancellation first.
    for (const [pointerId, pointerType] of activePointers) {
      const EventClass = windowRef.PointerEvent || windowRef.Event || globalThis.Event;
      const event = new EventClass('pointercancel', { pointerId, pointerType });
      if (!('pointerId' in event)) Object.defineProperties(event, { pointerId: { value: pointerId }, pointerType: { value: pointerType } });
      try { canvas.dispatchEvent(event); } catch {}
      try { if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId); } catch {}
    }
    activePointers.clear();
  }
  function setInteraction(enabled) {
    interaction = !!enabled && state === 'ready';
    if (controls) {
      cancelGesture(); controls.disconnect(); controls.enabled = interaction;
      if (interaction) controls.connect(canvas);
    }
    if (canvas) canvas.style.touchAction = interaction ? 'none' : 'pan-y';
    updateUI();
  }
  function clampTarget() {
    if (!controls || !bounds) return;
    const target = controls.target, x = Math.max(bounds.min.x, Math.min(bounds.max.x, target.x)), z = Math.max(bounds.min.z, Math.min(bounds.max.z, target.z));
    camera.position.x += x - target.x; camera.position.z += z - target.z;
    target.x = x; target.z = z;
  }
  function reset() {
    if (!camera || !controls || !resetPosition) return;
    camera.position.copy(resetPosition); controls.target.copy(resetTarget); controls.update(); invalidate();
  }
  function zoom(multiplier) {
    if (state !== 'ready' || !camera || !controls) return;
    const offset = camera.position.clone().sub(controls.target);
    offset.setLength(Math.max(controls.minDistance, Math.min(controls.maxDistance, offset.length() * multiplier)));
    camera.position.copy(controls.target).add(offset); controls.update(); invalidate();
  }
  function resize() {
    if (!renderer || !camera || !bounds || disposed || state === 'error') return;
    const { width, height } = stage.getBoundingClientRect(); if (!width || !height) return;
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    const target = bounds.getCenter(new THREE.Vector3()), direction = new THREE.Vector3(.7, 1, .85).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize(), up = new THREE.Vector3().crossVectors(direction, right);
    const tanHalfV = Math.tan(camera.fov * Math.PI / 360), tanHalfH = tanHalfV * camera.aspect, point = new THREE.Vector3();
    let distance = 0;
    // Perspective depth matters: each visible corner must fit at its own distance from the camera.
    for (const source of fitPoints) {
      point.copy(source).sub(target);
      distance = Math.max(distance, point.dot(direction) + Math.max(Math.abs(point.dot(right)) / tanHalfH, Math.abs(point.dot(up)) / tanHalfV) * 1.10);
    }
    resetTarget = target; resetPosition = target.clone().addScaledVector(direction, distance);
    controls.minDistance = radius * .3; controls.maxDistance = distance * 2.2;
    camera.near = Math.max(.05, radius / 500); camera.far = distance * 6; camera.updateProjectionMatrix();
    const sizeChanged = !lastSize || lastSize.width !== width || lastSize.height !== height; lastSize = { width, height };
    if (!cameraFitted || sizeChanged) { cameraFitted = true; reset(); } else invalidate();
  }
  function releaseScene() {
    cancelGesture(); pause();
    for (const cleanup of canvasCleanups) cleanup(); canvasCleanups = [];
    if (controls) { controls.removeEventListener('change', controlChange); controls.dispose(); controls = null; }
    for (const resource of resources) resource.dispose?.(); resources.clear();
    scene?.clear(); scene = camera = bounds = resetPosition = resetTarget = fitPoints = lastSize = null;
    renderer?.dispose(); renderer = null; canvas?.remove(); canvas = null; cameraFitted = false;
  }
  function fail() {
    if (disposed) return;
    generation++; transferController?.abort(); clearTimer(transferTimer); transferTimer = null;
    interaction = false; releaseScene(); state = 'error'; updateUI(); settleReady?.({ state }); settleReady = null;
  }
  async function start() {
    const current = ++generation; state = 'loading'; progress = undefined; geometry = false; firstFrame = false; updateUI();
    const controllerForLoad = transferController = new AbortController();
    transferTimer = setTimer(() => { if (generation === current) fail(); }, timeout);
    const isCurrent = () => !disposed && current === generation;
    try {
      const bytesPromise = transfer({ fetcher: url => windowRef.fetch(url, { signal: controllerForLoad.signal }), onProgress: ({ loaded, total }) => {
        if (!isCurrent()) return;
        progress = total > 0 ? Math.max(0, Math.min(100, Math.round(loaded / total * 100))) : undefined; updateUI();
      } });
      // Resolve both even if the import fails so a late transfer never rejects unhandled.
      const [engine, bytes] = await Promise.all([engineLoader(), bytesPromise]);
      if (!isCurrent()) return;
      THREE = engine.THREE; geometry = true; updateUI();
      const gltf = await new engine.GLTFLoader().parseAsync(bytes, new URL('./assets/', import.meta.url).href);
      const model = gltf.scene, originalResources = modelResources(model);
      if (!isCurrent()) { for (const resource of originalResources) resource.dispose?.(); return; }
      for (const resource of originalResources) resources.add(resource);
      prepareVenueModel(model, THREE);
      for (const resource of modelResources(model)) resources.add(resource);
      model.traverse(object => { if (/^roof/i.test(object.name)) object.visible = false; if (object.isMesh) { object.castShadow = false; object.receiveShadow = false; object.frustumCulled = true; } });
      scene = new THREE.Scene(); scene.add(model);
      scene.add(new THREE.HemisphereLight(0xe7efff, 0x7e6a4a, 2.4));
      const sun = new THREE.DirectionalLight(0xfff2d2, 2.6); sun.position.set(-20, 22, 8); scene.add(sun);
      const fill = new THREE.DirectionalLight(0xffffff, 1.2); fill.position.set(15, 14, -30); scene.add(fill);
      bounds = new THREE.Box3(); fitPoints = []; model.updateMatrixWorld(true);
      model.traverseVisible(object => {
        if (!object.isMesh || !object.geometry) return;
        object.geometry.computeBoundingBox(); const box = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld); bounds.union(box);
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) fitPoints.push(new THREE.Vector3(x, y, z));
      });
      if (bounds.isEmpty()) throw new Error('The venue has no visible geometry');
      radius = Math.max(1, bounds.getSize(new THREE.Vector3()).length() / 2);
      canvas = documentRef.createElement('canvas'); canvas.className = 'one16-preview-canvas'; canvas.style.touchAction = 'pan-y';
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', COPY[lang].canvas);
      renderer = createRenderer(THREE, { canvas, alpha: true, antialias: !coarse, powerPreference: 'low-power' });
      renderer.setClearColor(0x000000, 0); renderer.setPixelRatio(Math.min(windowRef.devicePixelRatio || 1, coarse ? 1.25 : 1.6));
      renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
      if (renderer.shadowMap) renderer.shadowMap.enabled = false;
      camera = new THREE.PerspectiveCamera(45, 1, .05, 500);
      controls = new engine.OrbitControls(camera, canvas); controls.enableDamping = false; controls.autoRotate = false;
      controls.screenSpacePanning = false; controls.minPolarAngle = .08; controls.maxPolarAngle = Math.PI * .48;
      controls.rotateSpeed = .6; controls.zoomSpeed = .8; controls.panSpeed = .65;
      controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
      controls.disconnect(); controls.enabled = false; canvas.style.touchAction = 'pan-y';
      controlChange = () => { clampTarget(); invalidate(); }; controls.addEventListener('change', controlChange);
      listen(canvas, 'pointerdown', event => { if (interaction) activePointers.set(event.pointerId, event.pointerType); }, { capture: true }, canvasCleanups);
      for (const name of ['pointerup', 'pointercancel']) listen(canvas, name, event => activePointers.delete(event.pointerId), undefined, canvasCleanups);
      listen(canvas, 'webglcontextlost', event => { event.preventDefault(); fail(); }, undefined, canvasCleanups);
      stage.append(canvas); resize();
      clearTimer(transferTimer); transferTimer = null;
      // The poster remains until the scheduled render succeeds, even with fully loaded bytes.
      if (!coarse) { interaction = true; controls.enabled = true; controls.connect(canvas); canvas.style.touchAction = 'none'; }
      invalidate();
    } catch { if (isCurrent()) fail(); }
  }
  function begin() { readyPromise = new Promise(resolve => { settleReady = resolve; }); preparedPromise = start(); }
  listen(buttons.activate, 'click', () => setInteraction(true));
  listen(buttons.done, 'click', () => { setInteraction(false); buttons.activate?.focus?.({ preventScroll: true }); });
  listen(buttons.in, 'click', () => zoom(.8)); listen(buttons.out, 'click', () => zoom(1.25));
  listen(buttons.reset, 'click', reset);
  listen(buttons.retry, 'click', () => { if (state === 'error') { releaseScene(); begin(); } });
  listen(documentRef, 'visibilitychange', () => {
    if (documentRef.visibilityState === 'hidden') { if (coarse) setInteraction(false); pause(); } else invalidate();
  });
  if (coarseQuery?.addEventListener) listen(coarseQuery, 'change', event => {
    coarse = !!event.matches;
    if (renderer) renderer.setPixelRatio(Math.min(windowRef.devicePixelRatio || 1, coarse ? 1.25 : 1.6));
    setInteraction(!coarse); invalidate();
  });
  const resizeObserver = ResizeObserverClass ? new ResizeObserverClass(resize) : null; resizeObserver?.observe(stage);
  if (!resizeObserver) listen(windowRef, 'resize', resize);
  const intersection = IntersectionObserverClass ? new IntersectionObserverClass(entries => {
    inView = entries.some(entry => entry.isIntersecting);
    if (inView) invalidate(); else { if (coarse) setInteraction(false); pause(); }
  }) : null; intersection?.observe(host);
  const controller = {
    setLanguage(next) { lang = next === 'es' ? 'es' : 'en'; if (!disposed) updateUI(); },
    get state() { return state; },
    get ready() { return readyPromise; },
    get prepared() { return preparedPromise; },
    dispose() {
      if (disposed) return;
      disposed = true; generation++; transferController?.abort(); clearTimer(transferTimer);
      resizeObserver?.disconnect(); intersection?.disconnect(); for (const cleanup of cleanups) cleanup();
      interaction = false; releaseScene(); state = 'disposed'; updateUI(); settleReady?.({ state }); settleReady = null;
    },
  };
  begin(); return controller;
}







