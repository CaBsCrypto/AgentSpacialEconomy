import { rpc } from '@stellar/stellar-sdk';
import { createAuthService } from '../identity/auth.mjs';
import { createWalletAuthority } from '../identity/wallet-authority.mjs';
import { createDatabase } from './db.mjs';
import { readConfig } from './config.mjs';
import { createResourceBudget } from './resources.mjs';
import { createPrivateStorage } from './storage.mjs';
import { createProjectService } from './project.mjs';
import { createChainAdapter } from './chain.mjs';
import { createTransactionService } from './transactions.mjs';
import { createOfferService } from './offers.mjs';
import { createConversationService,createGatewayModel } from './conversation.mjs';
import { createIntakeService } from './intake.mjs';
/** Production constructor: no fake adapters, fallback DB, model or receipt path. */
export function createRuntime(env=process.env) {
  const config=readConfig(env),db=createDatabase({connectionString:config.databaseUrl});
  const resources=createResourceBudget({db,config});
  const intake=createIntakeService({db,config});
  const rpcClient=new rpc.Server(config.rpcUrl);
  const limitedRpc=resource=>new Proxy(rpcClient,{get(target,name){const value=Reflect.get(target,name);return typeof value==='function'?async(...args)=>{await resources.reserve([{resource}]);return value.apply(target,args);}:value;}});
  const server=limitedRpc('rpcCalls');
  const authority=createWalletAuthority({config,rpc:server});
  const recoveryAuthority=createWalletAuthority({config,rpc:limitedRpc('rpcAuthCalls')});
  const auth=createAuthService({db,config,authority,recoveryAuthority,beforeAuthority:context=>resources.auth(context)});
  const storage=createPrivateStorage({token:config.blobToken});
  const projects=createProjectService({db,config,storage,resources,intake});
  const chain=createChainAdapter({config,server,authority});
  const recoveryChain=createChainAdapter({config,server:limitedRpc('rpcRecoveryCalls'),authority});
  const guardedChain={...chain,reconcile:recoveryChain.reconcile,submit:async body=>{await resources.reserve([{resource:'channelsSubmissions'}]);return chain.submit(body);}};
  const transactions=createTransactionService({db,config,chain:guardedChain,projects,intake});
  const offers=createOfferService({db,config,chain,projects});
  const model=createGatewayModel({config,env,resources});
  const conversation=createConversationService({db,config,projects,model,intake});
  return {config,db,resources,intake,storage,auth,projects,transactions,offers,conversation};
}
