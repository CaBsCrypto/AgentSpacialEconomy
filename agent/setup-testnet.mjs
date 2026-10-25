// One-time testnet setup for the demo (shared setup steps from the `agentic-payments` skill):
//   1. create two keypairs: AGENT (payer) and SERVICE (recipient)
//   2. fund both with testnet XLM via friendbot
//   3. add a USDC trustline to both
//   4. write them into ../.env (refuses to overwrite an existing .env)
// The last step is manual: get testnet USDC for the AGENT account at https://faucet.circle.com (captcha).
// Secret keys are written to .env only; this script never prints them.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

// Circle's classic USDC issuer on Stellar testnet (used for trustlines; the SAC address is different).
const USDC_ISSUER_TESTNET = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const examplePath = fileURLToPath(new URL("../.env.example", import.meta.url));

if (existsSync(envPath)) {
  console.error(".env already exists. Not overwriting it. Delete it first if you really want new accounts.");
  process.exit(1);
}

async function friendbot(pub) {
  const r = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(pub)}`);
  if (!r.ok) throw new Error(`friendbot failed for ${pub.slice(0, 6)}…: HTTP ${r.status}`);
}

async function addUsdcTrustline(kp) {
  const account = await horizon.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: new Asset("USDC", USDC_ISSUER_TESTNET) }))
    .setTimeout(60)
    .build();
  tx.sign(kp);
  return horizon.submitTransaction(tx);
}

const agent = Keypair.random();
const service = Keypair.random();

console.log("Funding with friendbot…");
await Promise.all([friendbot(agent.publicKey()), friendbot(service.publicKey())]);
await new Promise((r) => setTimeout(r, 2500));
console.log("Adding USDC trustlines…");
await addUsdcTrustline(agent);
await addUsdcTrustline(service);

let env = await readFile(examplePath, "utf8");
env = env
  .replace(/^SERVICE_RECIPIENT=.*$/m, `SERVICE_RECIPIENT=${service.publicKey()}`)
  .replace(/^AGENT_SECRET_KEY=.*$/m, `AGENT_SECRET_KEY=${agent.secret()}`);
env += `\n# Public key of the agent wallet (safe to share)\nAGENT_PUBLIC_KEY=${agent.publicKey()}\n`;
await writeFile(envPath, env, { mode: 0o600 });

console.log(`
Done. Wrote .env (git-ignored).

  Agent wallet (payer):     ${agent.publicKey()}
  Service wallet (payee):   ${service.publicKey()}

Last step, by hand: open https://faucet.circle.com, choose Stellar testnet,
and send USDC to the AGENT wallet above.

Check:   https://stellar.expert/explorer/testnet/account/${agent.publicKey()}
`);
