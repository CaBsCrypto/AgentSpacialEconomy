/** Offline MindAR 1.2.5 compiler. Build-only dependencies live in .ar-tools/. */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const root=process.cwd(),tools=path.resolve('.ar-tools'),require=createRequire(path.join(tools,'package.json'));
const shim=path.join(tools,'node_modules/canvas');
if(!fs.existsSync(shim)){
 fs.mkdirSync(shim,{recursive:true});fs.writeFileSync(path.join(shim,'package.json'),JSON.stringify({name:'canvas',private:true,type:'module',exports:'./index.mjs'}));
 fs.writeFileSync(path.join(shim,'index.mjs'),"import canvas from '@napi-rs/canvas';export const createCanvas=canvas.createCanvas;export const loadImage=canvas.loadImage;\n");
}
const source=path.join(tools,'mind-ar/package');
if(JSON.parse(fs.readFileSync(path.join(source,'package.json'))).version!=='1.2.5')throw Error('Compiler must be MindAR 1.2.5');
const tf=require('@tensorflow/tfjs');await tf.setBackend('cpu');await tf.ready();
const {loadImage}=require('@napi-rs/canvas'),msgpack=require('@msgpack/msgpack');
const {OfflineCompiler}=await import(pathToFileURL(path.join(source,'src/image-target/offline-compiler.js')).href);
const input=path.resolve(process.argv[2]||'dist/assets/passport-target.png'),output=path.resolve(process.argv[3]||'dist/assets/passport-target.mind');
const image=await loadImage(input),compiler=new OfflineCompiler();let step=-1;
const data=await compiler.compileImageTargets([image],percent=>{const current=Math.floor(percent/10);if(current!==step){step=current;console.log(`MindAR compilation ${Math.round(percent)}%`);}});
const bytes=compiler.exportData(),decoded=msgpack.decode(bytes);
if(decoded.v!==2||decoded.dataList.length!==1)throw Error('Unexpected MindAR format');
const matching=data[0].matchingData.map(k=>({width:k.width,height:k.height,maxima:k.maximaPoints.length,minima:k.minimaPoints.length}));
const tracking=data[0].trackingData.map(k=>({width:k.width,height:k.height,points:k.points.length}));
if(!matching.some(k=>k.maxima+k.minima>=30)||!tracking.some(k=>k.points>=10))throw Error('Too few extracted features for a useful image target');
fs.writeFileSync(output,bytes);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const report={compiler:'mind-ar@1.2.5 OfflineCompiler',format:decoded.v,backend:'tensorflowjs-cpu',input:path.relative(root,input).replaceAll('\\','/'),inputSha256:hash(fs.readFileSync(input)),width:image.width,height:image.height,output:path.relative(root,output).replaceAll('\\','/'),bytes:bytes.length,sha256:hash(bytes),matching,tracking,physicalRecognitionVerified:false};
fs.writeFileSync(output.replace(/\.mind$/,'.compiled.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
