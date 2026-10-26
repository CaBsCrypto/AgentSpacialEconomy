// Secret-free, bounded decoder subprocess. Input is raw image bytes, output a short JSON header + normalized PNG.
import sharp from 'sharp';
const limits=JSON.parse(process.argv[2]);
sharp.concurrency(1);sharp.cache(false);
const error=(code,status,message)=>{process.stderr.write(JSON.stringify({code,status,message}));process.exitCode=1;};
try{
 let size=0;const chunks=[];
 for await(const chunk of process.stdin){size+=chunk.length;if(size>limits.uploadBytes)throw {code:'UPLOAD_SIZE',status:413,message:'The image exceeds the upload limit.'};chunks.push(chunk);}
 const data=Buffer.concat(chunks);
 const p=sharp(data,{limitInputPixels:limits.imagePixels,failOn:'warning',animated:false,sequentialRead:true});
 const meta=await p.metadata();
 if(!['png','jpeg','webp'].includes(meta.format)||!meta.width||!meta.height||meta.width>limits.imageWidth||meta.height>limits.imageHeight||meta.width*meta.height>limits.imagePixels||(meta.pages??1)!==1)throw {code:'IMAGE_DIMENSIONS',status:422,message:'The image dimensions or animation exceed the content policy.'};
 const {data:png,info}=await p.rotate().png({compressionLevel:9}).timeout({seconds:5}).toBuffer({resolveWithObject:true});
 if(info.width>limits.imageWidth||info.height>limits.imageHeight)throw {code:'IMAGE_DIMENSIONS',status:422,message:'The oriented image exceeds the dimension policy.'};
 if(png.length>limits.uploadBytes)throw {code:'SANITIZED_UPLOAD_SIZE',status:413,message:'The decoded image exceeds the storage limit.'};
 process.stdout.write(Buffer.concat([Buffer.from(JSON.stringify({width:info.width,height:info.height})+'\n'),png]));
}catch(e){error(e.code&&e.status?e.code:'IMAGE_DECODE',e.status||422,e.code&&e.status?e.message:'The image could not be safely decoded.');}
