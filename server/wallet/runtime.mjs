import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Account, Address, Contract, Operation, StrKey, TransactionBuilder, scValToNative } from '@stellar/stellar-sdk';
import { Server, Api } from '@stellar/stellar-sdk/rpc';
import { Redis } from '@upstash/redis';
// This harmless library import also anchors the CLI's nested SDK dependency for file tracing.
import { CIRCLE_USDC_ISSUER } from '@sozu/faucet/lib/wallet.js';
import { CHANNELS_URL, SHARED_DEPLOYER, SOZU_ORIGIN, USDC_ISSUER } from './config.mjs';
import { WalletApiError } from './http.mjs';

const exec = promisify(execFile), require = createRequire(import.meta.url);
export function assertAddress(value) {
  if (typeof value !== 'string' || !StrKey.isValidContract(value)) throw new WalletApiError(400, 'invalid_address', 'Se requiere la dirección C… de tu smart wallet.');
  return value;
}

export function parseSozuClaimOutput(stdout, address) {
  try {
    const result = JSON.parse(stdout);
    if (!result || typeof result.success !== 'boolean' || result.to !== address || Object.hasOwn(result, 'wallet')) return { unknown: true };
    const hash = result.txHash || result.hash || result.transactionHash;
    if (hash !== undefined && (typeof hash !== 'string' || !/^[0-9a-f]{64}$/i.test(hash))) return { unknown: true };
    return { success: result.success, hash, reason: result.reason, nextAvailableAt: result.nextAvailableAt };
  } catch { return { unknown: true }; }
}

/** Invoke the installed official CLI once, never a shell or a wallet-generating mode. */
export async function runSozuClaim(address, { execute = exec } = {}) {
  assertAddress(address);
  if (CIRCLE_USDC_ISSUER !== USDC_ISSUER) throw Error('Unexpected CLI asset');
  const file = require.resolve('@sozu/faucet/bin/sozu-faucet.js');
  let stdout;
  try { ({ stdout } = await execute(process.execPath, [file, 'claim', address], { timeout: 110_000, killSignal: 'SIGKILL', maxBuffer: 262_144, windowsHide: true, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, SOZU_FAUCET_URL: SOZU_ORIGIN }, shell: false })); }
  catch (error) {
    // Timeout/termination can follow submission. No output or diagnostic stderr
    // proves that a transfer did not happen, so uncertainty stays durable.
    if (error.killed || error.signal || !error.stdout) return { unknown: true };
    stdout = error.stdout;
  }
  return parseSozuClaimOutput(stdout, address);
}

export function createRuntime(config, env = process.env) {
  let redis, rpc;
  const getRedis = () => redis ||= new Redis({ url: env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL, token: env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN });
  const getRpc = () => rpc ||= new Server(config.rpcUrl, { timeout: 12_000 });
  const transaction = operation => new TransactionBuilder(new Account(SHARED_DEPLOYER, '0'), { fee: '100', networkPassphrase: config.networkPassphrase }).addOperation(operation).setTimeout(30).build();
  return {
    redis: { get: (...args) => getRedis().get(...args), set: (...args) => getRedis().set(...args), eval: (...args) => getRedis().eval(...args) },
    async walletAllowed(address) {
      const result = await getRpc().getLedgerEntries(new Contract(address).getFootprint());
      const value = result.entries[0]?.val.contractData().val();
      if (!value || value.switch().name !== 'scvContractInstance') return false;
      const executable = value.instance().executable();
      return executable.switch().name === 'contractExecutableWasm' && executable.wasmHash().toString('hex') === config.accountWasmHash;
    },
    async balance(address) {
      const result = await getRpc().simulateTransaction(transaction(new Contract(config.tokenContract).call('balance', new Address(address).toScVal())));
      if (!Api.isSimulationSuccess(result) || !result.result?.retval) throw new WalletApiError(503, 'balance_unavailable', 'No se pudo confirmar el saldo de USDC en Testnet.');
      return BigInt(scValToNative(result.result.retval));
    },
    async simulateDeployment(parsed) {
      const result = await getRpc().simulateTransaction(transaction(Operation.invokeHostFunction(parsed)));
      if (!Api.isSimulationSuccess(result) || Api.isSimulationRestore(result)) throw new WalletApiError(400, 'deployment_simulation_failed', 'Stellar rechazó la simulación del despliegue.');
      if (BigInt(result.minResourceFee) > config.maxResourceFee) throw new WalletApiError(413, 'fee_limit', 'El despliegue excede el límite de comisiones del piloto.');
    },
    async relay(body) {
      // Contract verified against @openzeppelin/relayer-plugin-channels 0.21.0's HTTP client.
      const response = await fetch(CHANNELS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.CHANNELS_API_KEY}` }, body: JSON.stringify({ params: body }), signal: AbortSignal.timeout(90_000) });
      const data = await response.json();
      if (!response.ok || data.success !== true || typeof data.data?.hash !== 'string') throw new WalletApiError(502, 'relay_failed', 'No se pudo confirmar el envío del despliegue. Comprueba la wallet antes de volver a crearla.');
      return { success: true, data: { hash: data.data.hash, status: data.data.status, transactionId: data.data.transactionId } };
    },
    async availability() {
      const response = await fetch(`${SOZU_ORIGIN}/api/v1/faucet/status`, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new WalletApiError(503, 'faucet_unavailable', 'El faucet no está disponible ahora.');
      const data = await response.json();
      return { available: data.availability?.available === true && data.faucet?.network === 'testnet', claimAmount: data.faucet?.claimAmount || 100, cooldownMinutes: data.faucet?.cooldownMinutes || 60, ...(typeof data.availability?.reason === 'string' ? { reason: data.availability.reason.slice(0,80) } : {}) };
    },
    claim: address => runSozuClaim(address),
  };
}

