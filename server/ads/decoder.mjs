import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {AdsError} from './common.mjs';
export function decodeUpload(bytes,limits){
 return new Promise((resolve,reject)=>{
  // Pass no application, database, model, treasury or publisher credentials to the decoder.
  const child=spawn(process.execPath,['--max-old-space-size=64',fileURLToPath(new URL('./image-worker.mjs',import.meta.url)),JSON.stringify(limits)],{windowsHide:true,shell:false,env:{...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),...(process.env.PATH?{PATH:process.env.PATH}:{}),NODE_ENV:'production'},stdio:['pipe','pipe','pipe']});
  let length=0,errors='',finished=false;const chunks=[];
  const fail=error=>{if(finished)return;finished=true;clearTimeout(timer);child.kill();reject(error);};
  const timer=setTimeout(()=>fail(new AdsError(422,'IMAGE_TIMEOUT','The decoder exceeded its processing limit.')),10000);
  child.on('error',()=>fail(new AdsError(503,'IMAGE_DECODER_UNAVAILABLE','The isolated image decoder could not start.')));
  child.stdout.on('data',chunk=>{length+=chunk.length;if(length>limits.uploadBytes+512)return fail(new AdsError(413,'SANITIZED_UPLOAD_SIZE','The decoded image exceeds the storage limit.'));chunks.push(chunk);});
  child.stderr.on('data',chunk=>{errors=(errors+chunk.toString('utf8')).slice(0,2048);});
  child.stdin.on('error',()=>{});child.stdin.end(bytes);
  child.on('close',code=>{
   if(finished)return;finished=true;clearTimeout(timer);
   if(code!==0){let e;try{e=JSON.parse(errors);}catch{}return reject(new AdsError(e?.status===413?413:422,e?.code||'IMAGE_DECODE',e?.message||'The image could not be safely decoded.'));}
   try{
    const data=Buffer.concat(chunks),split=data.indexOf(10);if(split<0||split>256)throw Error();
    const info=JSON.parse(data.subarray(0,split).toString('utf8'));
    if(!Number.isSafeInteger(info.width)||!Number.isSafeInteger(info.height)||info.width>limits.imageWidth||info.height>limits.imageHeight)throw Error();
    resolve({data:data.subarray(split+1),info});
   }catch{reject(new AdsError(422,'IMAGE_DECODE','The decoder returned invalid output.'));}
  });
 });
}
