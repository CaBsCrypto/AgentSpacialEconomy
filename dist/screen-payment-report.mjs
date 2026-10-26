// Presentation of saved, independently checked payment evidence; no live balance or accounting writes.
import { validScreen } from "./screen-schedule.mjs";
export const SCREEN_USDC_ASSET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const SHA = /^[a-f0-9]{40}$/i;
const ACCOUNT = /^G[A-Z2-7]{55}$/;
const stamp = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const units = value => {
  if (!/^\d+(?:\.\d{1,7})?$/.test(String(value))) return null;
  const [whole, fraction = ""] = String(value).split(".");
  return BigInt(whole) * 10000000n + BigInt(fraction.padEnd(7, "0"));
};

/** Coherence gate for a saved verifier report, not a substitute for reading the chain again. */
export function screenPaymentReport(state) {
  const fail = reason => ({ verified: false, reason, verifiedOrders: 0, totalUnits: "0", totalUsdc: "0", payments: [] });
  if (!validScreen(state)) return fail("Invalid recorded schedule");
  const report = state.verification;
  if (!report || report.verified !== true) return fail("No saved per-payment verification");
  if (report.runId !== state.runId || report.sourceCommit !== state.sourceCommit || !SHA.test(report.sourceCommit ?? "") || !stamp(report.checkedAt) ||
      report.expectedOrders !== 6 || report.verifiedOrders !== 6 || state.orders.length !== 6 ||
      !Array.isArray(report.payments) || report.payments.length !== 6 ||
      !ACCOUNT.test(state.treasury?.account ?? "") || units(state.screen?.priceUsdc) !== 50000000n) return fail("Verification does not match this recording");
  const orders = new Map(state.orders.map(order => [order.tx.toLowerCase(), order]));
  const seen = new Set();
  let total = 0n;
  for (const proof of report.payments) {
    const tx = typeof proof?.tx === "string" ? proof.tx.toLowerCase() : "";
    const order = orders.get(tx);
    if (!order || seen.has(tx) || proof.verified !== true || proof.network !== "stellar:testnet" ||
        !ACCOUNT.test(order.account ?? "") || proof.payer !== order.account || proof.payTo !== state.treasury.account ||
        proof.asset !== SCREEN_USDC_ASSET || proof.amountUnits !== "50000000" || units(order.priceUsdc) !== 50000000n ||
        !Number.isSafeInteger(proof.ledger) || proof.ledger <= 0 || !stamp(proof.checkedAt) ||
        !["horizon-xdr", "rpc-xdr"].includes(proof.source)) return fail("A payment proof is missing or mismatched");
    seen.add(tx); total += BigInt(proof.amountUnits);
  }
  if (report.totalUnits !== total.toString() || units(report.totalUsdc) !== total || total !== 300000000n) return fail("Payment total does not reconcile");
  return { verified: true, verifiedOrders: seen.size, totalUnits: total.toString(), totalUsdc: "30",
    checkedAt: report.checkedAt, sourceCommit: report.sourceCommit, payments: report.payments };
}
