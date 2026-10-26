import {getContext,getVercelOidcTokenSync} from '@vercel/oidc';
import {AdsError} from './common.mjs';

const unavailable=()=>new AdsError(503,'MODEL_GATEWAY_AUTH_UNAVAILABLE','AI Gateway credentials are unavailable for this request.');
const apiKey=env=>typeof env.AI_GATEWAY_API_KEY==='string'&&env.AI_GATEWAY_API_KEY.trim()||null;
/** Readiness check only; Gateway validates the credential's cryptographic signature. */
export function freshVercelOidcToken(token,now=Date.now()){
 if(typeof token!=='string'||token.length>32768)return false;
 const parts=token.split('.');
 if(parts.length!==3||parts.some(part=>!part||!/^[A-Za-z0-9_-]+$/.test(part)))return false;
 try{
  const header=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
  const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
  const issuer=new URL(claims.iss);
  return typeof header.alg==='string'&&header.alg.toLowerCase()!=='none'&&issuer.origin==='https://oidc.vercel.com'&&!issuer.username&&!issuer.password&&!issuer.search&&!issuer.hash&&
   Number.isSafeInteger(claims.exp)&&claims.exp*1000>now+5000&&
   (claims.nbf===undefined||Number.isFinite(claims.nbf)&&claims.nbf*1000<=now);
 }catch{return false;}
}
/** Hosted build-time env tokens cannot establish runtime request readiness. */
export function hasEnvironmentGatewayCredential(env=process.env,now=Date.now()){
 return Boolean(apiKey(env)||env.VERCEL!=='1'&&freshVercelOidcToken(env.VERCEL_OIDC_TOKEN,now));
}
/** Never copy caller headers into platform context or credentials into process.env. */
export async function resolveGatewayCredential({
 env=process.env,now=Date.now,readContext=getContext,readOidcToken=getVercelOidcTokenSync,
}={}){
 const key=apiKey(env);if(key)return key;
 if(env.VERCEL!=='1'){
  if(freshVercelOidcToken(env.VERCEL_OIDC_TOKEN,now()))return env.VERCEL_OIDC_TOKEN;
  throw unavailable();
 }
 let candidate;
 try{candidate=readContext()?.headers?.['x-vercel-oidc-token'];}catch{throw unavailable();}
 // Use the official synchronous reader to avoid CLI refreshes or process.env writes.
 // A hosted runtime must have a fresh token in the trusted platform context.
 if(!freshVercelOidcToken(candidate,now()))throw unavailable();
 let token;
 try{token=readOidcToken();}catch{throw unavailable();}
 if(token!==candidate||!freshVercelOidcToken(token,now()))throw unavailable();
 return token;
}
export async function gatewayCredentialAvailable(options){
 try{await resolveGatewayCredential(options);return true;}catch{return false;}
}
