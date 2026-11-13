/** Local browser verification: all service and wallet interactions are intercepted fixtures. No RPC, AI, passkey or payment. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { StrKey } from '@stellar/stellar-sdk';
import { createWalletDevelopmentServer } from './serve-wallet.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'docs/reviews/reservations-ui'); await fs.mkdir(output, { recursive: true });
const id = value => value.repeat(64), address = value => StrKey.encodeContract(Buffer.alloc(32, value));
const hostAddress = address(1), brandAddress = address(2), contract = address(3);
const server = createWalletDevelopmentServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage(); const errors = [], requests = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());
let role = 'host', authenticated = true, conflict = false, failCatalog = false, failPrepare = false, failSubmit = false, paused = false, force401 = false, admitted = true, failMedia = false, failUpload = false, sessionFailure = 0;
let counter = 5, prepareCalls = 0, submitCalls = 0, proposalCalls = 0;
let project = { id: id('a'), revision: 1, title: 'Encuentro de diseño', context: 'Una propuesta para compartir ideas y proyectos.', spaces: [{ id: id('b'), name: 'Sala central', purpose: 'Presentaciones y encuentros' }], map: { mediaId: id('c'), points: [{ spaceId: id('b'), x: .4, y: .5 }] }, conversation: [{ id: id('d'), role: 'user', content: 'Contexto privado del anfitrión.', createdAt: '2026-11-13T12:00:00Z' }], editorialState: 'DRAFT', approvedSnapshotId: null, approvedSnapshot: null };
let offers = [], attempt = null, receipt = null;
const identity = () => ({ ownerId: role, address: role === 'host' ? hostAddress : brandAddress, role, mayReserve: role === 'brand' && admitted });
const session = () => ({ identity: identity(), expiresAt: new Date(Date.now() + 1800000).toISOString(), pendingAttempt: attempt && ['PREPARED', 'SUBMITTING', 'PENDING', 'NEEDS_RECONCILIATION'].includes(attempt.state) && attempt.actorAddress === identity().address ? attempt : null });
const mapImage = await sharp(Buffer.from('<svg width="900" height="520" xmlns="http://www.w3.org/2000/svg"><rect width="900" height="520" fill="#e7e9df"/><g fill="#c9dcd6" stroke="#346778" stroke-width="4"><rect x="45" y="50" width="460" height="340"/><rect x="545" y="50" width="310" height="210"/><rect x="545" y="300" width="310" height="150"/></g><text x="80" y="115" font-family="Arial" font-size="28" fill="#183f4b">PLANO DE PRUEBA</text><text x="80" y="455" font-family="Arial" font-size="21" fill="#183f4b">Imagen ficticia para comprobar la interfaz</text></svg>')).png().toBuffer();
const response = (route, value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  requests.push({ method: request.method(), path: url.pathname });
  if (url.origin !== origin) return route.abort();
  if (url.pathname === '/reservations-wallet.mjs') return route.fulfill({ contentType: 'application/javascript', body: `export async function createReservationsWallet(config,{api}){let account=null;return{get address(){return account},async connect(){account=${JSON.stringify(identity().address)};return{address:account,credentialId:'fixture'}},async prepareAuthentication(){return api.request('/auth/challenge',{method:'POST',body:{address:account,credentialId:'fixture'}})},async authenticate(){return api.request('/auth/verify',{method:'POST',body:{challengeId:'FIXTURE',response:{id:'fixture'}}})},prepare(){return{}},async sign(){return{func:'FIXTURE_ONLY',auth:['FIXTURE_ONLY']}}}}` });
  if (!url.pathname.startsWith('/api/reservations/')) return route.continue();
  const endpoint = url.pathname.slice('/api/reservations'.length), method = request.method();
  const body = request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : null;
  if (endpoint === '/config') return response(route, { enabled: true, mode: 'CONTROLLED', intakeEnabled: !paused, network: 'stellar:testnet', origin, rpId: '127.0.0.1', rpcUrl: 'https://soroban-testnet.stellar.org', networkPassphrase: 'Test SDF Network ; September 2015', projectId: project.id, contractId: contract, accountWasmHash: id('f'), webauthnVerifierAddress: address(4), capabilities: { authentication: true, reading: true, offerReading: true, mediaRead: true, recovery: true, project: !paused, media: !paused, publication: !paused, reservation: !paused, conversation: !paused }, limits: { spaces: 20, uploadBytes: 2097152, imageWidth: 2048, imageHeight: 2048 } });
  if (endpoint === '/auth/logout') { authenticated = false; return response(route, { ok: true }); }
  if (endpoint === '/auth/session') return sessionFailure ? route.fulfill({ status: sessionFailure, contentType: 'application/json', headers: { 'Retry-After': '5' }, body: JSON.stringify({ code: sessionFailure === 429 ? 'RATE_LIMIT' : 'UNAVAILABLE' }) }) : authenticated ? response(route, session()) : response(route, { code: 'AUTH_REQUIRED' }, 401);
  if (endpoint === '/auth/challenge') return response(route, { challengeId: 'FIXTURE' });
  if (endpoint === '/auth/verify') { authenticated = true; return response(route, session()); }
  if (endpoint === '/offers') return failCatalog ? response(route, { code: 'UNAVAILABLE' }, 503) : response(route, { offers });
  if (/^\/offers\/[^/]+\/media$/.test(endpoint)) return failMedia ? response(route, { code: 'UNAVAILABLE' }, 503) : route.fulfill({ contentType: 'image/png', body: mapImage });
  if (/^\/offers\/[a-f0-9]{64}$/.test(endpoint)) { const offer = offers.find(offer => endpoint.endsWith(offer.id)); return offer ? response(route, { offer }) : response(route, { code: 'NOT_FOUND' }, 404); }
  if (!authenticated || force401) return response(route, { code: 'SESSION_EXPIRED' }, 401);
  if (/^\/media\/[a-f0-9]{64}$/.test(endpoint)) return role === 'host' ? route.fulfill({ contentType: 'image/png', body: mapImage }) : response(route, { code: 'FORBIDDEN' }, 403);
  if (endpoint === '/project' && method === 'GET') return role === 'host' ? response(route, { project }) : response(route, { code: 'FORBIDDEN' }, 403);
  if (endpoint === '/project' && method === 'PUT') {
    if (conflict) return response(route, { code: 'REVISION_CONFLICT' }, 409);
    assert.equal(body.expectedRevision, project.revision); assert.deepEqual(Object.keys(body).sort(), ['context', 'expectedRevision', 'map', 'spaces', 'title']);
    project = { ...project, ...body, revision: project.revision + 1, spaces: body.spaces.map(space => ({ ...space, id: space.id || (++counter).toString(16).padStart(64, '0') })), editorialState: 'DRAFT', approvedSnapshotId: null, approvedSnapshot: null }; delete project.expectedRevision;
    return response(route, { project });
  }
  if (endpoint === '/media' && method === 'POST') return failUpload ? response(route, { code: 'UNAVAILABLE' }, 503) : response(route, { media: { id: id('c'), width: 900, height: 520, mime: 'image/png' } });
  if (endpoint === '/conversation') { proposalCalls++; const proposal = { summary: 'Propuesta de prueba <img src=x onerror=alert(1)>', title: 'Encuentro creativo', context: 'Presentaciones y colaboración.', spaces: [{ name: 'Escenario', purpose: 'Compartir proyectos' }, { name: 'Mesa de conversación', purpose: 'Conectar equipos' }] }; const message = { role: 'assistant', content: proposal }; project.conversation.push(message); return response(route, { message, proposal }); }
  if (endpoint === '/approval') {
    const space = project.spaces.find(space => space.id === body.spaceId);
    project.approvedSnapshot = { id: id('8'), projectId: project.id, revision: project.revision, spaceId: space.id, title: project.title, context: project.context, space, map: { ...project.map, points: project.map.points.filter(point => point.spaceId === space.id) }, contentHash: id('9'), approvedAt: '2026-11-13T12:10:00Z' };
    project.approvedSnapshotId = project.approvedSnapshot.id; project.editorialState = 'APPROVED'; return response(route, { snapshot: project.approvedSnapshot });
  }
  if (endpoint === '/attempts/prepare') {
    prepareCalls++; const snapshot = body.operation === 'publish' ? project.approvedSnapshot : offers[0].snapshot;
    attempt = attempt && attempt.operation === body.operation && attempt.actorAddress === identity().address ? attempt : { id: body.operation === 'publish' ? id('1') : id('2'), operation: body.operation, state: 'PREPARED', offerId: id('e'), snapshotId: snapshot.id, actorAddress: identity().address, expiresAt: new Date(Date.now() + 120000).toISOString() };
    if (failPrepare) return route.abort('failed');
    return response(route, { attempt, receipt, review: { title: snapshot.title, spaceName: snapshot.space.name }, signing: { fixture: true } });
  }
  if (/^\/attempts\/[a-f0-9]{64}\/submit$/.test(endpoint)) { submitCalls++; attempt.state = 'PENDING'; if (failSubmit) return route.abort('failed'); return response(route, { attempt, receipt }); }
  if (/^\/attempts\/[a-f0-9]{64}$/.test(endpoint)) return attempt && attempt.actorAddress === identity().address ? response(route, { attempt, receipt }) : response(route, { code: 'NOT_FOUND' }, 404);
  return response(route, { code: 'NOT_FOUND' }, 404);
});
const check = (name, condition = true) => { assert.ok(condition, name); checks.push(name); };
const idle = () => page.waitForFunction(() => !document.querySelector('#refresh-offers').disabled);
const screenshot = async name => {
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.evaluate(() => { if (!document.getElementById('fixture-label')) { const p = document.createElement('p'); p.id = 'fixture-label'; p.textContent = 'FIXTURE LOCAL · SIN FIRMAS NI RED'; p.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:99;background:#0e2635;color:#fff;font:11px Arial;padding:8px'; document.body.append(p); } });
  await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
};
try {
  await page.goto(origin + '/reservas'); await idle();
  check('restores private host project and conversation', await page.locator('#project-title').inputValue() === project.title && await page.locator('#conversation').innerText().then(value => value.includes('Contexto privado')));
  const initialMutations = requests.filter(request => request.method === 'POST' || request.method === 'PUT'); check('page load never mutates or requests funds', initialMutations.length === 0);
  await page.locator('#project-title').fill('Encuentro revisado'); await page.locator('#save-project').click(); await idle();
  check('explicit save persists revision and restores on reload', project.title === 'Encuentro revisado' && project.revision === 2);
  await page.reload(); await idle(); assert.equal(await page.locator('#project-title').inputValue(), 'Encuentro revisado');
  await page.locator('#map-space').selectOption(project.spaces[0].id); await page.locator('#point-0-x').fill('30'); await page.locator('#point-0-x').press('Tab'); await page.locator('#save-project').click(); await idle();
  check('keyboard coordinate edits persist normalized map position', project.map.points[0].x === .3);
  const mediaPosts = () => requests.filter(request => request.method === 'POST' && request.path === '/api/reservations/media').length;
  await page.locator('#media-rights').check(); await page.locator('#map-file').setInputFiles({ name: 'too-large.png', mimeType: 'image/png', buffer: Buffer.alloc(2097153) }); await page.locator('#upload-map').click(); await idle();
  check('oversized image is rejected before upload and preserves the existing map', mediaPosts() === 0 && await page.locator('#global-error').innerText().then(value => value.includes('2 MiB')) && await page.locator('#points-list .point-row').count() === 1);
  const tooWide = await sharp({ create: { width: 2049, height: 1, channels: 3, background: '#ffffff' } }).png().toBuffer();
  await page.locator('#map-file').setInputFiles({ name: 'too-wide.png', mimeType: 'image/png', buffer: tooWide }); await page.locator('#upload-map').click(); await idle();
  check('decoded image dimensions are checked before upload', mediaPosts() === 0 && await page.locator('#global-error').innerText().then(value => value.includes('2048')));
  failUpload = true; await page.locator('#map-file').setInputFiles({ name: 'map-fixture.png', mimeType: 'image/png', buffer: mapImage }); await page.locator('#upload-map').click(); await idle();
  check('failed media upload preserves existing positions', mediaPosts() === 1 && await page.locator('#points-list .point-row').count() === 1 && project.map.points[0].x === .3); failUpload = false;
  conflict = true; await page.locator('#project-title').fill('Cambio local en conflicto'); await page.locator('#save-project').click(); await idle();
  check('409 keeps local draft and exposes server comparison', await page.locator('#project-title').inputValue() === 'Cambio local en conflicto' && await page.locator('#project-conflict').isVisible());
  conflict = false; await page.locator('#use-server-project').click();
  await page.locator('#assistant-message').fill('Ayúdame a organizar dos espacios'); await page.locator('#ask-assistant').click(); await idle();
  check('AI proposal neither edits project nor renders untrusted HTML', proposalCalls === 1 && project.title === 'Encuentro revisado' && await page.locator('#proposal img').count() === 0);
  await page.reload(); await idle();
  check('structured assistant history survives reload as readable text without HTML execution', await page.locator('#conversation').innerText().then(text => text.includes('Encuentro creativo') && text.includes('Mesa de conversación') && !text.includes('[object Object]')) && await page.locator('#conversation img').count() === 0 && await page.locator('#proposal').isHidden());
  await page.getByRole('button', { name: 'Revisar propuesta del historial' }).last().click();
  check('historical proposal can be reopened for review without applying or requesting AI', project.title === 'Encuentro revisado' && proposalCalls === 1 && await page.locator('#proposal').isVisible());
  await page.locator('#proposal input[type=checkbox]').check(); await page.getByRole('button', { name: 'Aplicar y guardar propuesta' }).click(); await idle();
  check('explicit proposal application replaces spaces and clears points', project.title === 'Encuentro creativo' && project.spaces.length === 2 && project.map.points.length === 0);
  await page.locator('#map-space').selectOption(project.spaces[0].id); await page.locator('#add-point').click(); await page.locator('#save-project').click(); await idle();
  await page.locator('#review-space').selectOption(project.spaces[0].id); await page.locator('#approve-consent').check(); await page.locator('#approve-project').click(); await idle();
  check('approval returns exact immutable snapshot and does not publish', project.approvedSnapshot?.spaceId === project.spaces[0].id && prepareCalls === 0);
  await screenshot('host-desktop-fixture');
  for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport); check('no horizontal overflow at ' + viewport.width, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot('host-mobile-fixture');
  await page.locator('#connect').click(); await idle();
  await page.locator('#prepare-publish').click(); await idle(); check('preparation does not submit or sign automatically', prepareCalls === 1 && submitCalls === 0 && await page.locator('#sign-attempt').isVisible());
  await page.locator('#project-title').fill('Cambio después de revisar'); check('editing after preparation invalidates the local signing token', await page.locator('#sign-attempt').isHidden() && submitCalls === 0);
  await page.locator('#project-title').fill(project.title); await page.locator('#recover-attempt').click(); await idle();
  failSubmit = true; await page.locator('#sign-attempt').click(); await idle();
  check('lost submission remains uncertain and cannot sign again', submitCalls === 1 && await page.locator('#sign-attempt').isHidden() && await page.locator('#attempt-content').innerText().then(text => text.includes('verificación')));
  sessionFailure = 429; await page.reload(); await idle();
  check('session 429 on reload is temporary uncertainty, not a logged-out session', await page.locator('#session-label').innerText() === 'Consulta de sesión pendiente' && await page.locator('#global-error').innerText().then(text => text.includes('5 segundos')) && await page.locator('#connect').isDisabled() && await page.locator('#retry-session').isEnabled() && new URL(page.url()).searchParams.get('intento') === attempt.id);
  sessionFailure = 503; await page.locator('#retry-session').click(); await idle();
  check('session 503 retains recovery navigation and blocks new signing', await page.locator('#session-label').innerText() === 'Consulta de sesión pendiente' && await page.locator('#global-error').isVisible() && await page.locator('#sign-attempt').isHidden() && submitCalls === 1 && prepareCalls === 2);
  sessionFailure = 0; await page.locator('#retry-session').click(); await idle(); check('session retry restores pending intent without reconnecting or resubmitting', submitCalls === 1 && prepareCalls === 2 && await page.locator('#attempt-section').isVisible() && await page.locator('#retry-session').isHidden());
  await screenshot('pending-mobile-fixture');
  attempt.state = 'CONFIRMED'; receipt = { txHash: id('7'), ledger: 12345, offer: { id: id('e'), state: 'AVAILABLE', holder: null, host: hostAddress, projectId: project.id, spaceId: project.approvedSnapshot.spaceId } };
  offers = [{ id: id('e'), snapshot: structuredClone(project.approvedSnapshot), state: 'AVAILABLE', holder: null }];
  await page.locator('#check-attempt').click(); await idle(); check('confirmation requires a receipt and recovers without a signature', await page.getByText('Publicación confirmada', { exact: true }).count() === 1 && submitCalls === 1);
  check('confirmed receipt replaces the global in-progress message', await page.locator('#global-status').innerText() === 'Publicación confirmada en Stellar Testnet.');
  await screenshot('receipt-mobile-fixture');
  await page.locator('#logout').click(); await idle();
  check('logout clears private DOM while leaving public catalogue', await page.locator('#mi-espacio').isHidden() && await page.locator('#conversation').innerText() === '' && await page.locator('#project-title').inputValue() === '' && await page.locator('#map-space option').count() === 0 && await page.locator('#review-space option').count() === 0);
  role = 'brand'; authenticated = false; attempt = null; receipt = null; failSubmit = false;
  await page.goto(origin + '/reservas'); await idle(); check('brand sees catalogue without host controls', await page.locator('#mi-espacio').isHidden());
  await page.locator('#connect').click(); await idle(); check('connecting a passkey does not authenticate automatically', !authenticated && await page.locator('#authenticate').isVisible());
  await page.locator('#authenticate').click(); await idle(); check('explicit authentication establishes a separate brand session', authenticated && await page.locator('#mi-espacio').isHidden());
  failMedia = true; await page.reload(); await idle(); await page.getByRole('button', { name: 'Revisar reserva', exact: true }).click(); await idle(); await page.locator('#reserve-consent').check();
  await page.getByText('No pudimos cargar la imagen. Actualiza la página para revisarla antes de continuar.', { exact: true }).last().waitFor();
  check('missing snapshot image blocks preparation instead of approving an unseen review', await page.locator('#prepare-reserve').isDisabled());
  failMedia = false; await page.reload(); await idle(); await page.locator('#connect').click(); await idle(); await page.getByRole('button', { name: 'Revisar reserva', exact: true }).click(); await idle(); await page.locator('#reserve-consent').check();
  failPrepare = true; await page.locator('#prepare-reserve').click(); await idle(); check('lost prepare blocks new preparation and discovers durable intent', await page.locator('#prepare-reserve').isDisabled() && await page.locator('#attempt-section').isVisible());
  sessionFailure = 503; await page.locator('#check-attempt').click(); await idle();
  check('temporary session failure preserves an already visible uncertain attempt and disables signatures', await page.locator('#attempt-section').isVisible() && await page.locator('#session-label').innerText() === 'Consulta de sesión pendiente' && await page.locator('#connect').isDisabled() && await page.locator('#sign-attempt').isHidden() && submitCalls === 1);
  sessionFailure = 0;
  await page.locator('#check-attempt').click(); await idle(); check('recovered PREPARED requires fresh explicit review, not automatic signature', await page.locator('#recover-attempt').isVisible() && await page.locator('#sign-attempt').isHidden());
  failPrepare = false; await page.locator('#recover-attempt').click(); await idle(); await page.locator('#sign-attempt').click(); await idle();
  check('brand signs and submits only after explicit review', submitCalls === 2);
  admitted = false; await page.reload(); await idle(); check('removed brand admission blocks new reservations but retains pending recovery', await page.locator('#check-attempt').isEnabled() && await page.getByRole('button', { name: 'Revisar reserva', exact: true }).isDisabled());
  await page.locator('#check-attempt').click(); await idle(); check('disallowed brand still reconciles without resubmitting', submitCalls === 2 && await page.locator('#attempt-section').isVisible());
  paused = true; await page.reload(); await idle(); check('paused intake preserves pending recovery', await page.locator('#check-attempt').isEnabled() && await page.getByRole('button', { name: 'Revisar reserva', exact: true }).isDisabled());
  await page.locator('#check-attempt').click(); await idle();
  force401 = true; await page.locator('#check-attempt').click(); await idle(); check('only confirmed session expiry clears the visible attempt and permits reconnecting', await page.locator('#attempt-section').isHidden() && await page.locator('#retry-session').isHidden() && await page.locator('#session-label').innerText() === 'Conecta una wallet existente'); force401 = false;
  failCatalog = true; await page.locator('#refresh-offers').click(); await idle(); check('catalogue error is distinct from an empty catalogue', await page.locator('#offers-list').innerText().then(text => text.includes('No pudimos consultar')));
  await screenshot('catalogue-error-fixture');
  const forbidden = requests.filter(request => /wallet\/(faucet|relay)|\/ads|transfer|deploy/.test(request.path)); check('zero faucet, deploy, relay or advertising calls', forbidden.length === 0);
  check('no unhandled browser JavaScript errors', errors.length === 0);
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ recordedAt: new Date().toISOString(), evidence: 'LOCAL HTTP AND WALLET FIXTURES; NOT A LIVE ACCEPTANCE RESULT', checks, errors, mutations: requests.filter(request => !['GET', 'HEAD'].includes(request.method)), prepareCalls, submitCalls, externalProvidersCalled: false }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: checks.length, output, errors }, null, 2));
} finally { await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
