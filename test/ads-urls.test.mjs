import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, isPublicAddress, inspectUrl } from '../server/ads/urls.mjs';

const allowedDomains = ['x.com', 'example.com', 'cdn.example.com'];
test('CTA normalization rejects active schemes, credentials, IP aliases and unadmitted domains', () => {
  assert.equal(normalizeUrl('https://EXAMPLE.com/path', { allowedDomains }), 'https://example.com/path');
  for (const url of ['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com', 'https://127.1', 'https://2130706433', 'https://[::1]', 'https://example.com:8443', 'https://example.com.evil.org', 'https://example.com\\@evil.org', 'https://example.com/\n']) assert.throws(() => normalizeUrl(url, { allowedDomains }));
  assert.throws(() => normalizeUrl('https://example.com', {}), /admitted/);
});
test('DNS policy rejects private, link local, mapped and multicast ranges', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.31.1.1', '192.168.1.1', '100.100.100.200', '224.0.0.1', '198.18.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2002:7f00:1::', '2001:db8::1']) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});
test('every redirect rechecks domain and DNS and pins the checked connection address', async () => {
  const calls = [];
  const result = await inspectUrl('https://example.com/start', {
    allowedDomains, lookup: async host => [{ address: host === 'example.com' ? '8.8.8.8' : '1.1.1.1', family: 4 }],
    request: async (url, options) => {
      calls.push({ url: url.href, ...options });
      return url.hostname === 'example.com' ? { statusCode: 302, headers: { location: 'https://cdn.example.com/end' } } : { statusCode: 200, headers: {} };
    },
  });
  assert.equal(result.url, 'https://cdn.example.com/end');
  assert.deepEqual(calls.map(call => call.address), ['8.8.8.8', '1.1.1.1']);
  await assert.rejects(inspectUrl('https://example.com/start', { allowedDomains, lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: async () => ({ statusCode: 302, headers: { location: 'https://unadmitted.org' } }) }), /admitted/);
  let requested = false;
  await assert.rejects(inspectUrl('https://example.com', { allowedDomains, lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }], request: async () => { requested = true; } }), /restricted/);
  assert.equal(requested, false);
});
test('unavailable inspection, redirect loops and unsuccessful destinations fail closed', async () => {
  const base = { allowedDomains, lookup: async () => [{ address: '8.8.8.8', family: 4 }] };
  await assert.rejects(inspectUrl('https://example.com', { ...base, request: async () => { throw new Error('network'); } }), /safely inspected/);
  await assert.rejects(inspectUrl('https://example.com', { ...base, request: async () => ({ statusCode: 302, headers: { location: '/' } }) }), /loop/);
  await assert.rejects(inspectUrl('https://example.com', { ...base, request: async () => ({ statusCode: 405, headers: {} }) }), /successful/);
});
