// Live reads from Stellar testnet for the operator dashboard: is each recorded transaction really on
// the network, and what do the wallets hold now? Read-only Horizon calls, no keys, testnet only.
// If Horizon is unreachable (offline, testnet reset) the dashboard keeps the recorded values.
export const HORIZON = Object.freeze({ "stellar:testnet": "https://horizon-testnet.stellar.org" });
const HASH = /^[0-9a-f]{64}$/i;
const ACCOUNT = /^G[A-Z2-7]{55}$/;

export function horizonFor(network) {
  const url = HORIZON[network];
  if (!url) throw new Error("Live reads are testnet only in this MVP");
  return url;
}

async function getJSON(fetcher, url, timeoutMs) {
  const signal = globalThis.AbortSignal?.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
  const r = await fetcher(url, { cache: "no-store", ...(signal && { signal }) });
  if (r.status === 404) return { status: 404 };
  if (!r.ok) return { status: r.status };
  return { status: 200, body: await r.json() };
}

/** { state: "confirmed" | "failed" | "not-found" | "unavailable" | "invalid", ledger?, closedAt? } */
export async function confirmTx(network, hash, { fetcher = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (!HASH.test(String(hash ?? ""))) return { state: "invalid" };
  try {
    const r = await getJSON(fetcher, `${horizonFor(network)}/transactions/${hash.toLowerCase()}`, timeoutMs);
    if (r.status === 404) return { state: "not-found" };
    if (r.status !== 200) return { state: "unavailable" };
    return { state: r.body.successful ? "confirmed" : "failed", ledger: r.body.ledger ?? null, closedAt: r.body.created_at ?? null };
  } catch {
    return { state: "unavailable" };
  }
}

/** Live USDC balance of a classic account (its trustline), as a decimal string, or a state. */
export async function usdcBalance(network, account, issuer, { fetcher = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (!ACCOUNT.test(String(account ?? ""))) return { state: "invalid" };
  try {
    const r = await getJSON(fetcher, `${horizonFor(network)}/accounts/${account}`, timeoutMs);
    if (r.status === 404) return { state: "not-found" };
    if (r.status !== 200) return { state: "unavailable" };
    const line = (r.body.balances ?? []).find((b) => b.asset_code === "USDC" && b.asset_issuer === issuer);
    return line ? { state: "ok", balance: trimAmount(line.balance) } : { state: "no-trustline" };
  } catch {
    return { state: "unavailable" };
  }
}

/** "0.1400000" → "0.14", "10.0000000" → "10", "100" → "100". */
export function trimAmount(value) {
  const s = String(value);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") || "0" : s;
}

/** Every distinct transaction hash a recorded run points to (rows, allowance, recharge, stage card). */
export function txHashes(ledger, stage = null) {
  const out = new Set();
  const add = (h) => { if (HASH.test(String(h ?? ""))) out.add(h.toLowerCase()); };
  for (const r of ledger?.rows ?? []) add(r.tx);
  add(ledger?.onchain?.approveTx);
  add(ledger?.onchain?.drawTx);
  add(ledger?.onchain?.recharge?.approveTx);
  add(stage?.tx);
  add(stage?.sponsor?.tx);
  return [...out];
}

/** Short label for a confirmation, shown next to the recorded proof link. */
export function confirmationLabel(c) {
  switch (c?.state) {
    case "confirmed": return `✓ live on testnet · ledger ${c.ledger}`;
    case "failed": return "✗ on testnet but failed";
    case "not-found": return "not found on testnet now (testnet may have been reset)";
    case "unavailable": return "live check unavailable · recorded value shown";
    default: return "";
  }
}
