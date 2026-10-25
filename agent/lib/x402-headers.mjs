// x402 v2 carries Base64-encoded JSON in three headers:
//   PAYMENT-REQUIRED  (server → client, on the 402)
//   PAYMENT-SIGNATURE (client → server, on the paid retry)
//   PAYMENT-RESPONSE  (server → client, after settlement is attempted)
// v1 used X-PAYMENT / X-PAYMENT-RESPONSE; both are read here so the agent works with either.
import { toUnits } from "./money.mjs";

export function decodeHeader(value) {
  if (!value) return null;
  try {
    const json = Buffer.from(value, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function paymentRequiredFrom(res, body = null) {
  const fromHeader = decodeHeader(res.headers.get("payment-required"));
  if (fromHeader) return fromHeader;
  // Some v1 servers put the requirements in the JSON body of the 402 instead.
  return body && Array.isArray(body.accepts) ? body : null;
}

export function settlementFrom(res) {
  return decodeHeader(res.headers.get("payment-response") ?? res.headers.get("x-payment-response"));
}

/**
 * The largest amount (integer USDC units) the server asks for on `network`, or null if it does not
 * offer that network. v2 calls the field `amount`; v1 called it `maxAmountRequired`. Both are atomic units.
 */
export function requestedUnits(paymentRequired, network) {
  const accepts = paymentRequired?.accepts;
  if (!Array.isArray(accepts)) return null;
  const options = accepts.filter((a) => a?.network === network);
  if (!options.length) return null;
  let max = null;
  for (const a of options) {
    const raw = a.amount ?? a.maxAmountRequired;
    if (raw === undefined || !/^\d+$/.test(String(raw))) return null;
    const units = BigInt(raw);
    if (max === null || units > max) max = units;
  }
  return max;
}

/** True when the server asks for no more than we reserved. Compared in 7-decimal USDC units. */
export function withinReservation(paymentRequired, network, reservedUsdc) {
  const asked = requestedUnits(paymentRequired, network);
  return asked !== null && asked <= toUnits(reservedUsdc);
}

export function settlementTx(settlement) {
  if (!settlement) return { tx: null, payer: null, success: null };
  return {
    tx: settlement.transaction ?? settlement.txHash ?? settlement.hash ?? null,
    payer: settlement.payer ?? null,
    success: settlement.success ?? null,
    errorReason: settlement.errorReason ?? null,
  };
}
