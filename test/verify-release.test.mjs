import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifyRelease } from '../scripts/verify-release.mjs';

function fixture(override = () => null) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    const pathname = new URL(url).pathname;
    const custom = await override(pathname);
    if (custom) return custom;
    if (pathname === '/') return new Response(`<h1>Agentic Realities · Spatial AI for Venues and Events</h1><p>AGENTIC REALITY · AUGMENTED SPATIAL EXPERIENCES</p><p>Your venue's AI operator automating your event AR layer with x402 on a capped USDC budget.</p><a href="/dashboard.html">See the testnet evidence</a><a href="https://github.com/CaBsCrypto/AgentSpacialEconomy">GitHub</a>`, { headers: { 'content-type': 'text/html' } });
    if (pathname === '/one16') return new Response('<script type="module" src="/entry.mjs"></script>', { headers: { 'content-type': 'text/html' } });
    if (pathname === '/dashboard.html') return new Response('On-chain budget ceiling · recorded run', { headers: { 'content-type': 'text/html' } });
    if (pathname === '/sitemap.xml') return new Response('<urlset><url>https://agenticreality.space/one16</url><url>https://agenticreality.space/dashboard.html</url></urlset>', { headers: { 'content-type': 'application/xml' } });
    if (pathname === '/api/wallet/config') return Response.json({ enabled: true, configured: true, network: 'testnet', networkPassphrase: 'Test SDF Network ; September 2015', rpcUrl: 'https://soroban-testnet.stellar.org' });
    try {
      const body = await readFile(new URL('../dist' + pathname, import.meta.url));
      return new Response(body, { headers: { 'content-type': pathname.endsWith('.json') ? 'application/json' : pathname.endsWith('.txt') ? 'text/plain' : 'application/javascript', 'cache-control': 'no-store' } });
    } catch { return new Response('missing', { status: 404 }); }
  };
  return { fetchImpl, requests };
}

test('release verification accepts coherent real fixtures and only makes public GET requests', async () => {
  const { fetchImpl, requests } = fixture();
  const report = await verifyRelease('https://release.example', { fetchImpl });
  assert.equal(report.passed, true, JSON.stringify(report.checks.filter(check => !check.pass)));
  assert.ok(requests.length > 15);
  assert.ok(requests.every(({ url, options }) => new URL(url).origin === 'https://release.example' && options.method === 'GET' && options.redirect === 'manual' && !options.body && !options.headers));
});

test('an HTML fallback with status 200 cannot masquerade as a released JSON route', async () => {
  const { fetchImpl } = fixture(pathname => pathname === '/state/stage.json' ? new Response('<html>SPA fallback</html>', { headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=600' } }) : null);
  const report = await verifyRelease('https://release.example', { fetchImpl });
  assert.equal(report.passed, false);
  for (const name of ['GET /state/stage.json', '/state/stage.json parses as JSON', '/state/stage.json is not cached']) assert.equal(report.checks.find(check => check.name === name)?.pass, false, name);
});

test('verification refuses mixed runs and a disabled wallet pilot without exposing response bodies', async () => {
  const sensitivePattern = 'S' + 'A'.repeat(55);
  const { fetchImpl } = fixture(async pathname => {
    if (pathname === '/state/stage.json') {
      const stage = JSON.parse(await readFile(new URL('../dist/state/stage.json', import.meta.url)));
      stage.runId = 'different-run';
      return Response.json(stage, { headers: { 'cache-control': 'no-store' } });
    }
    if (pathname === '/api/wallet/config') return Response.json({ enabled: false, configured: true, network: 'testnet', networkPassphrase: 'Test SDF Network ; September 2015', rpcUrl: 'https://soroban-testnet.stellar.org', unexpected: sensitivePattern });
    return null;
  });
  const report = await verifyRelease('https://release.example', { fetchImpl });
  assert.equal(report.passed, false);
  assert.equal(report.checks.find(check => check.name === 'Ledger and stage have the same run')?.pass, false);
  assert.equal(report.checks.find(check => check.name === 'Wallet pilot is enabled and configured')?.pass, false);
  assert.equal(JSON.stringify(report).includes(sensitivePattern), false);
  assert.ok(report.checks.some(check => check.detail?.redacted === true && !check.pass));
});


test('integration-only mode permits the preserved landing while final QA requires brand and CTA', async () => {
  const { fetchImpl } = fixture(pathname => pathname === '/' ? new Response('<h1>Existing landing</h1>', { headers: { 'content-type': 'text/html' } }) : null);
  const integration = await verifyRelease('https://release.example', { fetchImpl, integrationOnly: true });
  assert.equal(integration.passed, true, JSON.stringify(integration.checks.filter(check => !check.pass)));
  assert.equal(integration.mode, 'integration');
  const final = await verifyRelease('https://release.example', { fetchImpl });
  assert.equal(final.passed, false);
  assert.equal(final.mode, 'final');
  assert.equal(final.checks.find(check => check.name === 'Landing preserves project name, brand line and tagline')?.pass, false);
  assert.equal(final.checks.find(check => check.name === 'Landing links to live testnet dashboard')?.pass, false);
});
