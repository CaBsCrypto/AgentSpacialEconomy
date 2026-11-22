/** Offline browser verification: static files are fulfilled locally; providers and WebAuthn are blocked. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import * as sdk from '@stellar/stellar-sdk';
import { createPlan, PINS } from '../dist/reservations-operator-core.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist'), output = path.join(root, '.tools', 'reservation-operator-ui');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const requests = [], forbidden = [], errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => {
  window.__operatorPrompts = [];
  for (const method of ['get', 'create']) Object.defineProperty(Object.getPrototypeOf(navigator.credentials), method, { configurable: true, value() { window.__operatorPrompts.push(method); return Promise.reject(Error('WebAuthn blocked in offline verification')); } });
});
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url()); requests.push(url.pathname);
  if (url.origin !== PINS.origin || request.method() !== 'GET' || url.pathname.startsWith('/api/')) { forbidden.push(url.origin + url.pathname); return route.abort(); }
  const target = path.resolve(dist, '.' + decodeURIComponent(url.pathname));
  if (!target.startsWith(dist + path.sep)) { forbidden.push('path'); return route.abort(); }
  try { const body = await fs.readFile(target); return route.fulfill({ body, contentType: target.endsWith('.html') ? 'text/html' : target.endsWith('.css') ? 'text/css' : 'application/javascript' }); }
  catch { return route.fulfill({ status: 404, body: 'Not found' }); }
});
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
const plan = await createPlan(sdk, { kind: 'bootstrap', intentId: 'a'.repeat(64), sourceSha: 'b'.repeat(40), hostAddress: sdk.StrKey.encodeContract(Buffer.alloc(32, 1)), projectId: 'c'.repeat(64), salt: 'd'.repeat(64) });
try {
  await page.goto(PINS.origin + '/reservations-operator.html');
  for (const name of ['connect', 'sign', 'export']) assert.equal(await page.locator('#' + name).isDisabled(), true);
  await page.locator('#plan').setInputFiles({ name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)) });
  await page.locator('#review:not([hidden])').waitFor();
  assert.match(await page.locator('#details').textContent(), new RegExp(plan.contractId));
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('deshabilitada'));
  for (const name of ['connect', 'sign', 'export']) assert.equal(await page.locator('#' + name).isDisabled(), true);
  await page.screenshot({ path: path.join(output, 'desktop-disabled.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, 'mobile-disabled.png'), fullPage: true });
  await page.locator('#plan').setInputFiles({ name: 'tampered.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...plan, wasmHash: 'e'.repeat(64) })) });
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('ajenos al candidato'));
  assert.equal(await page.locator('#review').isHidden(), true);
  assert.deepEqual(await page.evaluate(() => window.__operatorPrompts), []);
  assert.deepEqual(forbidden, []); assert.deepEqual(errors, []);
  const result = { status: 'PASS', checks: ['disabled-by-default', 'valid-plan-review', 'no-sign-with-disabled-policy', 'tampered-wasm-rejected', 'mobile-no-overflow', 'zero-webauthn-prompts', 'zero-provider-requests', 'zero-page-errors'], requests, screenshots: ['desktop-disabled.png', 'mobile-disabled.png'] };
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); }
