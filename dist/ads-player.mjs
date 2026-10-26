/** Read-only playlist consumer. A browser never records or multiplies delivery. */
export const ADS_PLACEMENTS = Object.freeze(['venue_center_banner', 'main_stage_screen']);
const stamp = value => typeof value === 'number' ? value : Date.parse(value);
const hashPattern = /^[a-f0-9]{64}$/i;
export function safeAdsUrl(value, origin = globalThis.location?.origin || 'https://ads.invalid') {
  const url = new URL(value, origin);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw Error('El destino requiere HTTPS.');
  if (url.username || url.password) throw Error('El destino contiene credenciales.');
  return url;
}
/** Public, non-accounting timing from the canonical publisher. */
export function validatePlayback(value, { serverTime, validUntil, maxTtlMs = 2000 } = {}) {
  if (value == null) return null; // Historical manifests have no countdown.
  if (!['IDLE','STARTING','PLAYING','PAUSED'].includes(value.phase)) throw Error('El tiempo de reproducción no es verificable.');
  const durationMs = value.durationMs, expiry = stamp(value.validUntil);
  if (!Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > 3600000 || !Number.isFinite(expiry) || expiry <= serverTime) throw Error('La reproducción no tiene vigencia verificable.');
  const timing = { phase:value.phase, passId:value.passId == null ? null : String(value.passId).slice(0,160), durationMs, startedAt:null, confirmedThrough:null, remainingMs:null, validUntil:Math.min(expiry, validUntil, serverTime+maxTtlMs) };
  if (value.phase !== 'PLAYING') return timing;
  const startedAt=stamp(value.startedAt),confirmedThrough=stamp(value.confirmedThrough);
  if (!timing.passId || durationMs <= 0 || !Number.isFinite(startedAt) || !Number.isFinite(confirmedThrough) || startedAt > confirmedThrough || confirmedThrough > serverTime || serverTime-confirmedThrough > maxTtlMs || !Number.isSafeInteger(value.remainingMs) || value.remainingMs < 0 || value.remainingMs > durationMs) throw Error('El pase no tiene confirmación reciente.');
  return {...timing,startedAt,confirmedThrough,remainingMs:value.remainingMs};
}
export function playbackCountdown(playback, serverTime, receivedServerTime = serverTime) {
  if (!playback || playback.phase !== 'PLAYING' || !Number.isFinite(serverTime) || serverTime >= playback.validUntil) return null;
  return Math.max(0, playback.remainingMs-Math.max(0,serverTime-receivedServerTime));
}
export function playbackLabel(playback) {
  if (!playback || playback.phase === 'IDLE') return 'Contenido del anfitrión';
  if (playback.phase === 'STARTING') return 'Preparando anuncio · sin tiempo consumido';
  if (playback.phase === 'PAUSED') return 'En pausa · el pase sigue pendiente';
  if (!Number.isFinite(playback.remainingMs)) return 'Verificando el tiempo del pase';
  const seconds=Math.ceil(playback.remainingMs/1000);
  return 'Pase en curso · '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+' restantes';
}
export function validatePlaylist(value, placementId, { origin = globalThis.location?.origin || 'https://ads.invalid', maxTtlMs = 2_000 } = {}) {
  if (!ADS_PLACEMENTS.includes(placementId)) throw Error('Ubicación publicitaria desconocida.');
  const serverTime = stamp(value?.serverTime), validUntil = stamp(value?.validUntil);
  if (!Number.isFinite(serverTime) || !Number.isFinite(validUntil) || validUntil <= serverTime || !Number.isSafeInteger(value?.version) || value.version < 0) throw Error('La playlist no tiene vigencia verificable.');
  const playlist = { ...value, serverTime, validUntil: Math.min(validUntil, serverTime + maxTtlMs), placementId, active: null, playback:validatePlayback(value.active==null||value.active.plan==='PASSES'&&value.active.offerVersion===2?value.playback:null,{serverTime,validUntil,maxTtlMs}) };
  if (value.active == null) return playlist;
  const active = value.active, startsAt = stamp(active.startsAt), endsAt = stamp(active.endsAt);
  if (!active.orderId || !active.revisionId || !hashPattern.test(active.manifestHash || '') || !hashPattern.test(active.imageHash || '') || !Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) throw Error('El anuncio no tiene un manifiesto válido.');
  const imageUrl = safeAdsUrl(active.imageUrl, origin);
  if (imageUrl.origin !== origin || !imageUrl.pathname.startsWith('/api/ads/assets/')) throw Error('El artefacto debe provenir del publicador autorizado.');
  const cta = (active.cta || []).map(item => {
    const url = safeAdsUrl(item.url, origin);
    if (url.protocol !== 'https:') throw Error('El CTA requiere HTTPS.');
    if (item.domain && item.domain !== url.hostname) throw Error('El dominio del CTA no coincide.');
    return { label: String(item.label || 'Visitar proyecto').slice(0, 80), url: url.href, domain: url.hostname };
  });
  playlist.active = { ...active, imageUrl: imageUrl.href, startsAt, endsAt, cta, alt: String(active.alt || 'Anuncio del proyecto').slice(0, 400) };
  return playlist;
}
export async function verifyAdsImage(response, expectedHash, cryptoImpl = globalThis.crypto) {
  if (!response.ok) throw Error('No se pudo descargar el anuncio.');
  const mimeType = response.headers.get('content-type')?.split(';')[0].trim();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw Error('Formato de anuncio no permitido.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 8_000_000) throw Error('Tamaño de anuncio no permitido.');
  const digest = new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes));
  const actual = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== expectedHash.toLowerCase()) throw Error('El archivo no coincide con el anuncio auditado.');
  return { bytes, mimeType };
}
export function createAdsPlayer({ placementId, fetchImpl = globalThis.fetch, now = () => globalThis.performance?.now?.() ?? Date.now(), origin = globalThis.location?.origin || 'https://ads.invalid', onChange = () => {}, onError = () => {}, verifyImage = verifyAdsImage, maxTtlMs = 2_000 } = {}) {
  if (!ADS_PLACEMENTS.includes(placementId)) throw Error('Ubicación publicitaria desconocida.');
  let state = { placementId, status: 'neutral', active: null, version: -1 }, highestVersion = -1, playlist = null, image = null, imageKey = '', generation = 0, pending = null, disposed = false, suspended = false, lastNow = -Infinity, serverAnchor = null, localAnchor = null, requestController;
  const localNow = () => { lastNow = Math.max(lastNow, now()); return lastNow; };
  const serverNow = () => serverAnchor == null ? null : serverAnchor + localNow() - localAnchor;
  function emit(next) {
    const signature = item => [item.status, item.version, item.active?.revisionId, item.active?.manifestHash, item.active?.imageHash].join(':');
    const changed = signature(next) !== signature(state); state = next;
    if (changed) onChange(state);
    return state;
  }
  function neutral(reason = 'Sin anuncio vigente', playback = null) { return emit({ placementId, status: 'neutral', active: null, version: highestVersion, reason, playback }); }
  function tick() {
    if (disposed || suspended || !playlist) return neutral();
    const time = serverNow(), active = playlist.active;
    if (time == null || time >= playlist.validUntil) return neutral('La vigencia debe verificarse de nuevo.');
    if (!active || time < active.startsAt || time >= active.endsAt || !image || ['PAUSED','IDLE'].includes(playlist.playback?.phase)) return neutral(playlist.playback?.phase === 'PAUSED' ? 'Publicación en pausa.' : undefined,playlist.playback ? {...playlist.playback,remainingMs:null} : null);
    const playback=playlist.playback ? {...playlist.playback,remainingMs:playbackCountdown(playlist.playback,time,playlist.serverTime)} : null;
    return emit({ placementId, status: 'active', active, version: playlist.version, serverTime: time, playback, ...image });
  }
  function refresh() {
    if (disposed || suspended) return Promise.resolve(neutral());
    if (pending) return pending;
    const serial = generation, requestedAt = localNow();
    requestController = new AbortController();
    pending = (async () => {
      try {
        const response = await fetchImpl('/api/ads/playlists/' + placementId, { cache: 'no-store', credentials: 'same-origin', signal: requestController.signal });
        if (!response.ok) throw Error('La programación no está disponible.');
        const next = validatePlaylist(await response.json(), placementId, { origin, maxTtlMs });
        if (disposed || suspended || serial !== generation) return state;
        if (next.version < highestVersion) throw Error('Se rechazó una versión anterior de programación.');
        // Use the whole round-trip as a conservative clock bound; delayed responses cannot extend validity.
        highestVersion = next.version; playlist = next; localAnchor = localNow(); serverAnchor = next.serverTime + Math.max(0, localAnchor - requestedAt);
        if (!next.active) { image = null; imageKey = ''; return neutral(); }
        const key = [next.active.revisionId, next.active.manifestHash, next.active.imageHash].join(':');
        if (imageKey !== key) {
          image = null; neutral('Verificando el anuncio auditado.');
          const asset = await fetchImpl(next.active.imageUrl, { cache: 'no-store', credentials: 'same-origin', signal: requestController.signal });
          const verified = await verifyImage(asset, next.active.imageHash);
          if (disposed || suspended || serial !== generation) return state;
          image = verified; imageKey = key;
        }
        return tick();
      } catch (error) {
        if (serial === generation && !disposed) { playlist = null; image = null; imageKey = ''; neutral('Sin programación verificable.'); if (error.name !== 'AbortError') onError(error); }
        return state;
      } finally { if (serial === generation) pending = null; }
    })();
    return pending;
  }
  return {
    get state() { return state; }, get serverTime() { return serverNow(); }, refresh, tick,
    suspend() { suspended = true; generation++; requestController?.abort(); pending = null; playlist = null; image = null; imageKey = ''; neutral('Publicación suspendida.'); },
    resume() { if (disposed) return Promise.resolve(state); suspended = false; return refresh(); },
    dispose() { this.suspend(); disposed = true; },
  };
}
