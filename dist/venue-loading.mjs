/** Small, framework-free lifecycle shared by the entry curtain and the venue renderer. */
export const VENUE_COPY = Object.freeze({
 en: Object.freeze({ welcome: 'WELCOME, BUILDERS.', title: 'Your experience starts here.', description: 'We are preparing the entrance and the space beyond it.', engine: 'Preparing the 3D engine…', download: 'Downloading the space', geometry: 'Preparing the geometry…', textures: 'Preparing the scene textures…', render: 'Preparing the first view…', ready: 'The space is ready.', error: 'The 3D space could not be prepared. You can retry or explore the 2D plan.', retry: 'Retry 3D', plan: 'Explore in 2D', exit: 'Back to Agentic Reality Space', progress: 'Download progress', poster: 'WELCOME, BUILDERS. sign above the entrance, leading to the yellow corridor' }),
 es: Object.freeze({ welcome: 'WELCOME, BUILDERS.', title: 'Tu experiencia empieza aquí.', description: 'Estamos preparando la entrada y el espacio que viene después.', engine: 'Preparando el motor 3D…', download: 'Descargando el espacio', geometry: 'Preparando la geometría…', textures: 'Preparando las texturas de la escena…', render: 'Preparando la primera vista…', ready: 'El espacio está listo.', error: 'No se pudo preparar el espacio 3D. Puedes reintentar o explorar el plano 2D.', retry: 'Reintentar 3D', plan: 'Explorar en 2D', exit: 'Volver a Agentic Reality Space', progress: 'Progreso de descarga', poster: 'Cartel WELCOME, BUILDERS. sobre la entrada, antes del pasillo amarillo' })
});

export function resolveVenueLanguage({ search = '', storage } = {}) {
 const requested = new URLSearchParams(search).get('lang');
 if (requested === 'en' || requested === 'es') return requested;
 try { const saved = storage?.getItem('ars-language'); if (saved === 'en' || saved === 'es') return saved; } catch {}
 return 'en';
}

/** Decide once, before downloading or applying a camera transform. */
export function resolveVenueIntent({ hash = '', search = '', savedReturn = null, now = Date.now(), bounds = null } = {}) {
 if (hash === '#accessibleTour') return { kind: 'static', mode: 'plan' };
 let saved = savedReturn;
 try { if (typeof saved === 'string') saved = JSON.parse(saved); } catch { saved = null; }
 const p = saved?.pose;
 const validPose = p && ['x', 'z', 'yaw', 'pitch'].every(key => Number.isFinite(p[key])) && Math.abs(p.x) <= 10000 && Math.abs(p.z) <= 10000 && Math.abs(p.yaw) <= 100000 && Math.abs(p.pitch) <= Math.PI / 2 && (!bounds || p.x >= bounds.minX && p.x <= bounds.maxX && p.z >= bounds.minZ && p.z <= bounds.maxZ);
 if (hash === '#recorrido' && Number.isFinite(saved?.expires) && saved.expires > now && validPose && ['walk', 'overview', 'plan'].includes(saved.mode)) {
  return { kind: 'ar-return', mode: saved.mode, pose: { x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch } };
 }
 const passport = new URLSearchParams(search).get('passport');
 if (passport === 'return' || passport === 'stand16') return { kind: 'passport-return', mode: 'walk' };
 return { kind: 'entrance', mode: 'walk' };
}

export function createVenueLoadingController({ onState = () => {}, onReady = () => {}, onError = () => {} } = {}) {
 let state = { attempt: 0, phase: 'idle', choice: 'scene', cover: true, prepared: false, loaded: 0, total: null, error: null };
 const snapshot = () => ({ ...state });
 const emit = () => onState(snapshot());
 const current = id => id === state.attempt && state.phase !== 'error';
 const fail = (id, error) => {
  if (!current(id)) return false;
  state = { ...state, phase: 'error', prepared: false, error, cover: state.choice === 'scene' };
  emit(); onError(error, snapshot()); return true;
 };
 return {
  get state() { return snapshot(); },
  begin() { state = { attempt: state.attempt + 1, phase: 'engine', choice: state.choice, cover: state.choice === 'scene', prepared: false, loaded: 0, total: null, error: null }; emit(); return state.attempt; },
  isCurrent: current,
  progress(id, phase, { loaded = 0, total = null } = {}) {
   if (!current(id) || state.prepared) return false;
   state = { ...state, phase, loaded, total: Number.isFinite(total) && total > 0 ? total : null }; emit(); return true;
  },
  prepared(id) { if (!current(id)) return false; state = { ...state, phase: 'render', prepared: true, loaded: 0, total: null }; emit(); return true; },
  show() { state = { ...state, choice: 'scene', cover: state.phase !== 'ready' }; emit(); },
  choosePlan() { state = { ...state, choice: 'plan', cover: false }; emit(); },
  leave() { state = { ...state, choice: 'left', cover: false }; emit(); },
  fail,
  /** Only an actual successful render can release the curtain. A parsed model is insufficient. */
  renderFrame(id, { render, width, height, contextLost = false } = {}) {
   if (!current(id) || !state.prepared || state.choice !== 'scene' || !(width > 0 && height > 0)) return false;
   if (contextLost) { fail(id, Error('WebGL context lost')); return false; }
   try { render(); } catch (error) { fail(id, error); return false; }
   if (state.phase === 'ready') return false;
   state = { ...state, phase: 'ready', cover: false }; emit(); onReady(snapshot()); return true;
  }
 };
}

export function mountVenueWelcome(documentRef, { language = 'en' } = {}) {
 const $ = id => documentRef.getElementById(id), cover = $('venueWelcome'), copy = VENUE_COPY[language] || VENUE_COPY.en;
 if (!cover) return { update() {} };
 cover.lang = language;
 for (const [id, text] of Object.entries({ venueWelcomeEyebrow: copy.welcome, venueWelcomeTitle: copy.title, venueWelcomeDescription: copy.description, venueWelcomeRetry: copy.retry, venueWelcomePlan: copy.plan, venueWelcomeExit: copy.exit })) if ($(id)) $(id).textContent = text;
 if ($('venueWelcomePoster')) $('venueWelcomePoster').alt = copy.poster;
 $('venueWelcomeProgress')?.setAttribute('aria-label', copy.progress);
 return { update(state) {
  cover.hidden = !state.cover;
  documentRef.documentElement.classList.toggle('venue-cover', state.cover);
  cover.dataset.phase = state.phase;
  cover.setAttribute('aria-busy', String(state.cover && state.phase !== 'error'));
  const status = $('venueWelcomeStatus'), progress = $('venueWelcomeProgress'), retry = $('venueWelcomeRetry');
  if (status) status.textContent = state.phase === 'download' && state.total ? `${copy.download}: ${Math.min(100, Math.round(state.loaded / state.total * 100))}%` : (copy[state.phase] || copy.engine);
  if (progress) { progress.hidden = state.phase === 'error'; if (state.phase === 'download' && state.total) { progress.max = state.total; progress.value = Math.min(state.loaded, state.total); } else progress.removeAttribute('value'); }
  if (retry) retry.hidden = state.phase !== 'error';
 }};
}
