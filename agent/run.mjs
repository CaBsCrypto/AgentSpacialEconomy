// The demo loop: venue agent → stage agent → paid calls over x402 → ledger → stage screen.
//
//   node run.mjs --mandate mandates/main-stage.json [--run-id <id>] [--now <iso>] [--dry]
//
// --run-id  reuse an id to resume: settled steps are never paid again (idempotency).
// --now     pick the "next session" as of this time (default: now).
// --dry     stop before signing anything; writes to agent/out only, never to dist/state.
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import { ROOT_AGENT } from "./ledger.mjs";
import { networkConfig, explorerTx } from "./config/networks.mjs";
import { nextSession, lisbonTime } from "./lib/plan.mjs";
import { createPurchaseExecutor, executeDurableAction, recoverDurableAction } from "./lib/payment-executor.mjs";
import { atomicWriteJson, openRunState } from "./lib/run-store.mjs";
import { drawPlan, probeAbove, sumAllocations, onchainSummary } from "./lib/allowance.mjs";
import { toUnits, fromUnits } from "./lib/money.mjs";

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
const outDir = here("./out/");
const store = await openRunState({ directory: outDir, runId, mandate });
try {
  const { ledger, results } = store;
  const ledgerFile = store.files.ledger;
  const save = () => store.save();

  // ---- payer (server-side only; the browser never holds a key) ----
  let payFetch = null;
  if (!args.dry) {
    if (!process.env.AGENT_SECRET_KEY) {
      throw new Error("AGENT_SECRET_KEY is missing in .env. Run `npm run setup:testnet` or use --dry.");
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

  // ---- the run ----
  log(`Run ${runId} · mandate "${mandate.id}" · ${NETWORK}${args.dry ? " · DRY RUN" : ""}`);
  log(`Objective: ${mandate.objective}`);

  const catalogRes = await fetch(`${SERVICES_URL}/catalog`).catch(() => {
    throw new Error(`Cannot reach the services at ${SERVICES_URL}. Start them with \`npm run services\`.`);
  });
  const { services: catalog } = await catalogRes.json();
  const buy = createPurchaseExecutor({ ledger, results, save, runId, catalog, servicesUrl: SERVICES_URL, payFetch, dry: args.dry, log });

  for (const [agent, amount] of Object.entries(mandate.allocations)) {
    const a = ledger.allocate(ROOT_AGENT, agent, amount);
    if (!a.ok) throw new Error(a.reason);
    log(`${ROOT_AGENT} → ${agent}: ${amount} USDC${a.unchanged ? " (already allocated)" : ""}`);
  }

  // ---- on-chain budget ceiling (SEP-41 allowance), when the operator's treasury approved this agent ----
  // The treasury approved the venue agent up to the mandate budget, with an expiry. The agent draws only
  // what it allocated; the network refuses any draw above what is left, whatever this code does.
  if (process.env.TREASURY_PUBLIC_KEY && !args.dry) {
    const net = networkConfig();
    const { Keypair } = await import("@stellar/stellar-sdk");
    const { createSac } = await import("./onchain.mjs");
    const sac = createSac(net);
    const agentKp = Keypair.fromSecret(process.env.AGENT_SECRET_KEY.trim());
    const agentPub = agentKp.publicKey();
    const treasury = process.env.TREASURY_PUBLIC_KEY.trim();
    const needed = sumAllocations(mandate.allocations);
    const drawKey = `${runId}#0:allowance-draw`;
    const label = "budget draw · USDC allowance (SEP-41)";

    const startUnits = await sac.allowanceUnits(treasury, agentPub, agentPub);
    log(`On-chain ceiling: ${fromUnits(startUnits)} USDC left on the operator's allowance to ${ROOT_AGENT}`);
    let drawTx = recoverDurableAction({ ledger, results, key: drawKey })?.tx ?? null;
    let drawn = drawTx ? needed : 0n;
    if (!drawTx) {
      const plan = drawPlan(startUnits, needed);
      if (!plan.ok) {
        ledger.note({ type: "onchain-draw", agent: ROOT_AGENT, service: label, priceUsdc: fromUnits(needed), status: "blocked", reason: "the allowance is below the allocations", key: drawKey });
        await save();
        throw new Error(`The operator's allowance (${fromUnits(startUnits)} USDC) is below the allocations (${fromUnits(needed)} USDC). Nothing was paid.`);
      }
      ({ tx: drawTx } = await executeDurableAction({
        ledger, results, save, key: drawKey,
        metadata: { type: "onchain-draw", agent: ROOT_AGENT, service: label, priceUsdc: fromUnits(plan.drawUnits) },
        execute: async () => { const { hash } = await sac.drawFrom(agentKp, treasury, agentPub, plan.drawUnits); return { tx: hash }; },
      }));
      drawn = plan.drawUnits;
      log(`  0. drew ${fromUnits(drawn)} USDC from the treasury: SETTLED ${explorerTx(NETWORK, drawTx)}`);
    }
    const remainingUnits = await sac.allowanceUnits(treasury, agentPub, agentPub);
    const probeUnits = probeAbove(remainingUnits);
    const probe = await sac.probeDraw(agentPub, treasury, agentPub, probeUnits);
    ledger.note({
      type: "onchain-draw", agent: ROOT_AGENT, service: label, priceUsdc: fromUnits(probeUnits),
      status: probe.refused ? "blocked" : "not-refused",
      reason: probe.refused ? "refused by the network before submission: above the remaining allowance" : "the network did not refuse — check the allowance",
    });
    log(`  0b. tried to draw ${fromUnits(probeUnits)} USDC: ${probe.refused ? "REFUSED BY THE NETWORK (simulation, nothing submitted)" : "NOT refused — check the allowance"}`);
    ledger.onchain = onchainSummary({
      network: NETWORK, sac: net.usdc.sac, treasury, spender: agentPub,
      approvedUnits: process.env.ALLOWANCE_APPROVED_USDC ? toUnits(process.env.ALLOWANCE_APPROVED_USDC) : startUnits + drawn,
      liveUntil: process.env.ALLOWANCE_LIVE_UNTIL ? Number(process.env.ALLOWANCE_LIVE_UNTIL) : null,
      approveTx: process.env.ALLOWANCE_APPROVE_TX || null,
      drawTx, drawUnits: drawn, remainingUnits,
      probe: { units: probeUnits, refused: probe.refused, reason: probe.reason },
    });
    await save();
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
    await atomicWriteJson(`${stateDir}ledger.json`, state);
    if (card) {
      const settledCard = state.rows.find((r) => r.key === `${runId}#2:screen-card`);
      await atomicWriteJson(
        `${stateDir}stage.json`,
        { runId, card, tx: settledCard?.tx ?? null, explorer: settledCard?.explorer ?? null },
      );
    }
    log(`\nWrote dist/state/ledger.json${card ? " and dist/state/stage.json" : ""}`);
  }

  log("\nBudget:");
  for (const [name, t] of Object.entries(state.totals)) {
    log(`  ${name}: allocated ${t.allocated} · spent ${t.spent} · reserved ${t.reserved} · available ${t.available}`);
  }
  log(`Ledger: ${ledgerFile}`);
} finally {
  await store.close();
}
