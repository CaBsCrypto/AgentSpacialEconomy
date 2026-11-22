import { fail, hexId } from '../identity/common.mjs';
import { requireCapability } from './config.mjs';
import { lock } from './db.mjs';

/** A DB admission boundary, never a process cache or an instruction to erase work. */
export function createIntakeService({db,config,now=Date.now}) {
  const key=()=>{hexId(config.projectId);return'intake:'+config.projectId;};
  async function row(tx=db,locking=false) {
    try {
      if(locking)await lock(tx,key());
      const value=(await tx.query('SELECT * FROM reservation_intake WHERE project_id=$1'+(locking?' FOR UPDATE':''),[config.projectId])).rows[0];
      if(value&&(!Number.isSafeInteger(Number(value.revision))||Number(value.revision)<1||typeof value.paused!=='boolean'||!Number.isFinite(new Date(value.updated_at).getTime())))throw Error('Invalid admission record');
      return value;
    } catch {fail(503,'INTAKE_UNAVAILABLE','Shared admission cannot be verified. New work remains paused.');}
  }
  const view=value=>({state:value?(value.paused?'PAUSED':'OPEN'):'MISSING',paused:value?.paused!==false,revision:value?Number(value.revision):null,updatedAt:value?new Date(value.updated_at).toISOString():null});
  async function status(){return view(await row());}
  async function requireOpen(tx,capability='project') {
    requireCapability(config,capability,now());
    if((await row(tx??db,Boolean(tx)))?.paused!==false)fail(503,'INTAKE_PAUSED','New reservation work is paused. Existing receipts and recovery remain available.');
  }
  async function requirePaused(tx) {
    if((await row(tx??db,Boolean(tx)))?.paused===false)fail(409,'BACKUP_REQUIRES_PAUSE','Pause shared admission and drain all admitted work before backup or restoration.');
  }
  async function change(paused,{dryRun=true,expectedRevision}={}) {
    key();
    if(typeof paused!=='boolean')fail(422,'INTAKE_ACTION','Choose pause or resume.');
    const validate=current=>{
      if(!paused){
        requireCapability(config,'project',now());
        if(!current||!Number.isSafeInteger(expectedRevision)||expectedRevision!==Number(current.revision))fail(409,'INTAKE_REVISION_CONFLICT','Read the current admission revision before explicitly resuming.');
      }
      const revision=Number(current?.revision??0)+1;
      if(!Number.isSafeInteger(revision))fail(409,'INTAKE_REVISION_CONFLICT','The admission revision cannot advance safely.');
      return revision;
    };
    if(dryRun){const current=await row();return{dryRun:true,projectId:config.projectId,current:view(current),planned:{state:paused?'PAUSED':'OPEN',paused,revision:validate(current)}};}
    return db.transaction(async tx=>{
      const current=await row(tx,true),revision=validate(current);
      await tx.query('INSERT INTO reservation_intake(project_id,paused,revision,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(project_id) DO UPDATE SET paused=EXCLUDED.paused,revision=EXCLUDED.revision,updated_at=EXCLUDED.updated_at',[config.projectId,paused,revision,new Date(now())]);
      return{dryRun:false,projectId:config.projectId,...view(await row(tx))};
    });
  }
  return{status,requireOpen,requirePaused,change};
}
