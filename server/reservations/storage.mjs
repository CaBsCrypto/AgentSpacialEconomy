import { fail, hexId } from '../identity/common.mjs';
export function createPrivateStorage({ token, sdk } = {}) {
  const client = async () => {
    if (sdk) return sdk;
    if (process.env.VERCEL_BLOB_RETRIES!=='0') fail(503,'BLOB_RETRY_POLICY','Disable automatic Blob retries before using the bounded storage allowance.');
    return import('@vercel/blob');
  };
  function key(value) { if (!/^reservations\/[a-f0-9]{64}\.png$/u.test(value || '')) fail(422,'INVALID_MEDIA_KEY','The media reference is invalid.'); return value; }
  async function get(value,maxBytes=2097152) {
    if (!token) fail(503,'BLOB_UNCONFIGURED','Private media storage is not configured.');
    if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>2097152)fail(422,'MEDIA_SIZE','A bounded media size is required.');
    const result = await (await client()).get(key(value),{ access:'private',token,abortSignal:AbortSignal.timeout(30000) });
    if (result===null || result?.statusCode===404) fail(404,'MEDIA_NOT_FOUND','The private image was not found.');
    if (!result || result.statusCode!==200 || !result.stream) fail(503,'MEDIA_READ_UNCERTAIN','The private image read could not be confirmed.');
    const reader=result.stream.getReader(),chunks=[];let size=0;
    try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>maxBytes){await reader.cancel();fail(503,'MEDIA_SIZE_MISMATCH','The stored image exceeds its recorded size.');}chunks.push(Buffer.from(part.value));}}finally{reader.releaseLock();}
    return Buffer.concat(chunks);
  }
  return { get, async remove(value) {
    if (!token) fail(503,'BLOB_UNCONFIGURED','Private media storage is not configured.');
    await (await client()).del(key(value),{token,abortSignal:AbortSignal.timeout(30000)});
  }, async put(bytes,id) {
    if (!token) fail(503,'BLOB_UNCONFIGURED','Private media storage is not configured.');
    const path = 'reservations/'+hexId(id)+'.png';
    // A lost response remains STAGED. Do not perform an unbudgeted fallback GET
    // or turn ambiguous storage acceptance into READY.
    await (await client()).put(path,bytes,{ access:'private',token,contentType:'image/png',addRandomSuffix:false,allowOverwrite:false,cacheControlMaxAge:60,abortSignal:AbortSignal.timeout(30000) });
    return { key:path };
  } };
}
