import test from 'node:test';
import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {freshVercelOidcToken,hasEnvironmentGatewayCredential,resolveGatewayCredential,gatewayCredentialAvailable} from '../server/ads/gateway-auth.mjs';
import {readAdsConfig,publicAdsConfig} from '../server/ads/config.mjs';
import {createAdsRuntimeResolver} from '../server/ads/runtime.mjs';
import {createGatewayModelRuntime} from '../server/ads/creative.mjs';

// All credentials in this file are unsigned local fixtures. No request reaches Gateway.
const context=new AsyncLocalStorage();
const requestContext=Symbol.for('@vercel/request-context');
const originalContext=Object.getOwnPropertyDescriptor(globalThis,requestContext);
test.before(()=>Object.defineProperty(globalThis,requestContext,{value:{get:()=>context.getStore()},configurable:true}));
test.after(()=>{if(originalContext)Object.defineProperty(globalThis,requestContext,originalContext);else delete globalThis[requestContext];});
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function token(label='fixture',claims={},header={}){
 return [encode({alg:'RS256',typ:'JWT',...header}),encode({iss:'https://oidc.vercel.com/local-fixture',sub:label,exp:Math.floor(Date.now()/1000)+3600,...claims}),'fixture-signature'].join('.');
}
const withToken=(value,fn)=>context.run({headers:{'x-vercel-oidc-token':value}},fn);
const hosted={VERCEL:'1'};
const authError=error=>error.code==='MODEL_GATEWAY_AUTH_UNAVAILABLE'&&error.status===503;

test('OIDC readiness rejects expired, unsigned, foreign-issuer and not-yet-valid fixtures',()=>{
 const now=Date.now();
 assert.equal(freshVercelOidcToken(token(),now),true);
 for(const value of [undefined,'opaque-header',token('expired',{exp:Math.floor(now/1000)-1}),token('soon',{exp:Math.floor(now/1000)+2}),token('unsigned',{}, {alg:'none'}),token('foreign',{iss:'https://example.com'}),token('future',{nbf:Math.ceil(now/1000)+60})])assert.equal(freshVercelOidcToken(value,now),false);
});

test('explicit server API key has precedence without reading OIDC or changing environment',async()=>{
 const before=process.env.VERCEL_OIDC_TOKEN;
 let reads=0;
 assert.equal(await resolveGatewayCredential({env:{...hosted,AI_GATEWAY_API_KEY:'local-test-api-key'},readContext:()=>{reads++;throw Error('unexpected context');},readOidcToken:()=>{reads++;throw Error('unexpected token');}}),'local-test-api-key');
 assert.equal(reads,0);
 assert.equal(process.env.VERCEL_OIDC_TOKEN===before,true);
 assert.equal(hasEnvironmentGatewayCredential({...hosted,AI_GATEWAY_API_KEY:'local-test-api-key'}),true);
});

test('ordinary caller headers and a hosted build-time token cannot establish runtime readiness',async()=>{
 const value=token('untrusted-client');let reads=0;
 await withToken(value,()=>assert.rejects(resolveGatewayCredential({env:{},readOidcToken:()=>{reads++;return value;}}),authError));
 await context.run({},()=>assert.rejects(resolveGatewayCredential({env:{...hosted,VERCEL_OIDC_TOKEN:value},readOidcToken:()=>{reads++;return value;}}),authError));
 assert.equal(reads,0);
 assert.equal(hasEnvironmentGatewayCredential({...hosted,VERCEL_OIDC_TOKEN:value}),false);
 assert.equal(await withToken(value,()=>gatewayCredentialAvailable({env:{}})),false);
});

test('official request-context reader isolates concurrent requests and never writes token env',async()=>{
 const before=process.env.VERCEL_OIDC_TOKEN,a=token('request-a'),b=token('request-b');
 const [actualA,actualB]=await Promise.all([
  withToken(a,async()=>{await Promise.resolve();return resolveGatewayCredential({env:hosted});}),
  withToken(b,async()=>{await Promise.resolve();return resolveGatewayCredential({env:hosted});}),
 ]);
 assert.equal(actualA,a);assert.equal(actualB,b);
 assert.equal(process.env.VERCEL_OIDC_TOKEN===before,true);
});

test('missing, expired or changed context fails closed before credential fallback',async()=>{
 let reads=0;
 const readOidcToken=()=>{reads++;return token('fallback');};
 for(const value of [undefined,token('expired',{exp:1})])await withToken(value,()=>assert.rejects(resolveGatewayCredential({env:hosted,readOidcToken}),authError));
 assert.equal(reads,0);
 await withToken(token('initial'),()=>assert.rejects(resolveGatewayCredential({env:hosted,readOidcToken}),authError));
 assert.equal(reads,1);
});

test('local explicit OIDC env token must be fresh and never consults caller context',async()=>{
 const value=token('local-env');
 assert.equal(await resolveGatewayCredential({env:{VERCEL_OIDC_TOKEN:value},readContext:()=>{throw Error('caller context forbidden');}}),value);
 assert.equal(hasEnvironmentGatewayCredential({VERCEL_OIDC_TOKEN:value}),true);
 await assert.rejects(resolveGatewayCredential({env:{VERCEL_OIDC_TOKEN:token('expired',{exp:1})}}),authError);
});

test('public configuration exposes only readiness while preserving unrelated integration gates',async()=>{
 const value=token('public-config');
 const available=await withToken(value,()=>gatewayCredentialAvailable({env:hosted}));
 const ready=readAdsConfig(hosted,{gatewayCredentialAvailable:available});
 const missing=readAdsConfig(hosted,{gatewayCredentialAvailable:false});
 assert.equal(ready.missing.includes('AI_GATEWAY_API_KEY'),false);
 assert.equal(missing.missing.includes('AI_GATEWAY_API_KEY'),true);
 assert.equal(ready.enabled,false);assert.equal(ready.missing.includes('walletCompatibilityVerified'),true);
 const encoded=JSON.stringify(publicAdsConfig(ready));
 assert.equal(encoded.includes(value),false);assert.equal(encoded.includes('local-test-api-key'),false);
 for(const forbidden of ['VERCEL_OIDC_TOKEN','gatewayCredential','apiKey','databaseUrl','publisherKey'])assert.equal(encoded.includes(forbidden),false);
});

test('runtime resolver refreshes readiness per request while sharing only the database pool',async()=>{
 let pools=0;const db={fixture:true};
 const resolve=createAdsRuntimeResolver({env:{...hosted,ADS_DATABASE_URL:'postgres://unused-local-fixture/ads'},databaseFactory:()=>{pools++;return db;},runtimeFactory:options=>({config:options.config,db:options.db})});
 const first=await withToken(token('first'),resolve);
 const absent=await context.run({},resolve);
 const expired=await withToken(token('expired',{exp:1}),resolve);
 const next=await withToken(token('next'),resolve);
 assert.equal(first.config.missing.includes('AI_GATEWAY_API_KEY'),false);
 assert.equal(absent.config.missing.includes('AI_GATEWAY_API_KEY'),true);
 assert.equal(expired.config.missing.includes('AI_GATEWAY_API_KEY'),true);
 assert.equal(next.config.missing.includes('AI_GATEWAY_API_KEY'),false);
 assert.notEqual(first,next);assert.notEqual(first.config,next.config);
 assert.equal(first.db,next.db);assert.equal(first.db,db);assert.equal(pools,1);
 assert.equal(first.config.enabled,false);
});

function fakeAI(calls){return async()=>({
 createGateway:({apiKey})=>({languageModel:id=>({id,fixtureCredential:apiKey})}),
 Output:{object:value=>value},
 generateText:async options=>{calls.push(options.model);return {output:{headline:'Local fixture',tagline:'',alt:'Local fixture.'}};},
});}
const modelConfig={model:{id:'explicit/local-fixture',maxTokens:100}};
const input={brief:{name:'Local fixture'},placements:['main_stage_screen']};

test('each model call resolves its own request credential without reusing a previous provider',async()=>{
 const calls=[],a=token('model-a'),b=token('model-b');
 const model=createGatewayModelRuntime({config:modelConfig,env:hosted,loadAI:fakeAI(calls)});
 await withToken(a,()=>model.compose(input));
 await withToken(b,()=>model.compose(input));
 assert.deepEqual(calls.map(call=>call.fixtureCredential),[a,b]);
 assert(calls.every(call=>call.id===modelConfig.model.id));
 await withToken(token('expired',{exp:1}),()=>assert.rejects(model.compose(input),authError));
 assert.equal(calls.length,2);
});

test('missing model auth fails before loading or calling the SDK and cannot reuse a previous token',async()=>{
 let loads=0;const model=createGatewayModelRuntime({config:modelConfig,env:hosted,loadAI:async()=>{loads++;throw Error('SDK must not load');}});
 await context.run({},()=>assert.rejects(model.compose(input),authError));
 assert.equal(loads,0);
});


test('public config HTTP route derives readiness from platform context and ignores caller token headers',async()=>{
 const value=token('http-request'),env={...hosted,ADS_ORIGIN:'https://ads.example'};let queries=0;
 const resolve=createAdsRuntimeResolver({env,databaseFactory:()=>({query:async()=>{queries++;throw Error('public config must not query storage');}})});
 const request=new Request(env.ADS_ORIGIN+'/api/ads/config',{headers:{'x-vercel-oidc-token':value}});
 const valid=await withToken(value,async()=>{const runtime=await resolve();return runtime.handler(request);});
 const absent=await context.run({},async()=>{const runtime=await resolve();return runtime.handler(request);});
 assert.equal(valid.status,200);assert.equal(absent.status,200);
 const available=await valid.json(),unavailable=await absent.json();
 assert.equal(available.missing.includes('AI_GATEWAY_API_KEY'),false);
 assert.equal(unavailable.missing.includes('AI_GATEWAY_API_KEY'),true);
 assert.equal(available.enabled,false);assert.equal(available.missing.includes('walletCompatibilityVerified'),true);
 assert.equal(JSON.stringify(available).includes(value),false);assert.equal(JSON.stringify(unavailable).includes(value),false);
 assert.equal(queries,0);
});
