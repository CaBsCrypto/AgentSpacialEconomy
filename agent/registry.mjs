// AdsRegistry on Soroban (testnet): deploy an instance from the WASM already uploaded to testnet by
// feature/ads-3d-ar-x402, commit one paid order, read it back. The contract is noncustodial (it never
// moves funds); `commit` needs only the issuer's authorization. Contract source:
// contracts/ads-registry/src/lib.rs on feature/ads-3d-ar-x402.
import { randomBytes, createHash } from "node:crypto";
import { Address, BASE_FEE, Contract, Operation, TransactionBuilder, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { Api, Server } from "@stellar/stellar-sdk/rpc";
import { registryCommitArgs } from "./lib/ads.mjs";

// WASM hash of the audited build the teammate deployed (docs/ads/testnet-registry/evidence.json).
export const REGISTRY_WASM_HASH = "d9caf94b2dfb159c7d46bf5779d358d6cced9ee7a94bd69e2bb1fa354b5ee526";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createRegistry(net, { server = new Server(net.rpcUrl) } = {}) {
  async function run(kp, op, label) {
    const account = await server.getAccount(kp.publicKey());
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: net.passphrase }).addOperation(op).setTimeout(60).build();
    const prepared = await server.prepareTransaction(tx);
    prepared.sign(kp);
    const sent = await server.sendTransaction(prepared);
    if (sent.status !== "PENDING") throw new Error(`${label}: submission ${sent.status}`);
    for (let i = 0; i < 40; i++) {
      const r = await server.getTransaction(sent.hash);
      if (r.status === Api.GetTransactionStatus.SUCCESS) return { hash: sent.hash, ledger: r.ledger, returnValue: r.returnValue };
      if (r.status === Api.GetTransactionStatus.FAILED) throw new Error(`${label} failed on-chain (tx ${sent.hash})`);
      await sleep(1000);
    }
    throw new Error(`${label}: no result after 40 s (tx ${sent.hash})`);
  }

  return {
    /** New instance of the uploaded WASM; the issuer is the venue treasury. */
    async deploy(issuerKp, publisherKey32, wasmHash = REGISTRY_WASM_HASH) {
      const op = Operation.createCustomContract({
        address: new Address(issuerKp.publicKey()),
        wasmHash: Buffer.from(wasmHash, "hex"),
        salt: randomBytes(32),
        constructorArgs: [new Address(issuerKp.publicKey()).toScVal(), nativeToScVal(Buffer.from(publisherKey32), { type: "bytes" })],
      });
      const r = await run(issuerKp, op, "deploy");
      return { hash: r.hash, ledger: r.ledger, contractId: scValToNative(r.returnValue) };
    },
    /** sha256 of the code the network runs for this contract, to compare with the audited build. */
    async wasmHashOf(contractId) {
      const wasm = await server.getContractWasmByContractId(contractId);
      return createHash("sha256").update(wasm).digest("hex");
    },
    async commit(issuerKp, contractId, commitment) {
      const sdk = await import("@stellar/stellar-sdk");
      const op = new Contract(contractId).call("commit", ...registryCommitArgs(commitment, sdk));
      const r = await run(issuerKp, op, "commit");
      return { hash: r.hash, ledger: r.ledger };
    },
    /** Read-only `get(order)` through simulation: nothing is submitted. */
    async get(contractId, orderHex, readerPub) {
      const account = await server.getAccount(readerPub);
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: net.passphrase })
        .addOperation(new Contract(contractId).call("get", nativeToScVal(Buffer.from(orderHex, "hex"), { type: "bytes" })))
        .setTimeout(60)
        .build();
      const sim = await server.simulateTransaction(tx);
      if (Api.isSimulationError(sim)) throw new Error(`get failed: ${String(sim.error).split("\n")[0]}`);
      return scValToNative(sim.result.retval);
    },
  };
}
