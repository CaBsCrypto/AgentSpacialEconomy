/** Reuse the venue controls while keeping panels out of the walking view. */
export function mountVenueUI(documentRef, { onInteract = () => {} } = {}) {
  const get = id => documentRef.getElementById(id);
  const view = get('viewer'), windowRef = documentRef.defaultView;
  const make = (tag, id, text) => {
    const element = documentRef.createElement(tag);
    if (id) element.id = id;
    if (text) element.textContent = text;
    return element;
  };
  view.classList.add('venue-ui');
  const hud = make('div', 'venueHud'), actions = make('div', 'venueActions');
  const toolbar = view.querySelector('.toolbar');
  hud.append(toolbar);
  actions.append(get('toggleZones'), get('room'));
  hud.append(actions); view.append(hud);
  const panel = make('aside', 'venuePlacesPanel');
  panel.setAttribute('aria-label', 'Lugares del recorrido');
  const heading = make('div'); heading.className = 'venue-panel-heading';
  const close = make('button', 'closePlaces', '×'); close.type = 'button';
  close.setAttribute('aria-label', 'Cerrar lugares');
  heading.append(make('h2', null, 'Lugares del recorrido'), close);
  panel.append(heading, get('zones')); view.append(panel);
  const places = get('toggleZones');
  places.setAttribute('aria-controls', panel.id);
  const guide = make('details', 'overviewGuide');
  guide.append(make('summary', null, 'Orientación y experiencias AR'), get('reviewTools'), get('overviewArHint'));
  view.append(guide);
  const minimap = get('walkMinimap'), mapToggle = make('button', 'minimapToggle');
  mapToggle.type = 'button'; mapToggle.setAttribute('aria-controls', 'miniMapImage miniMapFull');
  minimap.prepend(mapToggle);
  let mapExpanded = (windowRef?.innerHeight ?? 800) > 500 && (windowRef?.innerWidth ?? 1000) > 350, placesOpen = false;
  let rectangles = [], measuredAt = -Infinity;
  function setMapExpanded(open) {
    mapExpanded = open;
    minimap.classList.toggle('minimap-collapsed', !open);
    mapToggle.setAttribute('aria-expanded', String(open));
    mapToggle.textContent = open ? 'Mapa local ▾' : 'Mapa local ▸';
    get('miniMapImage').hidden = get('miniMapFull').hidden = !open;
    measuredAt = -Infinity;
  }
  function setPlaces(open, { focus = false } = {}) {
    placesOpen = open; panel.hidden = !open;
    view.classList.toggle('zones-open', open);
    places.setAttribute('aria-expanded', String(open));
    places.textContent = open ? 'Lugares ▴' : 'Lugares ▾';
    if (open) { guide.open = false; get('helpPanel').hidden = true; }
    onInteract(); measure();
    if (focus) (open ? close : places).focus({ preventScroll: true });
  }
  function measure() {
    const bounds = view.getBoundingClientRect(), hudBounds = hud.getBoundingClientRect();
    const bottom = Math.max(0, hudBounds.bottom - bounds.top);
    if (bottom) view.style.setProperty('--venue-hud-bottom', `${Math.ceil(bottom)}px`);
    const mapBounds = minimap.getBoundingClientRect();
    view.style.setProperty('--venue-map-height', `${Math.ceil(mapBounds.height)}px`);
    rectangles = [hud, panel, guide, get('helpPanel'), get('nearPassport'), get('nearActivation'), get('kickFootball'), get('guidedTourStatus'), get('guidedTourReset'), get('paltaNearButton')]
      .filter(element => element && !element.hidden)
      .map(element => element.getBoundingClientRect())
      .filter(rect => rect.width > 0 && rect.height > 0)
      .map(rect => ({ left: rect.left - bounds.left, top: rect.top - bounds.top,
        right: rect.right - bounds.left, bottom: rect.bottom - bounds.top }));
    measuredAt = windowRef?.performance?.now() ?? Date.now();
    return rectangles;
  }
  function closePanels() {
    if (placesOpen) { setPlaces(false, { focus: true }); return true; }
    if (guide.open) { guide.open = false; onInteract(); measure(); return true; }
    return false;
  }
  places.addEventListener('click', () => setPlaces(!placesOpen));
  close.addEventListener('click', () => setPlaces(false, { focus: true }));
  mapToggle.addEventListener('click', () => { setMapExpanded(!mapExpanded); onInteract(); });
  guide.addEventListener('toggle', () => {
    if (guide.open && placesOpen) setPlaces(false);
    onInteract(); measure();
  });
  function unavailable() {
    view.classList.add('venue-unavailable'); places.disabled = true;
    setPlaces(false); guide.open = false;
  }
  function available() {
    view.classList.remove('venue-unavailable'); places.disabled = false; measure();
  }
  documentRef.addEventListener('one16-failed', unavailable);
  documentRef.addEventListener('one16-ready', available);
  panel.addEventListener('toggle', measure, true);
  get('help').addEventListener('click', () => { if (placesOpen) setPlaces(false); guide.open = false; measure(); });
  const observer = windowRef?.ResizeObserver ? new windowRef.ResizeObserver(measure) : null;
  observer?.observe(hud); observer?.observe(panel); observer?.observe(guide);
  let shortViewport = (windowRef?.innerHeight ?? 800) <= 500;
  function resize() {
    const short = (windowRef?.innerHeight ?? 800) <= 500;
    if (short && !shortViewport) setMapExpanded(false);
    shortViewport = short; measure();
  }
  windowRef?.addEventListener('resize', resize);
  setMapExpanded(mapExpanded); setPlaces(false);
  return {
    closePanels,
    get blocksNavigation() { return placesOpen || guide.open; },
    setMode(mode) { setPlaces(false, { focus: placesOpen }); guide.open = false; guide.hidden = mode !== 'overview'; measure(); },
    markerRects() {
      const now = windowRef?.performance?.now() ?? Date.now();
      return now - measuredAt > 160 ? measure() : rectangles;
    },
    refresh: measure,
    dispose() { observer?.disconnect(); windowRef?.removeEventListener('resize', resize); documentRef.removeEventListener('one16-failed', unavailable); documentRef.removeEventListener('one16-ready', available); },
  };
}

export const VENUE_RENDER_QUALITY = Object.freeze({ exposure: 1, hemisphere: 1.7, sun: 2.3, fill: .8 });
export function tuneVenueTextures(model, { mobile = false } = {}) {
  const maximum = mobile ? 2 : 4, seen = new Set();
  model.traverse(object => {
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      for (const texture of Object.values(material)) if (texture?.isTexture && !seen.has(texture)) {
        seen.add(texture); texture.anisotropy = maximum;
      }
    }
  });
}
/** A slow six-percent light variation; reduced motion keeps the original intensity. */
export function createArcadeLighting(model, { reducedMotion = { matches: false } } = {}) {
  const materials = new Map();
  model.traverse(object => {
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material?.name?.startsWith('Arcade LED') && Number.isFinite(material.emissiveIntensity))
        materials.set(material, material.emissiveIntensity);
    }
  });
  let elapsed = 0;
  return {
    update(dt) {
      elapsed += Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), .05);
      let index = 0;
      for (const [material, base] of materials)
        material.emissiveIntensity = reducedMotion.matches ? base : base * (1 + .06 * Math.sin(elapsed * .8 + index++ * .6));
    },
    dispose() { for (const [material, base] of materials) material.emissiveIntensity = base; },
  };
}
