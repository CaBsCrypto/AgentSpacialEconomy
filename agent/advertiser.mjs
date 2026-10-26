// Paid screen time: an advertiser buys five minutes of the main-stage screen and pays the VENUE
// TREASURY over x402 on Stellar testnet. Run it with services.mjs running.
//
//   node advertiser.mjs --run-id <id> [--name "Demo Advertiser (testnet)"] [--headline "..."] [--max 5.00]
//
// Needs ADVERTISER_SECRET_KEY (a testnet wallet holding testnet USDC) and TREASURY_PUBLIC_KEY.
// Before signing, the advertiser checks the 402: price ≤ --max, network = testnet, payTo = the treasury.
// Writes dist/state/ads.json (one order per run id; a rerun with the same id never pays twice).
// The on-chain registry commit is done by the treasury (ads-ci.mjs).
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { networkConfig, explorerTx } from "./config/networks.mjs";
import { paymentRequiredFrom, settlementFrom, settlementTx } from "./lib/x402-headers.mjs";
import { sponsorPreflight } from "./lib/income.mjs";
import { AD_TYPE, adKey } from "./lib/ads.mjs";
import { toUnits, toDollarPrice } from "./lib/money.mjs";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const { values: args } = parseArgs({
  options: {
    "run-id": { type: "string" },
    name: { type: "string", default: "Demo Advertiser (testnet)" },
    headline: { type: "string", default: "Five minutes on the main stage, paid in testnet USDC" },
    max: { type: "string", default: "5.00" },
    section: { type: "string" }, // A–D: which quarter of the main-stage screen; empty = any free one
    out: { type: "string" }, // where to write the order (default dist/state/ads.json)
  },
});

const NETWORK = networkConfig().id; // throws for anything but testnet
const SERVICES_URL = (process.env.SERVICES_URL || "http://localhost:3001").replace(/\/$/, "");
const file = args.out ? args.out : fileURLToPath(new URL("../dist/state/ads.json", import.meta.url));
const fail = (msg) => { console.error(msg); process.exit(1); };

if (!process.env.ADVERTISER_SECRET_KEY) fail("ADVERTISER_SECRET_KEY is missing. Use a separate testnet wallet that holds testnet USDC.");
const treasury = (process.env.TREASURY_PUBLIC_KEY || "").trim();
if (!StrKey.isValidEd25519PublicKey(treasury)) fail("TREASURY_PUBLIC_KEY is missing or not a public G... key.");
const runId = args["run-id"] ?? new Date().toISOString();
const key = adKey(runId);

const previous = existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : null;
if (previous?.runId === runId && previous.rows?.some((r) => r.key === key && r.status === "settled")) {
  console.log(`Ad slot for run ${runId} already settled — not paying again.`);
  process.exit(0);
}

const catalog = await fetch(`${SERVICES_URL}/catalog`).then((r) => r.json()).catch(() => null);
const slot = catalog?.income?.find((s) => s.id === "ad-slot");
if (!slot) fail("The services offer no ad slot (is TREASURY_PUBLIC_KEY set for services.mjs?).");
if (toUnits(slot.priceUsdc) > toUnits(args.max)) fail(`Ad slot costs ${slot.priceUsdc} USDC, above --max ${args.max}. Nothing was signed.`);

const advertiser = Keypair.fromSecret(process.env.ADVERTISER_SECRET_KEY.trim()).publicKey();
const state = {
  runId,
  network: NETWORK,
  offer: { id: slot.offerId, placement: slot.placement, durationMs: slot.durationMs, priceUsdc: slot.priceUsdc, payTo: treasury },
  advertiser: { account: advertiser, name: null, headline: null },
  rows: [],
};
const save = () => writeFile(file, JSON.stringify(state, null, 2));
const record = async (status, extra) => {
  state.rows.push({
    type: AD_TYPE, agent: "advertiser", service: "ad-slot · main-stage screen · 5 min", priceUsdc: slot.priceUsdc,
    status, key: status === "settled" ? key : null, at: new Date().toISOString(), ...extra,
  });
  await save();
};

const url = `${SERVICES_URL}/paid${slot.path}`;
const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ advertiser: args.name, headline: args.headline, ...(args.section ? { section: args.section } : {}) }) };

// Preflight: what does the server really ask for, and who would receive it?
const pre = await fetch(url, init);
if (pre.status !== 402) fail(`Expected 402 Payment Required from the ad slot, got ${pre.status}. Nothing was signed.`);
let preBody = null;
try { preBody = await pre.json(); } catch {}
const check = sponsorPreflight(paymentRequiredFrom(pre, preBody), { network: NETWORK, maxUsdc: args.max, treasury });
if (!check.ok) {
  await record("blocked", { reason: `refused before signing: ${check.reason}` });
  fail(`Ad payment REFUSED before signing — ${check.reason}`);
}

const { wrapFetchWithPaymentFromConfig } = await import("@x402/fetch");
const { createEd25519Signer } = await import("@x402/stellar");
const { ExactStellarScheme } = await import("@x402/stellar/exact/client");
const signer = createEd25519Signer(process.env.ADVERTISER_SECRET_KEY, NETWORK);
// The x402 client caps each payment at $1 by default; raise it to exactly the advertiser's maximum
// (spendControls.maxAmountPerPayment, https://docs.x402.org/getting-started/quickstart-for-buyers).
const payFetch = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: NETWORK, client: new ExactStellarScheme(signer) }],
  spendControls: { maxAmountPerPayment: toDollarPrice(args.max) },
});

let res;
try {
  res = await payFetch(url, init);
} catch (e) {
  await record("failed", { reason: `payment error: ${e.message}` });
  fail(`Ad payment FAILED — ${e.message}`);
}
const { tx, success, errorReason } = settlementTx(settlementFrom(res));
if (!res.ok || success === false || !tx) {
  await record("failed", { reason: `HTTP ${res.status}${errorReason ? `: ${errorReason}` : ""}${tx ? "" : " (no settlement tx)"}` });
  fail(`Ad payment FAILED — HTTP ${res.status} ${errorReason ?? ""}`);
}
const bought = await res.json();
state.advertiser = { account: advertiser, name: bought.advertiser, headline: bought.headline, section: bought.section ?? null };
await record("settled", { tx, explorer: explorerTx(NETWORK, tx) });
console.log(`Advertiser "${bought.advertiser}" paid ${slot.priceUsdc} USDC to the venue treasury for ${slot.durationMs / 60000} min of ${slot.placement}: SETTLED ${explorerTx(NETWORK, tx)}`);
