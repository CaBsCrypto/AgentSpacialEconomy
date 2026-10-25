// Lossless transfer: the compressed payload expands to the original GLB bytes.
export async function fetchModel({onProgress=()=>{},fetcher=fetch,decompressor=globalThis.DecompressionStream}={}){
 const compressed=typeof decompressor==='function';
 const response=await fetcher(compressed?'./assets/one16.glb.gz?v=6':'./assets/one16.glb?v=5');
 if(!response.ok)throw Error(`Modelo: HTTP ${response.status}`);
 const total=Number(response.headers.get('content-length'))|| (compressed?1414969:8700920);
 let loaded=0;
 const progress=new TransformStream({transform(chunk,controller){loaded+=chunk.byteLength;onProgress({loaded,total});controller.enqueue(chunk)}});
 const payload=await new Response(response.body.pipeThrough(progress)).arrayBuffer();
 const magic=new Uint8Array(payload,0,Math.min(4,payload.byteLength));
 // Some hosts apply Content-Encoding and fetch already decompresses it.
 if(compressed&&magic[0]===0x1f&&magic[1]===0x8b)return new Response(new Blob([payload]).stream().pipeThrough(new decompressor('gzip'))).arrayBuffer();
 if(magic[0]!==0x67||magic[1]!==0x6c||magic[2]!==0x54||magic[3]!==0x46)throw Error('Respuesta de modelo inválida');
 return payload;
}
