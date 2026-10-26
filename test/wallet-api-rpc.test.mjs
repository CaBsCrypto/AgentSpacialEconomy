import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,hash} from '@stellar/stellar-sdk';
import {buildDeployTransaction,prepareDeploymentArtifacts} from '../node_modules/smart-account-kit/dist/kit/deploy-ops.js';
import {readConfig,SHARED_DEPLOYER,WEBAUTHN_VERIFIER} from '../server/wallet/config.mjs';
import {validateDeployment} from '../server/wallet/deployment.mjs';
import {createRuntime} from '../server/wallet/runtime.mjs';

// Opt-in reads only. This NEVER submits the prepared deployment or requests USDC.
// Run: WALLET_RPC_SMOKE=1 node --test test/wallet-api-rpc.test.mjs
// It checks the installed SDK's actual binding constructor, auth encoding and fees.
// The fixed fixture public key is the standard P-256 generator, not a visitor credential.
test('installed Smart Account Kit payload passes our proxy and live read-only Stellar simulation', {skip:process.env.WALLET_RPC_SMOKE!=='1'}, async()=>{
 const config=readConfig(process.env);
 const deployer=Keypair.fromRawEd25519Seed(hash(Buffer.from('openzeppelin-smart-account-kit')));
 assert.equal(deployer.publicKey(),SHARED_DEPLOYER);
 const publicKey=Buffer.from('046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5','hex');
 const deployment=await buildDeployTransaction({rpcUrl:config.rpcUrl,networkPassphrase:config.networkPassphrase,accountWasmHash:config.accountWasmHash,webauthnVerifierAddress:config.webauthnVerifierAddress,deployerKeypair:deployer,usingSharedDeployer:true,timeoutInSeconds:30},Buffer.from('one16-readonly-fixture-oct25'),publicKey);
 const {relayerPayload}=await prepareDeploymentArtifacts(deployment,async()=>{throw Error('No envelope signing expected');});
 const parsed=validateDeployment(relayerPayload,config),runtime=createRuntime(config);
 await runtime.simulateDeployment(parsed);
 assert.equal(await runtime.balance(WEBAUTHN_VERIFIER),0n);
});
