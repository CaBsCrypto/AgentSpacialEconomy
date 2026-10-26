// Income side: a sponsor buys one line on the main-stage screen and pays the VENUE TREASURY over
// x402 on Stellar testnet. Run it after the loop (run.mjs), with services.mjs still running.
//
//   node sponsor.mjs [--run-id <id>] [--name "Demo Sponsor (testnet)"] [--message "..."] [--max 0.10]
//
// Needs SPONSOR_SECRET_KEY (a testnet wallet holding testnet USDC) and TREASURY_PUBLIC_KEY.
// Before signing, the sponsor checks the 402: price ≤ --max, network = testnet, payTo = the treasury.
// Appends the payment to dist/state/ledger.json (append-only, idempotent per run) and adds the line
// to dist/state/stage.json. The recharge of the agent's allowance is done by the treasury (ci-run.mjs).
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import { StrKey } from "@stellar/stellar-sdk";
import { Ledger } from "./ledger.mjs";
import { networkConfig, explorerTx } from "./config/networks.mjs";
import { paymentRequiredFrom, settlementFrom, settlementTx } from "./lib/x402-headers.mjs";
import { INCOME_TYPE, sponsorKey, sponsorPreflight } from "./lib/income.mjs";
import { toUnits } from "./lib/money.mjs";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const { values: args } = parseArgs({
  options: {
    "run-id": { type: "string" },
    name: { type: "string", default: "Demo Sponsor (testnet)" },
    message: { type: "string", default: "Your brand here · sponsor slots paid in testnet USDC" },
    max: { type: "string", default: "0.10" },
  },
});

const NETWORK = networkConfig().id; // throws for anything but testnet
const SERVICES_URL = (process.env.SERVICES_URL || "http://localhost:3001").replace(/\/$/, "");
const stateDir = fileURLToPath(new URL("../dist/state/", import.meta.url));
const fail = (msg) => { console.error(msg); process.exit(1); };

if (!process.env.SPONSOR_SECRET_KEY) fail("SPONSOR_SECRET_KEY is missing. Use a separate testnet wallet that holds testnet USDC.");
const treasury = (process.env.TREASURY_PUBLIC_KEY || "").trim();
if (!StrKey.isValidEd25519PublicKey(treasury)) fail("TREASURY_PUBLIC_KEY is missing or not a public G... key.");
if (!existsSync(`${stateDir}ledger.json`)) fail("No dist/state/ledger.json yet. Run the loop first (npm run loop).");

const state = JSON.parse(await readFile(`${stateDir}ledger.json`, "utf8"));
const runId = args["run-id"] ?? state.runId;
if (state.runId !== runId) fail(`dist/state/ledger.json holds run ${state.runId}, not ${runId}. Nothing was paid.`);
const key = sponsorKey(runId);
if (state.rows.some((r) => r.key === key && r.status === "settled")) {
  console.log(`Sponsor slot for run ${runId} already settled — not paying again.`);
  process.exit(0);
}

const catalog = await fetch(`${SERVICES_URL}/catalog`).then((r) => r.json()).catch(() => null);
const slot = catalog?.income?.find((s) => s.id === "sponsor-slot");
if (!slot) fail("The services offer no sponsor slot (is TREASURY_PUBLIC_KEY set for services.mjs?).");
if (toUnits(slot.priceUsdc) > toUnits(args.max)) fail(`Sponsor slot costs ${slot.priceUsdc} USDC, above --max ${args.max}. Nothing was signed.`);

const url = `${SERVICES_URL}/paid${slot.path}`;
const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: args.name, message: args.message }) };

const record = async (status, extra) => {
  const ledger = Ledger.restore(state.mandate, state);
  ledger.note({ type: INCOME_TYPE, agent: "sponsor", service: "sponsor-slot · main-stage screen", priceUsdc: slot.priceUsdc, status, key: status === "settled" ? key : null, ...extra });
  await writeFile(`${stateDir}ledger.json`, JSON.stringify(ledger.toJSON(), null, 2));
};

// Preflight: what does the server really ask for, and who would receive it?
const pre = await fetch(url, init);
if (pre.status !== 402) fail(`Expected 402 Payment Required from the sponsor slot, got ${pre.status}. Nothing was signed.`);
let preBody = null;
try { preBody = await pre.json(); } catch {}
const check = sponsorPreflight(paymentRequiredFrom(pre, preBody), { network: NETWORK, maxUsdc: args.max, treasury });
if (!check.ok) {
  await record("blocked", { reason: `refused before signing: ${check.reason}` });
  fail(`Sponsor payment REFUSED before signing — ${check.reason}`);
}

const { wrapFetchWithPaymentFromConfig } = await import("@x402/fetch");
const { createEd25519Signer } = await import("@x402/stellar");
const { ExactStellarScheme } = await import("@x402/stellar/exact/client");
const signer = createEd25519Signer(process.env.SPONSOR_SECRET_KEY, NETWORK);
const payFetch = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: NETWORK, client: new ExactStellarScheme(signer) }] });

let res;
try {
  res = await payFetch(url, init);
} catch (e) {
  await record("failed", { reason: `payment error: ${e.message}` });
  fail(`Sponsor payment FAILED — ${e.message}`);
}
const { tx, success, errorReason } = settlementTx(settlementFrom(res));
if (!res.ok || success === false || !tx) {
  await record("failed", { reason: `HTTP ${res.status}${errorReason ? `: ${errorReason}` : ""}${tx ? "" : " (no settlement tx)"}` });
  fail(`Sponsor payment FAILED — HTTP ${res.status} ${errorReason ?? ""}`);
}
const bought = await res.json();
await record("settled", { tx });
console.log(`Sponsor "${bought.name}" paid ${slot.priceUsdc} USDC to the venue treasury: SETTLED ${explorerTx(NETWORK, tx)}`);

if (existsSync(`${stateDir}stage.json`)) {
  const stage = JSON.parse(await readFile(`${stateDir}stage.json`, "utf8"));
  if (stage.runId === runId) {
    stage.sponsor = { label: bought.label, name: bought.name, message: bought.message, priceUsdc: slot.priceUsdc, tx, explorer: explorerTx(NETWORK, tx) };
    await writeFile(`${stateDir}stage.json`, JSON.stringify(stage, null, 2));
    console.log("Added the sponsor line to dist/state/stage.json");
  }
}
