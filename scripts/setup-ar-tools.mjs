/**
 * Prepare build-only AR tools in ignored .ar-tools/; root package.json/lock stay untouched.
 * Pinned runtime sources: mind-ar 1.2.5 and three 0.160.0.
 * Pinned compiler deps below use pure TensorFlowJS CPU plus a prebuilt canvas binding.
 * Run from any directory: node scripts/setup-ar-tools.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const toolRoot=path.join(root,'.ar-tools');
const deps={
 '@tensorflow/tfjs':'4.16.0',
 '@msgpack/msgpack':'2.8.0',
 '@napi-rs/canvas':'0.1.80',
 'ml-matrix':'6.10.4',
 'mathjs':'11.6.0',
 'tinyqueue':'2.0.3',
 'svd-js':'1.1.1'
};
fs.mkdirSync(toolRoot,{recursive:true});
const readJson=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const run=(command,args)=>{
 const result=spawnSync(command,args,{cwd:toolRoot,stdio:'inherit',windowsHide:true});
 if(result.error)throw result.error;
 if(result.status!==0)throw Error(`${path.basename(command)} failed (${result.status})`);
};
// Prefer npm's JS CLI so spaces in the Windows workspace never pass through a shell.
function npm(args){
 const pathEntries=(process.env.PATH||'').split(path.delimiter);
 const candidates=[process.env.npm_execpath,path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),...pathEntries.map(p=>path.join(p,'node_modules/npm/bin/npm-cli.js')),'/usr/share/nodejs/npm/bin/npm-cli.js','/usr/local/lib/node_modules/npm/bin/npm-cli.js'];
 const cli=candidates.find(p=>p&&fs.existsSync(p));
 if(cli){run(process.execPath,[cli,...args]);return;}
 if(process.platform!=='win32'){run('npm',args);return;}
 // Fallback contains fixed package/flag tokens only; cwd carries the filesystem path.
 if(args.some(a=>!/^[A-Za-z0-9@._/=:\-]+$/.test(a)))throw Error('Unexpected npm argument');
 run(process.env.ComSpec||'cmd.exe',['/d','/s','/c',['npm.cmd',...args].join(' ')]);
}
function dependenciesReady(){
 if(!Object.entries(deps).every(([name,version])=>readJson(path.join(toolRoot,'node_modules',name,'package.json'))?.version===version))return false;
 try{
  const require=createRequire(path.join(toolRoot,'package.json'));
  return typeof require('@napi-rs/canvas').createCanvas==='function'&&typeof require('@tensorflow/tfjs').setBackend==='function';
 }catch{return false;}
}
const manifestPath=path.join(toolRoot,'package.json');
const previous=readJson(manifestPath)||{};
if(JSON.stringify(previous.dependencies)!==JSON.stringify(deps)||previous.private!==true){
 fs.writeFileSync(manifestPath,JSON.stringify({name:'one16-ar-build-tools',private:true,dependencies:deps},null,2)+'\n');
}
if(!dependenciesReady()){
 npm(['install','--cache','npm-cache','--fetch-retries=0','--fetch-timeout=30000','--ignore-scripts','--no-audit','--no-fund','--save-exact',...Object.entries(deps).map(([name,version])=>`${name}@${version}`)]);
 if(!dependenciesReady())throw Error('AR compiler dependencies are incomplete; inspect npm output and retry.');
}else console.log('Pinned AR compiler dependencies already ready.');

for(const source of [
 {name:'mind-ar',version:'1.2.5',folder:'mind-ar',required:'src/image-target/offline-compiler.js'},
 {name:'three',version:'0.160.0',folder:'three',required:'build/three.module.js'}
]){
 const unpack=path.join(toolRoot,source.folder),packageDir=path.join(unpack,'package');
 if(readJson(path.join(packageDir,'package.json'))?.version===source.version&&fs.existsSync(path.join(packageDir,source.required))){console.log(`${source.name}@${source.version} sources already ready.`);continue;}
 const archive=`${source.name}-${source.version}.tgz`;
 if(!fs.existsSync(path.join(toolRoot,archive)))npm(['pack',`${source.name}@${source.version}`,'--pack-destination','.','--cache','npm-cache','--fetch-retries=0','--fetch-timeout=30000','--silent']);
 fs.mkdirSync(unpack,{recursive:true});
 run('tar',['-xzf',archive,'-C',source.folder]);
 if(readJson(path.join(packageDir,'package.json'))?.version!==source.version||!fs.existsSync(path.join(packageDir,source.required)))throw Error(`Unpacked ${archive} does not contain the expected source.`);
}
// npm's MindAR tarball omits LICENSE. Reuse the checked-in upstream MIT notice.
const license=path.join(root,'dist/vendor/mindar/LICENSE');
if(fs.existsSync(license))fs.copyFileSync(license,path.join(toolRoot,'mind-ar/package/LICENSE'));
console.log('AR tools ready. Next: node scripts/vendor-ar.mjs; node scripts/compile-passport-target.mjs');
