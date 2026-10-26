import test from 'node:test';
import assert from 'node:assert/strict';
import { Address, StrKey, hash, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { ACCOUNT_WASM, DEFAULT_ORIGIN, SHARED_DEPLOYER, USDC_TOKEN, WEBAUTHN_VERIFIER, readConfig } from '../server/wallet/config.mjs';
import { createWalletHandlers } from '../server/wallet/service.mjs';
import { validateDeployment } from '../server/wallet/deployment.mjs';
import { readBody, WalletApiError } from '../server/wallet/http.mjs';

const ADDRESS = StrKey.encodeContract(Buffer.alloc(32, 7));
const env = { WALLET_ENABLED: 'true', CHANNELS_API_KEY: 'test-secret-not-returned', KV_REST_API_URL: 'https://redis.example', KV_REST_API_TOKEN: 'redis-secret-not-returned' };
const config = readConfig(env);
const request = (method = 'POST', body = { address: ADDRESS }, origin = DEFAULT_ORIGIN, path = '/api/wallet/faucet') => new Request(`${DEFAULT_ORIGIN}${path}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json', 'x-forwarded-for': '192.0.2.42' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
class Store {
  entries = new Map();
  async get(key) { return this.entries.has(key) ? structuredClone(this.entries.get(key)) : null; }
  async set(key, value, options) { if (options?.nx && this.entries.has(key)) return null; this.entries.set(key, structuredClone(value)); return 'OK'; }
  async eval(script, keys, args) {
    if (script.includes('wallet:claim:cas:v1')) {
      const item = this.entries.get(keys[0]), expected = JSON.parse(args[0]);
      if (!item || ['version','state','attempt','updatedAt'].some(key => item[key] !== expected[key])) return 0;
      this.entries.set(keys[0], JSON.parse(args[1])); return 1;
    }
    return 1;
  }
}
function fixture(overrides = {}, sharedStore = new Store()) {
  let funds = 0n, claims = 0;
  const runtime = { redis: sharedStore, walletAllowed: async () => true, balance: async () => funds, availability: async () => ({ available: true, claimAmount: 100, cooldownMinutes: 60 }),
    claim: async () => { claims++; funds = 1_000_000_000n; return { success: true, hash: 'a'.repeat(64) }; },
    simulateDeployment: async () => {}, relay: async () => ({ success: true, data: { hash: 'b'.repeat(64) } }), ...overrides };
  return { runtime, store: sharedStore, handlers: createWalletHandlers({ env, runtime }), get claims() { return claims; }, set funds(value) { funds = value; } };
}
const stateOf = async response => { assert.equal(response.status, 200); return response.json(); };

function deployment({ verifier = WEBAUTHN_VERIFIER, wasm = ACCOUNT_WASM, salt, nested = false, publicKey = Buffer.from('046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5','hex') } = {}) {
  const credential = Buffer.from('test-credential-0001');
  const keyData = Buffer.concat([publicKey, credential]);
  const create = new xdr.CreateContractArgsV2({
    contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(new xdr.ContractIdPreimageFromAddress({ address: Address.fromString(SHARED_DEPLOYER).toScAddress(), salt: salt || hash(credential) })),
    executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.from(wasm, 'hex')),
    constructorArgs: [xdr.ScVal.scvVec([xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('External'), new Address(verifier).toScVal(), xdr.ScVal.scvBytes(keyData)])]), xdr.ScVal.scvMap([])],
  });
  const root = new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeCreateContractV2HostFn(create), subInvocations: [] });
  if (nested) root.subInvocations([new xdr.SorobanAuthorizedInvocation({ function: root.function(), subInvocations: [] })]);
  const auth = new xdr.SorobanAuthorizationEntry({ credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({ address: Address.fromString(SHARED_DEPLOYER).toScAddress(), nonce: xdr.Int64.fromString('1'), signatureExpirationLedger: 100, signature: nativeToScVal([]) })), rootInvocation: root });
  return { func: xdr.HostFunction.hostFunctionTypeCreateContractV2(create).toXDR('base64'), auth: [auth.toXDR('base64')] };
}

test('config is testnet-only, accepts actual Marketplace aliases, and never returns secrets', async () => {
  assert.equal(config.configured, true);
  assert.equal(config.enabled, true);
  assert.equal(config.tokenContract, USDC_TOKEN);
  const response = await fixture().handlers.config(request('GET'));
  const body = await response.text();
  assert.match(body, /September 2015/); assert.match(body, /testnet/);
  assert.doesNotMatch(body, /test-secret|redis-secret/);
  const missing = createWalletHandlers({ env: {}, runtime: fixture().runtime });
  const status = await stateOf(await missing.config(request('GET')));
  assert.equal(status.enabled, false); assert.equal(status.configured, false);
  const post = await missing.faucet(request()); assert.equal(post.status, 503); assert.equal((await post.json()).reason, 'setup_required');
});

test('prewarming availability neither creates wallets nor requests funds', async () => {
  const f = fixture();
  assert.deepEqual(await stateOf(await f.handlers.faucet(request('GET'))), { available: true, claimAmount: 100, cooldownMinutes: 60 });
  assert.equal(f.claims, 0); assert.equal(f.store.entries.size, 0);
});

test('two instances share durable claim ownership; double taps cannot fund twice', async () => {
  const latch = deferred(), started = deferred(), store = new Store(); let calls = 0, funds = 0n;
  const runtime = { redis: store, walletAllowed: async () => true, balance: async () => funds, claim: async () => { calls++; started.resolve(); await latch.promise; funds = 1_000_000_000n; return { success: true }; } };
  const first = createWalletHandlers({ env, runtime }), second = createWalletHandlers({ env, runtime });
  const running = first.faucet(request()); await started.promise;
  const duplicate = await stateOf(await second.faucet(request())); assert.equal(duplicate.state, 'pending'); assert.equal(calls, 1);
  latch.resolve(); const completed = await stateOf(await running); assert.equal(completed.state, 'confirmed'); assert.equal(completed.balance, '1000000000');
  const restored = await stateOf(await second.faucet(request())); assert.equal(restored.state, 'confirmed'); assert.equal(calls, 1);
});

test('unknown outcomes survive reload and explicit retry without another claim, then reconcile onchain', async () => {
  let claims = 0;
  const f = fixture({ claim: async () => { claims++; return { unknown: true }; } });
  assert.equal((await stateOf(await f.handlers.faucet(request()))).state, 'unknown');
  assert.equal((await stateOf(await f.handlers.faucet(request('POST', { address: ADDRESS, retry: true })))).state, 'unknown');
  assert.equal(claims, 1);
  f.funds = 1_000_000_000n;
  const restored = createWalletHandlers({ env, runtime: f.runtime });
  assert.equal((await stateOf(await restored.faucet(request('GET', undefined, DEFAULT_ORIGIN, `/api/wallet/faucet?address=${ADDRESS}`)))).state, 'confirmed');
  assert.equal(claims, 1);
});

test('a faucet success is pending until an actual asset balance is confirmed', async () => {
  const f = fixture({ claim: async () => ({ success: true, hash: 'c'.repeat(64) }) });
  const result = await stateOf(await f.handlers.faucet(request()));
  assert.equal(result.state, 'pending'); assert.equal(result.balance, '0'); assert.equal(result.hash, 'c'.repeat(64));
});

test('a terminated process becomes unknown, never a definitely failed retryable operation', async () => {
  let calls = 0;
  const f = fixture({ claim: async () => { calls++; throw Error('process died'); } });
  assert.equal((await stateOf(await f.handlers.faucet(request()))).state, 'unknown');
  assert.equal((await stateOf(await f.handlers.faucet(request('POST', { address: ADDRESS, retry: true })))).state, 'unknown');
  assert.equal(calls, 1);
});

test('stale pending operations become unknown without expiring claim ownership', async () => {
  const f = fixture();
  const key = `wallet:${config.campaign}:testnet:claim:${ADDRESS}`;
  await f.store.set(key, { address: ADDRESS, state: 'pending', createdAt: 1, updatedAt: 1 });
  const handlers = createWalletHandlers({ env, runtime: f.runtime, now: () => 200_000 });
  const status = await stateOf(await handlers.faucet(request()));
  assert.equal(status.state, 'unknown'); assert.equal(f.claims, 0);
});

test('cooldowns remain definite failures and cannot be retried before the provider timestamp', async () => {
  let calls = 0;
  const f = fixture({ claim: async () => { calls++; return { success: false, reason: 'user_cooldown', nextAvailableAt: new Date(Date.now() + 3_600_000).toISOString() }; } });
  const result = await stateOf(await f.handlers.faucet(request())); assert.equal(result.state, 'failed'); assert.equal(result.reason, 'user_cooldown');
  await f.handlers.faucet(request()); await f.handlers.faucet(request('POST', { address: ADDRESS, retry: true })); assert.equal(calls, 1);
});

test('only an explicit retry can repeat a definite provider rejection', async () => {
  let calls = 0;
  const f = fixture({ claim: async () => { calls++; return { success: false, reason: 'empty_today' }; } });
  await f.handlers.faucet(request()); await f.handlers.faucet(request()); assert.equal(calls, 1);
  await f.handlers.faucet(request('POST', { address: ADDRESS, retry: true })); assert.equal(calls, 2);
});

test('preexisting USDC skips the faucet and confirmed wallets never auto-top-up', async () => {
  const f = fixture(); f.funds = 1n;
  const result = await stateOf(await f.handlers.faucet(request())); assert.equal(result.state, 'confirmed'); assert.equal(f.claims, 0);
  f.funds = 0n; await f.store.set(`wallet:${config.campaign}:testnet:claim:${ADDRESS}`, { state: 'confirmed', address: ADDRESS });
  const spent = await stateOf(await f.handlers.faucet(request())); assert.equal(spent.state, 'confirmed'); assert.equal(spent.balance, '0'); assert.equal(f.claims, 0);
});

test('writes require the exact allowed browser origin and checksum-valid C address', async () => {
  const f = fixture();
  assert.equal((await f.handlers.faucet(request('POST', undefined, 'https://evil.example'))).status, 403);
  const invalid = await f.handlers.faucet(request('POST', { address: 'C' + 'A'.repeat(55) })); assert.equal(invalid.status, 400);
  const undeployed = fixture({ walletAllowed: async () => false }); assert.equal((await undeployed.handlers.faucet(request())).status, 409);
  assert.equal(f.claims, 0);
});

test('relay accepts only the approved one-passkey deployment and exact authorization tree', () => {
  assert.equal(validateDeployment(deployment(), config).auth.length, 1);
  for (const body of [{ xdr: 'arbitrary' }, deployment({ verifier: ADDRESS }), deployment({ wasm: 'ff'.repeat(32) }), deployment({ salt: Buffer.alloc(32, 2) }), deployment({ nested: true }), deployment({ publicKey: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]) })]) {
    assert.throws(() => validateDeployment(body, config), WalletApiError);
  }
  const body = deployment(); body.auth = [];
  assert.throws(() => validateDeployment(body, config), WalletApiError);
});

test('relay performs bounded simulation before forwarding and keeps upstream failures private', async () => {
  const order = [];
  const f = fixture({ simulateDeployment: async () => { order.push('simulate'); throw new WalletApiError(413, 'fee_limit', 'Límite'); }, relay: async () => { order.push('relay'); } });
  const response = await f.handlers.relay(request('POST', deployment(), DEFAULT_ORIGIN, '/api/wallet/relay'));
  assert.equal(response.status, 413); assert.deepEqual(order, ['simulate']);
  const fail = fixture({ walletAllowed: async () => { throw Error('secret-provider-value'); } });
  const rejected = await fail.handlers.faucet(request()); assert.equal(rejected.status, 503); assert.doesNotMatch(await rejected.text(), /secret-provider-value/);
});

test('request JSON size is limited even without a Content-Length header', async () => {
  const oversized = request('POST', { address: ADDRESS, filler: 'x'.repeat(1000) });
  await assert.rejects(() => readBody(oversized, 512), error => error.status === 413);
});

test('only the deployment-specific preview receives its own disposable RP identity', async () => {
  const preview = 'https://one16-preview-a123.vercel.app';
  const settings = { ...env, VERCEL_ENV: 'preview', VERCEL_URL: 'one16-preview-a123.vercel.app' };
  const handlers = createWalletHandlers({ env: settings, runtime: fixture().runtime });
  const data = await stateOf(await handlers.config(new Request(`${preview}/api/wallet/config`)));
  assert.equal(data.origin, preview); assert.equal(data.rpId, 'one16-preview-a123.vercel.app');
  const other = await stateOf(await handlers.config(new Request('https://evil.vercel.app/api/wallet/config')));
  assert.equal(other.origin, DEFAULT_ORIGIN); assert.equal(other.rpId, 'agenticreality.space');
  const local = readConfig({ ...env, WALLET_ORIGIN: 'http://localhost:4318' });
  assert.equal(local.configured, true); assert.equal(local.rpId, 'localhost');
  assert.equal(readConfig({ ...env, WALLET_ORIGIN: 'http://localhost:4318', VERCEL_ENV: 'production' }).configured, false);
});

test('canonical wallet domain is agenticreality.space and old or www origins cannot request funds', async () => {
  assert.equal(DEFAULT_ORIGIN, 'https://agenticreality.space');
  const f = fixture();
  const canonical = await stateOf(await f.handlers.config(request('GET')));
  assert.equal(canonical.origin, DEFAULT_ORIGIN); assert.equal(canonical.rpId, 'agenticreality.space');
  for (const origin of ['https://one16-passport-ar.vercel.app', 'https://www.agenticreality.space', 'https://evil.agenticreality.space']) {
    assert.equal((await f.handlers.faucet(request('POST', undefined, origin))).status, 403);
  }
  assert.equal(f.claims, 0);
});

test('public config fingerprints are stable and change for a different RP or ledger configuration', async () => {
  const f = fixture(), handlers = f.handlers;
  const first = await stateOf(await handlers.config(request('GET'))), same = await stateOf(await handlers.config(request('GET')));
  assert.match(first.configFingerprint, /^[a-f0-9]{64}$/); assert.equal(first.configFingerprint, same.configFingerprint);
  const different = createWalletHandlers({ env: { ...env, WALLET_ORIGIN: 'https://another.example' }, runtime: f.runtime });
  const changed = await stateOf(await different.config(new Request('https://another.example/api/wallet/config')));
  assert.notEqual(first.configFingerprint, changed.configFingerprint);
  const otherCode = createWalletHandlers({ env: { ...env, WALLET_ACCOUNT_WASM_HASH: 'ab'.repeat(32) }, runtime: f.runtime });
  assert.notEqual(first.configFingerprint, (await stateOf(await otherCode.config(request('GET')))).configFingerprint);
});

test('API config and financial outcomes are never cached by browser or CDN', async () => {
  const f = fixture();
  for (const response of [await f.handlers.config(request('GET')), await f.handlers.faucet(request('POST', undefined, 'https://evil.example'))]) {
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
    assert.equal(response.headers.get('CDN-Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Vercel-CDN-Cache-Control'), 'no-store');
  }
});

test('observed prefunding is durably recorded, so spending it cannot enable an automatic top-up',async()=>{
 const f=fixture();f.funds=1n;
 assert.equal((await stateOf(await f.handlers.faucet(request()))).state,'confirmed');
 const record=await f.store.get(`wallet:${config.campaign}:testnet:claim:${ADDRESS}`);assert.equal(record.state,'confirmed');assert.ok(record.version);
 f.funds=0n;
 assert.equal((await stateOf(await f.handlers.faucet(request('POST',{address:ADDRESS,retry:true})))).state,'confirmed');assert.equal(f.claims,0);
});

test('a stale pending reader cannot downgrade a concurrent onchain confirmation to unknown',async()=>{
 const store=new Store(),latch=deferred(),started=deferred();let balances=0;
 const key=`wallet:${config.campaign}:testnet:claim:${ADDRESS}`;
 await store.set(key,{address:ADDRESS,state:'pending',createdAt:1,updatedAt:1,attempt:1,version:'original'});
 const runtime={redis:store,walletAllowed:async()=>true,balance:async()=>{balances++;if(balances===1){started.resolve();await latch.promise;return 0n;}return 100n;}};
 const first=createWalletHandlers({env,runtime,now:()=>200000}),second=createWalletHandlers({env,runtime,now:()=>200000});
 const read=()=>request('GET',undefined,DEFAULT_ORIGIN,`/api/wallet/faucet?address=${ADDRESS}`);
 const stale=first.faucet(read());await started.promise;
 assert.equal((await stateOf(await second.faucet(read()))).state,'confirmed');
 latch.resolve();assert.equal((await stateOf(await stale)).state,'confirmed');assert.equal((await store.get(key)).state,'confirmed');
});

test('a CLI completion cannot overwrite a confirmation inserted after its final Redis read',async()=>{
 class ConfirmingStore extends Store {
  reads=0;
  async get(key){const previous=await super.get(key);this.reads++;if(this.reads===2&&previous?.state==='pending')await super.set(key,{...previous,state:'confirmed',confirmedAt:1000,version:'concurrent-chain-proof'});return previous;}
 }
 const store=new ConfirmingStore();let claims=0;
 const f=fixture({claim:async()=>{claims++;return{success:true,hash:'f'.repeat(64)};}},store);
 const result=await stateOf(await f.handlers.faucet(request()));
 assert.equal(result.state,'confirmed');assert.equal(claims,1);assert.equal((await store.get(`wallet:${config.campaign}:testnet:claim:${ADDRESS}`)).version,'concurrent-chain-proof');
});

for(const outcome of [{success:false,reason:'payment_failed'},{success:false,reason:'unrecognized_provider_failure'},{success:false,reason:'user_cooldown',hash:'d'.repeat(64)},{}])test(`ambiguous provider outcome ${outcome.reason||'missing result'} never enables a second claim`,async()=>{
 let claims=0;const f=fixture({claim:async()=>{claims++;return outcome;}});
 assert.equal((await stateOf(await f.handlers.faucet(request()))).state,'unknown');
 assert.equal((await stateOf(await f.handlers.faucet(request('POST',{address:ADDRESS,retry:true})))).state,'unknown');assert.equal(claims,1);
});

test('explicit retries across instances atomically advance one failed revision, even at the same timestamp',async()=>{
 const store=new Store(),latch=deferred(),started=deferred();let claims=0;
 await store.set(`wallet:${config.campaign}:testnet:claim:${ADDRESS}`,{address:ADDRESS,state:'failed',reason:'empty_today',attempt:1,createdAt:1000,updatedAt:1000,version:'first-rejection'});
 const runtime={redis:store,walletAllowed:async()=>true,balance:async()=>0n,claim:async()=>{claims++;started.resolve();await latch.promise;return{success:false,reason:'empty_today'};}};
 const first=createWalletHandlers({env,runtime,now:()=>1000}),second=createWalletHandlers({env,runtime,now:()=>1000});
 const retry=()=>request('POST',{address:ADDRESS,retry:true});
 const running=first.faucet(retry());await started.promise;
 assert.equal((await stateOf(await second.faucet(retry()))).state,'pending');assert.equal(claims,1);
 latch.resolve();assert.equal((await stateOf(await running)).state,'failed');const record=await store.get(`wallet:${config.campaign}:testnet:claim:${ADDRESS}`);assert.equal(record.attempt,2);assert.notEqual(record.version,'first-rejection');
});
