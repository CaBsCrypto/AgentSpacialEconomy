import {requireSettlementReport} from './lib/verification.mjs';
import {Server as RpcServer} from '@stellar/stellar-sdk/rpc';
// One-shot testnet run for CI (GitHub Actions) or any machine with internet access.
//   1. ephemeral service (payee), agent and operator-treasury accounts (or a faucet-funded
//      agent from AGENT_SECRET_KEY, which skips the treasury)
//   2. friendbot XLM + USDC trustlines
//   3. the treasury buys a little testnet USDC with XLM on the testnet DEX (no captcha) and
//      approves the venue agent a SEP-41 allowance up to the mandate budget, valid ~24 h
//   4. writes ../.env, starts services.mjs, checks the facilitator, runs the loop (the agent draws
//      its allocations under the allowance, then pays over x402)
//   5. allowance mode only: an ephemeral sponsor pays the venue treasury for a stage-screen line
//      (sponsor.mjs), then the treasury re-approves the agent what is left plus that income
//      ("recharge") and reads the allowance back. A failure here never hides the main run.
// Secret keys only ever live in memory and in the git-ignored .env; nothing here prints them.
import { spawn, spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Asset, BASE_FEE, Horizon, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { networkConfig, explorerAccount } from "./config/networks.mjs";
import { createSac } from "./onchain.mjs";
import { liveUntilLedger } from "./lib/allowance.mjs";
import { incomeUnits, rechargePlan, rechargeSummary, rechargeKey, RECHARGE_TYPE } from "./lib/income.mjs";
import { Ledger } from "./ledger.mjs";
import { fromUnits } from "./lib/money.mjs";

const net = networkConfig("stellar:testnet");
const USDC = new Asset(net.usdc.code, net.usdc.issuer);
const MIN_USDC = 0.3;
const horizon = new Horizon.Server(net.horizonUrl);
const agentDir = fileURLToPath(new URL("./", import.meta.url));
const short = (pub) => `${pub.slice(0, 6)}…${pub.slice(-4)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function friendbot(pub) {
  const r = await fetch(`${net.friendbotUrl}?addr=${encodeURIComponent(pub)}`);
  if (!r.ok && r.status !== 400) throw new Error(`friendbot HTTP ${r.status}`); // 400 = already funded
}

async function submit(kp, ops) {
  const account = await horizon.loadAccount(kp.publicKey());
  const b = new TransactionBuilder(account, { fee: String(Number(BASE_FEE) * 10), networkPassphrase: net.passphrase });
  ops.forEach((op) => b.addOperation(op));
  const tx = b.setTimeout(60).build();
  tx.sign(kp);
  return horizon.submitTransaction(tx);
}

async function usdcBalance(pub) {
  const a = await horizon.loadAccount(pub);
  const line = a.balances.find((b) => b.asset_code === "USDC" && b.asset_issuer === USDC.issuer);
  return line ? Number(line.balance) : null;
}

async function ensureTrustline(kp) {
  if ((await usdcBalance(kp.publicKey())) === null) {
    await submit(kp, [Operation.changeTrust({ asset: USDC })]);
  }
}

async function buyUsdcWithXlm(kp, min = MIN_USDC) {
  for (const sendAmount of ["50", "200", "1000"]) {
    const { records } = await horizon.strictSendPaths(Asset.native(), sendAmount, [USDC]).call();
    const best = records.sort((a, b) => Number(b.destination_amount) - Number(a.destination_amount))[0];
    if (!best || Number(best.destination_amount) < min) continue;
    const path = best.path.map((p) => (p.asset_type === "native" ? Asset.native() : new Asset(p.asset_code, p.asset_issuer)));
    const destMin = (Number(best.destination_amount) * 0.95).toFixed(7);
    const res = await submit(kp, [
      Operation.pathPaymentStrictSend({ sendAsset: Asset.native(), sendAmount, destination: kp.publicKey(), destAsset: USDC, destMin, path }),
    ]);
    console.log(`Bought ~${Number(best.destination_amount).toFixed(4)} testnet USDC for ${sendAmount} XLM on the testnet DEX (tx ${res.hash})`);
    return true;
  }
  return false;
}

// ---- accounts ----
// Allowance mode (default): the operator's treasury holds the USDC and approves the venue agent a
// SEP-41 allowance up to the mandate budget; the agent starts with no USDC and draws what it allocates.
// Direct mode (AGENT_SECRET_KEY set): a faucet-funded agent wallet pays from its own balance.
const mandate = JSON.parse(await readFile(new URL("./mandates/main-stage.json", import.meta.url), "utf8"));
const service = Keypair.random();
const allowanceMode = !process.env.AGENT_SECRET_KEY;
let agent;
let treasury = null;
let sponsor = null;
if (allowanceMode) {
  agent = Keypair.random();
  treasury = Keypair.random();
  sponsor = Keypair.random();
  console.log(`Ephemeral agent wallet: ${agent.publicKey()}`);
  console.log(`Ephemeral operator treasury: ${treasury.publicKey()}`);
  console.log(`Ephemeral sponsor wallet: ${sponsor.publicKey()}`);
} else {
  agent = Keypair.fromSecret(process.env.AGENT_SECRET_KEY.trim());
  console.log(`Agent wallet from AGENT_SECRET_KEY: ${short(agent.publicKey())}`);
}
console.log(`Ephemeral service wallet: ${service.publicKey()}`);

const funded = allowanceMode ? [agent, service, treasury, sponsor] : [agent, service];
await Promise.all(funded.map((kp) => friendbot(kp.publicKey())));
await sleep(3000);
for (const kp of funded) await ensureTrustline(kp);

const payer = allowanceMode ? treasury : agent; // whoever must hold USDC
let balance = await usdcBalance(payer.publicKey());
if (balance < MIN_USDC) {
  const ok = await buyUsdcWithXlm(payer);
  balance = await usdcBalance(payer.publicKey());
  if (!ok || balance < MIN_USDC) {
    console.error(
      `\nThe ${allowanceMode ? "treasury" : "agent"} wallet has ${balance ?? 0} testnet USDC and the testnet DEX has no XLM→USDC route.\n` +
        `Fund an agent wallet at https://faucet.circle.com (Stellar testnet) and store its secret as the repo secret AGENT_SECRET_KEY.`,
    );
    process.exit(2);
  }
}
console.log(`${allowanceMode ? "Treasury" : "Agent"} USDC balance: ${balance}`);
let sponsorReady = false;
if (sponsor) {
  sponsorReady = (await usdcBalance(sponsor.publicKey())) >= 0.1 || (await buyUsdcWithXlm(sponsor, 0.12).catch(() => false));
  console.log(sponsorReady ? `Sponsor USDC balance: ${await usdcBalance(sponsor.publicKey())}` : "Sponsor could not get testnet USDC; the sponsor step will be skipped.");
}
console.log(`Agent account: ${explorerAccount(net.id, agent.publicKey())}`);

let allowanceEnv = {};
if (allowanceMode) {
  const sac = createSac(net);
  const liveUntil = liveUntilLedger(await sac.latestLedger(), 1);
  const { hash } = await sac.approve(treasury, agent.publicKey(), mandate.budgetUsdc, liveUntil);
  const approved = await sac.allowanceUnits(treasury.publicKey(), agent.publicKey(), agent.publicKey());
  console.log(`Treasury approved the venue agent ${fromUnits(approved)} USDC until ledger ${liveUntil} (SEP-41 approve, tx ${hash})`);
  allowanceEnv = {
    TREASURY_PUBLIC_KEY: treasury.publicKey(),
    ALLOWANCE_APPROVE_TX: hash,
    ALLOWANCE_LIVE_UNTIL: String(liveUntil),
    ALLOWANCE_APPROVED_USDC: mandate.budgetUsdc,
  };
}

// ---- environment for services.mjs and run.mjs ----
const facilitator = process.env.FACILITATOR_URL || net.facilitatorUrl;
const runEnv = {
  STELLAR_NETWORK: "stellar:testnet",
  FACILITATOR_URL: facilitator,
  OZ_API_KEY: process.env.OZ_API_KEY || "",
  SERVICE_RECIPIENT: service.publicKey(),
  AGENT_SECRET_KEY: agent.secret(),
  SERVICES_URL: "http://localhost:3001",
  SERVICES_PORT: "3001",
  ...allowanceEnv,
};
await writeFile(
  fileURLToPath(new URL("../.env", import.meta.url)),
  Object.entries(runEnv).map(([k, v]) => `${k}=${v}`).join("\n") + "\n",
  { mode: 0o600 },
);
// Pass the values explicitly too: dotenv never overrides a variable that already exists, and CI
// defines AGENT_SECRET_KEY as an empty string when the repo secret is not set.
const childEnv = { ...process.env, ...runEnv };

// ---- run ----
const check = spawnSync(process.execPath, ["check-facilitator.mjs"], { cwd: agentDir, stdio: "inherit", env: childEnv });
if (check.status !== 0) console.warn("Facilitator check failed; trying the run anyway to capture the exact error.");

const services = spawn(process.execPath, ["services.mjs"], { cwd: agentDir, stdio: ["ignore", "pipe", "pipe"], env: childEnv });
services.stdout.on("data", (d) => process.stdout.write(`[services] ${d}`));
services.stderr.on("data", (d) => process.stdout.write(`[services] ${d}`));

let up = false;
for (let i = 0; i < 40 && !up; i++) {
  await sleep(500);
  try { up = (await fetch("http://localhost:3001/health")).ok; } catch {}
}
if (!up) {
  console.error("Services did not start.");
  services.kill();
  process.exit(1);
}

const runId = new Date().toISOString();
const run = spawnSync(process.execPath, ["run.mjs", "--mandate", "mandates/main-stage.json", "--run-id", runId], {
  cwd: agentDir,
  stdio: "inherit",
  env: childEnv,
});

// ---- income: sponsor pays the treasury, the treasury recharges the agent's allowance ----
if (run.status === 0 && allowanceMode && sponsorReady) {
  console.log("\nIncome: a sponsor buys a line on the main-stage screen (paid to the venue treasury)");
  const paid = spawnSync(process.execPath, ["sponsor.mjs", "--run-id", runId], {
    cwd: agentDir,
    stdio: "inherit",
    env: { ...childEnv, SPONSOR_SECRET_KEY: sponsor.secret() },
  });
  const ledgerFile = fileURLToPath(new URL("../dist/state/ledger.json", import.meta.url));
  if (paid.status === 0 && existsSync(ledgerFile)) {
    try {
      const state = JSON.parse(await readFile(ledgerFile, "utf8"));
      const income = incomeUnits(state);
      const sac = createSac(net);
      const before = await sac.allowanceUnits(treasury.publicKey(), agent.publicKey(), agent.publicKey());
      const plan = rechargePlan(before, income);
      if (!plan.ok) throw new Error(plan.reason);
      const liveUntil = Number(allowanceEnv.ALLOWANCE_LIVE_UNTIL);
      const { hash } = await sac.approve(treasury, agent.publicKey(), fromUnits(plan.newAllowanceUnits), liveUntil);
      const verified = await sac.allowanceUnits(treasury.publicKey(), agent.publicKey(), agent.publicKey());
      const summary = rechargeSummary({ beforeUnits: before, incomeUnits: income, afterUnits: plan.newAllowanceUnits, approveTx: hash, liveUntil, verifiedUnits: verified });
      const ledger = Ledger.restore(state.mandate, state);
      ledger.note({
        type: RECHARGE_TYPE, agent: "operator-treasury", service: "recharge · USDC allowance (SEP-41 approve)",
        priceUsdc: summary.incomeUsdc, status: summary.verified ? "settled" : "failed", tx: hash, key: rechargeKey(runId),
        ...(summary.verified ? {} : { reason: `allowance read back ${summary.verifiedUsdc} USDC, expected ${summary.afterUsdc}` }),
      });
      ledger.onchain = { ...(ledger.onchain ?? {}), recharge: summary };
      await writeFile(ledgerFile, JSON.stringify(ledger.toJSON(), null, 2));
      console.log(`Treasury recharged the agent's allowance ${summary.beforeUsdc} → ${summary.afterUsdc} USDC with the sponsor income (SEP-41 approve, tx ${hash}); read back ${summary.verifiedUsdc} USDC${summary.verified ? " ✓" : " ✗"}`);
    } catch (e) {
      console.error(`Recharge skipped: ${e.message}`);
    }
  } else {
    console.error("Sponsor step did not settle; the recorded run stays as the loop wrote it.");
  }
}
services.kill();
let status=run.status??1;
if(status===0){
 try{
  const report=JSON.parse(await readFile(new URL('../dist/state/ledger.json',import.meta.url),'utf8'));
  const receipts=requireSettlementReport(report,{runId});
  const rpc=new RpcServer('https://soroban-testnet.stellar.org',{timeout:12000});
  for(const row of receipts)if((await rpc.getTransaction(row.tx)).status!=='SUCCESS')throw Error('Settlement is not confirmed on Stellar Testnet.');
 }catch{console.error('Live CI requires every expected fresh settlement and successful Stellar RPC confirmation; report/HTTP success alone is insufficient.');status=1;}
}
process.exit(status);
