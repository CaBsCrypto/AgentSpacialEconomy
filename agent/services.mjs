// Paid venue services over x402 on Stellar testnet.
//   GET  /health              free
//   GET  /catalog             free — services and prices
//   GET  /paid/venue-feed     paid — public HackMeridian schedule
//   POST /paid/screen-card    paid — a stage-screen card for one session
//   POST /paid/premium-render paid — priced above the demo cap on purpose
//
// Pattern follows the `agentic-payments` skill (stellar/stellar-dev-skill, x402.md): the payment gate
// is mounted under /paid and fails closed — without a valid recipient every /paid route answers 503,
// never a free 200.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import { paymentMiddlewareFromConfig } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { StrKey } from "@stellar/stellar-sdk";
import { CATALOG } from "./catalog.mjs";
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


function resolveRecipient() {
  const raw = (process.env.SERVICE_RECIPIENT || "").trim().replace(/['"]/g, "");
  if (!raw) return "";
  if (raw.startsWith("S")) {
    console.error("SERVICE_RECIPIENT looks like a SECRET key. Put the public G... key there. Paid routes disabled.");
    return "";
  }
  if (!StrKey.isValidEd25519PublicKey(raw)) {
    console.error(`SERVICE_RECIPIENT is not a valid public key (${raw.slice(0, 6)}...). Paid routes disabled.`);
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

const PAY_TO = resolveRecipient();
const PAID_ROUTES = Object.fromEntries(
  CATALOG.map((s) => [
    `${s.method} ${s.path}`,
    {
      accepts: { scheme: "exact", price: toDollarPrice(s.priceUsdc), network: NETWORK, payTo: PAY_TO },
      description: s.description,
    },
  ]),
);

const schedule = JSON.parse(await readFile(new URL("./fixtures/schedule.json", import.meta.url), "utf8"));

const app = express();
app.use(express.json({ limit: "16kb" }));

app.get("/health", (_req, res) => res.json({ ok: true, network: NETWORK, paidRoutes: Boolean(PAY_TO) }));
app.get("/catalog", (_req, res) => res.json({ network: NETWORK, services: CATALOG }));

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

app.listen(PORT, () => {
  console.log(`Venue services on http://localhost:${PORT} (${NETWORK})`);
  console.log(`Facilitator: ${FACILITATOR_URL}${sendsOzKey ? " (with OZ key)" : ""}`);
  console.log(PAY_TO ? `Paying to ${PAY_TO.slice(0, 6)}…${PAY_TO.slice(-4)}` : "Paid routes DISABLED");
});
