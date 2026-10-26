import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const origin = 'https://agenticreality.space';
const assets = new URL('../dist/assets/', import.meta.url);
const read = name => fs.readFileSync(new URL(name, assets));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

test('published QR and NFC metadata share the canonical domain and retain existing entry routes', () => {
  const access = JSON.parse(read('passport-access.json'));
  assert.equal(access.origin, origin);
  assert.equal(access.url, origin + '/passport-station.html');
  assert.equal(access.immersiveUrl, origin + '/?passport=stand16#recorrido');
  assert.equal(access.arUrl, origin + '/passport-space.html');
  assert.equal(access.temporary, false);
  assert.equal(access.nfcRecordType, 'NDEF URI');
});

// Both approved images were decoded as https://agenticreality.space/passport-station.html.
// The PDF's embedded QR pixels were checked against the same PNG, then visually rendered.
test('published PNG and SVG retain the QR codes decoded for the canonical station URL', () => {
  assert.equal(sha256(read('passport-qr.png')), 'e558f261b892396fdeb7b28af3c0739a1548fa52b9d11e78a4ec71d69de2e65b');
  assert.equal(sha256(read('passport-qr.svg')), 'e7b201aeaf0aea7a4426e5c4c4e3f0f920fd70392db16f1d6b09ac37d2c0cbf7');
  assert.match(read('passport-poster-a3.pdf').subarray(0, 8).toString(), /^%PDF-/);
});

test('both legacy Android pages launch canonical assets and return to the canonical experience', () => {
  for (const filename of ['index.html', 'passport.html']) {
    const html = fs.readFileSync(new URL('../dist/' + filename, import.meta.url), 'utf8');
    const href = html.match(/id="androidAR"[^>]*href="([^"]+)"/)[1].replaceAll('&amp;', '&');
    const params = new URLSearchParams(href.split('?')[1].split('#Intent')[0]);
    assert.equal(params.get('file'), origin + '/assets/passport.glb');
    assert.equal(params.get('mode'), 'ar_preferred');
    assert.match(href, /package=com.google.android.googlequicksearchbox;/);
    const fallback = decodeURIComponent(href.match(/S.browser_fallback_url=([^;]+)/)[1]);
    const url = new URL(fallback);
    assert.equal(url.origin, origin);
    assert.equal(url.pathname, filename === 'index.html' ? '/' : '/passport.html');
    assert.equal(url.hash, filename === 'index.html' ? '#recorrido' : '#mobileAR');
  }
  const html = fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const strict = html.match(/id="androidCamera"[^>]*href="([^"]+)"/)[1].replaceAll('&amp;', '&');
  assert.equal(new URLSearchParams(strict.split('?')[1].split('#Intent')[0]).get('mode'), 'ar_only');
  assert.match(strict, /package=com.google.ar.core;/);
  assert.equal(decodeURIComponent(strict.match(/S.browser_fallback_url=([^;]+)/)[1]), origin + '/?ar_fallback=1#recorrido');
});



