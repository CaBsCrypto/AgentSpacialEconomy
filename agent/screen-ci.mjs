// One-shot testnet run of the four-section main-stage screen, for CI (GitHub Actions) or any machine
// with internet access. Each order: 5 testnet USDC over x402, paid to the venue treasury, buys five
// minutes of one quarter of the screen; orders in the same quarter rotate.
//   1. ephemeral venue treasury, a funder and six advertisers; friendbot XLM; USDC trustlines
//   2. the funder buys testnet USDC on the DEX once and gives each advertiser 5.1 USDC
//   3. services.mjs runs; each advertiser pays its section with advertiser.mjs (402 checked first)
//   4. the treasury balance is read back; orders are scheduled per section (lib/screen.mjs)
//   5. the treasury deploys an AdsRegistry instance and commits every order with its payment hash
// Writes dist/state/screen.json. Secret keys only live in memory; nothing here prints them.
import { spawn, spawnSync } from "node:child_process";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Asset, BASE_FEE, Horizon, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { networkConfig, explorerTx } from "./config/networks.mjs";
import { AD_SLOT } from "./catalog.mjs";
import { adTerms, adCommitment, readBack } from "./lib/ads.mjs";
import { scheduleOrder, SLOT_MS } from "./lib/screen.mjs";
import { createRegistry, REGISTRY_WASM_HASH } from "./registry.mjs";

const net = networkConfig("stellar:testnet");
const USDC = new Asset(net.usdc.code, net.usdc.issuer);
const horizon = new Horizon.Server(net.horizonUrl);
const agentDir = fileURLToPath(new URL("./", import.meta.url));
const outFile = fileURLToPath(new URL("../dist/state/screen.json", import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Who buys what. Six orders for four sections: A and C get a second order, so the screen rotates.
const PLAN = [
  { section: "A", name: "Demo Advertiser 1 (testnet)", headline: "Live demo at table 4" },
  { section: "B", name: "Demo Advertiser 2 (testnet)", headline: "Workshop at 15:00, room 2" },
  { section: "C", name: "Demo Advertiser 3 (testnet)", headline: "Ask us about the testnet faucet" },
  { section: "D", name: "Demo Advertiser 4 (testnet)", headline: "Hiring Soroban developers" },
  { section: "A", name: "Demo Advertiser 5 (testnet)", headline: "Free coffee at the merch stand" },
  { section: "C", name: "Demo Advertiser 6 (testnet)", headline: "Vote for our project" },
];
const EACH = Number(AD_SLOT.priceUsdc) + 0.1;

async function friendbot(pub) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${net.friendbotUrl}?addr=${encodeURIComponent(pub)}`);
    if (r.ok || r.status === 400) return;
    await sleep(2000);
  }
  throw new Error(`friendbot failed for ${pub.slice(0, 6)}…`);
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
    console.log(`Funder bought ~${Number(best.destination_amount).toFixed(4)} testnet USDC for ${sendAmount} XLM on the testnet DEX (tx ${res.hash})`);
    return true;
  }
  return false;
}

// ---- accounts ----
const treasury = Keypair.random();
const funder = Keypair.random();
const service = Keypair.random(); // payee of the other routes; never paid here
const buyers = PLAN.map(() => Keypair.random());
console.log(`Ephemeral venue treasury: ${treasury.publicKey()}`);
for (const kp of [treasury, funder, ...buyers]) { await friendbot(kp.publicKey()); await sleep(300); }
await sleep(3000);
for (const kp of [treasury, ...buyers]) await submit(kp, [Operation.changeTrust({ asset: USDC })]);
await submit(funder, [Operation.changeTrust({ asset: USDC })]);
if (!(await buyUsdc(funder, EACH * buyers.length + 0.5))) {
  console.error("The testnet DEX has no XLM→USDC route for this run. Nothing was paid.");
  process.exit(2);
}
await submit(funder, buyers.map((kp) => Operation.payment({ destination: kp.publicKey(), asset: USDC, amount: EACH.toFixed(7) })));
const treasuryBefore = await usdc(treasury.publicKey());
console.log(`Each advertiser holds ${EACH} testnet USDC · treasury before: ${treasuryBefore}`);

// ---- services + payments ----
const runId = new Date().toISOString();
const childEnv = {
  ...process.env, STELLAR_NETWORK: "stellar:testnet", FACILITATOR_URL: process.env.FACILITATOR_URL || net.facilitatorUrl,
  SERVICE_RECIPIENT: service.publicKey(), TREASURY_PUBLIC_KEY: treasury.publicKey(),
  SERVICES_URL: "http://localhost:3001", SERVICES_PORT: "3001",
};
const services = spawn(process.execPath, ["services.mjs"], { cwd: agentDir, stdio: ["ignore", "pipe", "pipe"], env: childEnv });
services.stdout.on("data", (d) => process.stdout.write(`[services] ${d}`));
services.stderr.on("data", (d) => process.stdout.write(`[services] ${d}`));
let up = false;
for (let i = 0; i < 40 && !up; i++) { await sleep(500); try { up = (await fetch("http://localhost:3001/health")).ok; } catch {} }
if (!up) { console.error("Services did not start."); services.kill(); process.exit(1); }

const tmp = await mkdtemp(join(tmpdir(), "screen-"));
let schedule = [];
for (const [i, p] of PLAN.entries()) {
  const out = join(tmp, `order-${i + 1}.json`);
  const orderRun = `${runId}#${i + 1}`;
  const r = spawnSync(process.execPath, ["advertiser.mjs", "--run-id", orderRun, "--section", p.section, "--name", p.name, "--headline", p.headline, "--out", out], {
    cwd: agentDir, stdio: "inherit", env: { ...childEnv, ADVERTISER_SECRET_KEY: buyers[i].secret() },
  });
  const paidAt = Date.now();
  let st = null;
  try { st = JSON.parse(await readFile(out, "utf8")); } catch {}
  const row = st?.rows?.find((x) => x.status === "settled");
  if (r.status !== 0 || !row) { console.error(`Order ${i + 1} did not settle; it is left out of the screen.`); continue; }
  schedule = scheduleOrder(schedule, {
    id: orderRun, quadrant: st.advertiser.section ?? p.section, paidAt,
    advertiser: st.advertiser.name, headline: st.advertiser.headline, account: st.advertiser.account,
    priceUsdc: row.priceUsdc, tx: row.tx, explorer: row.explorer,
  });
  const o = schedule.at(-1);
  console.log(`Section ${o.quadrant}: ${o.advertiser} plays ${new Date(o.start).toISOString().slice(11, 19)}–${new Date(o.end).toISOString().slice(11, 19)} UTC`);
}
services.kill();
if (!schedule.length) { console.error("No order settled."); process.exit(1); }

// ---- treasury balance read back ----
const expected = schedule.length * Number(AD_SLOT.priceUsdc);
let treasuryAfter = treasuryBefore;
for (let i = 0; i < 10 && Number(treasuryAfter) - Number(treasuryBefore) < expected; i++) { await sleep(1500); treasuryAfter = await usdc(treasury.publicKey()); }
const received = (Number(treasuryAfter) - Number(treasuryBefore)).toFixed(7);
console.log(`Treasury USDC ${treasuryBefore} → ${treasuryAfter} (+${received}, expected +${expected})`);

const state = {
  runId, network: net.id, kind: "recorded testnet run",
  screen: { sections: ["A", "B", "C", "D"], slotMs: SLOT_MS, priceUsdc: AD_SLOT.priceUsdc, placement: AD_SLOT.placement },
  treasury: { account: treasury.publicKey(), usdcBefore: treasuryBefore, usdcAfter: treasuryAfter, receivedUsdc: received, verified: Number(received) === expected },
  orders: schedule, registry: null, recordedAt: null,
};
await writeFile(outFile, JSON.stringify(state, null, 2));

// ---- AdsRegistry: one instance, one commit per order ----
let exit = 0;
try {
  const registry = createRegistry(net);
  const deployed = await registry.deploy(treasury, Keypair.random().rawPublicKey());
  console.log(`AdsRegistry instance ${deployed.contractId} (tx ${deployed.hash})`);
  let wasmVerified = null;
  try { wasmVerified = (await registry.wasmHashOf(deployed.contractId)) === REGISTRY_WASM_HASH; } catch {}
  state.registry = { contractId: deployed.contractId, explorerContract: `${net.explorer}/contract/${deployed.contractId}`, wasmHash: REGISTRY_WASM_HASH, wasmVerified, deployTx: deployed.hash, deployExplorer: explorerTx(net.id, deployed.hash) };
  for (const o of state.orders) {
    const terms = adTerms({ slot: AD_SLOT, payTo: treasury.publicKey(), network: net.id, section: o.quadrant });
    const c = adCommitment({ runId: o.id, creative: { advertiser: o.advertiser, headline: o.headline }, terms, paymentTx: o.tx, claimant: o.account, startMs: o.start, durationMs: SLOT_MS });
    const committed = await registry.commit(treasury, deployed.contractId, c);
    const check = readBack(await registry.get(deployed.contractId, c.order, treasury.publicKey()), c);
    o.commitTx = committed.hash;
    o.commitExplorer = explorerTx(net.id, committed.hash);
    o.order = c.order;
    o.readBack = check;
    console.log(`Section ${o.quadrant} order committed (tx ${committed.hash}); read back ${check.state}${check.verified ? " ✓" : " ✗"}`);
    if (!check.verified) exit = 1;
  }
} catch (e) {
  console.error(`Registry step failed: ${e.message}`);
  state.registry = { error: e.message.slice(0, 300) };
  exit = 1;
}
state.recordedAt = new Date().toISOString();
await writeFile(outFile, JSON.stringify(state, null, 2));
console.log("Wrote dist/state/screen.json");
process.exit(exit);
