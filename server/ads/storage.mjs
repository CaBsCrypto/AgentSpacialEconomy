import { mkdir, readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { resolve, join, basename, relative, isAbsolute } from 'node:path';
import { AdsError, sha256 } from './common.mjs';

const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/json': 'json' };
const KEY = /^[a-f0-9]{64}\.(?:png|jpg|webp|json)$/u;
function validateKey(key) {
  if (typeof key !== 'string' || !KEY.test(key) || basename(key) !== key) throw new AdsError(422, 'INVALID_ASSET_KEY', 'Invalid asset reference.');
  return key;
}
function checkedBytes(bytes, key) {
  const data = Buffer.from(bytes);
  if (sha256(data) !== key.slice(0, 64)) throw new AdsError(500, 'ASSET_INTEGRITY', 'The stored asset failed its integrity check.');
  return data;
}

/** Private content-addressed assets. HTTP access is mediated by campaign ownership. */
export function createStorage({ config, blob } = {}) {
  const settings = config?.storage ?? config ?? {};
  const kind = settings.kind === 'filesystem' ? 'fs' : (settings.kind ?? 'fs');
  const root = settings.root ? resolve(settings.root) : null;
  if (!['fs', 'blob'].includes(kind) || (kind === 'fs' && !root)) throw new AdsError(503, 'STORAGE_UNCONFIGURED', 'Configure private creative storage.');
  if (kind === 'fs' && /(?:^|[\\/])(?:dist|public)(?:[\\/]|$)/iu.test(root)) throw new AdsError(503, 'PUBLIC_STORAGE_REJECTED', 'Creative storage must be outside the public document root.');

  async function privatePath(key, existing = false) {
    validateKey(key);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const realRoot = await realpath(root);
    const path = join(realRoot, key);
    const rel = relative(realRoot, path);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new AdsError(422, 'INVALID_ASSET_KEY', 'Invalid asset reference.');
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new AdsError(422, 'INVALID_ASSET_PATH', 'Asset references cannot point to links or directories.');
    } catch (error) { if (error.code !== 'ENOENT' || existing) throw error; }
    return path;
  }
  async function blobSdk() { return blob ?? await import('@vercel/blob'); }
  async function get(key) {
    validateKey(key);
    try {
      if (kind === 'fs') return checkedBytes(await readFile(await privatePath(key, true)), key);
      const result = await (await blobSdk()).get('ads/' + key, { access: 'private' });
      if (!result || result.statusCode !== 200 || !result.stream) throw new AdsError(404, 'ASSET_NOT_FOUND', 'The private creative asset was not found.');
      return checkedBytes(await new Response(result.stream).arrayBuffer(), key);
    } catch (error) {
      if (error.code === 'ENOENT') throw new AdsError(404, 'ASSET_NOT_FOUND', 'The private creative asset was not found.');
      throw error;
    }
  }
  async function put(bytes, { mime = 'image/png' } = {}) {
    const data = Buffer.from(bytes);
    if (!EXTENSIONS[mime]) throw new AdsError(422, 'ASSET_TYPE', 'Unsupported stored artifact type.');
    const hash = sha256(data);
    const key = hash + '.' + EXTENSIONS[mime];
    if (kind === 'fs') {
      const path = await privatePath(key);
      try { await writeFile(path, data, { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; checkedBytes(await get(key), key); }
    } else {
      const sdk = await blobSdk();
      try { await sdk.put('ads/' + key, data, { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: mime, cacheControlMaxAge: 60 }); }
      catch (error) {
        // A failed PUT can mean an existing immutable object or a lost response.
        // Only a private GET with matching bytes proves the requested write succeeded.
        try { checkedBytes(await get(key), key); } catch { throw error; }
      }
    }
    return { key, hash, size: data.length, mime };
  }
  return Object.freeze({ put, get, kind });
}
