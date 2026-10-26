import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LANGUAGE_KEY, PAGE_TITLES, SPANISH_COPY, resolvePlatformLanguage, applyPlatformLanguage, mountPlatform, SCENE_VIEW_COPY, SCENE_VIEWS, updateSceneCaption, deferOne16Preview, buildQuoteRequest, validateQuote, QUOTE_SUBJECT, mountQuoteForm } from '../dist/platform.mjs';

const html = fs.readFileSync(new URL('../dist/platform.html', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../dist/platform.mjs', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../dist/platform.css', import.meta.url), 'utf8');

class Node extends EventTarget {
  constructor(text = '', attributes = {}) {
    super(); this.textContent = text; this.attributes = { ...attributes }; this.dataset = {};
    for (const [key, value] of Object.entries(attributes)) if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  getAttribute(key) { return this.attributes[key] ?? null; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  click() { this.dispatchEvent(new Event('click')); }
}
function fixture() {
  const hero = new Node('Spaces that respond to their people', { 'data-i18n': 'heroTitle' });
  const how = new Node('One way in.More ways to interact.', { 'data-i18n': 'howTitle' });
  const phase = new Node('Available', { 'data-i18n': 'phaseCurrent' });
  const meta = new Node('', { 'data-i18n-content': 'metaDescription', content: 'Original English description' });
  const aria = new Node('', { 'data-i18n-aria': 'navAria', 'aria-label': 'Main navigation' });
  const image = new Node('', { 'data-i18n-alt': 'one16ImageAlt', alt: 'Original venue render description' });
  const buttons = ['en', 'es', 'en', 'es'].map(language => new Node(language.toUpperCase(), { 'data-language': language }));
  const nodes = { '[data-i18n]': [hero, how, phase], '[data-i18n-content]': [meta], '[data-i18n-aria]': [aria], '[data-i18n-alt]': [image], '[data-language]': buttons };
  const documentRef = { title: PAGE_TITLES.en, documentElement: { lang: 'en', dataset: {} }, querySelectorAll: selector => nodes[selector] || [] };
  return { documentRef, hero, how, phase, meta, aria, image, buttons };
}

test('the public root is an English landing with direct ONE16 calls and a deferred concept scene', () => {
  assert.match(html, /<html lang="en"/);
  assert.match(html, /Spaces that respond to their people/);
  assert.match(html, /Agentic Realities · Spatial AI for Venues and Events/);
  assert.ok((html.match(/href="\/one16"/g) || []).length >= 4);
  assert.match(html, /href="#how-it-works"/);
  assert.match(html, /src="\/platform.mjs\?v=premium-1"/);
  assert.match(html, /href="\/platform.css\?v=premium-1"/);
  // A non-submitting container protects entered details even when JavaScript never loads.
  assert.match(html, /<div class="quote-form" id="quoteForm" role="group"/);
  assert.doesNotMatch(html, /<form\b|type="submit"|mailto:|contact@agenticreality\.space/i);
  assert.match(html, /type="button" data-quote-prepare disabled/);
  assert.doesNotMatch(html + css, /submission-proof|spatial-proof/);
  assert.doesNotMatch(html, /entry\.mjs|viewer\.js|\.glb|\.usdz|data:image|wallet-controller\.mjs/i);
  assert.equal(/getUserMedia|requestSession|navigator\.credentials|fetch\(/.test(script), false);
  assert.deepEqual([...script.matchAll(/import\(['"]([^'"]+)/g)].map(match => match[1]), ['./platform-scene.mjs?v=premium-1', './one16-preview.mjs?v=1']);
  assert.match(html, /type="importmap"/);
  assert.match(html, /"three":"\/vendor\/three\/build\/three.module.js"/);
  const visibleCopy = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const forbidden = /\b(?:hackathon|genesis|track|rubric|score|judges?)\b|hackmeridian/i;
  assert.equal(forbidden.test(visibleCopy + Object.values(SPANISH_COPY).join(' ')), false, 'Public copy must describe the platform rather than its private evaluation context');
});

test('copy distinguishes the public demo, the Testnet pilot and planned commercial capabilities', () => {
  for (const phrase of ['3D demo available', 'Wallet access in Stellar Testnet', 'Test assets have no real value', 'Programmable advertising', 'Authorized agent services', 'x402']) assert.ok(html.includes(phrase), phrase);
  assert.match(html, /Organizers can commission custom immersive environments/);
  assert.match(html, /Brands and developers can commission activations and services/);
  assert.match(html, /does not imply an official partnership/);
  assert.match(html, /Platform concept · illustrative architecture/);
  for (const id of ['why', 'how-it-works', 'one16', 'next']) assert.match(html, new RegExp('id="' + id + '"'));
});

test('the only photographic preview is the actual inspected lightweight ONE16 render', () => {
  const images = [...html.matchAll(/<img\b[^>]*src="([^"]+)"[^>]*>/g)];
  assert.equal(images.length, 1);
  assert.equal(images[0][1], '/assets/overview.webp');
  assert.match(images[0][0], /loading="lazy"/);
  assert.ok(fs.statSync(new URL('../dist' + images[0][1], import.meta.url)).size < 100000);
  assert.match(html, /<svg class="spatial-diagram"[^>]*role="img"/);
  assert.doesNotMatch(css, /@import|https?:\/\//);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /focus-visible/);
});

test('every translated HTML text and accessibility attribute has a Spanish translation', () => {
  const keys = new Set([...html.matchAll(/data-i18n(?:-content|-aria|-alt)?="([^"]+)"/g)].map(match => match[1]));
  assert.deepEqual([...keys].sort(), Object.keys(SPANISH_COPY).sort());
  assert.equal(SPANISH_COPY.heroTitle, 'Espacios que responden a sus personas');
  assert.match(SPANISH_COPY.pilotBody, /no tienen valor real/);
});

test('English is the default, with explicit query precedence over a stored language', () => {
  assert.equal(resolvePlatformLanguage(), 'en');
  assert.equal(resolvePlatformLanguage({ storedLanguage: 'es' }), 'es');
  assert.equal(resolvePlatformLanguage({ search: '?lang=en', storedLanguage: 'es' }), 'en');
  assert.equal(resolvePlatformLanguage({ search: '?lang=es', storedLanguage: 'en' }), 'es');
  assert.equal(resolvePlatformLanguage({ search: '?lang=fr', storedLanguage: 'invalid' }), 'en');
});

test('switching Spanish updates metadata, labels and synchronized selectors, then restores English', () => {
  const f = fixture();
  applyPlatformLanguage(f.documentRef, 'es');
  assert.equal(f.hero.textContent, SPANISH_COPY.heroTitle);
  assert.equal(f.documentRef.documentElement.lang, 'es');
  assert.equal(f.documentRef.title, PAGE_TITLES.es);
  assert.equal(f.meta.getAttribute('content'), SPANISH_COPY.metaDescription);
  assert.equal(f.aria.getAttribute('aria-label'), SPANISH_COPY.navAria);
  assert.equal(f.image.getAttribute('alt'), SPANISH_COPY.one16ImageAlt);
  assert.deepEqual(f.buttons.map(button => button.getAttribute('aria-pressed')), ['false', 'true', 'false', 'true']);
  applyPlatformLanguage(f.documentRef, 'en');
  assert.equal(f.hero.textContent, 'Spaces that respond to their people');
  assert.equal(f.meta.getAttribute('content'), 'Original English description');
  assert.equal(f.how.textContent, 'One way in.\nMore ways to interact.');
  assert.equal(f.documentRef.title, PAGE_TITLES.en);
});

test('language selection persists locally and preserves unrelated query values and fragments', () => {
  const f = fixture(), values = new Map(), routes = [];
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const platform = mountPlatform({ documentRef: f.documentRef, locationRef: { href: 'https://agenticreality.space/?source=qr#why', search: '?source=qr' }, historyRef: { replaceState: (...args) => routes.push(args[2]) }, storage });
  assert.equal(platform.language, 'en');
  f.buttons[1].click();
  assert.equal(platform.language, 'es');
  assert.equal(values.get(LANGUAGE_KEY), 'es');
  assert.equal(routes[0], '/?source=qr&lang=es#why');
  f.buttons[2].click();
  assert.equal(platform.language, 'en');
  assert.equal(values.get(LANGUAGE_KEY), 'en');
  platform.destroy();
  f.buttons[3].click();
  assert.equal(platform.language, 'en');
});

test('a valid language query selects Spanish even when storage is unavailable', () => {
  const f = fixture();
  const platform = mountPlatform({ documentRef: f.documentRef, locationRef: { href: 'https://agenticreality.space/?lang=es', search: '?lang=es' }, historyRef: { replaceState() {} }, storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } });
  assert.equal(platform.language, 'es');
  assert.doesNotThrow(() => platform.setLanguage('en'));
  platform.destroy();
});

test('legacy QR/NFC continuation runs before preference storage and UI initialization', () => {
  let storageReads = 0, documentReads = 0;
  const redirects = [];
  const platform = mountPlatform({ documentRef: { querySelectorAll() { documentReads++; throw new Error('No landing initialization for NFC'); } }, locationRef: { href: 'https://agenticreality.space/?passport=stand16&from=nfc#recorrido', replace: value => redirects.push(value) }, storage: { getItem() { storageReads++; } } });
  assert.equal(platform.redirected, true);
  assert.deepEqual(redirects, ['https://agenticreality.space/one16?passport=stand16&from=nfc#recorrido']);
  assert.equal(storageReads, 0); assert.equal(documentReads, 0);
});




test('the landing segments spaces, services, scopes and both demos, and every quote path stays on the page', () => {
  for (const id of ['spaces', 'services', 'plans', 'demos', 'demo-visitor', 'demo-host', 'quote']) assert.match(html, new RegExp('id="' + id + '"'), id);
  for (const href of ['/dashboard.html', '/dashboard.html#ads-section', '/passport-space.html']) assert.ok(html.includes('href="' + href + '"'), href);
  assert.equal((html.match(/data-quote-scope="(?:event|season|permanent)"/g) || []).length, 3);
  for (const value of ['event', 'season', 'permanent']) assert.match(html, new RegExp('<option value="' + value + '" data-i18n="optScope'));
  assert.match(html, /Test assets have no real value/);
  assert.doesNotMatch(html, /href="\/ads(?:["?#])/);
  assert.match(html, /public ad checkout is not available here/);
});

test('a quote request needs a name, a valid email, a space and a scope, and becomes copyable text without a delivery destination', () => {
  assert.equal(validateQuote({ name: 'Ana', email: 'ana@example.org', space: 'event', scope: 'event' }), true);
  for (const missing of [{ name: '' }, { email: 'not-an-email' }, { space: '' }, { scope: '' }]) assert.equal(validateQuote({ name: 'Ana', email: 'ana@example.org', space: 'event', scope: 'event', ...missing }), false);
  const request = buildQuoteRequest([['Type of space', 'Event or venue'], ['Organization', ''], ['Your name', 'Ana & Co']], { language: 'en' });
  assert.equal(request.subject, QUOTE_SUBJECT.en);
  assert.equal(request.body, 'Type of space: Event or venue\nYour name: Ana & Co');
  assert.equal(request.text, QUOTE_SUBJECT.en + '\n\n' + request.body);
  assert.equal('mailto' in request, false);
  assert.equal(buildQuoteRequest([], { language: 'es' }).subject, QUOTE_SUBJECT.es);
});

function quoteFixture() {
  const controls = Object.fromEntries(['error', 'result', 'summary', 'copy', 'prepare', 'unavailable', 'copy-status'].map(key => [key, new Node()]));
  controls.prepare.disabled = true;
  controls.result.hidden = controls.error.hidden = controls['copy-status'].hidden = true;
  const values = { name: 'Ana', email: 'ana@example.org', space: 'event', scope: 'event' };
  const fields = Object.entries(values).map(([name, value]) => {
    const input = { name, value };
    values[name] = input;
    return {
      querySelector: selector => selector === '[data-quote-label]' ? { textContent: name } : selector === 'input,textarea' ? input : null,
      querySelectorAll: () => [],
    };
  });
  const container = new Node();
  container.querySelectorAll = selector => selector === '[data-quote-field]' ? fields : [];
  container.querySelector = selector => selector === '#quoteScope' ? values.scope : controls[selector.slice('[data-quote-'.length, -1)] || null;
  const scopeLink = new Node('', { 'data-quote-scope': 'permanent' });
  const documentRef = { getElementById: id => id === 'quoteForm' ? container : null, querySelectorAll: selector => selector === '[data-quote-scope]' ? [scopeLink] : [] };
  return { controls, values, container, scopeLink, documentRef };
}

test('request preparation validates locally, copies only on explicit action and clears stale results', async () => {
  const f = quoteFixture(), writes = [];
  const controller = mountQuoteForm({ documentRef: f.documentRef, clipboard: { async writeText(text) { writes.push(text); } } });
  assert.equal(f.controls.prepare.disabled, false);
  assert.equal(f.controls.unavailable.hidden, true);
  f.values.email.value = 'invalid';
  f.controls.prepare.click();
  assert.equal(f.controls.error.hidden, false);
  assert.equal(f.controls.result.hidden, true);
  assert.deepEqual(writes, []);
  f.values.email.value = 'ana@example.org';
  f.controls.prepare.click();
  assert.equal(f.controls.error.hidden, true);
  assert.equal(f.controls.result.hidden, false);
  assert.match(f.controls.summary.textContent, /Quote request · Agentic Realities/);
  assert.match(f.controls.summary.textContent, /email: ana@example.org/);
  assert.deepEqual(writes, []);
  f.controls.copy.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, [f.controls.summary.textContent]);
  assert.match(f.controls['copy-status'].textContent, /Request copied/);
  f.container.dispatchEvent(new Event('input'));
  assert.equal(f.controls.result.hidden, true);
  assert.equal(f.controls['copy-status'].hidden, true);
  f.scopeLink.click();
  assert.equal(f.values.scope.value, 'permanent');
  controller.destroy();
  assert.equal(f.controls.prepare.disabled, true);
  assert.equal(f.controls.unavailable.hidden, false);
});

test('Spanish requests retain selectable text when clipboard permission is denied', async () => {
  const f = quoteFixture();
  mountQuoteForm({ documentRef: f.documentRef, getLanguage: () => 'es', clipboard: { async writeText() { throw new Error('permission denied'); } } });
  f.controls.prepare.click();
  const request = f.controls.summary.textContent;
  assert.match(request, /Solicitud de cotización/);
  f.controls.copy.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.controls.summary.textContent, request);
  assert.equal(f.controls.result.hidden, false);
  assert.match(f.controls['copy-status'].textContent, /Selecciona la solicitud/);
});
