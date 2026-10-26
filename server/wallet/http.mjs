export class WalletApiError extends Error {
  constructor(status, reason, message) { super(message); this.status = status; this.reason = reason; }
}

export function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export function assertOrigin(request, config) {
  const origin = request.headers.get('origin');
  if (!origin || !config.allowedOrigins.has(origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new WalletApiError(403, 'origin_not_allowed', 'Abre la experiencia desde su dominio de wallet.');
  }
}

export function assertReady(config) {
  if (!config.enabled) throw new WalletApiError(503, 'setup_required', 'La conexión de wallet está pendiente de configuración.');
}

export async function readBody(request, limit = 24_000) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new WalletApiError(415, 'invalid_content_type', 'Se requiere JSON.');
  }
  if (Number(request.headers.get('content-length') || 0) > limit) throw new WalletApiError(413, 'body_too_large', 'Solicitud demasiado grande.');
  const reader = request.body?.getReader();
  let text = '', bytes = 0;
  if (reader) {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > limit) { await reader.cancel(); throw new WalletApiError(413, 'body_too_large', 'Solicitud demasiado grande.'); }
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
  }
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error();
    return body;
  } catch { throw new WalletApiError(400, 'invalid_json', 'La solicitud no contiene un objeto JSON válido.'); }
}

export async function withErrors(action) {
  try { return await action(); }
  catch (error) {
    if (error instanceof WalletApiError) return json({ state: 'failed', success: false, reason: error.reason, message: error.message, error: error.message }, error.status);
    return json({ state: 'failed', success: false, reason: 'service_unavailable', message: 'No se pudo completar la conexión. Vuelve a verificar el estado.', error: 'Wallet service unavailable' }, 503);
  }
}

/** Vercel's plain Node handler, with a Web Request core that is also testable. */
export async function nodeHandler(req, res, handle) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers || {})) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
  const method = req.method || 'GET';
  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    if (req.body !== undefined) body = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body);
    else {
      const chunks = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 24_000) { const result = json({ reason: 'body_too_large', message: 'Solicitud demasiado grande.' }, 413); res.statusCode = result.status; for (const [key,value] of result.headers) res.setHeader(key,value); res.end(await result.text()); return; }
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }
  }
  const request = new Request(`https://${headers.get('host') || 'localhost'}${req.url || '/'}`, { method, headers, ...(body === undefined ? {} : { body }) });
  const response = await handle(request);
  res.statusCode = response.status;
  for (const [key, value] of response.headers) res.setHeader(key, value);
  res.end(await response.text());
}
