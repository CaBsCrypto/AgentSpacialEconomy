// Lossless transfer; one original-GLB fallback if gzip is unsupported or fails.
export async function fetchModel({onProgress=()=>{},fetcher=fetch,decompressor=globalThis.DecompressionStream}={}){
 async function transfer(compressed){
  const response=await fetcher(compressed?'./assets/one16.glb.gz?v=e7d6e2af2a5e':'./assets/one16.glb?v=e7d6e2af2a5e');
  if(!response.ok)throw Error(`Modelo: HTTP ${response.status}`);
  const total=Number(response.headers.get('content-length'))||(compressed?1595751:9511336);
  let loaded=0;
  const progress=new TransformStream({transform(chunk,controller){loaded+=chunk.byteLength;onProgress({loaded,total});controller.enqueue(chunk)}});
  let payload=await new Response(response.body.pipeThrough(progress)).arrayBuffer();
  let magic=new Uint8Array(payload,0,Math.min(4,payload.byteLength));
  // Fetch may already have decoded a server Content-Encoding: gzip response.
  if(compressed&&magic[0]===0x1f&&magic[1]===0x8b){
   payload=await new Response(new Blob([payload]).stream().pipeThrough(new decompressor('gzip'))).arrayBuffer();
   magic=new Uint8Array(payload,0,Math.min(4,payload.byteLength));
  }
  if(magic[0]!==0x67||magic[1]!==0x6c||magic[2]!==0x54||magic[3]!==0x46)throw Error('Respuesta de modelo inválida');
  return payload;
 }
 if(typeof decompressor!=='function')return transfer(false);
 try{return await transfer(true)}catch(error){
  if(error?.name==='AbortError')throw error;
  onProgress({loaded:0,total:9511336});
  return transfer(false);
 }
}
