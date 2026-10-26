// Income side of the venue: a sponsor buys a line on the main-stage screen and pays the venue
// treasury over x402. The treasury can then raise the venue agent's SEP-41 allowance by that income
// (a "recharge" of the agent's credit pool).
// Pure helpers only — no SDK and no network — so the rules are unit-tested anywhere.
import { toUnits, fromUnits } from "./money.mjs";
import { requestedUnits } from "./x402-headers.mjs";

export const INCOME_TYPE = "income";
export const RECHARGE_TYPE = "onchain-recharge";

/** Idempotency key of the sponsor payment for one run: a retry never pays twice. */
export const sponsorKey = (runId) => `${runId}#S:sponsor-slot`;
export const rechargeKey = (runId) => `${runId}#R:allowance-recharge`;

const clean = (value, max) =>
  String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** What the sponsor bought: plain text only, short enough for one line on the stage screen. */
export function sponsorSlot(body) {
  const name = clean(body?.name, 40);
  if (!name) return null;
  return { label: "Presented by", name, message: clean(body?.message, 80), issuedAt: new Date().toISOString() };
}

/**
 * Before the sponsor signs: the 402 must ask for no more than the sponsor's maximum, on this network,
 * and every option must pay the venue treasury — otherwise refuse without signing.
 */
export function sponsorPreflight(paymentRequired, { network, maxUsdc, treasury }) {
  const asked = requestedUnits(paymentRequired, network);
  if (asked === null) return { ok: false, reason: "the service does not accept payment on this network" };
  if (asked > toUnits(maxUsdc)) return { ok: false, reason: "price above the sponsor's maximum" };
  const payTo = paymentRequired.accepts.filter((a) => a?.network === network).map((a) => a.payTo);
  if (!payTo.length || payTo.some((p) => p !== treasury)) {
    return { ok: false, reason: "payment would not go to the venue treasury" };
  }
  return { ok: true, askedUnits: asked };
}

/** Settled sponsor income in a recorded ledger, in 7-decimal USDC units. */
export function incomeUnits(state) {
  return (state?.rows ?? [])
    .filter((r) => r.type === INCOME_TYPE && r.status === "settled")
    .reduce((sum, r) => sum + toUnits(r.priceUsdc), 0n);
}

/**
 * SEP-41 `approve` SETS the allowance; it does not add to it. A recharge therefore approves what is
 * left on the allowance plus the new income.
 * Source: https://developers.stellar.org/docs/tokens/token-interface (approve).
 */
export function rechargePlan(remainingUnits, income) {
  const remaining = BigInt(remainingUnits);
  const add = BigInt(income);
  if (remaining < 0n) throw new RangeError("remaining allowance cannot be negative");
  if (add <= 0n) return { ok: false, reason: "no income to recharge with", newAllowanceUnits: remaining };
  return { ok: true, newAllowanceUnits: remaining + add };
}

/** The block stored at ledger.onchain.recharge. Amounts as decimal strings. */
export function rechargeSummary({ beforeUnits, incomeUnits: income, afterUnits, approveTx, liveUntil, verifiedUnits }) {
  const verified = verifiedUnits !== null && verifiedUnits !== undefined && BigInt(verifiedUnits) === BigInt(afterUnits);
  return {
    beforeUsdc: fromUnits(BigInt(beforeUnits)),
    incomeUsdc: fromUnits(BigInt(income)),
    afterUsdc: fromUnits(BigInt(afterUnits)),
    verifiedUsdc: verifiedUnits === null || verifiedUnits === undefined ? null : fromUnits(BigInt(verifiedUnits)),
    verified,
    approveTx: approveTx ?? null,
    liveUntilLedger: liveUntil ?? null,
  };
}
