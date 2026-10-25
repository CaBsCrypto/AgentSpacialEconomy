import fs from 'node:fs';import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
const file=process.argv[2];if(!file)throw Error('Pass full final GLB path');
const b=fs.readFileSync(file),array=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const gltf=await new Promise((resolve,reject)=>new GLTFLoader().parse(array,'',resolve,reject));
let meshes=0,vertices=0;gltf.scene.traverse(o=>{if(o.isMesh){meshes++;vertices+=o.geometry.attributes.position.count;for(const value of o.matrixWorld.elements)if(!Number.isFinite(value))throw Error('Non-finite transform');}});if(!meshes)throw Error('Empty model');console.log(JSON.stringify({file,bytes:b.length,meshes,vertices,parsed:true}));
