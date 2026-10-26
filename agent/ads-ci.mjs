// One-shot testnet run of paid screen time, for CI (GitHub Actions) or any machine with internet access.
//   1. ephemeral venue treasury and advertiser accounts, friendbot XLM, USDC trustlines
//   2. the advertiser buys a little testnet USDC with XLM on the testnet DEX
//   3. services.mjs runs; advertiser.mjs pays the ad slot (5 testnet USDC, 5 min of the main-stage
//      screen) over x402 to the TREASURY, after checking the 402 (price, testnet, payTo = treasury)
//   4. the treasury balance is read back from Horizon
//   5. the treasury deploys an AdsRegistry instance from the WASM already on testnet, commits the
//      order with the real settlement hash as `payment`, and reads it back with `get`
// Writes dist/state/ads.json. Secret keys only live in memory; nothing here prints them.
import { spawn, spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Asset, BASE_FEE, Horizon, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { networkConfig, explorerTx } from "./config/networks.mjs";
import { AD_SLOT } from "./catalog.mjs";
import { adTerms, adCommitment, readBack } from "./lib/ads.mjs";
import { createRegistry, REGISTRY_WASM_HASH } from "./registry.mjs";

const net = networkConfig("stellar:testnet");
const USDC = new Asset(net.usdc.code, net.usdc.issuer);
const NEED = Number(AD_SLOT.priceUsdc) + 0.2;
const horizon = new Horizon.Server(net.horizonUrl);
const agentDir = fileURLToPath(new URL("./", import.meta.url));
const adsFile = fileURLToPath(new URL("../dist/state/ads.json", import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const explorerContract = (id) => `${net.explorer}/contract/${id}`;

async function friendbot(pub) {
  const r = await fetch(`${net.friendbotUrl}?addr=${encodeURIComponent(pub)}`);
  if (!r.ok && r.status !== 400) throw new Error(`friendbot HTTP ${r.status}`);
}
async function submit(kp, ops) {
  const account = await horizon.loadAccount(kp.publicKey());
  const b = new TransactionBuilder(account, { fee: String(Number(BASE_FEE) * 10), networkPassphrase: net.passphrase });
  ops.forEach((op) => b.addOperation(op));
  const tx = b.setTimeout(60).build();
  tx.sign(kp);
  return horizon.submitTransaction(tx);
}
async function usdc(pub) {
  const a = await horizon.loadAccount(pub);
  const line = a.balances.find((b) => b.asset_code === "USDC" && b.asset_issuer === USDC.issuer);
  return line ? line.balance : null;
}
async function buyUsdc(kp, min) {
  for (const sendAmount of ["50", "200", "1000", "5000"]) {
    const { records } = await horizon.strictSendPaths(Asset.native(), sendAmount, [USDC]).call();
    const best = records.sort((a, b) => Number(b.destination_amount) - Number(a.destination_amount))[0];
    if (!best || Number(best.destination_amount) < min) continue;
    const path = best.path.map((p) => (p.asset_type === "native" ? Asset.native() : new Asset(p.asset_code, p.asset_issuer)));
    const res = await submit(kp, [Operation.pathPaymentStrictSend({
      sendAsset: Asset.native(), sendAmount, destination: kp.publicKey(), destAsset: USDC, destMin: (Number(best.destination_amount) * 0.95).toFixed(7), path,
    })]);
    console.log(`Advertiser bought ~${Number(best.destination_amount).toFixed(4)} testnet USDC for ${sendAmount} XLM on the testnet DEX (tx ${res.hash})`);
    return true;
  }
  return false;
}

// ---- accounts ----
const treasury = Keypair.random();
const advertiser = Keypair.random();
const service = Keypair.random(); // payee of the other routes; never paid in this run
console.log(`Ephemeral venue treasury: ${treasury.publicKey()}`);
console.log(`Ephemeral advertiser wallet: ${advertiser.publicKey()}`);
await Promise.all([treasury, advertiser].map((kp) => friendbot(kp.publicKey())));
await sleep(3000);
for (const kp of [treasury, advertiser]) await submit(kp, [Operation.changeTrust({ asset: USDC })]);
if (!(await buyUsdc(advertiser, NEED))) {
  console.error(`The testnet DEX has no XLM→USDC route for ${NEED} USDC. Nothing was paid.`);
  process.exit(2);
}
const treasuryBefore = await usdc(treasury.publicKey());
console.log(`Advertiser USDC: ${await usdc(advertiser.publicKey())} · treasury USDC before: ${treasuryBefore}`);

// ---- services + payment ----
const runId = new Date().toISOString();
const childEnv = {
  ...process.env,
  STELLAR_NETWORK: "stellar:testnet",
  FACILITATOR_URL: process.env.FACILITATOR_URL || net.facilitatorUrl,
  SERVICE_RECIPIENT: service.publicKey(),
  TREASURY_PUBLIC_KEY: treasury.publicKey(),
  SERVICES_URL: "http://localhost:3001",
  SERVICES_PORT: "3001",
};
const services = spawn(process.execPath, ["services.mjs"], { cwd: agentDir, stdio: ["ignore", "pipe", "pipe"], env: childEnv });
services.stdout.on("data", (d) => process.stdout.write(`[services] ${d}`));
services.stderr.on("data", (d) => process.stdout.write(`[services] ${d}`));
let up = false;
for (let i = 0; i < 40 && !up; i++) {
  await sleep(500);
  try { up = (await fetch("http://localhost:3001/health")).ok; } catch {}
}
if (!up) { console.error("Services did not start."); services.kill(); process.exit(1); }

const paid = spawnSync(process.execPath, ["advertiser.mjs", "--run-id", runId], {
  cwd: agentDir, stdio: "inherit", env: { ...childEnv, ADVERTISER_SECRET_KEY: advertiser.secret() },
});
services.kill();
const state = JSON.parse(await readFile(adsFile, "utf8"));
const settled = state.rows.find((r) => r.status === "settled");
if (paid.status !== 0 || !settled) {
  console.error("The ad payment did not settle; no registry commit.");
  process.exit(1);
}

// ---- treasury balance read back ----
let treasuryAfter = treasuryBefore;
for (let i = 0; i < 10 && Number(treasuryAfter) === Number(treasuryBefore); i++) {
  await sleep(1500);
  treasuryAfter = await usdc(treasury.publicKey());
}
const received = (Number(treasuryAfter) - Number(treasuryBefore)).toFixed(7);
state.treasury = {
  account: treasury.publicKey(),
  usdcBefore: treasuryBefore, usdcAfter: treasuryAfter, receivedUsdc: received,
  verified: Number(received) === Number(AD_SLOT.priceUsdc),
};
console.log(`Treasury USDC ${treasuryBefore} → ${treasuryAfter} (+${received})${state.treasury.verified ? " ✓" : " ✗"}`);
await writeFile(adsFile, JSON.stringify(state, null, 2));

// ---- AdsRegistry: deploy, commit, read back ----
const registry = createRegistry(net);
const publisher = Keypair.random(); // signs delivery evidence; no delivery is recorded in this run
let exit = 0;
try {
  const deployed = await registry.deploy(treasury, publisher.rawPublicKey());
  console.log(`AdsRegistry instance ${deployed.contractId} deployed from WASM ${REGISTRY_WASM_HASH.slice(0, 12)}… (tx ${deployed.hash})`);
  let wasmVerified = null;
  try { wasmVerified = (await registry.wasmHashOf(deployed.contractId)) === REGISTRY_WASM_HASH; } catch (e) { console.warn(`WASM hash check skipped: ${e.message}`); }
  const terms = adTerms({ slot: AD_SLOT, payTo: treasury.publicKey(), network: net.id });
  const latest = await horizon.ledgers().order("desc").limit(1).call();
  const nowMs = Date.parse(latest.records[0].closed_at);
  const startMs = Math.ceil((nowMs + 5 * 60_000) / 60_000) * 60_000; // scheduled a few minutes ahead
  const commitment = adCommitment({
    runId, creative: { advertiser: state.advertiser.name, headline: state.advertiser.headline }, terms,
    paymentTx: settled.tx, claimant: advertiser.publicKey(), startMs, durationMs: AD_SLOT.durationMs,
  });
  const committed = await registry.commit(treasury, deployed.contractId, commitment);
  console.log(`Order committed with payment = ${settled.tx.slice(0, 12)}… (tx ${committed.hash})`);
  const record = await registry.get(deployed.contractId, commitment.order, treasury.publicKey());
  const check = readBack(record, commitment);
  console.log(`Read back: ${check.state}, delivered ${check.deliveredMs} of ${check.requiredMs} ms, payment hash matches: ${check.verified ? "yes ✓" : "no ✗"}`);
  state.registry = {
    contractId: deployed.contractId, explorerContract: explorerContract(deployed.contractId),
    wasmHash: REGISTRY_WASM_HASH, wasmVerified,
    issuer: treasury.publicKey(),
    deployTx: deployed.hash, deployExplorer: explorerTx(net.id, deployed.hash),
    commitTx: committed.hash, commitExplorer: explorerTx(net.id, committed.hash),
    commitment, terms, readBack: check,
  };
  if (!check.verified) exit = 1;
} catch (e) {
  console.error(`Registry step failed: ${e.message}`);
  state.registry = { error: e.message.slice(0, 300) };
  exit = 1;
}
state.recordedAt = new Date().toISOString();
await writeFile(adsFile, JSON.stringify(state, null, 2));
console.log("Wrote dist/state/ads.json");
process.exit(exit);
