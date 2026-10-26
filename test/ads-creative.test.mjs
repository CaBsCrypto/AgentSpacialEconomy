import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { createCreativeService, sniffImage } from '../server/ads/creative.mjs';
import { createStorage } from '../server/ads/storage.mjs';

const config = { allowedDomains: ['x.com', 'example.com'], limits: { nameChars: 100, descriptionChars: 1000, textBytes: 4096, uploadBytes: 100000, imagePixels: 1000000, imageWidth: 1000, imageHeight: 1000 }, model: { id: 'explicit/test-injection', maxCalls: 3, maxTokens: 500, timeoutMs: 1000, maxInputTokens: 3000000, maxCostMicrousd: 20, inputMicrousdPerMillion: '1', outputMicrousdPerMillion: '1' } };
const brief = { name: 'Aster', description: 'An accessible puzzle game.', xUrl: 'https://x.com/aster', websiteUrl: 'https://example.com/play', rightsConfirmed: true };
async function setup(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ads-creative-'));
  const storage = createStorage({ config: { storage: { root } } });
  const model = { compose: async () => ({ headline: 'Explore Aster', tagline: 'A puzzle for curious minds.', alt: 'Aster puzzle game advertisement.' }), audit: async input => ({ decision: 'ALLOW', reasons: [], reviewedHash: input.manifestHash }), ...overrides.model };
  const creative = createCreativeService({ config: overrides.config ?? config, storage, model, urlInspector: overrides.urlInspector ?? (async url => ({ url })) });
  const image = await sharp({ create: { width: 100, height: 80, channels: 4, background: '#72e3df' } }).png().toBuffer();
  const logo = await creative.sanitizeUpload(image, 'image/png');
  return { creative, storage, logo, image };
}
test('uploads sniff real bytes, re-decode, strip metadata and reject active or oversized content', async () => {
  const { creative, storage, logo, image } = await setup();
  assert.equal(sniffImage(await storage.get(logo.key)), 'image/png');
  assert.deepEqual([logo.width, logo.height], [100, 80]);
  await assert.rejects(creative.sanitizeUpload(Buffer.from('<svg onload="alert(1)"/>'), 'image/png'), /PNG, JPEG or WebP/);
  await assert.rejects(creative.sanitizeUpload(image, 'image/jpeg'), /declared media/);
  await assert.rejects(creative.sanitizeUpload(Buffer.alloc(config.limits.uploadBytes + 1), 'image/png'), /upload limit/);
  const tooWide = await sharp({ create: { width: 1001, height: 1, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(creative.sanitizeUpload(tooWide, 'image/png'), /dimensions/);
  const withTail = Buffer.concat([image, Buffer.from('<script>untrusted-tail</script>')]);
  const clean = await creative.sanitizeUpload(withTail, 'image/png');
  assert.equal((await storage.get(clean.key)).includes(Buffer.from('<script>')), false);
});
test('a model ALLOW cannot waive rights, asset integrity, domain or SSRF checks', async () => {
  const { creative, logo } = await setup();
  for (const unsafe of [{ ...brief, rightsConfirmed: false }, { ...brief, websiteUrl: 'https://127.0.0.1' }, { ...brief, websiteUrl: 'https://evil.org' }]) assert.equal((await creative.preaudit({ brief: unsafe, logo })).allowed, false);
  assert.equal((await creative.preaudit({ brief, logo: { ...logo, hash: 'a'.repeat(64) } })).allowed, false);
  const denied = await setup({ urlInspector: async () => { throw new Error('unsafe or unavailable destination'); } });
  const verdict = await denied.creative.preaudit({ brief, logo: denied.logo });
  assert.equal(verdict.state, 'QUARANTINED');
});
test('generation produces fixed-ratio raster artifacts and audit binds exact immutable hashes and CTA', async () => {
  const { creative, storage, logo } = await setup();
  const output = await creative.generate({ brief, logo, revisionId: 'revision-a', placements: ['venue_center_banner', 'main_stage_screen'] });
  assert.equal(output.verdict.allowed, true, JSON.stringify(output.verdict));
  assert.equal(output.artifacts.length, 2);
  for (const artifact of output.artifacts) {
    const meta = await sharp(await storage.get(artifact.key)).metadata();
    assert.equal(meta.format, 'png');
    assert.equal(meta.width / meta.height, artifact.placement === 'venue_center_banner' ? 4 : 16 / 9);
  }
  assert.equal(output.verdict.reviewedHash, output.manifestHash);
  assert.equal(output.manifest.cta[1].url, brief.websiteUrl);
  const revised = await creative.generate({ brief: { ...brief, description: 'Another game description.' }, logo, revisionId: 'revision-b', placements: ['venue_center_banner'] });
  assert.notEqual(output.manifestHash, revised.manifestHash);
});
test('uncertain, missing, timed-out or incorrectly bound final moderation never approves publication', async () => {
  const { creative, logo } = await setup({ model: { audit: async () => ({ decision: 'ALLOW', reasons: [], reviewedHash: 'a'.repeat(64) }) } });
  const output = await creative.generate({ brief, logo, revisionId: 'revision-a', placements: ['venue_center_banner'] });
  assert.equal(output.verdict.state, 'QUARANTINED');
  const timed = await setup({ config: { ...config, model: { ...config.model, timeoutMs: 10 } }, model: { audit: async () => new Promise(() => {}) } });
  const result = await timed.creative.preaudit({ brief, logo: timed.logo });
  assert.equal(result.state, 'QUARANTINED');
  assert.match(result.reasons[0].code, /TIMEOUT/);
  const unavailable = createCreativeService({ config, storage: { get: async () => Buffer.alloc(0) }, model: null, urlInspector: async url => ({ url }) });
  assert.equal((await unavailable.preaudit({ brief, logo })).allowed, false);
});


test('worst-case cost and input budgets are reserved before invoking any model', async () => {
  let calls = 0;
  const tooCheap = await setup({ config: { ...config, model: { ...config.model, maxCostMicrousd: 3 } }, model: { audit: async () => { calls += 1; return {}; } } });
  const blocked = await tooCheap.creative.preaudit({ brief, logo: tooCheap.logo });
  assert.equal(blocked.state, 'QUARANTINED');
  assert.equal(blocked.reasons[0].code, 'MODEL_BUDGET');
  assert.equal(calls, 0);
  const tooSmall = await setup({ config: { ...config, model: { ...config.model, maxInputTokens: 4096 } }, model: { audit: async () => { calls += 1; return {}; } } });
  assert.equal((await tooSmall.creative.preaudit({ brief, logo: tooSmall.logo })).reasons[0].code, 'MODEL_INPUT_BUDGET');
  assert.equal(calls, 0);
  const normal = await setup();
  const audited = await normal.creative.preaudit({ brief, logo: normal.logo });
  assert.deepEqual(audited.budget, { calls: 1, reservedMicrousd: '4', maxCostMicrousd: 20 });
});
