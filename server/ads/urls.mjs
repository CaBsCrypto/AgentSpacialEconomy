import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { AdsError } from './common.mjs';

const fail = (code, message) => new AdsError(422, code, message);

/** Only exact, explicitly configured HTTPS domains are accepted. */
export function normalizeUrl(raw, config = {}) {
  if (typeof raw !== 'string' || raw.length > 2048 || /[\u0000-\u0020\u007f\\]/u.test(raw)) throw fail('UNSAFE_URL', 'Use a complete HTTPS URL without spaces or control characters.');
  let url;
  try { url = new URL(raw); } catch { throw fail('UNSAFE_URL', 'The destination URL is invalid.'); }
  const host = url.hostname.toLowerCase().replace(/\.$/u, '');
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || isIP(host.replace(/^\[|\]$/gu, '')) || !host.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/u.test(host)) throw fail('UNSAFE_URL', 'Only public HTTPS destinations without credentials are allowed.');
  const domains = Array.isArray(config) ? config : config.allowedDomains;
  if (!Array.isArray(domains) || !domains.map(d => String(d).toLowerCase()).includes(host)) throw fail('DOMAIN_NOT_ALLOWED', 'The destination domain has not been admitted by the operator.');
  url.hostname = host;
  return url.href;
}

export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const value = address.toLowerCase();
    const prefix = parseInt(value.split(':')[0], 16);
    const second = parseInt(value.split(':')[1] || '0', 16);
    return (prefix & 0xe000) === 0x2000 && !(prefix === 0x2001 && (second < 0x200 || second === 0xdb8)) && prefix !== 0x2002 && prefix !== 0x3fff;
  }
  return false;
}

/** Pin the checked DNS result to the connection and retain TLS hostname validation. */
function pinnedHead(url, { address, family, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      method: 'HEAD', agent: false, maxHeaderSize: 8192,
      lookup: (_hostname, options, callback) => options?.all ? callback(null, [{ address, family }]) : callback(null, address, family),
      headers: { 'user-agent': 'SpatialAds-CTA-Inspector/1', accept: '*/*' },
    }, res => {
      const result = { statusCode: res.statusCode, headers: res.headers };
      res.destroy();
      resolve(result);
    });
    const timer = setTimeout(() => req.destroy(new Error('CTA inspection timed out')), timeoutMs);
    req.once('close', () => clearTimeout(timer));
    req.once('error', reject);
    req.end();
  });
}

export async function inspectUrl(raw, { allowedDomains, lookup = dnsLookup, request = pinnedHead, maxRedirects = 3, timeoutMs = 5000 } = {}) {
  let current = normalizeUrl(raw, { allowedDomains });
  const visited = new Set();
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (visited.has(current)) throw fail('CTA_REDIRECT_LOOP', 'The destination redirects in a loop.');
    visited.add(current);
    const url = new URL(current);
    let addresses, response;
    try {
      let timer;
      try {
        addresses = await Promise.race([lookup(url.hostname, { all: true, verbatim: true }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DNS inspection timed out')), timeoutMs); })]);
      } finally { clearTimeout(timer); }
      if (!Array.isArray(addresses) || !addresses.length || addresses.some(row => !isPublicAddress(row.address))) throw fail('PRIVATE_DESTINATION', 'The destination resolves to a restricted address.');
      response = await request(url, { ...addresses[0], timeoutMs });
    } catch (error) {
      if (error instanceof AdsError) throw error;
      throw fail('CTA_UNVERIFIED', 'The destination could not be safely inspected.');
    }
    const status = response.statusCode ?? response.status;
    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = response.headers?.location ?? response.headers?.get?.('location');
      if (hop === maxRedirects || typeof location !== 'string' || location.length > 2048) throw fail('CTA_REDIRECT_LIMIT', 'The destination has too many or invalid redirects.');
      current = normalizeUrl(new URL(location, url).href, { allowedDomains });
      continue;
    }
    if (!Number.isInteger(status) || status < 200 || status >= 300) throw fail('CTA_UNVERIFIED', 'The destination did not return a successful response.');
    return { url: current, domain: new URL(current).hostname, redirects: hop, checkedAt: new Date().toISOString() };
  }
  throw fail('CTA_UNVERIFIED', 'The destination could not be inspected.');
}
