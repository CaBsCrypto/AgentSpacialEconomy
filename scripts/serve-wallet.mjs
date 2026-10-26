import {createServer} from 'node:http';
import {createReadStream,realpathSync} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolvePlatformRequest} from '../dist/platform-routing.mjs';

const defaultRoot=fileURLToPath(new URL('../dist/',import.meta.url));
const defaultApis=new Map([
 ['/api/wallet/config',async(req,res)=>(await import('../api/wallet/config.js')).default(req,res)],
 ['/api/wallet/relay',async(req,res)=>(await import('../api/wallet/relay.js')).default(req,res)],
 ['/api/wallet/faucet',async(req,res)=>(await import('../api/wallet/faucet.js')).default(req,res)],
]);
const types={'.html':'text/html; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.glb':'model/gltf-binary','.usdz':'model/vnd.usdz+zip','.gz':'application/gzip','.mp4':'video/mp4'};

/** Mirror platform/NFC routing locally; API handlers retain their own method and origin guards. */
export function createWalletDevelopmentServer({distRoot=defaultRoot,apiHandlers=defaultApis}={}) {
 const root=path.resolve(distRoot);
 return createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');
   if(url.pathname==='/api/ads'||url.pathname.startsWith('/api/ads/')){await(await import('../server/ads/runtime.mjs')).handleAdsNode(req,res);return;}
   if(url.pathname==='/ads'){url.pathname='/ads.html';}
   if(apiHandlers.has(url.pathname)){await apiHandlers.get(url.pathname)(req,res);return;}
   if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
   const route=resolvePlatformRequest(url.href);
   if(route?.type==='redirect'){res.writeHead(route.status,{'Location':route.destination,'Cache-Control':'no-store'});res.end();return;}
   const decoded=decodeURIComponent(route?.pathname||url.pathname);
   const file=path.resolve(root,'.'+decoded+(decoded.endsWith('/')?'index.html':''));
   const relative=path.relative(root,file);
   if(relative.startsWith('..')||path.isAbsolute(relative)||decoded.split(/[\\/]/).some(p=>p.startsWith('.'))){res.writeHead(403);res.end();return;}
   const info=await stat(file);
   if(!info.isFile())throw Error('not file');
   res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Permissions-Policy':'camera=(self), microphone=(), geolocation=(), xr-spatial-tracking=(self)'});
   if(req.method==='HEAD')res.end();else createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  }catch{if(!res.headersSent)res.writeHead(404);res.end('No disponible');}
 });
}

if(process.argv[1]&&realpathSync(path.resolve(process.argv[1]))===realpathSync(fileURLToPath(import.meta.url))){
 const port=Number(process.env.PORT||4318);
 // Local credentials stay on localhost; never inherit the event's RP ID.
 process.env.WALLET_ORIGIN='http://localhost:'+port;
 createWalletDevelopmentServer().listen(port,'127.0.0.1',()=>console.log('Local: http://localhost:'+port));
}
