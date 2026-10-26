import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

const HASH = /^[a-f0-9]{64}$/i;
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const ROUTES = [
  ['/', /text\/html/i], ['/one16', /text\/html/i], ['/dashboard.html', /text\/html/i],
  ['/state/ledger.json', /application\/json/i], ['/state/stage.json', /application\/json/i],
  ['/llms.txt', /text\/plain/i], ['/robots.txt', /text\/plain/i], ['/sitemap.xml', /(?:application|text)\/xml/i],
];
const plain = text => text.replace(/<[^>]*>/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&middot;|&#183;/g, '·').replace(/\s+/g, ' ').trim();
const amount = value => typeof value === 'string' && /^\d+(?:\.\d{1,7})?$/.test(value) ? BigInt(value.replace('.', '').padEnd(value.includes('.') ? value.indexOf('.') + 7 : value.length + 7, '0')) : null;
const explorer = tx => `https://stellar.expert/explorer/testnet/tx/${tx}`;
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
const imports = text => [...text.matchAll(/\b(?:import|export)\s+(?:[^;"']*?\s+from\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g)].map(match => match[1] || match[2]);

/** Read-only public HTTP checks. No signing, wallet creation, authentication or response bodies in the report. */
export async function verifyRelease(baseURL, { fetchImpl = fetch, integrationOnly = false } = {}) {
  const base = new URL(baseURL);
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
      (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) {
    throw new Error('Use an HTTPS origin, or an HTTP localhost origin, without credentials, query or path.');
  }
  const checks = [], pages = new Map();
  const add = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), ...(detail ? { detail } : {}) });
  async function get(pathname, type) {
    const url = new URL(pathname, base);
    if (url.origin !== base.origin) return null;
    const displayURL = url.origin + url.pathname;
    try {
      const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const contentType = response.headers.get('content-type') || '';
      const cacheControl = response.headers.get('cache-control') || '';
      const body = await response.text();
      const record = { url: displayURL, status: response.status, contentType, cacheControl, body };
      add(`GET ${url.pathname}`, response.status === 200 && type.test(contentType), { url: displayURL, status: response.status, contentType });
      if (/\bS[A-Z2-7]{55}\b/.test(body)) add(`No secret-key pattern in ${url.pathname}`, false, { redacted: true });
      pages.set(url.pathname, record);
      return record;
    } catch (error) {
      add(`GET ${url.pathname}`, false, { url: displayURL, error: error.name || 'RequestError', ...(typeof error.cause?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.cause.code) ? { code: error.cause.code } : {}) });
      return null;
    }
  }
  await Promise.all(ROUTES.map(([pathname, type]) => get(pathname, type)));
  for (const pathname of ['/state/ledger.json', '/state/stage.json']) {
    add(`${pathname} is not cached`, /(?:^|,)\s*no-store\b/i.test(pages.get(pathname)?.cacheControl || ''));
  }
  function json(pathname) {
    try { const value = JSON.parse(pages.get(pathname)?.body || ''); add(`${pathname} parses as JSON`, true); return value; }
    catch { add(`${pathname} parses as JSON`, false); return null; }
  }
  const ledger = json('/state/ledger.json'), stage = json('/state/stage.json');
  if (ledger && stage) {
    const rows = Array.isArray(ledger.rows) ? ledger.rows : [];
    const feed = rows.find(row => row.service === 'venue-feed' && row.status === 'settled');
    const card = rows.find(row => row.service === 'screen-card' && row.status === 'settled');
    const blocked = rows.find(row => row.service === 'premium-render' && row.status === 'blocked');
    add('All recorded networks are testnet', ledger.network === 'stellar:testnet' && ledger.mandate?.network === 'stellar:testnet' && ledger.onchain?.network === 'stellar:testnet');
    add('Two paid x402 services settled for 0.01 and 0.05 USDC', amount(feed?.priceUsdc) === 100000n && amount(card?.priceUsdc) === 500000n);
    add('Settled payments have testnet transaction links', rows.filter(row => row.status === 'settled').every(row => HASH.test(row.tx || '') && row.explorer === explorer(row.tx)) && Boolean(feed && card));
    add('Ledger and stage have the same run', typeof ledger.runId === 'string' && ledger.runId === stage.runId);
    add('Morning briefing is tied to its settled receipt', stage.card?.title === 'Morning briefing' && HASH.test(stage.tx || '') && stage.tx === card?.tx && stage.explorer === explorer(stage.tx));
    add('0.25 USDC attempt is blocked before signing', amount(blocked?.priceUsdc) === 2500000n && blocked?.needsApproval === true && !blocked.tx && !blocked.explorer && amount(ledger.mandate?.perCallCapUsdc) === 1000000n);
    const ceiling = ledger.onchain;
    add('SEP-41 ceiling and rejected 0.31 draw are recorded', ceiling?.mode === 'sep41-allowance' && amount(ceiling.approvedUsdc) === 5000000n && amount(ceiling.drawnUsdc) === 2000000n && amount(ceiling.remainingUsdc) === 3000000n && HASH.test(ceiling.approveTx || '') && HASH.test(ceiling.drawTx || '') && ceiling.probe?.refused === true && amount(ceiling.probe.amountUsdc) === 3100000n);
  }
  const landing = pages.get('/')?.body || '', dashboard = pages.get('/dashboard.html')?.body || '';
  const text = plain(landing);
  if (!integrationOnly) {
    const hero = [...landing.matchAll(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi)].find(match => attribute(match[0], 'id') === 'hero-title')?.[0] || '';
    add('Landing preserves Agentic Reality Space identity and hero', text.includes('Agentic Reality Space') && plain(hero).includes('Make your event a place to explore'));
    const links = [...landing.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)].map(match => ({ href: attribute(match[0], 'href'), text: plain(match[0]) }));
    add('Landing links to the ONE16 experience', links.some(link => {
      if (!link.href || !/ONE16/i.test(link.text)) return false;
      const destination = new URL(link.href, base);
      return destination.origin === base.origin && destination.pathname === '/one16';
    }));
  }
  add('Dashboard contains on-chain ceiling and recorded-run label', /On-chain budget ceiling/i.test(plain(dashboard)) && /recorded run/i.test(dashboard));
  if (!integrationOnly) add('Sitemap includes twin and dashboard', ['/one16', '/dashboard.html'].every(route => pages.get('/sitemap.xml')?.body.includes(`https://agenticreality.space${route}`)));
  add('Robots advertises canonical sitemap', pages.get('/robots.txt')?.body.includes('https://agenticreality.space/sitemap.xml'));
  const assets = new Map([
    ['/platform.mjs', /(?:application|text)\/(?:javascript|ecmascript)/i], ['/entry.mjs', /(?:application|text)\/(?:javascript|ecmascript)/i],
    ['/viewer.js', /(?:application|text)\/(?:javascript|ecmascript)/i], ['/stage-screen.mjs', /(?:application|text)\/(?:javascript|ecmascript)/i],
    ['/palta-reveal.mjs', /(?:application|text)\/(?:javascript|ecmascript)/i], ['/vendor/wallet/kit.mjs', /(?:application|text)\/(?:javascript|ecmascript)/i],
    ['/vendor/wallet/kit.mjs.LEGAL.txt', /text\/plain/i], ['/vendor/three/build/three.module.js', /(?:application|text)\/(?:javascript|ecmascript)/i],
  ]);
  for (const pathname of ['/', '/one16']) for (const match of (pages.get(pathname)?.body || '').matchAll(/<(script|link)\b[^>]*>/gi)) {
    const tag = match[0], source = match[1].toLowerCase() === 'script' ? attribute(tag, 'src') : attribute(tag, 'rel') === 'stylesheet' ? attribute(tag, 'href') : null;
    if (!source) continue;
    const url = new URL(source, new URL(pathname, base));
    if (url.origin === base.origin) assets.set(url.pathname + url.search, /\.css$/i.test(url.pathname) ? /text\/css/i : /(?:application|text)\/(?:javascript|ecmascript)/i);
  }
  await Promise.all([...assets].map(([pathname, type]) => get(pathname, type)));
  const children = new Set();
  for (const pathname of ['/platform.mjs', '/entry.mjs', '/viewer.js', '/stage-screen.mjs', '/palta-reveal.mjs']) {
    for (const source of imports(pages.get(pathname)?.body || '')) {
      if (!source.startsWith('.') && !source.startsWith('/')) continue;
      const url = new URL(source, new URL(pathname, base));
      if (url.origin === base.origin && !pages.has(url.pathname)) children.add(url.pathname + url.search);
    }
  }
  await Promise.all([...children].map(pathname => get(pathname, /(?:application|text)\/(?:javascript|ecmascript)/i)));
  add('Wallet bundle retains linked license notices', /license|copyright|MIT/i.test(pages.get('/vendor/wallet/kit.mjs.LEGAL.txt')?.body || '') && /kit\.mjs\.LEGAL\.txt/.test(pages.get('/vendor/wallet/kit.mjs')?.body || ''));
  const walletResponse = await get('/api/wallet/config', /application\/json/i);
  if (walletResponse) {
    const wallet = json('/api/wallet/config');
    add('Wallet pilot is enabled and configured', wallet?.enabled === true && wallet?.configured === true);
    add('Wallet config only targets testnet', wallet?.network === 'testnet' && wallet?.networkPassphrase === TESTNET_PASSPHRASE && wallet?.rpcUrl === 'https://soroban-testnet.stellar.org');
  }
  return { checkedAt: new Date().toISOString(), baseURL: base.origin, mode: integrationOnly ? 'integration' : 'final', passed: checks.every(check => check.pass), checkCount: checks.length, failed: checks.filter(check => !check.pass).length, checks };
}

async function main() {
  const [baseURL, ...options] = process.argv.slice(2);
  let integrationOnly = false, output;
  for (let i = 0; i < options.length; i++) {
    if (options[i] === '--integration-only') integrationOnly = true;
    else if (options[i] === '--report' && options[i + 1] && !options[i + 1].startsWith('--')) output = options[++i];
    else throw new Error('Unknown or incomplete option.');
  }
  if (!baseURL) throw new Error('Usage: node scripts/verify-release.mjs https://host [--integration-only] [--report ../close-materials/release-report.json]');
  const report = await verifyRelease(baseURL, { integrationOnly });
  for (const check of report.checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}`);
  console.log(`${report.passed ? 'PASS' : 'FAIL'} ${report.checkCount - report.failed}/${report.checkCount} release checks`);
  if (output) {
    const reportPath = path.resolve(output);
    if (!reportPath.split(path.sep).includes('close-materials') || path.extname(reportPath) !== '.json') throw new Error('Report path must be a JSON file inside close-materials.');
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
  process.exitCode = report.passed ? 0 : 1;
}
if (process.argv[1] && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) main().catch(error => { console.error(error.message); process.exitCode = 1; });
