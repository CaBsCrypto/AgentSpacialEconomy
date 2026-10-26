// On-chain budget ceiling: SEP-41 allowance on the USDC Stellar Asset Contract (SAC).
//   approve(from = operator treasury, spender = venue agent, amount, live_until_ledger)
//   transfer_from(spender, from, to, amount)   — authorized by the spender
//   allowance(from, spender)                   — read-only, via simulation
// The network refuses any draw above the approved amount or after it expires, whatever our code does.
// Signatures: https://developers.stellar.org/docs/tokens/token-interface
import { Address, BASE_FEE, Contract, TransactionBuilder, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { Api, Server } from "@stellar/stellar-sdk/rpc";
import { toUnits } from "./lib/money.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const addr = (a) => new Address(a).toScVal();
const i128 = (units) => nativeToScVal(BigInt(units), { type: "i128" });
const u32 = (n) => nativeToScVal(Number(n), { type: "u32" });

export function createSac(net, { server = new Server(net.rpcUrl) } = {}) {
  const sac = new Contract(net.usdc.sac);

  async function build(sourcePub, method, args) {
    const account = await server.getAccount(sourcePub);
    return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: net.passphrase })
      .addOperation(sac.call(method, ...args))
      .setTimeout(60)
      .build();
  }

  async function simulate(sourcePub, method, args) {
    return server.simulateTransaction(await build(sourcePub, method, args));
  }

  async function invoke(kp, method, args) {
    const prepared = await server.prepareTransaction(await build(kp.publicKey(), method, args));
    prepared.sign(kp);
    const sent = await server.sendTransaction(prepared);
    if (sent.status !== "PENDING") {
      throw new Error(`${method}: submission ${sent.status}`);
    }
    for (let i = 0; i < 40; i++) {
      const r = await server.getTransaction(sent.hash);
      if (r.status === Api.GetTransactionStatus.SUCCESS) return { hash: sent.hash, ledger: r.ledger };
      if (r.status === Api.GetTransactionStatus.FAILED) throw new Error(`${method} failed on-chain (tx ${sent.hash})`);
      await sleep(1000);
    }
    throw new Error(`${method}: no result after 40 s (tx ${sent.hash})`);
  }

  return {
    async latestLedger() {
      return (await server.getLatestLedger()).sequence;
    },
    approve(fromKp, spender, amountUsdc, liveUntil) {
      return invoke(fromKp, "approve", [addr(fromKp.publicKey()), addr(spender), i128(toUnits(amountUsdc)), u32(liveUntil)]);
    },
    async allowanceUnits(from, spender, readerPub) {
      const sim = await simulate(readerPub, "allowance", [addr(from), addr(spender)]);
      if (Api.isSimulationError(sim)) throw new Error(`allowance read failed: ${sim.error}`);
      return BigInt(scValToNative(sim.result.retval));
    },
    drawFrom(spenderKp, from, to, units) {
      return invoke(spenderKp, "transfer_from", [addr(spenderKp.publicKey()), addr(from), addr(to), i128(units)]);
    },
    /** Simulate a draw without submitting it: shows whether the network would accept it. */
    async probeDraw(spenderPub, from, to, units) {
      const sim = await simulate(spenderPub, "transfer_from", [addr(spenderPub), addr(from), addr(to), i128(units)]);
      return Api.isSimulationError(sim)
        ? { refused: true, reason: String(sim.error).split("\n")[0].slice(0, 200) }
        : { refused: false, reason: null };
    },
  };
}
