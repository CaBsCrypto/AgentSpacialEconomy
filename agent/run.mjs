// The demo loop: venue agent → stage agent → paid calls over x402 → ledger → stage screen.
//
//   node run.mjs --mandate mandates/main-stage.json [--run-id <id>] [--now <iso>] [--dry]
//
// --run-id  reuse an id to resume: settled steps are never paid again (idempotency).
// --now     pick the "next session" as of this time (default: now).
// --dry     stop before signing anything; writes to agent/out only, never to dist/state.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import { Ledger, ROOT_AGENT } from "./ledger.mjs";
import { networkConfig, explorerTx } from "./config/networks.mjs";
import { findService } from "./catalog.mjs";
import { nextSession, lisbonTime } from "./lib/plan.mjs";
import { paymentRequiredFrom, settlementFrom, settlementTx, withinReservation } from "./lib/x402-headers.mjs";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const { values: args } = parseArgs({
  options: {
    mandate: { type: "string", default: "mandates/main-stage.json" },
    "run-id": { type: "string" },
    now: { type: "string" },
    dry: { type: "boolean", default: false },
  },
});

const NETWORK = networkConfig().id; // throws for anything but testnet
const SERVICES_URL = (process.env.SERVICES_URL || "http://localhost:3001").replace(/\/$/, "");
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const mandate = JSON.parse(await readFile(here(args.mandate.startsWith("/") ? args.mandate : `./${args.mandate}`), "utf8"));
const runId = args["run-id"] ?? new Date().toISOString();
const safeRunId = runId.replace(/[^A-Za-z0-9._-]/g, "_");
const outDir = here("./out/");
const ledgerFile = `${outDir}ledger-${safeRunId}.json`;
const resultsFile = `${outDir}results-${safeRunId}.json`;
await mkdir(outDir, { recursive: true });

const ledger = existsSync(ledgerFile)
  ? Ledger.restore(mandate, JSON.parse(await readFile(ledgerFile, "utf8")))
  : new Ledger(mandate, { runId });
const results = existsSync(resultsFile) ? JSON.parse(await readFile(resultsFile, "utf8")) : {};
const save = async () => {
  await writeFile(ledgerFile, JSON.stringify(ledger.toJSON(), null, 2));
  await writeFile(resultsFile, JSON.stringify(results, null, 2));
};

// ---- payer (server-side only; the browser never holds a key) ----
let payFetch = null;
if (!args.dry) {
  if (!process.env.AGENT_SECRET_KEY) {
    console.error("AGENT_SECRET_KEY is missing in .env. Run `npm run setup:testnet` or use --dry.");
    process.exit(1);
  }
  const { wrapFetchWithPaymentFromConfig } = await import("@x402/fetch");
  const { createEd25519Signer } = await import("@x402/stellar");
  const { ExactStellarScheme } = await import("@x402/stellar/exact/client");
  const signer = createEd25519Signer(process.env.AGENT_SECRET_KEY, NETWORK);
  payFetch = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: NETWORK, client: new ExactStellarScheme(signer) }],
  });
}

const log = (...m) => console.log(...m);

async function buy(step, agent, serviceId, { method = "GET", body } = {}) {
  const service = findService(catalog, serviceId);
  const key = `${runId}#${step}:${serviceId}`;
  if (results[key]) {
    log(`  ${step}. ${serviceId}: already settled in this run — reusing, not paying again`);
    return results[key];
  }
  const auth = ledger.authorize({ agent, service: serviceId, priceUsdc: service.priceUsdc, key });
  if (!auth.ok) {
    log(`  ${step}. ${serviceId} (${service.priceUsdc} USDC): BLOCKED — ${auth.reason}${auth.row?.needsApproval ? " (needs operator approval)" : ""}`);
    await save();
    return null;
  }
  const url = `${SERVICES_URL}/paid${service.path}`;
  const init = { method, headers: { "content-type": "application/json" }, ...(body && { body: JSON.stringify(body) }) };

  // Preflight: read what the server actually asks for, and refuse before signing if it is more
  // than we reserved.
  const pre = await fetch(url, init);
  let preBody = null;
  try { preBody = await pre.json(); } catch {}
  if (pre.status !== 402) {
    ledger.release(key, `expected 402 Payment Required, got ${pre.status}`);
    log(`  ${step}. ${serviceId}: FAILED — service answered ${pre.status} instead of asking for payment`);
    await save();
    return null;
  }
  const required = paymentRequiredFrom(pre, preBody);
  if (!withinReservation(required, NETWORK, service.priceUsdc)) {
    ledger.release(key, "server asked for more than the reserved price, or not on this network");
    log(`  ${step}. ${serviceId}: REFUSED before signing — price mismatch`);
    await save();
    return null;
  }
  if (args.dry) {
    ledger.release(key, "dry run: stopped before signing");
    log(`  ${step}. ${serviceId} (${service.priceUsdc} USDC): dry run — would pay`);
    await save();
    return null;
  }

  let res;
  try {
    res = await payFetch(url, init);
  } catch (e) {
    ledger.release(key, `payment error: ${e.message}`);
    log(`  ${step}. ${serviceId}: FAILED — ${e.message}`);
    await save();
    return null;
  }
  const { tx, payer, success, errorReason } = settlementTx(settlementFrom(res));
  if (!res.ok || success === false) {
    ledger.release(key, `HTTP ${res.status}${errorReason ? `: ${errorReason}` : ""}`);
    log(`  ${step}. ${serviceId}: FAILED — HTTP ${res.status} ${errorReason ?? ""}`);
    await save();
    return null;
  }
  const data = await res.json();
  ledger.settle(key, { tx, payer, note: tx ? null : "paid, but the service sent no settlement header" });
  results[key] = data;
  await save();
  log(`  ${step}. ${serviceId} (${service.priceUsdc} USDC): SETTLED ${tx ? explorerTx(NETWORK, tx) : "(no tx hash returned)"}`);
  return data;
}

// ---- the run ----
log(`Run ${runId} · mandate "${mandate.id}" · ${NETWORK}${args.dry ? " · DRY RUN" : ""}`);
log(`Objective: ${mandate.objective}`);

const catalogRes = await fetch(`${SERVICES_URL}/catalog`).catch((e) => {
  console.error(`Cannot reach the services at ${SERVICES_URL}: ${e.message}. Start them with \`npm run services\`.`);
  process.exit(1);
});
const { services: catalog } = await catalogRes.json();

for (const [agent, amount] of Object.entries(mandate.allocations)) {
  const a = ledger.allocate(ROOT_AGENT, agent, amount);
  if (!a.ok) throw new Error(a.reason);
  log(`${ROOT_AGENT} → ${agent}: ${amount} USDC${a.unchanged ? " (already allocated)" : ""}`);
}

const feed = await buy(1, "stage-agent", "venue-feed");
// In a dry run nothing is bought, so plan from the local fixture to exercise the next step too.
const feedData = feed ?? (args.dry ? JSON.parse(await readFile(here("./fixtures/schedule.json"), "utf8")) : null);
const session = feedData ? nextSession(feedData.items, args.now) : null;
if (session) log(`  next session: ${session.title} — ${lisbonTime(session.start)}`);

const card = session
  ? await buy(2, "stage-agent", "screen-card", { method: "POST", body: { title: session.title, start: session.start, location: session.location } })
  : null;

// Demonstrates the cap: the ledger refuses this before any signature.
await buy(3, "stage-agent", "premium-render", { method: "POST", body: { title: session?.title ?? "Main stage" } });

await save();
const state = ledger.toJSON();

if (!args.dry) {
  const stateDir = fileURLToPath(new URL("../dist/state/", import.meta.url));
  await mkdir(stateDir, { recursive: true });
  await writeFile(`${stateDir}ledger.json`, JSON.stringify(state, null, 2));
  if (card) {
    const settledCard = state.rows.find((r) => r.key === `${runId}#2:screen-card`);
    await writeFile(
      `${stateDir}stage.json`,
      JSON.stringify({ runId, card, tx: settledCard?.tx ?? null, explorer: settledCard?.explorer ?? null }, null, 2),
    );
  }
  log(`\nWrote dist/state/ledger.json${card ? " and dist/state/stage.json" : ""}`);
}

log("\nBudget:");
for (const [name, t] of Object.entries(state.totals)) {
  log(`  ${name}: allocated ${t.allocated} · spent ${t.spent} · reserved ${t.reserved} · available ${t.available}`);
}
log(`Ledger: ${ledgerFile}`);
