/** Vendor isolated, exact mobile AR runtime without changing the venue's Three.js. */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const root=process.cwd(),toolRoot=path.resolve(process.env.AR_TOOLS_DIR||'.ar-tools');
const three=path.join(toolRoot,'three/package'),mindar=path.join(toolRoot,'mind-ar/package');
for(const [folder,expected] of [[three,'0.160.0'],[mindar,'1.2.5']]){const actual=JSON.parse(fs.readFileSync(path.join(folder,'package.json'))).version;if(actual!==expected)throw Error(`Expected ${expected}, got ${actual}`);}
const copies=[];
function copy(from,to){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);copies.push(path.relative(root,to).replaceAll('\\','/'));}
const seen=new Set();
function visit(rel){if(seen.has(rel))return;seen.add(rel);const source=path.join(three,rel),dest=path.resolve('dist/vendor/ar-three',rel),text=fs.readFileSync(source,'utf8');copy(source,dest);for(const m of text.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]*?\sfrom\s*)?['"]([^'"]+)['"]/g)){const spec=m[1];if(spec.startsWith('.'))visit(path.posix.normalize(path.posix.join(path.posix.dirname(rel),spec)));else if(spec.startsWith('three/addons/'))visit(spec.replace('three/addons/','examples/jsm/'));else if(spec!=='three')throw Error(`Unexpected import ${spec}`);}}
for(const rel of ['build/three.module.js','examples/jsm/loaders/GLTFLoader.js','examples/jsm/controls/OrbitControls.js','examples/jsm/renderers/CSS3DRenderer.js'])visit(rel);
copy(path.join(three,'LICENSE'),path.resolve('dist/vendor/ar-three/LICENSE'));
for(const rel of ['mindar-image-three.prod.js','controller-mGt1s8dJ.js','ui-fBadYuor.js'])copy(path.join(mindar,'dist',rel),path.resolve('dist/vendor/mindar',rel));
if(fs.existsSync(path.join(mindar,'LICENSE')))copy(path.join(mindar,'LICENSE'),path.resolve('dist/vendor/mindar/LICENSE'));
const manifest={three:'0.160.0',mindar:'1.2.5',source:'Exact npm registry tarballs: three@0.160.0 and mind-ar@1.2.5. MindAR distribution retains embedded third-party notices.',files:copies.map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}))};
fs.writeFileSync('dist/vendor/ar-runtime.json',JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({three:manifest.three,mindar:manifest.mindar,files:copies.length}));
