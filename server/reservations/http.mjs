import { ServiceError,fail,exactKeys } from '../identity/common.mjs';
import { publicConfig,requireCapability,mayReserve } from './config.mjs';
import { sessionCookie } from '../identity/auth.mjs';
const HEADERS={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer'};
function json(value,status=200,extra={}) { return new Response(JSON.stringify(value),{status,headers:{...HEADERS,'Content-Type':'application/json; charset=utf-8',...extra}}); }
async function readBytes(request,limit) {
  if (Number(request.headers.get('content-length'))>limit) fail(413,'REQUEST_SIZE','The request exceeds the allowed size.');
  const chunks=[]; let size=0; const reader=request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  try { for(;;) { const {value,done}=await reader.read(); if (done) break; size+=value.length; if (size>limit) {await reader.cancel();fail(413,'REQUEST_SIZE','The request exceeds the allowed size.');}chunks.push(Buffer.from(value)); } } finally {reader.releaseLock();}
  return Buffer.concat(chunks);
}
async function readJson(request) {
  if (request.headers.get('content-type')?.split(';')[0]!=='application/json') fail(422,'CONTENT_TYPE','Use application/json for this request.');
  const bytes=await readBytes(request,65536);
  try { return JSON.parse(bytes.toString('utf8')); } catch {fail(400,'INVALID_JSON','The request JSON is invalid.');}
}
const identityView=(identity,config)=>({ownerId:identity.ownerId,address:identity.address,role:identity.role,mayReserve:mayReserve(config,identity)});
export function createApi(runtime) {
  const {config,resources,auth,projects,transactions,offers,conversation}=runtime;
  return async function handle(request,context={}) {
    let clearingSession=false;
    try {
      const path=new URL(request.url).pathname.replace(/^\/api\/reservations\/?/,'').replace(/\/$/,'');
      const method=request.method.toUpperCase(),origin=request.headers.get('origin');
      if (origin && origin!==config.origin || !['GET','HEAD'].includes(method)&&origin!==config.origin) fail(403,'ORIGIN_REJECTED','The request origin does not match this application.');
      clearingSession=method==='POST'&&path==='auth/logout';
      if (method==='GET'&&path==='config') return json(publicConfig(config));
      requireCapability(config,'reading');
      // Reserve the bounded response before any downstream provider. Failed requests
      // retain their allowance; provider hard caps remain an external release gate.
      const recovering=path.startsWith('auth/') || method==='GET'&&(/^(project|attempts\/[a-f0-9]{64})$/.test(path));
      await resources.reserve([{resource:recovering?'recoveryRequests':'functionRequests'},{resource:recovering?'recoveryTransferBytes':'transferBytes',amount:config.limits.uploadBytes}]);
      if (clearingSession) {const value=await auth.logout(request);return json({ok:true},200,{'Set-Cookie':value.cookie});}
      if (method==='POST'&&path==='auth/challenge') {
        requireCapability(config,'authentication'); const input=await readJson(request);exactKeys(input,['address','credentialId']);return json(await auth.challenge(input,context));
      }
      if (method==='POST'&&path==='auth/verify') {
        requireCapability(config,'authentication');const input=await readJson(request);exactKeys(input,['challengeId','response']);
        const value=await auth.verify(input,context);return json({identity:identityView(value.identity,config),expiresAt:value.expiresAt,pendingAttempt:await transactions.pending(value.identity)},200,{'Set-Cookie':value.cookie});
      }
      if (method==='GET'&&path==='offers') return json({offers:await offers.list()});
      let match=/^offers\/([a-f0-9]{64})(\/media)?$/.exec(path);
      if (method==='GET'&&match) return match[2]?new Response(await offers.media(match[1]),{headers:{...HEADERS,'Content-Type':'image/png'}}):json({offer:await offers.get(match[1])});
      requireCapability(config,'authentication');
      const identity=await auth.authenticate(request,context);
      if (method==='GET'&&path==='auth/session') return json({identity:identityView(identity,config),expiresAt:null,pendingAttempt:await transactions.pending(identity)});
      if (path==='project'&&method==='GET') return json({project:await projects.get(identity)});
      if (path==='project'&&method==='PUT') return json({project:await projects.update(identity,await readJson(request))});
      if (path==='approval'&&method==='POST') return json({snapshot:await projects.approve(identity,await readJson(request))});
      if (path==='conversation'&&method==='POST') return json(await conversation.propose(identity,await readJson(request)));
      if (path==='media'&&method==='POST') return json({media:await projects.upload(identity,await readBytes(request,config.limits.uploadBytes),request.headers.get('content-type')?.split(';')[0])},201);
      match=/^media\/([a-f0-9]{64})$/.exec(path);
      if (method==='GET'&&match) return new Response(await projects.readMedia(identity,match[1]),{headers:{...HEADERS,'Content-Type':'image/png'}});
      if (path==='attempts/prepare'&&method==='POST') return json(await transactions.prepare(identity,await readJson(request)));
      match=/^attempts\/([a-f0-9]{64})(\/submit)?$/.exec(path);
      if (match&&method==='GET'&&!match[2]) return json(await transactions.reconcile(identity,match[1]));
      if (match&&method==='POST'&&match[2]) return json(await transactions.submit(identity,match[1],await readJson(request)));
      fail(404,'NOT_FOUND','The reservation endpoint was not found.');
    } catch(error) {
      const extra=clearingSession?{'Set-Cookie':sessionCookie('',0)}:{};
      return error instanceof ServiceError?json({code:error.code,message:error.message},error.status,extra):json({code:'SERVICE_UNAVAILABLE',message:clearingSession?'The browser cookie was cleared, but server-side session revocation could not be confirmed.':'The reservation service is unavailable. Existing intents remain preserved.'},503,extra);
    }
  };
}
