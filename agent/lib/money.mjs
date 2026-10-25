// USDC on Stellar uses 7 decimals. All arithmetic is done in integer units (BigInt)
// so budgets never drift through floating-point rounding.
export const DECIMALS = 7;
const SCALE = 10n ** BigInt(DECIMALS);

export function toUnits(value) {
  if (typeof value === "bigint") return value;
  const s = String(value).trim().replace(/^\$/, "");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new TypeError(`Not a USDC amount: ${value}`);
  const [whole, frac = ""] = s.split(".");
  if (frac.length > DECIMALS) throw new RangeError(`More than ${DECIMALS} decimals: ${value}`);
  return BigInt(whole) * SCALE + BigInt(frac.padEnd(DECIMALS, "0"));
}

export function fromUnits(units) {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

/** "$0.05" — the human-readable price format x402 route configs accept. */
export function toDollarPrice(value) {
  return `$${fromUnits(toUnits(value))}`;
}
