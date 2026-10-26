import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStorage } from '../server/ads/storage.mjs';
import { sha256 } from '../server/ads/common.mjs';

test('private storage is content addressed, deduplicated and checks bytes on reads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ads-private-'));
  const storage = createStorage({ config: { storage: { kind: 'fs', root } } });
  const input = Buffer.from('sanitized-raster-fixture');
  const a = await storage.put(input, { mime: 'image/png' });
  const b = await storage.put(input, { mime: 'image/png' });
  assert.equal(a.key, b.key);
  assert.equal(a.hash, sha256(input));
  assert.deepEqual(await storage.get(a.key), input);
  assert.deepEqual(await readFile(join(root, a.key)), input);
  await writeFile(join(root, a.key), 'tampered');
  await assert.rejects(storage.get(a.key), /integrity/);
});
test('private storage rejects path traversal, public roots, unsupported types and missing configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ads-private-'));
  const storage = createStorage({ config: { storage: { root } } });
  for (const key of ['../secret', '..\\secret', '/absolute', 'https://example.com/file', 'a'.repeat(64) + '.svg']) await assert.rejects(storage.get(key), /Invalid asset/);
  await assert.rejects(storage.put(Buffer.from('<svg/>'), { mime: 'image/svg+xml' }), /Unsupported/);
  assert.throws(() => createStorage({ config: { storage: { root: join(root, 'public') } } }), /outside/);
  assert.throws(() => createStorage({ config: {} }), /Configure/);
});
test('blob adapter uses private access and never trusts corrupt duplicate objects', async () => {
  let options;
  const data = Buffer.from('private-blob');
  const storage = createStorage({ config: { storage: { kind: 'blob' } }, blob: {
    put: async (_key, _data, args) => { options = args; },
    get: async () => ({ statusCode: 200, stream: new Blob([data]).stream() }),
  } });
  const asset = await storage.put(data, { mime: 'image/png' });
  assert.equal(options.access, 'private');
  assert.equal(options.allowOverwrite, false);
  assert.deepEqual(await storage.get(asset.key), data);
});


test('a lost Blob PUT response is deduplicated only by reading matching private content', async () => {
  const data = Buffer.from('immutable-private-asset');
  let stored = data;
  const storage = createStorage({ config: { storage: { kind: 'blob' } }, blob: {
    put: async () => { throw new Error('PUT response lost or object already exists'); },
    get: async () => ({ statusCode: 200, stream: new Blob([stored]).stream() }),
  } });
  const asset = await storage.put(data, { mime: 'image/png' });
  assert.equal(asset.hash, sha256(data));
  stored = Buffer.from('tampered');
  await assert.rejects(storage.put(data, { mime: 'image/png' }), /PUT response lost/);
});
