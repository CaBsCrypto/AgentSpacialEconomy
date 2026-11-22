import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ServiceError } from '../identity/common.mjs';
import { readConfig } from './config.mjs';
import { createDatabase } from './db.mjs';
import { createIntakeService } from './intake.mjs';

/** Internal operator CLI. No provider, signed transaction, reset or HTTP endpoint. */
export async function runIntake(args,env=process.env,{database=createDatabase}={}) {
  const [command,...flags]=args;
  if(!['status','pause','resume'].includes(command))throw new Error('Use status, pause or resume.');
  let apply=false,expectedRevision;
  const seen=new Set();
  for(let i=0;i<flags.length;i++){
    const flag=flags[i];if(seen.has(flag))throw new Error('Duplicate intake argument.');seen.add(flag);
    if(flag==='--apply')apply=true;
    else if(flag==='--expected-revision'&&/^[1-9][0-9]*$/.test(flags[i+1]??'')){expectedRevision=Number(flags[++i]);if(!Number.isSafeInteger(expectedRevision))throw new Error('Invalid admission revision.');}
    else throw new Error('Unsupported or invalid intake argument.');
  }
  if(command==='status'&&flags.length||command!=='resume'&&expectedRevision!==undefined)throw new Error('The flags do not match the operation.');
  const config=readConfig(env),db=database({connectionString:config.databaseUrl}),intake=createIntakeService({db,config});
  try{
    if(command==='status')return{projectId:config.projectId,environment:{enabled:config.enabled,intakeEnabled:config.intakeEnabled,mode:config.mode},...await intake.status()};
    return await intake.change(command==='pause',{dryRun:!apply,expectedRevision});
  }finally{await db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{console.log(JSON.stringify(await runIntake(process.argv.slice(2)),null,2));}
  catch(error){console.error(error instanceof ServiceError?JSON.stringify({code:error.code,message:error.message}):'Admission was not changed successfully. Check the explicit project configuration and command arguments.');process.exitCode=1;}
}
