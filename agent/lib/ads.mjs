// Paid screen time: an advertiser buys five minutes of the main-stage screen and pays the VENUE
// TREASURY over x402. The treasury then records the order in the AdsRegistry Soroban contract
// (contracts/ads-registry on feature/ads-3d-ar-x402) with the real settlement hash as `payment`.
// The registry is noncustodial: it never moves funds. Delivery is not recorded here, so the order
// stays `Queued` — the honest state for "paid and committed, not yet shown".
// Pure helpers only (no network), so the rules are unit-tested anywhere.
import { createHash } from "node:crypto";

export const AD_TYPE = "ad-order";
export const REGISTRY_SLOTS = ["main_stage_screen", "venue_center_banner"]; // the contract accepts only these
const HASH = /^[0-9a-f]{64}$/i;
const ACCOUNT = /^[GC][A-Z2-7]{55}$/;

/** Idempotency key of the ad payment for one run: a retry never pays twice. */
export const adKey = (runId) => `${runId}#A:ad-slot`;

/** Deterministic JSON: object keys sorted at every level, so the same order always hashes the same. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const sha256Hex = (text) => createHash("sha256").update(String(text)).digest("hex");

const clean = (value, max) =>
  String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** What the advertiser shows: plain text only. */
export function adCreative(body) {
  const advertiser = clean(body?.advertiser, 40);
  if (!advertiser) return null;
  return { advertiser, headline: clean(body?.headline, 80) };
}

/** The terms both sides agreed to; their hash goes on chain. */
export function adTerms({ slot, payTo, network }) {
  return {
    offer: slot.offerId,
    placement: slot.placement,
    plan: "Time",
    durationMs: slot.durationMs,
    priceUsdc: slot.priceUsdc,
    payTo,
    network,
  };
}

/**
 * The AdsRegistry `commit` payload, as hex strings and integers. Mirrors the contract's own checks
 * (one known slot, units > 0, units ≤ window, deadline after the window) so a bad order is refused
 * before anything is signed.
 */
export function adCommitment({ runId, creative, terms, paymentTx, claimant, startMs, durationMs, slot = terms?.placement, graceMs = 3_600_000 }) {
  if (!HASH.test(String(paymentTx ?? ""))) throw new Error("payment must be the 64-hex settlement transaction hash");
  if (!ACCOUNT.test(String(claimant ?? ""))) throw new Error("claimant must be the advertiser's public address");
  if (!REGISTRY_SLOTS.includes(slot)) throw new Error(`slot ${slot} is not a registry placement`);
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) throw new Error("duration must be a positive number of milliseconds");
  if (!Number.isSafeInteger(startMs) || startMs <= 0) throw new Error("start must be a timestamp in milliseconds");
  if (!creative) throw new Error("creative is required");
  const end = startMs + durationMs;
  return {
    order: sha256Hex(adKey(runId)),
    revision: sha256Hex(canonical({ runId, creative })),
    terms: sha256Hex(canonical(terms)),
    manifest: sha256Hex(canonical({ creative, placement: slot, durationMs })),
    payment: String(paymentTx).toLowerCase(),
    claimant,
    deadline: end + graceMs,
    placements: [{ slot, plan: "Time", units: durationMs, pass_ms: 0, start: startMs, end }],
  };
}

/**
 * Explicit XDR for `commit(c: Commitment)`: structs are maps with symbol keys in sorted order, the
 * Plan enum is a one-symbol vector. Same encoding as registryArguments() in server/ads/registry.mjs
 * on feature/ads-3d-ar-x402, which committed successfully on testnet (tx 380dfd78…).
 */
export function registryCommitArgs(c, s) {
  const bytes = (hex) => s.nativeToScVal(Buffer.from(hex, "hex"), { type: "bytes" });
  const sym = (v) => s.nativeToScVal(v, { type: "symbol" });
  const u64 = (v) => s.nativeToScVal(BigInt(v), { type: "u64" });
  const u32 = (v) => s.nativeToScVal(Number(v), { type: "u32" });
  const struct = (fields) =>
    s.xdr.ScVal.scvMap(Object.keys(fields).sort().map((key) => new s.xdr.ScMapEntry({ key: sym(key), val: fields[key] })));
  const placements = c.placements.map((p) =>
    struct({ slot: sym(p.slot), plan: s.xdr.ScVal.scvVec([sym(p.plan)]), units: u64(p.units), pass_ms: u32(p.pass_ms ?? 0), start: u64(p.start), end: u64(p.end) }));
  return [
    struct({
      order: bytes(c.order), revision: bytes(c.revision), terms: bytes(c.terms), manifest: bytes(c.manifest), payment: bytes(c.payment),
      claimant: s.nativeToScVal(c.claimant, { type: "address" }), deadline: u64(c.deadline), placements: s.xdr.ScVal.scvVec(placements),
    }),
  ];
}

const hex = (v) => (v == null ? "" : typeof v === "string" ? v.toLowerCase() : Buffer.from(v).toString("hex"));

/** Compare what `get(order)` returned with what we committed. */
export function readBack(record, c) {
  const state = Array.isArray(record?.state) ? String(record.state[0]) : String(record?.state ?? "");
  const delivered = record?.delivered?.[0] ?? null;
  const verified = Boolean(record) && state === "Queued" && hex(record.commitment?.payment) === c.payment &&
    hex(record.commitment?.order) === c.order && delivered !== null && BigInt(delivered) === 0n;
  return { verified, state: state || null, deliveredMs: delivered === null ? null : String(delivered), requiredMs: String(c.placements[0].units) };
}
