// Pure helpers for the on-chain budget ceiling (SEP-41 allowance on the USDC Stellar Asset Contract).
// No SDK and no network here, so the rules are unit-tested anywhere; agent/onchain.mjs does the calls.
import { toUnits, fromUnits } from "./money.mjs";

export const LEDGERS_PER_DAY = 17280; // ~5 s per ledger
const PROBE_STEP = toUnits("0.01");

/** Ledger until which the approval stays live. SEP-41: must not be below the current ledger. */
export function liveUntilLedger(latestLedger, days = 1) {
  if (!Number.isInteger(latestLedger) || latestLedger <= 0) throw new RangeError("latestLedger must be a positive integer");
  if (!(days > 0)) throw new RangeError("days must be positive");
  return latestLedger + Math.ceil(days * LEDGERS_PER_DAY);
}

/**
 * What the venue agent draws from the operator's treasury and what it tries next to show the
 * network refusing: one cent above whatever allowance is left after the draw.
 */
export function drawPlan(allowanceUnits, neededUnits) {
  const allowance = BigInt(allowanceUnits);
  const needed = BigInt(neededUnits);
  if (needed <= 0n) throw new RangeError("needed must be positive");
  if (allowance < needed) {
    return { ok: false, drawUnits: 0n, remainingUnits: allowance, probeUnits: needed, reason: "allowance below the allocations" };
  }
  const remaining = allowance - needed;
  return { ok: true, drawUnits: needed, remainingUnits: remaining, probeUnits: remaining + PROBE_STEP };
}

/** One cent above what is left: the smallest draw the network must refuse. */
export function probeAbove(remainingUnits) {
  return BigInt(remainingUnits) + PROBE_STEP;
}

export function sumAllocations(allocations) {
  return Object.values(allocations ?? {}).reduce((s, v) => s + toUnits(v), 0n);
}

/** The block the dashboard reads from ledger.json. Amounts as decimal strings. */
export function onchainSummary({ network, sac, treasury, spender, approvedUnits, liveUntil, approveTx, drawTx, drawUnits, remainingUnits, probe }) {
  return {
    mode: "sep41-allowance",
    network,
    asset: { code: "USDC", sac },
    treasury,
    spender,
    approvedUsdc: fromUnits(BigInt(approvedUnits)),
    liveUntilLedger: liveUntil ?? null,
    approveTx: approveTx ?? null,
    drawnUsdc: fromUnits(BigInt(drawUnits ?? 0n)),
    drawTx: drawTx ?? null,
    remainingUsdc: fromUnits(BigInt(remainingUnits ?? 0n)),
    probe: probe
      ? { amountUsdc: fromUnits(BigInt(probe.units)), refused: Boolean(probe.refused), reason: probe.reason ?? null }
      : null,
  };
}
