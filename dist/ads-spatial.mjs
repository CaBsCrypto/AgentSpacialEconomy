import { createAdsPlayer, safeAdsUrl } from './ads-player.mjs';
import { screenPlacement, BACKDROP_NODE } from './stage-screen.mjs';
import { createSpatialSession } from './spatial-session.mjs';
import { createWorldPassportPlacement } from './passport-world-placement.mjs';

export function createAdsSurface(THREE, model, placement) {
  let position, rotation = [0, 0, 0], width, height;
  if (placement.id === 'main_stage_screen') {
    const backdrop = model.getObjectByName(BACKDROP_NODE);
    if (!backdrop) return null;
    const bounds = new THREE.Box3().setFromObject(backdrop), centre = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
    const measured = screenPlacement(bounds.min.toArray(), bounds.max.toArray(), centre.toArray());
    position = measured.position; width = measured.width; height = Math.min(measured.height, width * 9 / 16); width = height * 16 / 9; rotation[1] = measured.rotationY;
    position[2] += Math.cos(rotation[1]) * .012; position[0] += Math.sin(rotation[1]) * .012;
  } else if (placement.id === 'venue_center_banner') {
    const transform = placement.transform;
    if (!Array.isArray(transform?.position) || transform.position.length !== 3 || !transform.position.every(Number.isFinite) || !(transform.width > 0) || !(transform.height > 0)) return null;
    position = transform.position; width = transform.width; height = transform.height;
    if (Math.abs(width / height - 4) > .05) return null;
    if (transform.rotation) {
      if (!Array.isArray(transform.rotation) || transform.rotation.length !== 3 || !transform.rotation.every(Number.isFinite)) return null;
      rotation = transform.rotation;
    }
  } else return null;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide }));
  mesh.name = placement.id; mesh.userData.adsPlacement = placement.id; const raycast = mesh.raycast; mesh.raycast = function(ray, intersections) { if (this.visible) raycast.call(this, ray, intersections); }; mesh.position.set(...position); mesh.rotation.set(...rotation); mesh.visible = false; model.add(mesh);
  return mesh;
}
async function decodeBitmap(bytes, mimeType) {
  const blob = new Blob([bytes], { type: mimeType });
  if (globalThis.createImageBitmap) return createImageBitmap(blob, { imageOrientation: 'flipY' });
  const url = URL.createObjectURL(blob), image = new Image();
  try { image.src = url; await image.decode(); return image; } finally { URL.revokeObjectURL(url); }
}
/** Texture changes are acknowledged only after the owner confirms an actual rendered frame. */
export function bindAdsSurface(THREE, mesh, { onApplied = () => {}, decodeImage = decodeBitmap, hostSurface = null } = {}) {
  let serial = 0, pendingAck = null, disposed = false, bitmap = null;
  function clear() {
    mesh.visible = false; mesh.material.map?.dispose(); mesh.material.map = null; mesh.material.needsUpdate = true;
    bitmap?.close?.(); bitmap = null; pendingAck = null;
    if (hostSurface) hostSurface.visible = true;
  }
  return {
    async update(state) {
      const generation = ++serial; clear();
      if (disposed || state.status !== 'active') return;
      try {
        const image = await decodeImage(state.bytes, state.mimeType);
        if (disposed || generation !== serial) { image.close?.(); return; }
        const expected = mesh.geometry.parameters.width / mesh.geometry.parameters.height;
        if (!image.width || !image.height || Math.abs(image.width / image.height - expected) > .05) { image.close?.(); return; }
        bitmap = image; const texture = new THREE.Texture(image); texture.needsUpdate = true; texture.colorSpace = THREE.SRGBColorSpace;
        mesh.material.map = texture; mesh.material.needsUpdate = true; mesh.visible = true;
        if (hostSurface) hostSurface.visible = false;
        pendingAck = { placementId: state.placementId, version: state.version, revisionId: state.active.revisionId, manifestHash: state.active.manifestHash, imageHash: state.active.imageHash };
      } catch { if (generation === serial) clear(); }
    },
    afterFrame(frameAt) { if (pendingAck && mesh.visible && Number.isFinite(frameAt)) onApplied({ ...pendingAck, frameAt }); },
    clear() { serial++; clear(); },
    dispose() { disposed = true; serial++; clear(); mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose(); },
  };
}
export async function mountAdsSpatial(THREE, model, { config, fetchImpl = fetch, onApplied = () => {}, timer = setInterval, clearTimer = clearInterval, now = Date.now, decodeImage, defaultLoop } = {}) {
  if (!config) {
    const response = await fetchImpl('/api/ads/config', { cache: 'no-store' });
    if (!response.ok) return null;
    config = await response.json();
  }
  if (config.defaultStageUrl) defaultLoop?.setUrl(config.defaultStageUrl);
  const players = [], surfaces = [];
  for (const placement of config.placements || []) {
    const mesh = createAdsSurface(THREE, model, placement);
    if (!mesh) continue;
    const surface = bindAdsSurface(THREE, mesh, { onApplied, decodeImage, hostSurface: placement.id === 'main_stage_screen' ? model.getObjectByName('Main stage default loop') || model.getObjectByName('Stage agent screen') : null });
    const player = createAdsPlayer({ placementId: placement.id, fetchImpl, onChange: state => { void surface.update(state); } });
    players.push(player); surfaces.push(surface); void player.refresh();
  }
  const refreshTimer = timer(() => { for (const player of players) void player.refresh(); }, 1_000);
  return {
    get playback() { return players.find(player=>player.state.placementId==='main_stage_screen')?.state.playback||null; },
    get state() { return players.map(player => ({ placementId: player.state.placementId, status: player.state.status, reason: player.state.reason || null, version: player.state.version, revisionId: player.state.active?.revisionId || null, visible: !!model.getObjectByName(player.state.placementId)?.visible })); },
    update() { players.forEach(player => player.tick()); },
    afterFrame({ camera } = {}) {
      const frustum = camera ? new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)) : null;
      for (let index = 0; index < players.length; index++) { const mesh = model.getObjectByName(players[index].state.placementId); if (!frustum || mesh && frustum.intersectsObject(mesh)) surfaces[index].afterFrame(now()); }
    },
    suspend() { players.forEach(player => player.suspend()); },
    resume() { players.forEach(player => { void player.resume(); }); },
    dispose() { clearTimer(refreshTimer); players.forEach(player => player.dispose()); surfaces.forEach(surface => surface.dispose()); },
  };
}

/** A manual, device-local AR placement. It never claims shared venue alignment. */
export function createAdsSpatialController({ THREE: T, renderer, scene, camera, object, uiRoot, onState = () => {}, onFrame = () => {}, onEnd = () => {}, requestSession = () => navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test', 'dom-overlay'], optionalFeatures: ['local-floor'], domOverlay: { root: uiRoot } }) } = {}) {
  const placement = createWorldPassportPlacement(T, { elevation: .75 });
  let run = null, disposed = false;
  const emit = (state, error = null) => onState({ state, error, placed: !!placement.placed, canPlace: !!placement.hit && !placement.placed && !!run?.viewer });
  function restore(local) {
    local.session.removeEventListener('select', local.select); local.reference?.removeEventListener('reset', local.reset); local.session.removeEventListener('visibilitychange', local.visibility);
    try { local.hitSource?.cancel(); } catch {}
    if (run === local) { renderer.setAnimationLoop(null); local.parent.add(object); object.position.copy(local.position); object.quaternion.copy(local.quaternion); object.scale.copy(local.scale); object.visible = local.visible; run = null; placement.reset(); }
    local.anchor?.removeFromParent(); local.reticle?.removeFromParent(); local.reticle?.geometry.dispose(); local.reticle?.material.dispose();
  }
  function place() {
    if (!run?.viewer) return false;
    const matrix = placement.place(run.viewer.transform.matrix);
    if (!matrix) return false;
    run.anchor.matrix.fromArray(matrix); run.anchor.matrixWorldNeedsUpdate = true; run.anchor.visible = true; run.reticle.visible = false; emit('placed'); return true;
  }
  async function prepare(session, signal) {
    const local = { session, parent: object.parent, position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(), visible: object.visible, viewer: null };
    try {
      renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local'); await renderer.xr.setSession(session); if (signal.aborted) throw signal.reason;
      local.reference = renderer.xr.getReferenceSpace();
      const viewerSpace = await session.requestReferenceSpace('viewer'); if (signal.aborted) throw signal.reason;
      local.hitSource = await session.requestHitTestSource({ space: viewerSpace }); if (signal.aborted) throw signal.reason;
      placement.reset(); local.anchor = new T.Group(); local.anchor.matrixAutoUpdate = false; local.anchor.visible = false; local.anchor.name = 'Advertisement local AR anchor';
      local.reticle = new T.Mesh(new T.RingGeometry(.06, .075, 32).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0xc7ff72 })); local.reticle.matrixAutoUpdate = false; local.reticle.visible = false;
      scene.add(local.anchor, local.reticle); local.anchor.add(object); object.position.set(0, 0, 0); object.quaternion.identity(); run = local;
      local.select = () => { if (!placement.placed) place(); };
      local.reset = event => { local.viewer = null; placement.rebase(event.transform?.matrix); local.anchor.visible = false; local.reticle.visible = false; emit('tracking-lost'); };
      local.visibility = () => { if (session.visibilityState === 'hidden') controller.stop(); };
      session.addEventListener('select', local.select); local.reference.addEventListener('reset', local.reset); session.addEventListener('visibilitychange', local.visibility);
      renderer.setAnimationLoop((time, frame) => {
        if (!frame || signal.aborted || run !== local) return;
        const pose = frame.getViewerPose(local.reference), tracked = !!pose && !pose.emulatedPosition && session.visibilityState !== 'visible-blurred';
        local.viewer = tracked ? pose : null;
        if (!tracked) { local.anchor.visible = false; local.reticle.visible = false; emit('tracking-lost'); }
        else if (placement.placed) { local.anchor.matrix.fromArray(placement.placed); local.anchor.matrixWorldNeedsUpdate = true; local.anchor.visible = true; local.reticle.visible = false; emit('placed'); }
        else {
          const hit = frame.getHitTestResults(local.hitSource).map(result => result.getPose(local.reference)).find(value => value?.transform.matrix[5] >= .75);
          placement.offerHit(hit?.transform.matrix); local.reticle.visible = !!placement.hit;
          if (local.reticle.visible) { local.reticle.matrix.fromArray(placement.hit); local.reticle.matrixWorldNeedsUpdate = true; }
          emit(local.reticle.visible ? 'surface-found' : 'searching');
        }
        onFrame(time); renderer.render(scene, camera);
      });
      return () => restore(local);
    } catch (error) { restore(local); throw error; }
  }
  const controller = createSpatialSession({ requestSession, prepareSession: prepare, onState: value => { if (['requesting', 'error'].includes(value.state)) emit(value.state, value.error); }, onEnd() { if (!disposed) { emit('preview'); onEnd(); } } });
  return { start() { return disposed ? Promise.resolve(false) : controller.start(); }, stop() { controller.stop(); }, place, reposition() { placement.reset(); if (run) { run.anchor.visible = false; run.reticle.visible = false; run.viewer = null; } emit('searching'); }, get placed() { return placement.placed; }, dispose() { disposed = true; controller.stop(); if (run) restore(run); } };
}

/** Venue-owned background; advertisements temporarily cover it, never modify its asset. */
export function createDefaultStageLoop(THREE, model, { url = '/assets/main-stage-default.mp4', documentRef = globalThis.document } = {}) {
  const mesh = createAdsSurface(THREE, model, { id: 'main_stage_screen' });
  if (!mesh) return null;
  mesh.name = 'Main stage default loop'; mesh.visible = true; mesh.material.color.set(0x081018);
  const video = documentRef.createElement('video');
  video.muted = true; video.defaultMuted = true; video.autoplay = true; video.loop = true; video.playsInline = true; video.preload = 'auto'; video.crossOrigin = 'anonymous';
  video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.setAttribute('aria-hidden', 'true'); video.src = url;
  const texture = new THREE.VideoTexture(video); texture.colorSpace = THREE.SRGBColorSpace;
  mesh.material.map = texture; mesh.material.color.set(0xffffff); mesh.material.needsUpdate = true;
  const play = () => { const request = video.play(); request?.catch?.(() => {}); };
  let currentUrl = url;
  const setUrl = next => { const parsed = safeAdsUrl(next); if (parsed.href !== new URL(currentUrl, globalThis.location?.origin || 'https://ads.invalid').href) { currentUrl = next; video.src = parsed.href; play(); } };
  play();
  return { mesh, video, play, setUrl, get state() { return { visible: mesh.visible, currentTime: video.currentTime, duration: video.duration, muted: video.muted, loop: video.loop, playsInline: video.playsInline, paused: video.paused, readyState: video.readyState }; }, pause() { video.pause(); }, dispose() { video.pause(); video.removeAttribute('src'); video.load?.(); texture.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); mesh.removeFromParent(); } };
}
