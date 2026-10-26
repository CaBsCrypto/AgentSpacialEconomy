// The agent's credit pool, as the operator reads it: the SEP-41 allowance and what the agents did
// with it, counted in credits instead of USDC. 1 credit = mandate.creditUsdc (default 0.01 USDC).
// Display only — the network and the agent ledger enforce the amounts in USDC.
export const DEFAULT_CREDIT_USDC = "0.01";
const DECIMALS = 7;
const SCALE = 10n ** BigInt(DECIMALS);

export function units(value) {
  const s = String(value ?? "0").trim();
  if (!/^\d+(\.\d{1,7})?$/.test(s)) throw new TypeError(`Not a USDC amount: ${value}`);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * SCALE + BigInt(frac.padEnd(DECIMALS, "0"));
}

/** USDC → credits, as a short decimal string ("6", "12.5"). */
export function toCredits(usdc, creditUsdc = DEFAULT_CREDIT_USDC) {
  const credit = units(creditUsdc);
  if (credit <= 0n) throw new RangeError("a credit must be worth more than 0 USDC");
  const hundredths = (units(usdc) * 100n) / credit;
  const whole = hundredths / 100n;
  const frac = (hundredths % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Everything the dashboard shows about the pool, or null when the run has no on-chain allowance. */
export function creditPool(ledger) {
  const oc = ledger?.onchain;
  if (!oc || oc.mode !== "sep41-allowance") return null;
  const creditUsdc = ledger.mandate?.creditUsdc ?? DEFAULT_CREDIT_USDC;
  const c = (v) => toCredits(v ?? "0", creditUsdc);
  const spentUnits = Object.values(ledger.totals ?? {}).reduce((sum, t) => sum + units(t.spent ?? "0"), 0n);
  const spent = spentUnits / SCALE + "." + (spentUnits % SCALE).toString().padStart(DECIMALS, "0");
  const recharge = oc.recharge ?? null;
  return {
    creditUsdc,
    approved: c(oc.approvedUsdc),
    drawn: c(oc.drawnUsdc),
    spent: c(spent),
    left: c(oc.remainingUsdc),
    deposited: recharge ? c(recharge.incomeUsdc) : "0",
    leftAfterDeposit: recharge ? c(recharge.afterUsdc) : null,
    depositVerified: Boolean(recharge?.verified),
  };
}
