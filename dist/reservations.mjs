import { createReservationsApi, errorMessage, ReservationError } from './reservations-api.mjs';
import { createReservationsWallet } from './reservations-wallet.mjs';
import { ACTIVE_ATTEMPTS, HEX_ID, clone, editableProject, draftChanged, projectPayload, validateProposal, applyProposal, removeSpace, pointFromPointer, shortAddress, confirmedReceipt, safeExplorerUrl, attemptCopy } from './reservations-state.mjs';

/** Dependency injection is used by local tests only; production always uses same-origin HTTP and the real wallet. */
export function mountReservations({ documentRef = document, windowRef = window, api = createReservationsApi(), walletFactory = createReservationsWallet } = {}) {
  const $ = id => documentRef.getElementById(id);
  const state = { config: null, session: null, sessionUncertain: false, wallet: null, project: null, draft: null, serverProject: null, proposal: null, offers: [], selectedOffer: null, result: null, preparation: null, token: null, expected: null, unknownPrepare: false, busy: false, epoch: 0, timer: null, expiryTimer: null, controller: new AbortController(), destroyed: false };
  const node = (tag, text, className) => { const element = documentRef.createElement(tag); if (text !== undefined) element.textContent = String(text); if (className) element.className = className; return element; };
  const button = (label, callback, className = 'secondary small-button') => { const element = node('button', label, className); element.type = 'button'; element.addEventListener('click', callback); return element; };
  const status = message => { $('global-status').textContent = message; };
  const showError = message => { $('global-error').textContent = message; $('global-error').hidden = !message; };
  const can = capability => state.config?.capabilities?.[capability] === true;
  const host = () => state.session?.identity?.role === 'host';
  const dirty = () => !!state.project && !!state.draft && draftChanged(state.project, state.draft);
  const hasActive = () => state.unknownPrepare || ACTIVE_ATTEMPTS.has(state.result?.attempt?.state);
  const snapshotPublished = () => !!state.project?.approvedSnapshot && (state.offers.some(offer => offer.snapshot.id === state.project.approvedSnapshot.id) || state.result?.attempt?.operation === 'publish' && state.result.attempt.snapshotId === state.project.approvedSnapshot.id && !!confirmedReceipt(state.result, state.session?.identity));
  const clearPoll = () => { clearTimeout(state.timer); state.timer = null; };
  function clearPrivate() {
    state.epoch++; state.controller.abort(); state.controller = new AbortController();
    clearPoll(); clearTimeout(state.expiryTimer);
    Object.assign(state, { session: null, sessionUncertain: false, wallet: null, project: null, draft: null, serverProject: null, proposal: null, selectedOffer: null, result: null, preparation: null, token: null, expected: null, unknownPrepare: false, reviewMediaReady: false, approvedMediaReady: false, reserveMediaReady: false });
    $('mi-espacio').hidden = true; $('host-link').hidden = true; $('reserve-review').hidden = true; $('attempt-section').hidden = true;
    $('project-title').value = ''; $('project-context').value = ''; $('assistant-message').value = ''; $('map-file').value = '';
    $('map-image').removeAttribute('src');
    for (const id of ['spaces-list', 'points-list', 'map-markers', 'map-space', 'review-space', 'conversation', 'proposal', 'approved-preview', 'review-preview', 'reserve-content', 'attempt-content', 'conflict-comparison']) $(id).replaceChildren();
    $('project-workspace').hidden = true;
    for (const id of ['approve-consent', 'reserve-consent', 'media-rights']) $(id).checked = false;
    $('authenticate').hidden = true; renderSession(); renderActions();
  }
  async function request(path, options = {}) {
    const epoch = state.epoch;
    try {
      const result = await api.request(path, { ...options, signal: state.controller.signal });
      if (state.destroyed || epoch !== state.epoch) throw new ReservationError('STALE_RESPONSE');
      return result;
    } catch (error) {
      if (epoch !== state.epoch || state.destroyed) throw new ReservationError('STALE_RESPONSE');
      if (error.status === 401 && state.session) clearPrivate();
      throw error;
    }
  }
  async function run(message, operation) {
    if (state.busy || state.destroyed) return;
    state.busy = true; showError(''); status(message); renderActions();
    try { await operation(); }
    catch (error) { if (error.code !== 'STALE_RESPONSE') showError(errorMessage(error)); }
    finally { state.busy = false; renderActions(); }
  }
  function validation(message) { showError(message); }
  function renderSession() {
    const identity = state.session?.identity;
    $('logout').hidden = !identity;
    $('retry-session').hidden = !state.sessionUncertain;
    $('session-label').textContent = state.sessionUncertain ? 'Consulta de sesión pendiente' : identity ? `Sesión de ${identity.role === 'host' ? 'anfitrión' : 'marca'} · ${shortAddress(identity.address)}` : 'Conecta una wallet existente';
    $('session-detail').textContent = state.sessionUncertain ? 'No pudimos comprobar tu acceso. Vuelve a consultar antes de conectar o firmar; no se ha cerrado tu sesión ni reiniciado un intento.' : identity ? identity.address : 'Usaremos tu passkey para identificarte. No se solicitará USDC ni se creará una wallet aquí.';
    $('connect').textContent = identity ? state.wallet?.address === identity.address ? 'Cambiar wallet' : 'Conectar passkey para firmar' : 'Conectar mi wallet';
    $('mi-espacio').hidden = !host(); $('host-link').hidden = !host();
  }
  function renderActions() {
    const busy = state.busy || state.sessionUncertain;
    $('connect').disabled = busy || !can('authentication');
    $('authenticate').disabled = busy || !can('authentication');
    $('refresh-offers').disabled = state.busy;
    $('retry-session').disabled = state.busy;
    $('reload-project').disabled = busy || !host() || !can('reading');
    $('save-project').disabled = busy || !host() || !can('project') || !dirty();
    $('add-space').disabled = busy || !can('project') || (state.draft?.spaces.length || 0) >= 20;
    $('upload-map').disabled = busy || !can('media');
    $('add-point').disabled = busy || !can('project') || !state.draft?.map || !$('map-space').value;
    $('ask-assistant').disabled = busy || !can('conversation') || dirty() || !state.project?.title;
    $('assistant-capability').textContent = !can('conversation') ? 'El asistente no está disponible ahora. Puedes completar el proyecto manualmente.' : dirty() ? 'Guarda tus cambios antes de solicitar una propuesta.' : 'Límite del piloto: 30 mensajes por día. Una propuesta sólo se aplica si tú lo decides.';
    $('approve-project').disabled = busy || !can('project') || dirty() || !$('approve-consent').checked || !$('review-space').value || !state.reviewMediaReady;
    $('prepare-publish').disabled = busy || !can('publication') || dirty() || !state.project?.approvedSnapshot || !host() || hasActive() || snapshotPublished() || !state.approvedMediaReady;
    $('publication-capability').textContent = snapshotPublished() ? 'Esta versión ya está publicada. Puedes consultarla en el catálogo.' : !can('publication') ? 'Nuevas publicaciones de prueba pausadas. Puedes consultar tus intentos y recibos.' : dirty() ? 'Guarda y aprueba la versión actual antes de publicar.' : hasActive() ? 'Consulta el intento pendiente antes de preparar otra operación.' : 'La preparación muestra la operación; la firma requiere otra acción explícita.';
    $('prepare-reserve').disabled = busy || !can('reservation') || state.session?.identity?.role !== 'brand' || state.session.identity.mayReserve !== true || !$('reserve-consent').checked || !state.selectedOffer || hasActive() || !state.reserveMediaReady;
    $('check-attempt').disabled = state.busy;
    const capability = state.result?.attempt?.operation === 'publish' ? 'publication' : 'reservation';
    const reserveAllowed = state.result?.attempt?.operation !== 'reserve' || state.session?.identity?.mayReserve === true;
    $('sign-attempt').disabled = busy || !can(capability) || !reserveAllowed || !state.token || state.result?.attempt?.state !== 'PREPARED' || !state.attemptMediaReady;
    $('recover-attempt').disabled = busy || !can(capability) || !reserveAllowed;
    $('save-state').textContent = dirty() ? 'Cambios sin guardar' : state.project ? `Guardado · revisión ${state.project.revision}` : 'Sin proyecto cargado';
    for (const input of $('project-form').querySelectorAll('input,textarea,select')) input.disabled = busy || !can('project');
    for (const control of $('spaces-list').querySelectorAll('button')) control.disabled = busy || !can('project');
    for (const control of $('points-list').querySelectorAll('button,input')) control.disabled = busy || !can('project');
    if (state.sessionUncertain) for (const control of $('offers-list').querySelectorAll('button')) control.disabled = true;
  }
  function renderCapabilities() {
    const items = [];
    if (!can('authentication')) items.push('La identificación por passkey no está habilitada ahora.');
    if (state.config?.mode === 'CONTROLLED') items.push('Piloto controlado: las reservas nuevas están disponibles sólo para las cuentas habilitadas.');
    if (!can('publication')) items.push('Nuevas publicaciones pausadas.');
    if (!can('reservation')) items.push('Nuevas reservas pausadas. Los intentos y recibos existentes se consultan desde tu sesión.');
    $('capabilities').replaceChildren(...items.map(text => node('p', text)));
    $('capabilities').hidden = !items.length;
  }
  function details(fields) {
    const element = node('details', undefined, 'snapshot-details'); element.append(node('summary', 'Detalles de la versión'));
    const list = node('dl');
    for (const [label, value] of fields) { list.append(node('dt', label), node('dd', value || 'No disponible')); }
    element.append(list); return element;
  }
  function snapshotNode(snapshot, offerId = null, mediaKey = null) {
    const element = node('div', undefined, 'snapshot');
    if (mediaKey) state[mediaKey] = !snapshot?.map;
    if (!snapshot?.space) { element.append(node('p', 'La versión no pudo verificarse.')); return element; }
    element.append(node('h4', snapshot.title), node('p', snapshot.context || 'Sin contexto adicional.'), node('strong', snapshot.space.name), node('p', snapshot.space.purpose || 'Sin propósito adicional.'));
    if (HEX_ID.test(snapshot.map?.mediaId || '')) {
      const map = node('div', undefined, 'map-canvas'), image = node('img');
      image.alt = 'Imagen completa de la versión revisada';
      image.src = offerId ? `/api/reservations/offers/${offerId}/media` : `/api/reservations/media/${snapshot.map.mediaId}`;
      image.addEventListener('load', () => { if (mediaKey && image.isConnected) { state[mediaKey] = true; renderActions(); } }, { once: true });
      image.addEventListener('error', () => { image.hidden = true; map.append(node('p', 'No pudimos cargar la imagen. Actualiza la página para revisarla antes de continuar.', 'notice')); if (mediaKey && image.isConnected) { state[mediaKey] = false; renderActions(); } }, { once: true });
      const markers = node('div', undefined, 'map-markers');
      for (const point of snapshot.map.points || []) {
        if (point.spaceId !== snapshot.spaceId || ![point.x, point.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) continue;
        const marker = node('span', '1', 'map-point'); marker.style.left = point.x * 100 + '%'; marker.style.top = point.y * 100 + '%'; marker.setAttribute('aria-label', `Ubicación de ${snapshot.space.name}`); markers.append(marker);
      }
      map.append(image, markers); element.append(map);
    }
    if (snapshot.id) element.append(details([['Versión', snapshot.id], ['Proyecto', snapshot.projectId], ['Espacio', snapshot.spaceId], ['Revisión', snapshot.revision], ['Huella del contenido', snapshot.contentHash]]));
    return element;
  }
  async function refreshOffers() {
    try {
      const result = await request('/offers');
      if (!Array.isArray(result.offers)) throw new ReservationError('INVALID_RESPONSE');
      state.offers = result.offers.filter(offer => HEX_ID.test(offer.id || '') && offer.snapshot?.space);
      $('offers-list').replaceChildren();
      if (!state.offers.length) $('offers-list').append(node('p', 'Todavía no hay ofertas publicadas.', 'notice'));
      for (const offer of state.offers) {
        const card = node('article', undefined, 'offer-card');
        const label = offer.state === 'AVAILABLE' ? 'Disponible en Testnet' : offer.state === 'RESERVED' ? offer.holder === state.session?.identity?.address ? 'Reservada por tu cuenta' : 'Esta oferta ya está reservada' : 'Estado pendiente de comprobar';
        card.append(node('span', label, 'pill ' + (offer.state === 'RESERVED' ? 'reserved' : offer.state !== 'AVAILABLE' ? 'uncertain' : '')), snapshotNode(offer.snapshot, offer.id));
        if (offer.state === 'AVAILABLE') {
          const action = button(state.session ? 'Revisar reserva' : 'Conectar para reservar', () => state.session ? run('Consultando la oferta…', () => reviewOffer(offer.id)) : run('Conectando tu wallet…', connect));
          action.disabled = state.sessionUncertain || !can('reservation') || !!state.session && (state.session.identity.role !== 'brand' || state.session.identity.mayReserve !== true);
          card.append(action);
          if (!can('reservation')) card.append(node('p', 'Nuevas reservas pausadas.', 'small muted'));
          if (host()) card.append(node('p', 'Las reservas requieren una sesión de marca.', 'small muted'));
          if (state.session?.identity.role === 'brand' && state.session.identity.mayReserve !== true) card.append(node('p', 'Esta cuenta no está habilitada para reservas nuevas. Puedes consultar tus intentos anteriores.', 'small muted'));
        }
        if (offer.holder) card.append(node('p', 'Titular: ' + shortAddress(offer.holder), 'small muted'));
        $('offers-list').append(card);
      }
    } catch (error) {
      if (error.code === 'STALE_RESPONSE') throw error;
      state.offers = []; state.selectedOffer = null; $('reserve-review').hidden = true;
      $('offers-list').replaceChildren(node('p', 'No pudimos consultar las ofertas. Usa «Actualizar catálogo» para volver a intentarlo.', 'notice'));
    }
    renderApproved(); renderActions();
  }
  function acceptSession(session) {
    if (!session?.identity || !/^C[A-Z2-7]{55}$/.test(session.identity.address || '') || !['host', 'brand'].includes(session.identity.role)) throw new ReservationError('INVALID_RESPONSE');
    if (state.session && (state.session.identity.address !== session.identity.address || state.session.identity.role !== session.identity.role)) clearPrivate();
    state.session = session; state.sessionUncertain = false; clearTimeout(state.expiryTimer);
    if (session.expiresAt) {
      const remaining = Date.parse(session.expiresAt) - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) { clearPrivate(); throw new ReservationError('SESSION_EXPIRED', 401); }
      state.expiryTimer = setTimeout(() => { clearPrivate(); status('Tu sesión terminó. Vuelve a identificarte para continuar.'); }, Math.min(remaining, 2147483647));
    }
    renderSession();
  }
  async function restoreSession() {
    try { const session = await request('/auth/session'); acceptSession(session); return session; }
    catch (error) {
      if (error.status === 401) { clearPrivate(); return null; }
      if (error.code !== 'STALE_RESPONSE') {
        state.sessionUncertain = true; state.token = null; state.preparation = null; clearPoll();
        renderSession(); renderAttempt(); renderActions();
        status('La consulta de sesión está pendiente. Reintenta la consulta para recuperar tu operación.');
      }
      throw error;
    }
  }
  async function restorePrivate({ preserveDraft = false } = {}) {
    if (host() && can('reading')) await loadProject({ preserveDraft });
    if (state.session?.pendingAttempt) {
      const pending = state.session.pendingAttempt;
      if (HEX_ID.test(pending.id || '')) { state.result = { attempt: { ...pending, actorAddress: state.session.identity.address }, receipt: null }; state.unknownPrepare = false; renderAttempt(); await reconcile(); }
    }
  }
  async function restoreAccess({ preserveDraft = false } = {}) {
    const session = await restoreSession();
    if (!session) return;
    await restorePrivate({ preserveDraft });
    const attemptId = new URL(windowRef.location.href).searchParams.get('intento');
    if (!state.result && HEX_ID.test(attemptId || '')) { state.result = await request('/attempts/' + attemptId); renderAttempt(); }
  }
  async function retrySession() {
    await restoreAccess({ preserveDraft: true }); await refreshOffers();
    if (!state.session) status('No hay una sesión activa. Conecta tu wallet para identificarte.');
    else if (!state.result) status('Sesión comprobada. Puedes continuar con los datos guardados.');
    else renderAttempt();
  }
  async function connect() {
    if (state.sessionUncertain || !can('authentication')) return;
    // Do not retain one account's project while selecting another identity.
    const previousAddress = state.session?.identity?.address;
    const factoryEpoch = state.epoch;
    const wallet = await walletFactory(state.config, { api: { request }, browser: windowRef });
    if (factoryEpoch !== state.epoch) return;
    const connection = await wallet.connect();
    if (factoryEpoch !== state.epoch) return;
    if (previousAddress && previousAddress !== connection.address) {
      clearPrivate();
      await request('/auth/logout', { method: 'POST', body: {} });
    }
    state.wallet = wallet;
    if (state.session?.identity.address === connection.address) { status('La passkey corresponde a tu sesión. Puedes revisar una operación para firmar.'); renderSession(); return; }
    await wallet.prepareAuthentication();
    $('authenticate').hidden = false;
    status('Wallet conectada. Pulsa «Verificar acceso» para autorizar tu sesión de reservas.');
  }
  async function authenticate() {
    if (state.sessionUncertain) return;
    const epoch = state.epoch, wallet = state.wallet;
    const session = await wallet.authenticate();
    if (epoch !== state.epoch) return;
    acceptSession(session); $('authenticate').hidden = true;
    await restorePrivate(); await refreshOffers(); if (!state.result) status('Acceso verificado. Tu wallet se conserva sin solicitar fondos.');
  }
  async function logout() {
    clearPrivate(); state.busy = false; renderActions(); status('Cerrando la sesión de reservas…');
    try { await request('/auth/logout', { method: 'POST', body: {} }); status('Sesión de reservas cerrada. Tu passkey de ONE16 se conserva.'); }
    catch (error) { if (error.code !== 'STALE_RESPONSE') showError('No pudimos confirmar el cierre en el servidor. Reintenta el cierre.'); $('logout').hidden = false; }
    await refreshOffers();
  }
  function setProject(project) {
    if (!project || !HEX_ID.test(project.id || '') || !Number.isSafeInteger(project.revision) || !Array.isArray(project.spaces)) throw new ReservationError('INVALID_RESPONSE');
    state.project = clone(project); state.draft = editableProject(project); state.serverProject = null; state.proposal = null;
    if (state.token && state.expected?.operation === 'publish' && state.expected.snapshot.id !== project.approvedSnapshot?.id) { state.token = null; state.preparation = null; renderAttempt(); }
    $('project-loading').hidden = true; $('project-workspace').hidden = false; $('project-conflict').hidden = true;
    $('project-title').value = state.draft.title; $('project-context').value = state.draft.context;
    $('approve-consent').checked = false; $('proposal').hidden = true;
    renderSpaces(); renderMap(); renderConversation(); renderReview(); renderApproved(); renderActions();
  }
  async function loadProject({ preserveDraft = false } = {}) {
    if (!host()) return;
    const result = await request('/project');
    if (preserveDraft && dirty()) {
      state.serverProject = result.project;
      $('conflict-comparison').replaceChildren();
      for (const [label, value] of [['Tus cambios locales', state.draft], ['Versión guardada', editableProject(result.project)]]) {
        const section = node('div'); section.append(node('h4', label), node('pre', JSON.stringify(value, null, 2))); $('conflict-comparison').append(section);
      }
      $('project-conflict').hidden = false; status('Compara las versiones. Tus cambios locales siguen en esta pestaña.');
    } else setProject(result.project);
  }
  function draftEdited() {
    $('approve-consent').checked = false;
    if (state.token && state.expected?.operation === 'publish' && dirty()) { state.token = null; state.preparation = null; renderAttempt(); status('Tu borrador cambió. Consulta el intento y revisa su versión antes de firmar.'); }
    if (dirty()) $('review-preview').replaceChildren(node('p', 'Guarda tus cambios antes de revisar y aprobar esta versión.', 'notice'));
    else renderReview();
    renderActions();
  }
  function renderSpaces() {
    $('spaces-list').replaceChildren(); $('space-count').textContent = `${state.draft.spaces.length} de 20 espacios`;
    state.draft.spaces.forEach((space, index) => {
      const row = node('div', undefined, 'space-row');
      for (const [key, label, max] of [['name', 'Nombre', 80], ['purpose', 'Propósito', 500]]) {
        const group = node('div'), control = node(key === 'purpose' ? 'textarea' : 'input'), id = `space-${index}-${key}`;
        control.id = id; control.value = space[key]; control.maxLength = max; if (key === 'purpose') control.rows = 1;
        const lab = node('label', `${label} del espacio ${index + 1}`); lab.htmlFor = id;
        control.addEventListener('input', () => { state.draft.spaces[index][key] = control.value; draftEdited(); }); group.append(lab, control); row.append(group);
      }
      row.append(button('Quitar espacio', () => {
        const hasPoint = state.draft.map?.points.some(point => point.spaceId === space.id);
        if (hasPoint && !windowRef.confirm('Quitar este espacio también elimina su punto del mapa. Los cambios se aplican al guardar.')) return;
        state.draft = removeSpace(state.draft, index); renderSpaces(); renderMap(); draftEdited();
      }));
      if (!space.id) row.append(node('p', 'Espacio nuevo: guarda para poder ubicarlo en el mapa.', 'new-space'));
      $('spaces-list').append(row);
    });
  }
  function fillSpaces(select, { savedOnly = false } = {}) {
    const previous = select.value; select.replaceChildren(node('option', 'Elige un espacio')); select.firstChild.value = '';
    for (const space of state.draft?.spaces || []) {
      if (!space.id && savedOnly) continue;
      const option = node('option', space.name || 'Espacio sin nombre'); option.value = space.id || ''; option.disabled = !space.id; select.append(option);
    }
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
  }
  function renderMap() {
    const map = state.draft?.map; $('map-editor').hidden = !map;
    fillSpaces($('map-space'), { savedOnly: true });
    if (!map) { $('map-image').removeAttribute('src'); $('map-markers').replaceChildren(); $('points-list').replaceChildren(); return; }
    $('map-image').src = '/api/reservations/media/' + map.mediaId;
    renderPoints();
  }
  function renderMarkers() {
    $('map-markers').replaceChildren();
    (state.draft?.map?.points || []).forEach((point, index) => {
      const space = state.draft.spaces.find(space => space.id === point.spaceId);
      const marker = button(String(index + 1), event => { event.stopPropagation(); $('map-space').value = point.spaceId; renderMarkers(); }, 'map-point');
      marker.setAttribute('aria-label', 'Ubicación de ' + (space?.name || 'espacio'));
      marker.setAttribute('aria-pressed', String($('map-space').value === point.spaceId));
      marker.style.left = point.x * 100 + '%'; marker.style.top = point.y * 100 + '%'; $('map-markers').append(marker);
    });
  }
  function renderPoints() {
    $('points-list').replaceChildren(); renderMarkers();
    (state.draft.map?.points || []).forEach((point, index) => {
      const space = state.draft.spaces.find(space => space.id === point.spaceId), row = node('div', undefined, 'point-row');
      row.append(node('span', `${index + 1}. ${space?.name || 'Espacio'}`, 'point-name'));
      for (const [axis, label] of [['x', 'Horizontal (%)'], ['y', 'Vertical (%)']]) {
        const group = node('div'), lab = node('label', label), input = node('input');
        input.type = 'number'; input.min = '0'; input.max = '100'; input.step = '0.1'; input.value = String(Math.round(point[axis] * 1000) / 10); input.id = `point-${index}-${axis}`; lab.htmlFor = input.id;
        input.addEventListener('change', () => {
          const number = Number(input.value);
          if (input.value === '' || !Number.isFinite(number) || number < 0 || number > 100) { input.value = String(point[axis] * 100); validation('Usa coordenadas entre 0 y 100%.'); return; }
          point[axis] = number / 100; renderMarkers(); draftEdited();
        });
        group.append(lab, input); row.append(group);
      }
      row.append(button('Quitar punto', () => { state.draft.map.points = state.draft.map.points.filter(p => p.spaceId !== point.spaceId); renderPoints(); draftEdited(); })); $('points-list').append(row);
    });
  }
  function placePoint(position) {
    const spaceId = $('map-space').value;
    if (!can('project') || !state.draft?.map || !spaceId || !state.project.spaces.some(space => space.id === spaceId)) { validation('Elige un espacio guardado para ubicarlo.'); return; }
    const existing = state.draft.map.points.find(point => point.spaceId === spaceId);
    if (existing) Object.assign(existing, position); else if (state.draft.map.points.length < 20) state.draft.map.points.push({ spaceId, ...position });
    renderPoints(); draftEdited();
  }
  async function uploadMap() {
    const epoch = state.epoch;
    const file = $('map-file').files?.[0];
    if (!$('media-rights').checked) { validation('Confirma que tienes autorización para usar esta imagen.'); return; }
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { validation('Elige una imagen PNG, JPEG o WebP.'); return; }
    if (!file.size || file.size > 2097152) { validation('La imagen debe pesar como máximo 2 MiB.'); return; }
    let bitmap;
    try { bitmap = await windowRef.createImageBitmap(file); if (bitmap.width > 2048 || bitmap.height > 2048) { validation('La imagen debe tener como máximo 2048 píxeles por lado.'); return; } }
    catch { validation('No pudimos leer la imagen. El mapa anterior se conserva.'); return; }
    finally { bitmap?.close(); }
    if (epoch !== state.epoch || !state.draft) return;
    const result = await request('/media', { method: 'POST', bytes: file, mime: file.type });
    if (!HEX_ID.test(result.media?.id || '') || result.media.width > 2048 || result.media.height > 2048) throw new ReservationError('INVALID_RESPONSE');
    state.draft.map = { mediaId: result.media.id, points: [] }; $('map-file').value = ''; $('media-rights').checked = false;
    renderMap(); draftEdited(); status('Imagen cargada. Ubica los espacios sobre ella y guarda los cambios.');
  }
  async function saveProject(draft = state.draft) {
    let payload;
    try { payload = projectPayload(state.project, draft); } catch (error) { validation(error.message); return false; }
    try {
      const result = await request('/project', { method: 'PUT', body: payload });
      const project = result.project;
      if (!project) throw new ReservationError('INVALID_RESPONSE');
      setProject({ ...project, conversation: project.conversation || state.project.conversation, approvedSnapshot: project.approvedSnapshot || null });
      status('Cambios guardados.'); return true;
    } catch (error) {
      if (error.status === 409 || error.code === 'NETWORK_UNCERTAIN') { await loadProject({ preserveDraft: true }); }
      throw error;
    }
  }
  function renderConversation() {
    $('conversation').replaceChildren();
    for (const message of state.project?.conversation || []) {
      const item = node('div', undefined, 'message'); item.append(node('strong', message.role === 'user' ? 'TÚ' : 'ASISTENTE'));
      if (message.role === 'assistant' && message.content && typeof message.content === 'object') {
        try {
          const proposal = validateProposal(message.content);
          item.append(node('p', proposal.summary), node('p', 'Título: ' + proposal.title), node('p', proposal.context));
          const spaces = node('ul'); proposal.spaces.forEach(space => spaces.append(node('li', `${space.name}: ${space.purpose}`))); item.append(spaces);
          item.append(button('Revisar propuesta del historial', () => { state.proposal = proposal; renderProposal(); status('Propuesta recuperada para revisión. No se han aplicado cambios.'); }));
        } catch { item.append(node('span', 'Esta propuesta guardada no tiene un formato válido. El proyecto se conserva.')); }
      } else item.append(node('span', typeof message.content === 'string' ? message.content : 'Mensaje guardado no disponible.'));
      $('conversation').append(item);
    }
  }
  async function askAssistant() {
    const message = $('assistant-message').value.trim(); if (!message) { validation('Escribe un mensaje para solicitar una propuesta.'); return; }
    const result = await request('/conversation', { method: 'POST', body: { message, expectedRevision: state.project.revision } });
    try { state.proposal = validateProposal(result.proposal); } catch { validation('La propuesta no tiene un formato válido. Tu proyecto se conserva.'); return; }
    const fresh = await request('/project');
    state.project.conversation = fresh.project.conversation; renderConversation();
    $('assistant-message').value = ''; renderProposal(); status('Propuesta recibida. Revisa sus cambios antes de aplicarla.');
  }
  function renderProposal() {
    const box = $('proposal'); box.replaceChildren(); box.hidden = !state.proposal; if (!state.proposal) return;
    const proposal = state.proposal;
    box.append(node('h4', 'Propuesta pendiente de tu decisión'), node('p', proposal.summary), node('p', 'Título: ' + proposal.title), node('p', proposal.context));
    const list = node('ol'); proposal.spaces.forEach(space => list.append(node('li', `${space.name}: ${space.purpose}`))); box.append(list);
    box.append(node('p', `Al aplicar se reemplazan los ${state.draft.spaces.length} espacios actuales y se eliminan sus puntos. La imagen se conserva. Tendrás que ubicar y revisar los espacios nuevos.`, 'small'));
    const consent = node('label', undefined, 'check'), check = node('input'); check.type = 'checkbox'; consent.append(check, node('span', 'Revisé los reemplazos y quiero guardar esta propuesta.')); box.append(consent);
    const actions = node('div', undefined, 'actions');
    const apply = button('Aplicar y guardar propuesta', () => run('Guardando la propuesta aprobada…', async () => { if (state.sessionUncertain || !check.checked || dirty()) return; await saveProject(applyProposal(state.draft, proposal)); })); apply.disabled = true;
    check.addEventListener('change', () => { apply.disabled = !check.checked || dirty() || state.busy || state.sessionUncertain || !can('project'); });
    actions.append(apply, button('Descartar propuesta', () => { state.proposal = null; renderProposal(); status('Propuesta descartada. El proyecto guardado se conserva.'); })); box.append(actions);
  }
  function renderReview() {
    fillSpaces($('review-space'), { savedOnly: true });
    const space = state.draft?.spaces.find(space => space.id === $('review-space').value);
    const box = $('review-preview'); box.replaceChildren();
    if (dirty()) box.append(node('p', 'Guarda tus cambios antes de aprobar esta versión.', 'notice'));
    if (space) box.append(snapshotNode({ title: state.draft.title, context: state.draft.context, space, spaceId: space.id, map: state.draft.map ? { ...state.draft.map, points: state.draft.map.points.filter(point => point.spaceId === space.id) } : null }, null, 'reviewMediaReady'));
    else box.append(node('p', 'Elige un espacio guardado y revisa su posición.', 'muted'));
  }
  function renderApproved() {
    $('approved-preview').replaceChildren();
    const snapshot = state.project?.approvedSnapshot;
    if (!snapshot) { $('approved-preview').append(node('p', 'Todavía no hay una versión aprobada.')); return; }
    $('approved-preview').append(node('p', snapshotPublished() ? 'Versión aprobada · publicada' : 'Versión aprobada · pendiente de publicación', 'pill'), snapshotNode(snapshot, null, 'approvedMediaReady'));
  }
  async function approve() {
    if (dirty() || !$('approve-consent').checked) return;
    const result = await request('/approval', { method: 'POST', body: { expectedRevision: state.project.revision, spaceId: $('review-space').value } });
    if (!HEX_ID.test(result.snapshot?.id || '') || result.snapshot.projectId !== state.project.id || result.snapshot.revision !== state.project.revision) throw new ReservationError('INVALID_RESPONSE');
    state.project.approvedSnapshot = result.snapshot; state.project.approvedSnapshotId = result.snapshot.id; state.project.editorialState = 'APPROVED'; $('approve-consent').checked = false; renderApproved(); status('Versión aprobada y guardada. Todavía no está publicada.');
  }
  async function reviewOffer(id) {
    const result = await request('/offers/' + id), offer = result.offer;
    if (offer?.id !== id || offer.state !== 'AVAILABLE') { validation('La oferta ya no está disponible o su estado no pudo confirmarse.'); await refreshOffers(); return; }
    state.selectedOffer = offer; $('reserve-consent').checked = false; $('reserve-content').replaceChildren(snapshotNode(offer.snapshot, offer.id, 'reserveMediaReady'), node('p', 'Reservarás el identificador de esta oferta de prueba. No se transfiere USDC. Esta versión no admite cancelar ni cambiar el titular.'), node('p', 'Cuenta que autoriza: ' + state.session.identity.address, 'small'));
    $('reserve-review').hidden = false; $('reserve-review').scrollIntoView({ block: 'start' }); status('Revisa la versión antes de preparar la reserva.');
  }
  async function prepare(operation, { recovered = false } = {}) {
    const snapshot = operation === 'publish' ? state.project?.approvedSnapshot : state.selectedOffer?.snapshot;
    const offerId = operation === 'reserve' ? state.selectedOffer?.id : undefined;
    if (state.sessionUncertain || !snapshot || !state.session || !can(operation === 'publish' ? 'publication' : 'reservation')) return;
    if (operation === 'reserve' && state.session.identity.mayReserve !== true) return;
    if (state.wallet?.address !== state.session.identity.address) { validation('Conecta la passkey de tu sesión antes de preparar una firma.'); return; }
    if (hasActive() && !recovered) { validation('Consulta el intento pendiente antes de iniciar otra operación.'); return; }
    const expected = { operation, actorAddress: state.session.identity.address, snapshot: clone(snapshot), ...(offerId ? { offerId } : {}) };
    state.preparation = null; state.token = null; state.expected = expected;
    try {
      const result = await request('/attempts/prepare', { method: 'POST', body: operation === 'publish' ? { operation, snapshotId: snapshot.id } : { operation, offerId } });
      state.result = result; state.unknownPrepare = false;
      if (result.attempt?.state === 'PREPARED' && result.signing) {
        state.token = state.wallet.prepare(result, expected); state.preparation = result;
      }
      renderAttempt(); status(state.token ? 'Preparación lista. Revisa el resumen y pulsa firmar cuando decidas autorizarla.' : 'Consulta el estado del intento antes de continuar.');
    } catch (error) {
      if (error.code === 'NETWORK_UNCERTAIN' || error.code === 'INVALID_RESPONSE') { state.unknownPrepare = true; renderAttempt(); }
      throw error;
    }
  }
  function renderAttempt() {
    state.attemptMediaReady = false;
    $('attempt-section').hidden = !state.result && !state.unknownPrepare;
    const box = $('attempt-content'); box.replaceChildren();
    $('sign-attempt').hidden = !state.token; $('recover-attempt').hidden = true;
    if (state.unknownPrepare) { box.append(node('p', 'La preparación pudo guardarse, pero no recibimos confirmación. Consulta el estado para recuperar tu intento; no prepares ni firmes otro.', 'notice')); return; }
    const attempt = state.result?.attempt; if (!attempt) return;
    // An opaque navigation ID is never authority: every restoration is owner-checked by GET.
    if (HEX_ID.test(attempt.id || '')) {
      const url = new URL(windowRef.location.href); url.searchParams.set('intento', attempt.id);
      windowRef.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    const receipt = confirmedReceipt(state.result, state.session?.identity);
    if (receipt) {
      const content = node('div', undefined, 'receipt'); content.append(node('h3', attempt.operation === 'publish' ? 'Publicación confirmada' : 'Reserva confirmada'));
      const dl = node('dl');
      for (const [label, value] of [['Red', 'Stellar Testnet'], ['Oferta', attempt.offerId], ['Cuenta que autorizó', attempt.actorAddress], ['Titular confirmado', receipt.offer.holder || 'Aún sin titular'], ['Ledger', receipt.ledger], ['Transacción', receipt.txHash]]) dl.append(node('dt', label), node('dd', value));
      const link = node('a', 'Consultar transacción en Testnet ↗'); link.href = safeExplorerUrl(receipt); link.target = '_blank'; link.rel = 'noopener noreferrer';
      content.append(dl, link, button('Copiar hash', () => run('Copiando hash…', async () => { try { await windowRef.navigator.clipboard.writeText(receipt.txHash); status('Hash copiado.'); } catch { status('No pudimos copiar. Selecciona el hash visible en el recibo.'); } }))); box.append(content);
    } else {
      box.append(node('p', attempt.state === 'CONFIRMED' ? 'El recibo no pudo verificarse. No se presenta como confirmado.' : attemptCopy(attempt.state), 'notice'));
      if (state.preparation) box.append(snapshotNode(state.expected.snapshot, attempt.operation === 'reserve' ? attempt.offerId : null, 'attemptMediaReady'), node('p', 'Esta operación ' + (attempt.operation === 'publish' ? 'publica la versión aprobada' : 'reserva el identificador de la oferta') + '. No transfiere USDC.'));
      if (attempt.state === 'PREPARED' && !state.token) $('recover-attempt').hidden = false;
    }
    box.append(details([['Intento', attempt.id], ['Operación', attempt.operation === 'publish' ? 'Publicación' : 'Reserva'], ['Oferta', attempt.offerId], ['Cuenta', attempt.actorAddress]]));
    $('sign-attempt').textContent = attempt.operation === 'publish' ? 'Firmar publicación' : 'Firmar reserva';
    status(receipt ? (attempt.operation === 'publish' ? 'Publicación confirmada' : 'Reserva confirmada') + ' en Stellar Testnet.' : attempt.state === 'CONFIRMED' ? 'El recibo no pudo verificarse. Consulta el estado antes de continuar.' : attemptCopy(attempt.state));
    renderActions(); schedulePoll();
  }
  async function signAttempt() {
    const epoch = state.epoch, wallet = state.wallet;
    const token = state.token, id = state.result?.attempt?.id;
    if (state.sessionUncertain || !token || !id) return;
    if (state.result.attempt.operation === 'reserve' && state.session?.identity.mayReserve !== true) return;
    state.token = null; state.preparation = null; renderAttempt();
    let payload;
    try { payload = await wallet.sign(token); }
    catch { if (epoch !== state.epoch) return; status('No se autorizó el envío. Consulta el intento antes de volver a revisarlo.'); await reconcile(); return; }
    if (epoch !== state.epoch || !state.session) return;
    // A consumed token is never reused; submit is invoked at most once by this interaction.
    state.result = { attempt: { ...state.result.attempt, state: 'SUBMITTING' }, receipt: null }; renderAttempt();
    try { state.result = await request('/attempts/' + id + '/submit', { method: 'POST', body: payload }); renderAttempt(); await refreshOffers(); }
    catch (error) {
      if (epoch !== state.epoch) return;
      if (state.result?.attempt) state.result.attempt.state = 'NEEDS_RECONCILIATION'; renderAttempt(); throw error;
    }
  }
  async function reconcile() {
    state.token = null; state.preparation = null;
    if (state.sessionUncertain && !await restoreSession()) return;
    if (state.unknownPrepare || !state.result) {
      const session = await restoreSession();
      if (!session) return;
      if (!session.pendingAttempt) { state.unknownPrepare = true; renderAttempt(); status('No encontramos todavía un intento activo. Vuelve a consultar antes de iniciar otra operación.'); return; }
      state.result = { attempt: { ...session.pendingAttempt, actorAddress: session.identity.address }, receipt: null }; state.unknownPrepare = false;
    }
    const id = state.result?.attempt?.id; if (!HEX_ID.test(id || '')) return;
    state.result = await request('/attempts/' + id); renderAttempt();
    if (state.result.attempt?.state === 'CONFIRMED') await refreshOffers();
  }
  async function recoverPreparation() {
    await reconcile(); const attempt = state.result?.attempt;
    if (attempt?.state !== 'PREPARED') return;
    if (attempt.operation === 'publish') {
      if (!host()) return; await loadProject({ preserveDraft: true });
      if (state.project?.approvedSnapshot?.id !== attempt.snapshotId || dirty()) { validation('La intención usa otra versión. Consulta el intento; no se reconstruirá una firma con tu borrador actual.'); return; }
    } else {
      const result = await request('/offers/' + attempt.offerId); state.selectedOffer = result.offer;
      if (result.offer?.snapshot?.id !== attempt.snapshotId || result.offer.state !== 'AVAILABLE') { validation('La oferta cambió. Conserva el intento para su verificación.'); return; }
    }
    await prepare(attempt.operation, { recovered: true });
  }
  function schedulePoll() {
    clearPoll();
    if (state.destroyed || documentRef.hidden || state.sessionUncertain || !state.session || !['SUBMITTING', 'PENDING'].includes(state.result?.attempt?.state)) return;
    state.timer = setTimeout(async () => { if (state.busy) { schedulePoll(); return; } try { await reconcile(); } catch (error) { if (error.code !== 'STALE_RESPONSE') { clearPoll(); status('La consulta automática se detuvo. Puedes consultar el estado cuando vuelva la conexión.'); } } }, 15000);
  }
  const onVisibility = () => { if (documentRef.hidden) clearPoll(); else if (state.session && state.result && !state.busy) void run('Consultando tu operación…', reconcile); };
  const beforeUnload = event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } };
  const pageHide = () => { clearPrivate(); };
  const pageShow = event => { if (event.persisted) void run('Restaurando tu sesión…', async () => { await restoreAccess(); await refreshOffers(); }); };
  $('retry-session').addEventListener('click', () => run('Volviendo a consultar tu sesión…', retrySession));
  $('connect').addEventListener('click', () => run('Conectando tu wallet…', connect));
  $('authenticate').addEventListener('click', () => run('Verifica tu passkey…', authenticate));
  $('logout').addEventListener('click', logout);
  $('refresh-offers').addEventListener('click', () => run('Consultando ofertas…', async () => { await refreshOffers(); status('Catálogo consultado.'); }));
  $('reload-project').addEventListener('click', () => run('Consultando la versión guardada…', () => loadProject({ preserveDraft: true })));
  $('use-server-project').addEventListener('click', () => { if (state.serverProject && windowRef.confirm('Se descartarán los cambios sin guardar de esta pestaña.')) { setProject(state.serverProject); status('Versión guardada restaurada.'); } });
  $('project-title').addEventListener('input', event => { if (state.draft) { state.draft.title = event.target.value; draftEdited(); } });
  $('project-context').addEventListener('input', event => { if (state.draft) { state.draft.context = event.target.value; draftEdited(); } });
  $('add-space').addEventListener('click', () => { if (state.draft && state.draft.spaces.length < 20) { state.draft.spaces.push({ name: '', purpose: '' }); renderSpaces(); draftEdited(); $(`space-${state.draft.spaces.length - 1}-name`).focus(); } });
  $('project-form').addEventListener('submit', event => { event.preventDefault(); void run('Guardando cambios…', () => saveProject()); });
  $('upload-map').addEventListener('click', () => run('Validando y subiendo imagen…', uploadMap));
  $('add-point').addEventListener('click', () => placePoint({ x: .5, y: .5 }));
  $('map-space').addEventListener('change', () => { renderMarkers(); renderActions(); });
  $('map-image').addEventListener('click', event => placePoint(pointFromPointer(event.clientX, event.clientY, $('map-image').getBoundingClientRect())));
  $('ask-assistant').addEventListener('click', () => run('Solicitando una propuesta…', askAssistant));
  $('review-space').addEventListener('change', () => { $('approve-consent').checked = false; renderReview(); renderActions(); });
  $('approve-consent').addEventListener('change', renderActions);
  $('approve-project').addEventListener('click', () => run('Guardando la versión aprobada…', approve));
  $('prepare-publish').addEventListener('click', () => run('Preparando la publicación…', () => prepare('publish')));
  $('reserve-consent').addEventListener('change', renderActions);
  $('prepare-reserve').addEventListener('click', () => run('Preparando la reserva…', () => prepare('reserve')));
  $('cancel-reserve').addEventListener('click', () => { state.selectedOffer = null; $('reserve-review').hidden = true; });
  $('sign-attempt').addEventListener('click', () => run('Confirma la operación con tu passkey…', signAttempt));
  $('check-attempt').addEventListener('click', () => run('Consultando tu operación…', reconcile));
  $('recover-attempt').addEventListener('click', () => run('Recuperando la misma intención…', recoverPreparation));
  documentRef.addEventListener('visibilitychange', onVisibility); windowRef.addEventListener('beforeunload', beforeUnload); windowRef.addEventListener('pagehide', pageHide); windowRef.addEventListener('pageshow', pageShow);
  const ready = run('Consultando disponibilidad del servicio…', async () => {
    state.config = await request('/config'); renderCapabilities(); renderSession();
    try {
      await restoreAccess();
    } catch (error) { if (error.status !== 401 && error.code !== 'STALE_RESPONSE') showError(errorMessage(error)); }
    await refreshOffers(); if (!state.session && !state.sessionUncertain) status('Revisa el catálogo o conecta tu wallet para identificarte.');
  });
  return { ready, destroy() { state.destroyed = true; clearPrivate(); documentRef.removeEventListener('visibilitychange', onVisibility); windowRef.removeEventListener('beforeunload', beforeUnload); windowRef.removeEventListener('pagehide', pageHide); windowRef.removeEventListener('pageshow', pageShow); } };
}

if (typeof document !== 'undefined' && document.body?.hasAttribute('data-reservations')) mountReservations();
