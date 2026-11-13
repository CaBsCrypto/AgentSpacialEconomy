import { Readable } from 'node:stream';
import { createRuntime } from '../server/reservations/runtime.mjs';
import { createApi } from '../server/reservations/http.mjs';
let handler;
export default async function reservations(request,response) {
  handler??=createApi(createRuntime());
  const origin=process.env.WALLET_ORIGIN||'https://agenticreality.space';
  const headers=new Headers();
  for(const [name,value] of Object.entries(request.headers)) if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(','):String(value));
  const method=request.method||'GET';
  const body=['GET','HEAD'].includes(method)?undefined:Readable.toWeb(request);
  const input=new Request(new URL(request.url,origin),{method,headers,...(body?{body,duplex:'half'}:{})});
  // Only trust the platform's overwritten client-IP header on Vercel; local
  // callers cannot choose their rate bucket using X-Forwarded-For.
  const ip=process.env.VERCEL==='1'?request.headers['x-real-ip']||'unknown':request.socket?.remoteAddress||'unknown';
  const result=await handler(input,{ip});
  response.statusCode=result.status; for(const [name,value] of result.headers) response.setHeader(name,value);
  response.end(Buffer.from(await result.arrayBuffer()));
}
export const config={api:{bodyParser:false}};
