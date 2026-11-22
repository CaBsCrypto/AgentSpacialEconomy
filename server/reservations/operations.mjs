import { readFile,writeFile,stat,realpath,access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve,dirname,basename,relative,isAbsolute,sep } from 'node:path';
import { pathToFileURL,fileURLToPath } from 'node:url';
import { createRuntime } from './runtime.mjs';
import { createMaintenanceService } from './maintenance.mjs';
import { createBackupService } from './backup.mjs';
import { ServiceError } from '../identity/common.mjs';
export async function runOperation(args,env=process.env) {
  const [command,...flags]=args;
  const allowed=new Set(['--apply','--resume','--file','--operation']);
  for(let i=0;i<flags.length;i++){if(!allowed.has(flags[i]))throw new Error('Unsupported operation argument.');if(['--file','--operation'].includes(flags[i])){if(!flags[i+1]||flags[i+1].startsWith('--'))throw new Error('Missing argument value.');i++;}}
  const value=name=>{const index=flags.indexOf(name);return index<0?null:flags[index+1];};
  const dryRun=!flags.includes('--apply'),runtime=createRuntime(env),maintenance=createMaintenanceService(runtime),backup=createBackupService(runtime);
  try{
    if(command==='cleanup')return await maintenance.cleanup({dryRun,resume:flags.includes('--resume')});
    if(!['backup','restore','verify-media'].includes(command))throw new Error('Use cleanup, backup, restore or verify-media.');
    const file=value('--file');if(!file)throw new Error('Choose an explicit private backup file with --file.');
    const requested=resolve(file),directory=await realpath(dirname(requested)),path=resolve(directory,basename(requested)),checkout=await realpath(fileURLToPath(new URL('../../',import.meta.url))),rel=relative(checkout,path);
    if(rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel)||/(?:^|[\\/])(?:dist|public|\.git)(?:[\\/]|$)/i.test(path))throw new Error('Backup artifacts must remain outside the checkout and public directories.');
    if(command==='backup'){
      if(dryRun)return{dryRun:true,operation:'backup',message:'Use --apply to read the configured private data and write a new backup file; no existing file is overwritten.'};
      await access(directory,constants.W_OK);
      try{await stat(path);throw new Error('A backup file already exists at this location.');}catch(error){if(error.code!=='ENOENT')throw error;}
      const bundle=await backup.exportBackup();await writeFile(path,JSON.stringify(bundle),{flag:'wx',mode:0o600});return{operation:'backup',checksum:bundle.checksum,mediaCount:bundle.payload.blobs.length,requiresFreshCoverage:true};
    }
    if((await stat(path)).size>64*1024*1024)throw new Error('The backup exceeds 64 MiB.');
    const bundle=JSON.parse(await readFile(path,'utf8'));
    if(command==='restore')return await backup.restore(bundle,{dryRun});
    const operationId=value('--operation');if(!operationId)throw new Error('Choose the persisted restore operation with --operation.');
    return await backup.verifyRestoredMedia(bundle,operationId,{dryRun});
  }finally{await runtime.db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{console.log(JSON.stringify(await runOperation(process.argv.slice(2)),null,2));}
  catch(error){console.error(error instanceof ServiceError?JSON.stringify({code:error.code,message:error.message}):'The operation failed. No successful backup, deletion or restoration is claimed.');process.exitCode=1;}
}
