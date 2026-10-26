import test from 'node:test';
import assert from 'node:assert/strict';
import { StrKey } from '@stellar/stellar-sdk';
import { runSozuClaim, parseSozuClaimOutput } from '../server/wallet/runtime.mjs';
import { claimResultState } from '../server/wallet/claim-store.mjs';
import { SOZU_ORIGIN } from '../server/wallet/config.mjs';
const address=StrKey.encodeContract(Buffer.alloc(32,11)),other=StrKey.encodeContract(Buffer.alloc(32,12));
const hash='a'.repeat(64);

test('official CLI invocation always has an explicit C address, fixed origin, bounded lifetime and no shell',async()=>{
 let calls=0;
 const result=await runSozuClaim(address,{execute:async(executable,args,options)=>{
  calls++;assert.equal(executable,process.execPath);assert.match(args[0],/node_modules[\\/]@sozu[\\/]faucet[\\/]bin[\\/]sozu-faucet\.js$/);assert.deepEqual(args.slice(1),['claim',address]);
  assert.equal(options.shell,false);assert.equal(options.timeout,110000);assert.equal(options.killSignal,'SIGKILL');assert.equal(options.windowsHide,true);assert.equal(options.env.SOZU_FAUCET_URL,SOZU_ORIGIN);
  assert.deepEqual(Object.keys(options.env).sort(),['PATH','SOZU_FAUCET_URL','SystemRoot']);
  return{stdout:JSON.stringify({success:true,to:address,txHash:hash})};
 }});
 assert.equal(calls,1);assert.deepEqual(result,{success:true,hash,reason:undefined,nextAvailableAt:undefined});assert.equal(claimResultState(result),'pending','CLI output alone is never confirmed');
});

for(const payload of [{success:true,to:other,txHash:hash},{success:true,to:address,wallet:{secret:'never-accepted'}},{success:true,to:address,wallet:null},{success:true,to:address,txHash:'invalid'},null,[]])test('unexpected CLI recipient, wallet generation or malformed output remains unknown',()=>{
 assert.deepEqual(parseSozuClaimOutput(JSON.stringify(payload),address),{unknown:true});
});

test('timeouts and abnormal exits never trigger another child process or reinterpret uncertainty as rejection',async()=>{
 for(const error of [Object.assign(Error('timeout'),{killed:true,stdout:JSON.stringify({success:true,to:address,txHash:hash})}),Object.assign(Error('signal'),{signal:'SIGKILL'}),Error('no JSON output')]){
  let calls=0;assert.deepEqual(await runSozuClaim(address,{execute:async()=>{calls++;throw error;}}),{unknown:true});assert.equal(calls,1);
 }
});

test('an ordinary nonzero CLI exit preserves an explicit safe provider rejection without stderr',async()=>{
 const result=await runSozuClaim(address,{execute:async()=>{throw Object.assign(Error('exit'),{stdout:JSON.stringify({success:false,to:address,reason:'ip_limit'}),stderr:'not returned'});}});
 assert.equal(result.reason,'ip_limit');assert.equal(claimResultState(result),'failed');assert.doesNotMatch(JSON.stringify(result),/stderr|not returned/);
});

test('invalid addresses are refused before spawning any CLI process',async()=>{
 let calls=0;await assert.rejects(runSozuClaim('Cbad',{execute:async()=>{calls++;}}),error=>error.reason==='invalid_address');assert.equal(calls,0);
});
