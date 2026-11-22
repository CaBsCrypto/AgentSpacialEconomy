export class ReservationError extends Error {
  constructor(code, status = 0, retryAfter = null) {
    super(code); this.name = 'ReservationError'; this.code = code; this.status = status; this.retryAfter = retryAfter;
  }
}

/** Same-origin cookies are the only session credential. Mutations are never retried here. */
export function createReservationsApi({ fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  return {
    async request(path, { method = 'GET', body, bytes, mime, signal } = {}) {
      if (!/^\/[a-z0-9/_-]*$/i.test(path) || path.includes('..')) throw new ReservationError('INVALID_PATH');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) controller.abort();
      try {
        const response = await fetchImpl('/api/reservations' + path, {
          method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
          headers: bytes ? { 'Content-Type': mime } : body === undefined ? {} : { 'Content-Type': 'application/json' },
          ...(bytes ? { body: bytes } : body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        let value; try { value = await response.json(); } catch { throw new ReservationError('INVALID_RESPONSE', response.status); }
        if (!response.ok) throw new ReservationError(typeof value?.code === 'string' ? value.code : 'REQUEST_FAILED', response.status, response.headers.get('Retry-After'));
        if (!value || typeof value !== 'object') throw new ReservationError('INVALID_RESPONSE', response.status);
        return value;
      } catch (error) {
        if (error instanceof ReservationError) throw error;
        throw new ReservationError('NETWORK_UNCERTAIN');
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    },
  };
}

const messages = {
  REVISION_CONFLICT: 'Hay una versión más reciente guardada. Tus cambios aún no se aplicaron.',
  UNKNOWN_SPACE: 'Guarda los espacios nuevos antes de ubicarlos en el mapa.',
  SPACES_LIMIT: 'El piloto admite hasta 20 espacios.',
  INVALID_MAP: 'Revisa los puntos: uno por espacio y coordenadas entre 0 y 100%.',
  REVIEW_INCOMPLETE: 'Guarda un título, un espacio y su ubicación antes de aprobar.',
  REVISION_ALREADY_APPROVED: 'Esta versión ya tiene otro espacio aprobado. Edita y guarda antes de revisar otra oferta.',
  OFFER_UNAVAILABLE: 'La oferta ya no está disponible o necesita verificación.',
  ACTIVE_OFFER: 'Ya existe una oferta activa para este proyecto.',
  ACTIVE_ATTEMPT: 'Hay un intento pendiente. Consulta su estado antes de continuar.',
  PREPARATION_PENDING: 'La preparación aún no está lista. Consulta el intento; no vuelvas a firmar.',
  INTAKE_PAUSED: 'Las operaciones nuevas están pausadas. Consulta el estado del intento antes de continuar.',
  INTAKE_UNAVAILABLE: 'No pudimos comprobar si se admiten nuevas operaciones. Consulta el estado del intento cuando vuelva el servicio.',
  UPLOAD_SIZE: 'La imagen supera el límite de 2 MiB.',
  IMAGE_SIZE: 'La imagen normalizada supera el tamaño permitido.',
  IMAGE_DIMENSIONS: 'La imagen debe tener como máximo 2048 píxeles por lado y un solo fotograma.',
  UPLOAD_TYPE: 'Elige una imagen PNG, JPEG o WebP.',
  IMAGE_DECODE_FAILED: 'No pudimos leer esa imagen. Conservamos el mapa anterior.',
  AUTHORIZATION_EXPIRED: 'La preparación venció. Consulta el intento antes de continuar.',
  NETWORK_UNCERTAIN: 'No pudimos confirmar la respuesta. Consulta el estado antes de repetir la acción.',
  INVALID_RESPONSE: 'La respuesta no pudo verificarse. No se confirmó la operación.',
};
export function errorMessage(error) {
  if (error?.status === 401) return 'Tu sesión terminó. Vuelve a identificarte para continuar.';
  if (error?.status === 403) return 'Tu cuenta no tiene permiso para esta acción.';
  if (error?.status === 429) return 'Alcanzaste el límite temporal. Espera antes de volver a intentarlo.' + (/^\d{1,6}$/.test(error.retryAfter || '') ? ` Espera indicada: ${error.retryAfter} segundos.` : '');
  if (messages[error?.code]) return messages[error.code];
  if (error?.status === 503) return 'Esta función no está disponible ahora. Puedes consultar las funciones habilitadas.';
  if (error?.status === 404) return 'El recurso no está disponible para esta cuenta.';
  if (error?.status === 409) return 'La operación entra en conflicto con el estado guardado. Consulta la versión vigente.';
  return 'No pudimos completar la acción. Revisa los datos e inténtalo de nuevo cuando el estado sea conocido.';
}
