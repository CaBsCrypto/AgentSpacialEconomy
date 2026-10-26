import fs from 'node:fs';import {execFileSync} from 'node:child_process';import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
// CPU validation only: Pillow actually decodes embedded image bytes; no GPU rendering claim.
globalThis.self=globalThis;let decodedImages=0;
globalThis.createImageBitmap=async blob=>{const b=Buffer.from(await blob.arrayBuffer());const dimensions=JSON.parse(execFileSync(process.env.PYTHON||'python',['-c','from PIL import Image;import io,sys,json;im=Image.open(io.BytesIO(sys.stdin.buffer.read()));im.load();print(json.dumps(im.size))'],{input:b}).toString());decodedImages++;return{width:dimensions[0],height:dimensions[1],close(){}}};
const file=process.argv[2];if(!file)throw Error('Pass full final GLB path');
const b=fs.readFileSync(file),array=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const gltf=await new GLTFLoader().parseAsync(array,'');let meshes=0,vertices=0;gltf.scene.traverse(o=>{if(o.isMesh){meshes++;vertices+=o.geometry.attributes.position.count;for(const value of o.matrixWorld.elements)if(!Number.isFinite(value))throw Error('Non-finite transform');}});if(!meshes)throw Error('Empty model');console.log(JSON.stringify({file,bytes:b.length,meshes,vertices,decodedImages,parsed:true,gpuTested:false}));
