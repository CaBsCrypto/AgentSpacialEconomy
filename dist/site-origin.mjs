export const CANONICAL_ORIGIN = 'https://agenticreality.space';
export const LEGACY_HOSTS = Object.freeze([
  'one16-passport-ar.vercel.app',
  'one16-lisbon-hackmeridian-3d.cabscryptocontacto.chatgpt.site',
  'www.agenticreality.space',
]);

/** Keep the full visitor route, including the fragment that never reaches the server. */
export function canonicalContinuationUrl(href) {
  const source = new URL(href), canonical = new URL(CANONICAL_ORIGIN);
  if (source.origin === canonical.origin) return null;
  if (!LEGACY_HOSTS.includes(source.hostname) && source.hostname !== canonical.hostname) return null;
  return canonical.origin + source.pathname + source.search + source.hash;
}

/** Runs in each HTML head before modules, camera setup, IndexedDB or wallet preparation. */
export function canonicalBootstrapScript() {
  return `(()=>{const u=new URL(location.href),o=${JSON.stringify(CANONICAL_ORIGIN)},h=${JSON.stringify([...LEGACY_HOSTS,new URL(CANONICAL_ORIGIN).hostname])};if(u.origin!==o&&h.includes(u.hostname))location.replace(o+u.pathname+u.search+u.hash)})();`;
}
