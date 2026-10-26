import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SCENE_VIEWS, SCENE_VIEW_COPY, applyPlatformLanguage, updateSceneCaption,
  mountPlatform, deferOne16Preview,
} from '../dist/platform.mjs';

class Element extends EventTarget {
  constructor(text = '', attributes = {}) {
    super(); this.textContent = text; this.attributes = {}; this.dataset = {}; this.hidden = false;
    for (const [name, value] of Object.entries(attributes)) this.setAttribute(name, value);
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, character) => character.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return name in this.attributes; }
  click() { this.dispatchEvent(new Event('click')); }
}
function pageFixture() {
  const sceneHost = new Element('', { 'data-active-view': 'space' }), caption = new Element();
  const views = SCENE_VIEWS.map(view => new Element(view, { 'data-scene-view': view }));
  const languages = ['en', 'es', 'en', 'es'].map(language => new Element(language, { 'data-language': language }));
  const html = fs.readFileSync(new URL('../dist/platform.html', import.meta.url), 'utf8');
  const links = [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>/g)].map(match => new Element('', { href: match[1] }));
  const documentRef = {
    documentElement: { lang: 'en', dataset: {} }, title: '',
    getElementById: id => id === 'platformScene' ? sceneHost : null,
    querySelector: selector => selector === '[data-scene-caption]' ? caption : null,
    querySelectorAll(selector) {
      if (selector === '[data-scene-view]') return views;
      if (selector === '[data-language]') return languages;
      if (selector === '[data-one16-link],a[href="/one16"]') return links.filter(link => link.hasAttribute('data-one16-link') || link.getAttribute('href') === '/one16');
      return [];
    },
  };
  sceneHost.ownerDocument = documentRef;
  return { documentRef, sceneHost, caption, views, languages, links };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function previewFixture({ loadPreview, withObserver = true } = {}) {
  const retry = new Element(), status = new Element(), host = new Element(); retry.hidden = true;
  const windowRef = new EventTarget(); windowRef.innerHeight = 800;
  let bounds = { top: 1400, bottom: 1800 };
  host.getBoundingClientRect = () => bounds;
  host.ownerDocument = { defaultView: windowRef };
  host.querySelector = selector => ({ '[data-preview-retry]': retry, '[data-preview-status]': status })[selector] || null;
  const observers = [], mounts = [], forwardedLanguages = [];
  let imports = 0, disposals = 0;
  class IntersectionObserver {
    constructor(callback, options) { this.callback = callback; this.options = options; this.observed = []; this.disconnects = 0; observers.push(this); }
    observe(element) { this.observed.push(element); }
    disconnect() { this.disconnects++; }
    fire(isIntersecting) { this.callback([{ isIntersecting, target: host }]); }
  }
  const module = { mountOne16Preview(element, options) {
    mounts.push({ element, language: options.language });
    return { setLanguage: language => forwardedLanguages.push(language), dispose: () => disposals++ };
  } };
  const controller = deferOne16Preview({
    host, windowRef, IntersectionObserverClass: withObserver ? IntersectionObserver : null,
    loadPreview: () => { imports++; return loadPreview ? loadPreview(module, imports) : Promise.resolve(module); },
  });
  return { host, retry, status, windowRef, observers, mounts, forwardedLanguages, controller, module, imports: () => imports, disposals: () => disposals, setBounds: value => { bounds = value; } };
}

test('guided native controls keep the selected view and accessible caption through EN/ES changes', () => {
  const f = pageFixture(), frames = new Map(); let next = 1;
  const previousRequest = globalThis.requestAnimationFrame, previousCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = callback => { const id = next++; frames.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  let platform;
  try {
    platform = mountPlatform({ documentRef: f.documentRef, locationRef: { href: 'https://agenticreality.space/', search: '' }, historyRef: { replaceState() {} }, storage: { getItem() {}, setItem() {} } });
    assert.equal(f.caption.textContent, SCENE_VIEW_COPY.en.space);
    f.views[2].click();
    assert.equal(f.sceneHost.dataset.activeView, 'experiences'); assert.equal(f.caption.textContent, SCENE_VIEW_COPY.en.experiences);
    assert.deepEqual(f.views.map(button => button.getAttribute('aria-pressed')), ['false', 'false', 'true']);
    f.languages[1].click();
    assert.equal(f.documentRef.documentElement.lang, 'es'); assert.equal(f.sceneHost.dataset.activeView, 'experiences');
    assert.equal(f.caption.textContent, SCENE_VIEW_COPY.es.experiences);
    assert.deepEqual(f.views.map(button => button.getAttribute('aria-pressed')), ['false', 'false', 'true']);
    f.views[1].click(); assert.equal(f.caption.textContent, SCENE_VIEW_COPY.es.entry);
    f.languages[2].click(); assert.equal(f.caption.textContent, SCENE_VIEW_COPY.en.entry);
    assert.deepEqual(f.views.map(button => button.getAttribute('aria-pressed')), ['false', 'true', 'false']);
    platform.destroy(); platform = null; assert.equal(frames.size, 0);
    f.views[0].click(); assert.equal(f.sceneHost.dataset.activeView, 'entry', 'destroy removes native button handlers');
  } finally {
    platform?.destroy();
    if (previousRequest === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = previousRequest;
    if (previousCancel === undefined) delete globalThis.cancelAnimationFrame; else globalThis.cancelAnimationFrame = previousCancel;
  }
});

test('every real ONE16 call carries the chosen language after repeated switches without changing section links', () => {
  const f = pageFixture(), eventLinks = f.links.filter(link => link.getAttribute('href') === '/one16');
  assert.ok(eventLinks.length >= 4, 'exercise all event calls in the actual landing');
  const sectionLinks = f.links.filter(link => link.getAttribute('href').startsWith('#')), originalSectionHrefs = sectionLinks.map(link => link.getAttribute('href'));
  updateSceneCaption(f.documentRef, 'entry');
  for (const language of ['es', 'en', 'es']) {
    applyPlatformLanguage(f.documentRef, language);
    assert.ok(eventLinks.every(link => link.getAttribute('href') === '/one16?lang=' + language));
    assert.ok(eventLinks.every(link => link.hasAttribute('data-one16-link')), 'previously rewritten hrefs remain discoverable');
    assert.deepEqual(sectionLinks.map(link => link.getAttribute('href')), originalSectionHrefs);
    assert.equal(f.sceneHost.dataset.activeView, 'entry'); assert.equal(f.caption.textContent, SCENE_VIEW_COPY[language].entry);
  }
  assert.equal(updateSceneCaption(f.documentRef, 'invalid'), 'space');
  assert.deepEqual(f.views.map(button => button.getAttribute('aria-pressed')), ['true', 'false', 'false']);
});

test('ONE16 imports only at the 200px intersection boundary and repeated observations mount once', async () => {
  const pending = deferred(), f = previewFixture({ loadPreview: () => pending.promise });
  const observer = f.observers[0];
  assert.equal(observer.options.rootMargin, '200px'); assert.deepEqual(observer.observed, [f.host]); assert.equal(f.imports(), 0);
  observer.fire(false); await settle(); assert.equal(f.imports(), 0);
  observer.fire(true); observer.fire(true); observer.fire(true); f.retry.click(); await settle();
  assert.equal(f.imports(), 1); assert.equal(f.mounts.length, 0);
  pending.resolve(f.module); await settle(); assert.equal(f.mounts.length, 1); assert.equal(f.mounts[0].element, f.host);
  assert.ok(observer.disconnects > 0); observer.fire(true); f.retry.click(); await settle();
  assert.equal(f.imports(), 1); assert.equal(f.mounts.length, 1);
  f.controller.destroy(); assert.equal(f.disposals(), 1);
});

test('failed preview import retains a translated retry path and double retry still mounts once', async () => {
  const pending = deferred(), f = previewFixture({ loadPreview: (module, attempt) => attempt === 1 ? Promise.reject(Error('offline')) : pending.promise });
  f.observers[0].fire(true); await settle();
  assert.equal(f.host.dataset.previewState, 'error'); assert.equal(f.retry.hidden, false); assert.match(f.status.textContent, /Retry or enter/);
  f.controller.setLanguage('es'); assert.match(f.status.textContent, /Puedes reintentar/);
  f.retry.click(); f.retry.click(); await settle(); assert.equal(f.imports(), 2); assert.equal(f.mounts.length, 0);
  pending.resolve(f.module); await settle(); assert.equal(f.mounts.length, 1); assert.equal(f.mounts[0].language, 'es');
  f.retry.click(); await settle(); assert.equal(f.imports(), 2);
  f.controller.destroy(); assert.equal(f.disposals(), 1);
});

test('latest preview language reaches a late mount and subsequent changes reach its controller', async () => {
  const pending = deferred(), f = previewFixture({ loadPreview: () => pending.promise });
  f.observers[0].fire(true); await settle(); f.controller.setLanguage('es');
  pending.resolve(f.module); await settle(); assert.equal(f.mounts[0].language, 'es');
  f.controller.setLanguage('en'); f.controller.setLanguage('es'); f.controller.setLanguage('unsupported');
  assert.deepEqual(f.forwardedLanguages, ['en', 'es', 'en']); f.controller.destroy(); assert.equal(f.disposals(), 1);
});

test('destroy before a pending import resolves prevents mounting and removes the retry path', async () => {
  const pending = deferred(), f = previewFixture({ loadPreview: () => pending.promise });
  f.observers[0].fire(true); await settle(); assert.equal(f.imports(), 1);
  f.controller.destroy(); pending.resolve(f.module); await settle();
  assert.equal(f.mounts.length, 0); assert.equal(f.disposals(), 0); assert.ok(f.observers[0].disconnects > 0);
  f.observers[0].fire(true); f.retry.click(); await settle(); assert.equal(f.imports(), 1);
});

test('destroy before a late import failure leaves the initial poster state intact', async () => {
  const pending = deferred(), f = previewFixture({ loadPreview: () => pending.promise });
  f.observers[0].fire(true); await settle(); f.controller.destroy(); pending.reject(Error('late offline')); await settle();
  assert.equal(f.host.dataset.previewState, undefined); assert.equal(f.retry.hidden, true); assert.equal(f.status.textContent, ''); assert.equal(f.mounts.length, 0);
});

test('without IntersectionObserver the viewport check respects 200px and teardown removes scroll work', async () => {
  const f = previewFixture({ withObserver: false }); await settle(); assert.equal(f.imports(), 0);
  f.setBounds({ top: 1001, bottom: 1400 }); f.windowRef.dispatchEvent(new Event('scroll')); await settle(); assert.equal(f.imports(), 0);
  f.setBounds({ top: 1000, bottom: 1400 }); f.windowRef.dispatchEvent(new Event('scroll')); await settle(); assert.equal(f.imports(), 1); assert.equal(f.mounts.length, 1);
  f.controller.destroy(); assert.equal(f.disposals(), 1);
  f.windowRef.dispatchEvent(new Event('resize')); f.windowRef.dispatchEvent(new Event('scroll')); await settle(); assert.equal(f.imports(), 1);
});


test('document exit releases scenes, while a cached history entry keeps its paused views', async()=>{
 const {bindPlatformLifecycle}=await import('../dist/platform.mjs');
 const windowRef=new EventTarget();let destroys=0;
 const unbind=bindPlatformLifecycle({destroy(){destroys++;}},windowRef);
 const cached=new Event('pagehide');Object.defineProperty(cached,'persisted',{value:true});windowRef.dispatchEvent(cached);assert.equal(destroys,0);
 const exiting=new Event('pagehide');Object.defineProperty(exiting,'persisted',{value:false});windowRef.dispatchEvent(exiting);assert.equal(destroys,1);
 windowRef.dispatchEvent(exiting);assert.equal(destroys,1);unbind();
});
