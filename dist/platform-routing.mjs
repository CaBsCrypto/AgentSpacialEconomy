/** Routing-only compatibility; imports no viewer, wallet or browser storage. */
export const ONE16_PATH = '/one16';
const DIRECT_PASSPORT_VALUES = new Set(['stand16', 'return']);
const LEGACY_VENUE_HASHES = new Set(['#recorrido', '#accessibleTour']);

function webUrl(href) {
  try {
    const url = new URL(href);
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch { return null; }
}

export function isDirectPassportSearch(search) {
  return DIRECT_PASSPORT_VALUES.has(new URLSearchParams(search).get('passport'));
}

/** Hashes never reach the server; static-server fallbacks still reach the same experience. */
export function platformContinuationUrl(href) {
  const url = webUrl(href);
  if (!url || url.pathname !== '/') return null;
  const legacy = isDirectPassportSearch(url.search) || url.searchParams.get('ar_fallback') === '1' || LEGACY_VENUE_HASHES.has(url.hash);
  return legacy ? url.origin + ONE16_PATH + url.search + url.hash : null;
}

/** Shared semantic routes for the local server and production route regression tests. */
export function resolvePlatformRequest(href) {
  const url = webUrl(href);
  if (!url) return null;
  const suffix = url.search + url.hash;
  if (url.pathname === '/one16/' || url.pathname === '/index.html') return { type: 'redirect', status: 308, destination: ONE16_PATH + suffix };
  if (url.pathname === '/platform.html') return { type: 'redirect', status: 308, destination: '/' + suffix };
  if (url.pathname === ONE16_PATH) return { type: 'file', pathname: '/index.html' };
  if (url.pathname !== '/') return null;
  if (isDirectPassportSearch(url.search)) return { type: 'file', pathname: '/index.html' };
  if (url.searchParams.get('ar_fallback') === '1') return { type: 'redirect', status: 308, destination: ONE16_PATH + suffix };
  return { type: 'file', pathname: '/platform.html' };
}

export function platformCanonicalPath(filename) {
  return filename === 'index.html' ? ONE16_PATH : filename === 'platform.html' ? '/' : '/' + filename;
}
