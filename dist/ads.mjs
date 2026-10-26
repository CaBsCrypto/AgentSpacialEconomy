import { ADS_PLACEMENTS, createAdsPlayer } from './ads-player.mjs';
import { createAdsWallet } from './ads-wallet.mjs';
export const PILOT_PROFILE = 'main-stage-test-5m';
export function configuredPilotOffer(config) {
  if (!config.profile) return null;
  if (config.profile !== PILOT_PROFILE) throw Error('El catálogo de este piloto no está disponible.');
  const offer = config.offers?.find(item => item.id === PILOT_PROFILE);
  if (!offer || config.offers.length !== 1 || config.plans?.length !== 1 || config.plans[0] !== 'PASSES' || config.units?.passMs !== 60000 || offer.offerVersion !== 2 || offer.placementId !== 'main_stage_screen' || offer.plan !== 'PASSES' || offer.units !== 5 || offer.requiredUnits !== 5 || offer.passMs !== 60000 || offer.durationMs !== 300000 || offer.unitAmount !== '10000000' || offer.amountUnits !== '50000000' || offer.designAmount !== '0') throw Error('La oferta no coincide con los 5 USDC de prueba por 5 entregas completas de 1 minuto.');
  return offer;
}
export function advertisementQuotePayload(config, input) {
  const offer = configuredPilotOffer(config);
  if (offer) {
    if (input.placements.length !== 1 || input.placements[0] !== offer.placementId) throw Error('Este piloto vende únicamente la pantalla del main stage.');
    return { campaignId: input.campaignId, offerId: offer.id, startsAt: input.startsAt, endsAt: input.endsAt };
  }
  return { campaignId: input.campaignId, placements: input.placements, plan: input.plan, units: input.units, startsAt: input.startsAt, endsAt: input.endsAt };
}
export function validatePilotQuote(quote, offer) {
  if (!offer) return quote;
  const line = quote?.lines?.[0];
  if (quote?.offerId !== offer.id || quote.offerVersion !== offer.offerVersion || quote.amountUnits !== offer.amountUnits || quote.plan !== offer.plan || quote.units !== offer.units || quote.requiredUnits !== offer.requiredUnits || quote.unit !== 'PASSES' || quote.passMs !== offer.passMs || quote.placements?.length !== 1 || quote.placements[0] !== offer.placementId || quote.lines?.length !== 1 || line.placementId !== offer.placementId || line.plan !== offer.plan || line.units !== offer.units || line.unitAmount !== offer.unitAmount || line.designAmount !== '0' || line.deliveryAmount !== offer.amountUnits || line.amountUnits !== offer.amountUnits || quote.terms?.refundPolicy !== 'FULFILL_REMAINING') throw Error('La cotización no corresponde a 5 entregas completas de 1 minuto por 5 USDC de prueba.');
  return quote;
}
export async function requestPaymentAuthorization({ api, wallet, path, amountUnits, config, idempotencyKey }) {
  const response = await api(path, { method: 'POST', allow402: true, idempotencyKey });
  if (!response.paymentRequired) return response;
  if (!amountUnits) throw Error('Debes recuperar la cotización original antes de autorizar el importe.');
  const paymentPayload = await wallet.signPayment({ challenge: response.paymentRequired, expected: { amountUnits, payTo: config.payTo, asset: config.asset, network: config.network, resourceUrl: '/api/ads' + path } });
  return { paymentPayload };
}
export const ORDER_LABELS = Object.freeze({ DRAFT: 'Brief guardado', PREAUDITED: 'Brief admitido', QUOTED: 'Cotización disponible', RESERVED: 'Capacidad reservada · pago pendiente', PAYMENT_PENDING: 'Verificando el pago', QUEUED: 'Pago confirmado · en cola durable', PROCESSING: 'Generando el anuncio', AUDITING: 'Auditando el creativo final', SCHEDULED: 'Anuncio programado', LIVE: 'Anuncio activo', COMPLETED: 'Obligaciones cerradas', BLOCKED: 'Orden bloqueada · requiere resolución', QUARANTINED: 'Contenido en cuarentena', CANCELLED: 'Orden cancelada', RECONCILIATION_REQUIRED: 'Reconciliando el intento original' });
export function adsConfigPath(search = '') {
  const source = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  const query = new URLSearchParams(); for (const value of source.getAll('placement')) query.append('placement', value);
  return '/config' + (query.size ? '?' + query.toString() : '');
}
export function configuredPlacement(config, requested = false) {
  const selected = config.selectedPlacement;
  if (selected == null && !requested) return null;
  if (!ADS_PLACEMENTS.includes(selected) || !config.placements?.some(item => item.id === selected)) throw Error('La ubicación del enlace no fue validada por el servidor.');
  return selected;
}
export function formatAdsAmount(units) {
  const number = BigInt(units), scale = 10_000_000n;
  return String(number / scale) + (number % scale ? '.' + String(number % scale).padStart(7, '0').replace(/0+$/, '') : '');
}
export function exclusiveUnits(startsAt, endsAt, unitMs) {
  const duration = endsAt - startsAt;
  if (!Number.isSafeInteger(unitMs) || unitMs <= 0 || !Number.isSafeInteger(duration) || duration <= 0 || duration % unitMs !== 0) throw Error('La ventana debe ser un múltiplo exacto de la unidad exclusiva configurada.');
  return duration / unitMs;
}
export function fulfillmentRemaining(order, config = {}) {
  return (order?.quote ? order.quote.terms?.refundPolicy : config.terms?.refundPolicy) === 'FULFILL_REMAINING';
}
export function deliveryProgress(item, quote = {}) {
  if (quote.plan !== 'PASSES' && item.unit !== 'PASSES') return null;
  const required = quote.requiredUnits ?? item.required, completed = item.delivered ?? 0;
  if (!Number.isSafeInteger(required) || required <= 0 || !Number.isSafeInteger(completed) || completed < 0 || completed > required || item.required != null && item.required !== required) return { valid: false };
  return { valid: true, completed, required, owed: required - completed };
}
export function quoteUnitsDescription(quote, config = {}) {
  if (quote.plan === 'TIME') return quote.units + ' unidad(es) de ' + ((quote.timeUnitMs ?? config.units?.timeMs) / 1000) + ' segundos de actividad acumulada.';
  if (quote.plan === 'PASSES') return quote.units + ' entregas completas de ' + ((quote.passMs ?? config.units?.passMs) / 1000) + ' segundos. Una entrega interrumpida no cuenta y sigue pendiente.';
  return 'Ventana exclusiva: ' + new Date(quote.startsAt).toLocaleString() + ' → ' + new Date(quote.endsAt).toLocaleString();
}
export function orderProgress(order) {
  const status = order?.status, queue = order?.queue?.state;
  const paid = order?.payment?.status === 'SETTLED';
  return { payment: paid, queue: paid && ['QUEUED', 'LIVE', 'COMPLETED'].includes(status), processing: ['SCHEDULED', 'LIVE', 'COMPLETED'].includes(status) || queue === 'SCHEDULED', scheduled: ['LIVE', 'COMPLETED'].includes(status) || queue === 'SCHEDULED', delivery: status === 'COMPLETED' && order.placements?.length > 0 && order.placements.every(item => ['FULFILLED', 'CLOSED_WITH_REMEDY'].includes(item.status) && (!fulfillmentRemaining(order) || deliveryProgress(item, order.quote)?.owed === 0)) };
}
export function includedCorrectionEligible(order) {
  const included = order?.quote?.terms?.includedRevisions;
  const disputes = (order?.disputes || []).some(item => (item.status || item.state) === 'OPEN');
  const refunds = (order?.refunds || []).some(item => !['FAILED', 'CANCELLED', 'REJECTED'].includes(item.status || item.state));
  return ['BLOCKED', 'QUARANTINED'].includes(order?.status) && Number.isSafeInteger(included) && included > 0 && !!order.quote?.campaignId && !disputes && !refunds;
}
export async function submitIncludedCorrection({ api, order, brief, logo, keyFor }) {
  if (!includedCorrectionEligible(order)) throw Error('Esta orden no tiene una corrección incluida disponible.');
  if (!logo || !['image/png', 'image/jpeg', 'image/webp'].includes(logo.type)) throw Error('Selecciona un logo PNG, JPEG o WebP para la corrección.');
  const upload = await api('/uploads', { method: 'POST', body: logo, raw: true, idempotencyKey: await keyFor('upload', logo) });
  const campaignId = order.quote.campaignId, body = { brief, logoId: upload.id };
  const revision = await api('/campaigns/' + encodeURIComponent(campaignId) + '/revisions', { method: 'POST', body, idempotencyKey: await keyFor('includedRevision', { orderId: order.id, ...body }) });
  const audit = await api('/campaigns/' + encodeURIComponent(campaignId) + '/preaudit', { method: 'POST', body: {}, idempotencyKey: await keyFor('preaudit', { campaignId, revisionId: revision.revisionId }) });
  if (!revision.revisionId || audit.revisionId !== revision.revisionId || audit.allowed !== true || (audit.state || audit.status) !== 'PREAUDITED') throw Error(audit.reason || audit.reasons?.join(' ') || 'La corrección no superó la preauditoría; conserva el derecho al remedio previsto en tus condiciones.');
  return api('/orders/' + encodeURIComponent(order.id) + '/revision', { method: 'POST', body: { revisionId: revision.revisionId }, idempotencyKey: await keyFor('orderRevision', { orderId: order.id, revisionId: revision.revisionId }) });
}
export function decodePaymentChallenge(response, value) {
  const header = response.headers.get('payment-required');
  if (header) {
    try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(header), character => character.charCodeAt(0)))); }
    catch { throw Error('La solicitud x402 no tiene un formato válido.'); }
  }
  return value.paymentRequired || value.challenge || value;
}
export function createAdsApi({ fetchImpl = fetch } = {}) {
  return async (path, { method = 'GET', body, idempotencyKey, raw = false, allow402 = false } = {}) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = raw ? body.type : 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const response = await fetchImpl('/api/ads' + path, { method, credentials: 'same-origin', cache: 'no-store', headers, ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }) });
    let value;
    try { value = await response.json(); } catch { throw Error('El servidor devolvió una respuesta no verificable.'); }
    if (response.status === 402 && allow402) return { paymentRequired: decodePaymentChallenge(response, value) };
    if (!response.ok) throw Object.assign(Error(value.message || value.error?.message || (typeof value.error === 'string' ? value.error : null) || 'La solicitud no pudo completarse.'), { status: response.status, reason: value.reason || value.error?.code });
    return value;
  };
}
export async function initAdsPage(documentRef = document) {
  const $ = id => documentRef.getElementById(id), api = createAdsApi(), params = new URLSearchParams(location.search), publisher = params.get('publisher') === '1';
  const form = $('briefForm'), feedback = $('feedback');
  $('timeZoneHint').textContent = 'Fechas en tu zona horaria: ' + Intl.DateTimeFormat().resolvedOptions().timeZone + '. La cotización conserva los instantes exactos.';
  let config = { enabled: false, missing: [], placements: [] }, pilotOffer = null, wallet, signedIn = false, campaign, quote, order, polling, busy = false, ar = null, operatorRefunds = [];
  const players = new Map(), artUrls = new Map(), rendered = new Map();
  documentRef.body.classList.toggle('publisher', publisher);
  const message = text => { feedback.querySelector('span').textContent = text; feedback.hidden = false; };
  feedback.querySelector('button').addEventListener('click', () => { feedback.hidden = true; });
  const setNotice = (text, error = false) => { $('notice').textContent = text; $('notice').classList.toggle('error', error); };
  const stored = {
    get(key) { try { return JSON.parse(sessionStorage.getItem('spatial-ads:' + key)); } catch { return null; } },
    set(key, value) { try { sessionStorage.setItem('spatial-ads:' + key, JSON.stringify(value)); } catch { throw Error('Tu navegador debe permitir guardar el intento para evitar pagos duplicados.'); } },
    remove(key) { try { sessionStorage.removeItem('spatial-ads:' + key); } catch {} },
  };
  async function requestKey(action, payload, renew = false) {
    const bytes = payload instanceof Blob ? new Uint8Array(await payload.arrayBuffer()) : new TextEncoder().encode(JSON.stringify(payload));
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    const slot = 'request:' + action + ':' + hash;
    let key = renew ? null : stored.get(slot); if (!key) { key = crypto.randomUUID(); stored.set(slot, key); }
    return key;
  }
  function controls() {
    $('preauditButton').disabled = busy || !signedIn;
    $('quoteButton').disabled = busy || !campaign || !signedIn || !config.enabled;
    $('previewButton').disabled = busy || !campaign || !signedIn;
    $('reserveButton').disabled = busy || !quote || !config.enabled || Date.parse(quote.expiresAt) <= Date.now();
    $('payButton').disabled = busy || !order || !signedIn || !config.enabled || ['SETTLED', 'VERIFYING', 'AUTHORIZED', 'SETTLING', 'RECONCILIATION_REQUIRED'].includes(order.payment?.status) || ['BLOCKED', 'QUARANTINED', 'CANCELLED', 'COMPLETED', 'RECONCILIATION_REQUIRED'].includes(order.status);
    $('walletButton').disabled = busy;
    const keepOwed = fulfillmentRemaining(order, config);
    documentRef.querySelectorAll('[data-remedy="refunds"]').forEach(button => { button.hidden = keepOwed; button.disabled = busy || keepOwed; });
    $('fulfillmentNotice').hidden = !keepOwed; $('remedyHelp').textContent = keepOwed ? 'Se conservará la evidencia. Una reclamación o solicitud de cambio de ventana no equivale a entregas confirmadas.' : 'Se conservará la evidencia. Una solicitud no significa que la devolución o el cambio estén confirmados.'; $('remediesSummary').textContent = keepOwed ? 'Reclamación o cambio de ventana' : 'Reclamación, devolución o cambio de ventana';
    $('correctionPanel').hidden = !includedCorrectionEligible(order); $('correctionButton').disabled = busy || !signedIn || !includedCorrectionEligible(order);
  }
  async function action(task) {
    if (busy) return;
    busy = true; controls();
    try { await task(); } catch (error) { message(error.name === 'NotAllowedError' ? 'La confirmación de passkey se canceló. Puedes volver a intentarlo.' : error.message); }
    finally { busy = false; controls(); }
  }
  function links(container, cta) {
    container.replaceChildren();
    for (const item of cta || []) {
      const link = documentRef.createElement('a'); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = item.label + ' · ' + item.domain + ' ↗'; container.append(link);
    }
  }
  async function renderPlacement(state) {
    const card = documentRef.querySelector('[data-placement="' + state.placementId + '"]'), image = card.querySelector('.active-art');
    rendered.delete(state.placementId); image.hidden = true; image.removeAttribute('src');
    const old = artUrls.get(state.placementId); if (old) { URL.revokeObjectURL(old); artUrls.delete(state.placementId); }
    const status = card.querySelector('.playback-status');
    status.textContent = state.status === 'active' ? 'Anuncio programado activo · entrega digital' : state.placementId === 'main_stage_screen' ? 'Contenido prioritario del anfitrión' : state.reason || 'Sin anuncio vigente';
    links(card.querySelector('.cta-links'), state.active?.cta);
    if (ar?.placementId === state.placementId) void ar.binding.update(state);
    if (state.status !== 'active') return;
    const url = URL.createObjectURL(new Blob([state.bytes], { type: state.mimeType })); artUrls.set(state.placementId, url); image.src = url; image.alt = state.active.alt;
    try { await image.decode(); }
    catch { if (artUrls.get(state.placementId) === url) { URL.revokeObjectURL(url); artUrls.delete(state.placementId); image.hidden = true; } return; }
    if (artUrls.get(state.placementId) !== url || players.get(state.placementId)?.tick().status !== 'active') return;
    image.hidden = false; rendered.set(state.placementId, { placementId: state.placementId, version: state.version, revisionId: state.active.revisionId, manifestHash: state.active.manifestHash, imageHash: state.active.imageHash });
  }
  for (const placementId of ADS_PLACEMENTS) {
    const player = createAdsPlayer({ placementId, onChange: state => { void renderPlacement(state); }, onError: () => {} }); players.set(placementId, player);
  }
  const ticks = setInterval(() => { for (const player of players.values()) player.tick(); }, 100);
  const playlistPoll = setInterval(() => { for (const player of players.values()) void player.refresh(); }, 1_000);
  let publisherFrame = 0;
  if (publisher) {
    const acknowledge = () => {
      if (documentRef.visibilityState === 'visible' && typeof window.__adsPublisherAck === 'function') for (const [placementId, value] of rendered) {
        const player = players.get(placementId); player.tick();
        if (player.state.status === 'active' && rendered.has(placementId)) window.__adsPublisherAck({ ...value, frameAt: Date.now() });
      }
      publisherFrame = requestAnimationFrame(acknowledge);
    };
    publisherFrame = requestAnimationFrame(() => { publisherFrame = requestAnimationFrame(acknowledge); });
  }
  documentRef.addEventListener('visibilitychange', () => {
    for (const player of players.values()) { if (documentRef.visibilityState === 'hidden') player.suspend(); else void player.resume(); }
    if (documentRef.visibilityState === 'hidden') ar?.controller.stop();
  });
  window.addEventListener('pagehide', () => { clearInterval(ticks); clearInterval(playlistPoll); clearInterval(polling); cancelAnimationFrame(publisherFrame); for (const player of players.values()) player.dispose(); ar?.controller.dispose(); });
  documentRef.querySelectorAll('input[name="plan"]').forEach(input => input.addEventListener('change', () => {
    const plan = form.elements.plan.value; form.elements.units.disabled = plan === 'EXCLUSIVE';
    $('unitHint').textContent = plan === 'TIME' ? 'La cotización declara la unidad temporal y las reglas de pausa.' : plan === 'PASSES' ? 'Cada aparición debe completarse. La duración por pase se declara antes de pagar.' : 'Se reserva el intervalo completo [inicio, fin), con prioridad del anfitrión.';
    quote = null; $('quoteOutput').hidden = true; controls();
  }));
  form.addEventListener('input', event => {
    const name = event.target.name;
    if (['name','description','xUrl','websiteUrl','logo','rightsAccepted'].includes(name)) { campaign = null; $('briefStatus').textContent = 'El brief cambió. Guarda y repite la preauditoría antes de cotizar.'; }
    quote = null; $('quoteOutput').hidden = true; controls();
  });
  documentRef.querySelectorAll('input[name="placement"]').forEach(input => input.addEventListener('change', () => { quote = null; $('quoteOutput').hidden = true; controls(); }));
  $('walletButton').addEventListener('click', () => action(async () => {
    const response = await fetch('/api/wallet/config', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw Error('La configuración de wallet no está disponible.');
    const walletConfig = await response.json();
    wallet ||= await createAdsWallet(walletConfig);
    const connection = await wallet.connect(); const session = await wallet.authenticate(); signedIn = true;
    $('operatorPanel').hidden = session.identity?.role !== 'operator'; if (session.identity?.role === 'operator') await loadOperator();
    $('sessionLabel').textContent = 'Sesión autenticada · ' + connection.address.slice(0, 7) + '…' + connection.address.slice(-5);
    $('walletButton').textContent = 'Passkey conectada';
    const previous = params.get('order') ? { id: params.get('order') } : stored.get('order');
    if (previous?.id) { try { order = await api('/orders/' + encodeURIComponent(previous.id)); renderOrder(); } catch { stored.remove('order'); } }
  }));
  const requireSession = () => { if (!signedIn) throw Error('Conecta tu passkey para guardar el brief y consultar tu campaña. Puedes crear tu wallet desde el mapa de ONE16.'); };
  form.addEventListener('submit', event => { event.preventDefault(); void action(async () => {
    requireSession(); if (!form.reportValidity()) return;
    const logo = form.elements.logo.files[0];
    if (!logo || !['image/png', 'image/jpeg', 'image/webp'].includes(logo.type)) throw Error('Selecciona un logo PNG, JPEG o WebP.');
    const upload = await api('/uploads', { method: 'POST', body: logo, raw: true, idempotencyKey: await requestKey('upload', logo) });
    const campaignPayload = { brief: { name: form.elements.name.value.trim(), description: form.elements.description.value.trim(), xUrl: form.elements.xUrl.value, websiteUrl: form.elements.websiteUrl.value, rightsAccepted: form.elements.rightsAccepted.checked }, logoId: upload.id };
    campaign = null; const draft = await api('/campaigns', { method: 'POST', body: campaignPayload, idempotencyKey: await requestKey('campaign', campaignPayload) });
    const audit = await api('/campaigns/' + encodeURIComponent(draft.id) + '/preaudit', { method: 'POST', body: {}, idempotencyKey: await requestKey('preaudit', { campaignId: draft.id, revisionId: draft.revisionId }) });
    const verdict = audit.verdict || audit;
    if (['BLOCKED', 'QUARANTINED', 'REJECTED'].includes(verdict.status || verdict.state) || verdict.allowed === false) { campaign = null; throw Error(verdict.reason || 'El brief requiere correcciones antes de cotizar.'); }
    campaign = draft; $('briefStatus').textContent = 'Brief admitido por la preauditoría. Ya puedes consultar capacidad y cotizar.'; quote = null; $('quoteOutput').hidden = true;
  }); });
  $('previewButton').addEventListener('click', () => action(async () => {
    requireSession(); const preview = await api('/campaigns/' + encodeURIComponent(campaign.id) + '/preview', { method: 'POST', body: {}, idempotencyKey: await requestKey('preview', { campaignId: campaign.id, revisionId: campaign.revisionId }) });
    const output = $('previewOutput'); output.replaceChildren(); output.hidden = false;
    const label = documentRef.createElement('p'); label.className = 'small'; label.textContent = preview.message || 'Vista previa orientativa. El creativo final se audita de nuevo antes de publicarse.'; output.append(label);
    for (const asset of preview.artifacts || preview.assets || (preview.imageUrl ? [preview] : [])) {
      const url = new URL(asset.imageUrl, location.origin); if (url.origin !== location.origin || !url.pathname.startsWith('/api/ads/previews/')) continue;
      const image = documentRef.createElement('img'); image.src = url.href; image.alt = asset.alt || 'Vista previa del creativo'; output.append(image);
    }
  }));
  $('quoteButton').addEventListener('click', () => action(async () => {
    requireSession(); if (!form.reportValidity()) return;
    const placements = [...documentRef.querySelectorAll('input[name="placement"]:checked')].map(input => input.value);
    if (!placements.length) throw Error('Elige al menos una ubicación digital.');
    const startsAt = new Date(form.elements.startsAt.value), endsAt = new Date(form.elements.endsAt.value);
    if (!(endsAt > startsAt)) throw Error('La fecha de fin debe ser posterior al inicio.');
    const quotePayload = advertisementQuotePayload(config, { campaignId: campaign.id, placements, plan: pilotOffer ? pilotOffer.plan : form.elements.plan.value, units: pilotOffer ? pilotOffer.units : form.elements.plan.value === 'EXCLUSIVE' ? exclusiveUnits(startsAt, endsAt, config.units?.exclusiveMs) : Number(form.elements.units.value), startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() });
    const result = await api('/quotes', { method: 'POST', body: quotePayload, idempotencyKey: await requestKey('quote', quotePayload, quote && Date.parse(quote.expiresAt) <= Date.now()) });
    quote = validatePilotQuote(result, pilotOffer);
    const output = $('quoteOutput'); output.replaceChildren(); output.hidden = false;
    const price = documentRef.createElement('p'); price.className = 'quote-price'; price.textContent = formatAdsAmount(quote.amountUnits) + ' USDC de prueba'; output.append(price);
    const network = documentRef.createElement('p'); network.textContent = 'Stellar Testnet · ' + quote.plan + ' · ' + placements.length + ' ubicación(es)'; output.append(network);
    const recipient = documentRef.createElement('p'); recipient.className = 'mono small'; recipient.textContent = 'Beneficiario: ' + config.payTo; output.append(recipient);
    const expiry = documentRef.createElement('p'); expiry.className = 'small'; expiry.textContent = 'Cotización válida hasta ' + new Date(quote.expiresAt).toLocaleString(); output.append(expiry);
    const units = documentRef.createElement('p'); units.className = 'small'; units.textContent = quoteUnitsDescription(quote, config); output.append(units);
    const terms = documentRef.createElement('div'); terms.className = 'terms';
    if (typeof quote.terms === 'string') terms.textContent = quote.terms;
    else for (const [key, label] of Object.entries({ version: 'Condiciones', interruptions: 'Interrupciones y pausas', refundPolicy: 'Devoluciones', refundDeadlineMs: 'Plazo para devolución en segundos', disputeAuthority: 'Resolución de reclamaciones', includedRevisions: 'Revisiones incluidas', processingMs: 'Plazo de procesamiento en segundos' })) { const value = quote.terms?.[key]; if (value != null) { const text = documentRef.createElement('p'); text.textContent = label + ': ' + (key.endsWith('Ms') ? value / 1000 : value === 'FULL' ? 'Devolución completa según condiciones' : value === 'PRO_RATA' ? 'Devolución proporcional al déficit' : value === 'FULFILL_REMAINING' ? 'Las entregas incompletas siguen pendientes; no se cierran mediante devolución automática' : String(value)); terms.append(text); } }
    const priority = documentRef.createElement('p'); priority.textContent = 'El anfitrión mantiene prioridad sobre el contenido del main stage. Una interrupción detiene las unidades aplicables. La entrega se mide en el publicador digital canónico, sin contar espectadores.'; terms.append(priority); output.append(terms);
  }));
  $('reserveButton').addEventListener('click', () => action(async () => {
    requireSession(); validatePilotQuote(quote, pilotOffer); order = await api('/orders', { method: 'POST', body: { quoteId: quote.id }, idempotencyKey: 'order:' + quote.id }); stored.set('order', { id: order.id, amountUnits: quote.amountUnits }); const orderUrl = new URL(location.href); orderUrl.searchParams.set('order', order.id); history.replaceState(null, '', orderUrl); renderOrder(); $('orderPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  function renderOrder() {
    if (!order) return;
    $('orderPanel').hidden = false; $('orderId').textContent = order.id;
    if (order.amountUnits) $('payButton').textContent = (['FAILED', 'EXPIRED'].includes(order.payment?.status) ? 'Reintentar autorización de ' : 'Autorizar ') + formatAdsAmount(order.amountUnits) + ' USDC de prueba';
    const phase = order.queue?.state || order.status;
    $('orderStatus').textContent = ORDER_LABELS[phase] || ORDER_LABELS[order.status] || order.status;
    $('orderReason').textContent = order.queue?.reason || order.reason || (order.payment?.status === 'RECONCILIATION_REQUIRED' ? 'Se está consultando el intento original. No autorices un pago nuevo.' : 'El estado de entrega se consulta por ubicación.');
    const progress = orderProgress(order); for (const element of documentRef.querySelectorAll('[data-step]')) element.classList.toggle('done', !!progress[element.dataset.step]);
    const delivery = $('deliveryOutput'); delivery.replaceChildren();
    if (order.quote) { const contract = documentRef.createElement('p'); contract.className = 'small'; contract.textContent = 'Condiciones contratadas · ' + order.quote.plan + ' · ' + quoteUnitsDescription(order.quote); delivery.append(contract); }
    if (order.placements?.length) {
      const table = documentRef.createElement('table'), head = documentRef.createElement('tr');
      for (const text of ['Ubicación', 'Entregado / contratado', 'Pendiente', 'Estado']) { const cell = documentRef.createElement('th'); cell.textContent = text; cell.scope = 'col'; head.append(cell); } table.append(head);
      for (const item of order.placements) { const row = documentRef.createElement('tr'), passes = deliveryProgress(item, order.quote); const completed = passes ? passes.valid ? passes.completed + ' / ' + passes.required + ' entregas completas' : 'Recuento pendiente de verificación' : String(item.delivered || 0) + ' / ' + String(item.required || 0) + ' ' + (item.unit || ''); const owed = passes ? passes.valid ? passes.owed + ' entrega(s)' : 'Pendiente de verificación' : String(item.deficit ?? Math.max(0, (item.required || 0) - (item.delivered || 0))) + ' ' + (item.unit || ''); if (passes) { const summary = documentRef.createElement('dl'); summary.className = 'delivery-summary'; summary.setAttribute('aria-label', 'Entregas de ' + (item.placementId === 'main_stage_screen' ? 'Main stage' : item.placementId)); for (const [label, value] of [['Entregas completas', passes.valid ? passes.completed + ' / ' + passes.required : 'Sin verificar'], ['Entregas pendientes', passes.valid ? String(passes.owed) : 'Sin verificar']]) { const group = documentRef.createElement('div'), term = documentRef.createElement('dt'), count = documentRef.createElement('dd'); term.textContent = label; count.textContent = value; group.append(term, count); summary.append(group); } delivery.append(summary); } for (const text of [item.placementId, completed, owed, item.status]) { const cell = documentRef.createElement('td'); cell.textContent = text; row.append(cell); } table.append(row); } delivery.append(table);
    }
    const receipts = $('receiptOutput'); receipts.replaceChildren();
    const tx = order.receipt?.transaction || order.receipt?.tx || order.payment?.transaction;
    if (typeof tx === 'string' && /^[a-f0-9]{64}$/i.test(tx)) { const link = documentRef.createElement('a'); link.className = 'receipt-link mono'; link.href = 'https://stellar.expert/explorer/testnet/tx/' + tx; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Recibo de liquidación · ' + tx.slice(0, 12) + '… ↗'; receipts.append(link); }
    for (const refund of order.refunds || (order.refund ? [order.refund] : [])) { const text = documentRef.createElement('p'); const state = refund.status || refund.state; text.textContent = state === 'CONFIRMED' ? 'Devolución confirmada mediante transferencia.' : 'Devolución: ' + state + '. Aún no se confirma la devolución de fondos.'; receipts.append(text); if (state === 'CONFIRMED' && /^[a-f0-9]{64}$/i.test(refund.transaction_hash || refund.transaction || '')) { const link = documentRef.createElement('a'); link.href = 'https://stellar.expert/explorer/testnet/tx/' + (refund.transaction_hash || refund.transaction); link.textContent = 'Ver transferencia de devolución ↗'; link.rel = 'noopener noreferrer'; link.target = '_blank'; receipts.append(link); } }
    clearInterval(polling); if (!['COMPLETED', 'CANCELLED'].includes(order.status)) polling = setInterval(() => { if (!busy && signedIn) void updateOrder().catch(() => {}); }, 5_000);
    controls();
  }
  async function updateOrder() { if (!order) return; order = await api('/orders/' + encodeURIComponent(order.id)); renderOrder(); }
  $('refreshOrder').addEventListener('click', () => action(updateOrder));
  $('payButton').addEventListener('click', () => action(async () => {
    requireSession(); if (!wallet) throw Error('Conecta la wallet para autorizar este importe.');
    await updateOrder();
    if (['SETTLED', 'VERIFYING', 'AUTHORIZED', 'SETTLING', 'RECONCILIATION_REQUIRED'].includes(order.payment?.status) || order.status === 'RECONCILIATION_REQUIRED') throw Error('El intento original sigue pendiente de resolución. No se creará una autorización nueva.');
    const orderId = order.id, path = '/orders/' + encodeURIComponent(orderId) + '/pay';
    let attempt = stored.get('payment:' + orderId);
    if (attempt && ['FAILED', 'EXPIRED'].includes(order.payment?.status)) { stored.remove('payment:' + orderId); attempt = null; }
    if (!attempt) {
      const saved = stored.get('order');
      const amountUnits = order.amountUnits || saved?.amountUnits || quote?.amountUnits;
      if (pilotOffer && order.quote?.offerVersion === pilotOffer.offerVersion) { validatePilotQuote(order.quote, pilotOffer); if (amountUnits !== pilotOffer.amountUnits) throw Error('El importe de la orden no coincide con la oferta fija.'); }
      const response = await requestPaymentAuthorization({ api, wallet, path, amountUnits, config, idempotencyKey: await requestKey('paymentChallenge', { orderId }) });
      if (!response.paymentPayload) { if (response.order?.id) order = response.order; else if (response.id) order = response; await updateOrder(); return; }
      attempt = { key: crypto.randomUUID(), paymentPayload: response.paymentPayload }; stored.set('payment:' + orderId, attempt);
    }
    $('orderStatus').textContent = 'PAYMENT_PENDING · verificando liquidación del intento original';
    try { const receipt = await api(path, { method: 'POST', body: { paymentPayload: attempt.paymentPayload }, idempotencyKey: attempt.key }); if (receipt.order?.id) order = receipt.order; else if (receipt.id) order = receipt; if (receipt.receipt && !order.receipt) order.receipt = receipt.receipt; renderOrder(); await updateOrder(); }
    catch (error) { try { await updateOrder(); } catch {} throw Error('El resultado del intento debe reconciliarse. Se conserva la misma autorización; no se generó otro pago. ' + error.message); }
  }));
  $('correctionButton').addEventListener('click', () => action(async () => {
    requireSession(); await updateOrder();
    if (!form.reportValidity()) { $('brief').scrollIntoView({behavior:'smooth',block:'start'}); throw Error('Completa el brief, los enlaces, el logo y la autorización de marca en el formulario para enviar la corrección.'); }
    const brief = { name: form.elements.name.value.trim(), description: form.elements.description.value.trim(), xUrl: form.elements.xUrl.value, websiteUrl: form.elements.websiteUrl.value, rightsAccepted: form.elements.rightsAccepted.checked };
    await submitIncludedCorrection({ api, order, brief, logo: form.elements.logo.files[0], keyFor: requestKey });
    message('Corrección incluida enviada. Se conserva el pago original; el nuevo creativo pasa generación y auditoría antes de programarse.'); await updateOrder();
  }));
  documentRef.querySelectorAll('[data-remedy]').forEach(button => button.addEventListener('click', () => action(async () => {
    requireSession(); if (!order) return;
    const reason = $('remedyReason').value.trim(); if (!reason) throw Error('Describe el motivo de la solicitud.');
    if (button.dataset.remedy === 'refunds' && fulfillmentRemaining(order, config)) throw Error('Las entregas incompletas siguen pendientes. Puedes abrir una reclamación o solicitar reprogramación.');
    const body = { reason };
    if (button.dataset.remedy === 'reprogram') { const start = new Date($('reprogramStart').value), end = new Date($('reprogramEnd').value); if (!(end > start)) throw Error('Indica una nueva ventana válida.'); body.startsAt = start.toISOString(); body.endsAt = end.toISOString(); body.consented = true; }
    await api('/orders/' + encodeURIComponent(order.id) + '/' + button.dataset.remedy, { method: 'POST', body, idempotencyKey: await requestKey('remedy:' + button.dataset.remedy, { orderId: order.id, ...body }) }); message('Solicitud registrada. Consulta el estado para conocer su resolución.'); await updateOrder();
  })));
  function operatorTable(container, rows, columns) {
    container.replaceChildren(); const table = documentRef.createElement('table'), header = documentRef.createElement('tr');
    for (const [, label] of columns) { const cell = documentRef.createElement('th'); cell.scope = 'col'; cell.textContent = label; header.append(cell); } table.append(header);
    for (const item of rows) { const row = documentRef.createElement('tr'); for (const [key] of columns) { const cell = documentRef.createElement('td'); cell.textContent = item[key] == null ? '—' : String(item[key]); row.append(cell); } table.append(row); } container.append(table);
  }
  async function loadOperator() {
    const [orders, refunds] = await Promise.all([api('/operator/orders'), api('/operator/refunds')]);
    operatorTable($('operatorOrders'), orders.orders || [], [['id','Orden'],['status','Estado'],['reason','Motivo']]);
    operatorRefunds = refunds.refunds || []; operatorTable($('operatorRefunds'), operatorRefunds, [['id','Devolución'],['state','Estado'],['amount','Unidades de USDC de prueba']]);
    const select = $('operatorRefundId'), selected = select.value; select.replaceChildren(); const placeholder = documentRef.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Selecciona una devolución'; select.append(placeholder);
    for (const refund of operatorRefunds) { const option = documentRef.createElement('option'); option.value = refund.id; option.textContent = refund.id + ' · ' + (refund.state || refund.status); select.append(option); } if (operatorRefunds.some(refund => refund.id === selected)) select.value = selected;
    refundDetail(); $('operatorStatus').textContent = 'Registros actualizados. Ninguna acción económica se ejecuta al consultar.';
  }
  function refundDetail() { const refund = operatorRefunds.find(item => item.id === $('operatorRefundId').value); $('operatorRefundDetail').textContent = refund ? 'Importe: ' + formatAdsAmount(refund.amountUnits || refund.amount || '0') + ' USDC de prueba · Estado: ' + (refund.state || refund.status) + (refund.payer ? ' · Destino: ' + refund.payer : '') : 'Selecciona una solicitud antes de actuar.'; }
  $('operatorRefresh').addEventListener('click', () => action(loadOperator)); $('operatorRefundId').addEventListener('change', refundDetail);
  $('operatorSuspend').addEventListener('click', () => action(async () => { const id = $('operatorOrderId').value.trim(), reason = $('operatorReason').value.trim(); if (!/^[a-f0-9-]{36}$/i.test(id) || reason.length < 3) throw Error('Indica la orden completa y el motivo de la retirada.'); await api('/operator/orders/' + encodeURIComponent(id) + '/suspend', {method:'POST',body:{reason},idempotencyKey:await requestKey('suspend',{id,reason})}); $('operatorStatus').textContent = 'Retirada solicitada. La publicación se suspende y sus obligaciones se conservan.'; await loadOperator(); for(const player of players.values())void player.refresh(); }));
  documentRef.querySelectorAll('[data-refund-action]').forEach(button => button.addEventListener('click', () => action(async () => { const id = $('operatorRefundId').value, actionName = button.dataset.refundAction; if (!id) throw Error('Selecciona una devolución.'); await api('/operator/refunds/' + encodeURIComponent(id) + '/' + actionName, {method:'POST',body:{},idempotencyKey:await requestKey('refund:' + actionName,{id})}); await loadOperator(); $('operatorStatus').textContent = actionName === 'submit' ? 'Se consultó el envío de la devolución. Sólo CONFIRMED acredita fondos devueltos.' : 'Solicitud procesada; revisa el estado y el recibo.'; })));
  async function openAR(placementId) {
    const player = players.get(placementId); player.tick();
    if (player.state.status !== 'active') { message('No hay un anuncio auditado vigente para colocar. Puedes explorar el mapa 3D y el contenido del anfitrión.'); return; }
    if (!navigator.xr || !(await navigator.xr.isSessionSupported('immersive-ar').catch(() => false))) { message('Este navegador no permite AR dinámica. Conservas la tarjeta con enlaces y el mapa 3D. La colocación compartida del venue no está validada.'); return; }
    const [T, spatial] = await Promise.all([import('three'), import('./ads-spatial.mjs')]);
    $('arPanel').hidden = false; $('arStatus').textContent = 'Toca Iniciar cámara AR. Busca una superficie y coloca el anuncio manualmente.';
    const renderer = new T.WebGLRenderer({ canvas: $('arCanvas'), alpha: true, antialias: true }); renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); renderer.outputColorSpace = T.SRGBColorSpace;
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(55, innerWidth / innerHeight, .01, 100), group = new T.Group(); scene.add(group);
    const ratio = placementId === 'venue_center_banner' ? 4 : 16 / 9;
    const mesh = new T.Mesh(new T.PlaneGeometry(1, 1 / ratio), new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide, toneMapped: false })); group.add(mesh); mesh.visible = false;
    const binding = spatial.bindAdsSurface(T, mesh), controller = spatial.createAdsSpatialController({ THREE: T, renderer, scene, camera, object: group, uiRoot: $('arControls'), onFrame: () => player.tick(), onState: value => {
      $('placeAR').hidden = !value.canPlace; $('resetAR').hidden = !value.placed; $('startAR').disabled = !['preview', 'error'].includes(value.state);
      $('arStatus').textContent = ({ requesting: 'Permite iniciar la sesión de cámara AR.', searching: 'Apunta al suelo o a una mesa y mueve el teléfono despacio.', 'surface-found': 'Superficie encontrada. Toca Colocar aquí.', placed: 'Colocación local. Puedes moverte alrededor del anuncio.', 'tracking-lost': 'Seguimiento perdido. El anuncio se oculta hasta recuperar la posición.', preview: 'Puedes volver a iniciar AR o regresar a la tarjeta.', error: 'No se pudo iniciar AR. Regresa a la tarjeta o vuelve a intentarlo.' })[value.state] || 'Preparando AR…';
    }, onEnd: () => { $('startAR').disabled = false; } });
    ar = { placementId, controller, binding, renderer }; await binding.update(player.state); $('startAR').disabled = false;
  }
  documentRef.querySelectorAll('[data-ar]').forEach(button => button.addEventListener('click', () => action(() => openAR(button.dataset.ar))));
  $('startAR').addEventListener('click', () => { if (ar) void ar.controller.start(); }); $('placeAR').addEventListener('click', () => ar?.controller.place()); $('resetAR').addEventListener('click', () => ar?.controller.reposition());
  $('closeAR').addEventListener('click', () => { ar?.controller.dispose(); ar?.binding.dispose(); ar?.renderer.dispose(); ar = null; $('arPanel').hidden = true; });
  $('arControls').addEventListener('beforexrselect', event => { if (event.target.closest?.('button,a')) event.preventDefault(); });
  try {
    config = await api(adsConfigPath(params));
    const selected = configuredPlacement(config, params.has('placement'));
    if (config.network !== 'stellar:testnet') throw Error('La publicidad debe operar exclusivamente en Stellar Testnet.');
    pilotOffer = configuredPilotOffer(config);
    $('pilotOffer').hidden = !pilotOffer; $('legacyPlans').hidden = !!pilotOffer; $('unitsLabel').hidden = !!pilotOffer;
    if (pilotOffer) {
      $('heroIntro').textContent = 'Forma parte del espacio digital de ONE16. Prueba tu anuncio en el main stage: 5 USDC de prueba por 5 entregas completas de 1 minuto.';
      $('spacesTitle').textContent = 'Tu anuncio, en el main stage.';
      $('offerPrice').textContent = formatAdsAmount(pilotOffer.amountUnits) + ' USDC de prueba · 5 entregas de 1 minuto';
      form.elements.plan.value = pilotOffer.plan; form.elements.units.value = String(pilotOffer.units); form.elements.units.disabled = true;
      for (const input of documentRef.querySelectorAll('input[name="plan"]')) input.disabled = true;
    }
    for (const input of documentRef.querySelectorAll('input[name="placement"]')) {
      const placement = config.placements.find(item => item.id === input.value);
      const purchasable = !!placement && placement.purchasable !== false && (!pilotOffer || input.value === pilotOffer.placementId);
      input.disabled = !purchasable;
      if (selected || pilotOffer) input.checked = purchasable && input.value === (selected || pilotOffer.placementId);
      if (!purchasable) { input.checked = false; input.closest('label').querySelector('span').textContent = 'No está a la venta'; }
    }
    if (!config.enabled) setNotice('Las compras todavía están pendientes de configuración. Puedes explorar las ubicaciones; no hay una cotización pagable ni autorización de pago disponible.', true);
    else setNotice('Compras testnet habilitadas. El precio y las condiciones se muestran en una cotización antes de autorizar el pago.');
    if (pilotOffer && selected && selected !== pilotOffer.placementId) setNotice('Puedes explorar este banner. La oferta de compra está disponible únicamente para la pantalla del main stage.', !config.enabled);
    if (config.defaultStageUrl) { const defaultUrl = new URL(config.defaultStageUrl, location.origin); if (defaultUrl.protocol === 'https:' || defaultUrl.origin === location.origin) for (const video of documentRef.querySelectorAll('.stage-default')) { video.src = defaultUrl.href; video.play().catch(() => {}); } }
    for (const input of documentRef.querySelectorAll('input[name="placement"]')) if (!config.placements.some(item => item.id === input.value)) { input.disabled = true; input.checked = false; }
    for (const player of players.values()) void player.refresh();
    if (!publisher) {
      try {
        const session = await api('/auth/me'); const identity = session.identity;
        if (identity?.address) {
          signedIn = true; $('sessionLabel').textContent = 'Sesión autenticada · ' + identity.address.slice(0,7) + '…' + identity.address.slice(-5); $('walletButton').textContent = 'Conectar para pagar';
          $('operatorPanel').hidden = identity.role !== 'operator'; if (identity.role === 'operator') await loadOperator();
          const previous = params.get('order') ? { id: params.get('order') } : stored.get('order');
          if (previous?.id) { order = await api('/orders/' + encodeURIComponent(previous.id)); renderOrder(); }
        }
      } catch {}
    }
  } catch (error) { config.enabled = false; setNotice('Las compras no están disponibles: ' + error.message, true); }
  controls();
}
if (typeof document !== 'undefined') void initAdsPage().catch(error => { const notice = document.getElementById('notice'); if (notice) { notice.textContent = 'No se pudo preparar la publicidad. ' + error.message; notice.classList.add('error'); } });
