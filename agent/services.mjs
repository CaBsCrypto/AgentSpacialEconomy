// Paid venue services over x402 on Stellar testnet.
//   GET  /health              free
//   GET  /catalog             free — services and prices
//   GET  /paid/venue-feed     paid — public HackMeridian schedule
//   POST /paid/screen-card    paid — a stage-screen card for one session
//   POST /paid/premium-render paid — priced above the demo cap on purpose
//   POST /paid/sponsor-slot   paid by a sponsor TO THE VENUE TREASURY — income that can recharge the agent
//
// Pattern follows the `agentic-payments` skill (stellar/stellar-dev-skill, x402.md): the payment gate
// is mounted under /paid and fails closed — without a valid recipient every /paid route answers 503,
// never a free 200. The sponsor slot also needs TREASURY_PUBLIC_KEY, or it answers 503.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import { paymentMiddlewareFromConfig } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { StrKey } from "@stellar/stellar-sdk";
import { CATALOG, SPONSOR_SLOT, AD_SLOT } from "./catalog.mjs";
import { sponsorSlot } from "./lib/income.mjs";
import { adCreative } from "./lib/ads.mjs";
import { parseQuadrant } from "./lib/screen.mjs";
import { toDollarPrice } from "./lib/money.mjs";
import { networkConfig } from "./config/networks.mjs";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

let net;
try {
  net = networkConfig();
} catch (e) {
  console.error(`${e.message} Fix STELLAR_NETWORK in .env.`);
  process.exit(1);
}
const NETWORK = net.id;
const FACILITATOR_URL = process.env.FACILITATOR_URL || net.facilitatorUrl;
const PORT = Number(process.env.SERVICES_PORT || 3001);


function resolvePublicKey(name, disables) {
  const raw = (process.env[name] || "").trim().replace(/['"]/g, "");
  if (!raw) return "";
  if (raw.startsWith("S")) {
    console.error(`${name} looks like a SECRET key. Put the public G... key there. ${disables} disabled.`);
    return "";
  }
  if (!StrKey.isValidEd25519PublicKey(raw)) {
    console.error(`${name} is not a valid public key (${raw.slice(0, 6)}...). ${disables} disabled.`);
    return "";
  }
  return raw;
}

// Only send the OpenZeppelin key to OpenZeppelin, never to another facilitator.
const sendsOzKey = Boolean(process.env.OZ_API_KEY) && FACILITATOR_URL.startsWith("https://channels.openzeppelin.com/");
const facilitator = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
  ...(sendsOzKey && {
    createAuthHeaders: async () => {
      const h = { Authorization: `Bearer ${process.env.OZ_API_KEY}` };
      return { verify: h, settle: h, supported: h };
    },
  }),
});

const PAY_TO = resolvePublicKey("SERVICE_RECIPIENT", "Paid routes");
const TREASURY = resolvePublicKey("TREASURY_PUBLIC_KEY", "The sponsor slot is");
const route = (s, payTo) => [
  `${s.method} ${s.path}`,
  { accepts: { scheme: "exact", price: toDollarPrice(s.priceUsdc), network: NETWORK, payTo }, description: s.description },
];
const PAID_ROUTES = Object.fromEntries([
  ...CATALOG.map((s) => route(s, PAY_TO)),
  ...(TREASURY ? [route(SPONSOR_SLOT, TREASURY), route(AD_SLOT, TREASURY)] : []),
]);

const schedule = JSON.parse(await readFile(new URL("./fixtures/schedule.json", import.meta.url), "utf8"));

const app = express();
app.use(express.json({ limit: "16kb" }));

app.get("/health", (_req, res) =>
  res.json({ ok: true, network: NETWORK, paidRoutes: Boolean(PAY_TO), sponsorSlot: Boolean(PAY_TO && TREASURY) }));
app.get("/catalog", (_req, res) =>
  res.json({ network: NETWORK, services: CATALOG, income: PAY_TO && TREASURY ? [SPONSOR_SLOT, AD_SLOT] : [] }));

// Fail closed: without a venue treasury the income routes are not in the payment config, so they
// must never fall through to their handlers for free.
for (const slot of [SPONSOR_SLOT, AD_SLOT]) {
  app.use(`/paid${slot.path}`, (_req, res, next) =>
    TREASURY ? next() : res.status(503).json({ error: "venue treasury not configured" }));
}

let paymentGate;
if (PAY_TO) {
  paymentGate = paymentMiddlewareFromConfig(
    PAID_ROUTES,
    facilitator,
    [{ network: NETWORK, server: new ExactStellarScheme() }],
    { appName: "Spatial Agents · Operating System — venue services", testnet: true },
  );
} else {
  console.warn("SERVICE_RECIPIENT missing or invalid — every /paid route answers 503.");
  paymentGate = (_req, res) => res.status(503).json({ error: "payments not configured" });
}
app.use("/paid", paymentGate);

app.get("/paid/venue-feed", (_req, res) => res.json(schedule));

function card(body, label) {
  const title = String(body?.title || "").slice(0, 120);
  if (!title) return null;
  return {
    label,
    title,
    start: body.start ?? null,
    location: String(body.location || "Main stage").slice(0, 60),
    issuedAt: new Date().toISOString(),
    theme: { background: "#07121f", text: "#eef4f7", accent: "#72e3df", money: "#e3bd79" },
  };
}

app.post("/paid/screen-card", (req, res) => {
  const c = card(req.body, "Next on the main stage");
  if (!c) return res.status(400).json({ error: "title is required" });
  res.json(c);
});

app.post("/paid/premium-render", (req, res) => {
  const c = card(req.body, "Premium render");
  if (!c) return res.status(400).json({ error: "title is required" });
  res.json({ ...c, animated: true });
});

app.post(`/paid${SPONSOR_SLOT.path}`, (req, res) => {
  const slot = sponsorSlot(req.body);
  if (!slot) return res.status(400).json({ error: "name is required" });
  res.json({ ...slot, priceUsdc: SPONSOR_SLOT.priceUsdc, payTo: TREASURY, screen: "main-stage" });
});

app.post(`/paid${AD_SLOT.path}`, (req, res) => {
  const creative = adCreative(req.body);
  if (!creative) return res.status(400).json({ error: "advertiser is required" });
  let section;
  try { section = parseQuadrant(req.body?.section); } catch (e) { return res.status(400).json({ error: e.message }); }
  res.json({
    ...creative, section, offerId: AD_SLOT.offerId, placement: AD_SLOT.placement, durationMs: AD_SLOT.durationMs,
    priceUsdc: AD_SLOT.priceUsdc, payTo: TREASURY, issuedAt: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`Venue services on http://localhost:${PORT} (${NETWORK})`);
  console.log(`Facilitator: ${FACILITATOR_URL}${sendsOzKey ? " (with OZ key)" : ""}`);
  console.log(PAY_TO ? `Paying to ${PAY_TO.slice(0, 6)}…${PAY_TO.slice(-4)}` : "Paid routes DISABLED");
  console.log(PAY_TO && TREASURY ? `Sponsor slot pays the venue treasury ${TREASURY.slice(0, 6)}…${TREASURY.slice(-4)}` : "Sponsor slot DISABLED (no TREASURY_PUBLIC_KEY)");
});
