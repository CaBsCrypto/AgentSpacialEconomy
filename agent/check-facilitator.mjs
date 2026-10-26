// Confirms the configured x402 facilitator serves stellar:testnet before anything else is tried.
//   node check-facilitator.mjs
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { networkConfig } from "./config/networks.mjs";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
const net = networkConfig();
const url = (process.env.FACILITATOR_URL || net.facilitatorUrl).replace(/\/$/, "");
const network = net.id;
const headers = process.env.OZ_API_KEY && url.startsWith("https://channels.openzeppelin.com/")
  ? { Authorization: `Bearer ${process.env.OZ_API_KEY}` }
  : {};

const res = await fetch(`${url}/supported`, { headers });
if (!res.ok) {
  console.error(`${url}/supported → HTTP ${res.status}. Try another facilitator (see .env.example).`);
  process.exit(1);
}
const body = await res.json();
const kinds = body.kinds ?? body.supported ?? [];
const match = kinds.filter((k) => k.network === network);
if (!match.length) {
  console.error(`${url} does not list ${network}. Listed: ${[...new Set(kinds.map((k) => k.network))].join(", ") || "nothing"}`);
  process.exit(1);
}
console.log(`OK: ${url} supports ${network} (${match.map((k) => `${k.scheme} v${k.x402Version ?? "?"}`).join(", ")})`);
