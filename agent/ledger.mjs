// Budget ledger for the venue agent and its sub-agents.
// Pure logic, no network: every rule from SPEC.md "Ledger rules" lives here and is unit-tested.
//
//   available = allocated − delegated − reserved − spent
//
// A call is authorized (and its price reserved) only if the service is allowed, the price is within
// the per-call cap and the approval threshold, and the agent has enough available budget.
// Nothing is ever deleted: blocked, failed and settled attempts all stay as rows.
import { toUnits, fromUnits } from "./lib/money.mjs";
import { explorerTx } from "./config/networks.mjs";

export const ROOT_AGENT = "venue-agent";

export function explorerUrl(network, tx) {
  return explorerTx(network, tx);
}

export class Ledger {
  constructor(mandate, { runId, clock = () => new Date().toISOString() } = {}) {
    validateMandate(mandate);
    this.mandate = mandate;
    this.runId = runId ?? clock();
    this.clock = clock;
    this.network = mandate.network;
    this.perCallCap = toUnits(mandate.perCallCapUsdc);
    this.approvalAbove = toUnits(mandate.requiresApprovalAboveUsdc ?? mandate.perCallCapUsdc);
    this.allowed = new Set(mandate.allowedServices);
    this.agents = { [ROOT_AGENT]: account(toUnits(mandate.budgetUsdc)) };
    this.rows = [];
    this.byKey = new Map();
  }

  /** Rebuild a ledger from its JSON so a rerun with the same run id never pays twice. */
  static restore(mandate, json, opts = {}) {
    const ledger = new Ledger(mandate, { ...opts, runId: json.runId });
    ledger.agents = {};
    for (const [name, t] of Object.entries(json.totals)) {
      ledger.agents[name] = {
        allocated: toUnits(t.allocated),
        delegated: toUnits(t.delegated ?? "0"),
        reserved: 0n,
        spent: toUnits(t.spent),
      };
    }
    for (const row of json.rows) {
      const r = { ...row };
      // A reservation without an outcome means we crashed mid-payment. We cannot know whether the
      // facilitator settled it, so we never retry it automatically.
      if (r.status === "reserved") {
        r.status = "needs-reconciliation";
        r.reason = "interrupted during payment; check the payer account before retrying";
        ledger.agents[r.agent].spent += toUnits(r.priceUsdc);
      }
      ledger.rows.push(r);
      if (r.key) ledger.byKey.set(r.key, r);
    }
    if (json.onchain) ledger.onchain = json.onchain;
    return ledger;
  }

  available(agent) {
    const a = this.#agent(agent);
    return a.allocated - a.delegated - a.reserved - a.spent;
  }

  /** The venue agent hands a sub-budget to a sub-agent. Idempotent for the same amount. */
  allocate(from, to, amountUsdc) {
    const amount = toUnits(amountUsdc);
    if (amount <= 0n) throw new RangeError("Allocation must be positive");
    const existing = this.agents[to];
    if (existing) {
      if (existing.allocated === amount) return { ok: true, unchanged: true };
      throw new Error(`${to} already has a different allocation`);
    }
    if (amount > this.available(from)) {
      return { ok: false, reason: `allocation above ${from}'s available budget` };
    }
    this.#agent(from).delegated += amount;
    this.agents[to] = account(amount);
    this.#push({ type: "allocation", from, agent: to, priceUsdc: fromUnits(amount), status: "allocated" });
    return { ok: true };
  }

  /** Decide before anything is signed. Returns { ok, row } or { ok:false, reason, row }. */
  authorize({ agent, service, priceUsdc, key }) {
    if (!key) throw new Error("An idempotency key is required");
    const prior = this.byKey.get(key);
    if (prior && prior.status !== "failed" && prior.status !== "blocked") {
      return { ok: false, duplicate: true, reason: `already ${prior.status}`, row: prior };
    }
    const price = toUnits(priceUsdc);
    const base = { type: "payment", key, agent, service, priceUsdc: fromUnits(price) };

    let reason = null;
    let needsApproval = false;
    if (!this.agents[agent]) reason = `unknown agent ${agent}`;
    else if (!this.allowed.has(service)) reason = "service not allowed by the mandate";
    else if (price > this.perCallCap) { reason = "price above the per-call cap"; needsApproval = true; }
    else if (price > this.approvalAbove) { reason = "price above the approval threshold"; needsApproval = true; }
    else if (price > this.available(agent)) reason = "not enough budget left in this allocation";

    if (reason) {
      const row = this.#push({ ...base, status: "blocked", reason, needsApproval });
      return { ok: false, reason, row };
    }
    this.agents[agent].reserved += price;
    const row = this.#push({ ...base, status: "reserved" });
    return { ok: true, row };
  }

  settle(key, { tx = null, payer = null, note = null } = {}) {
    const row = this.#reserved(key);
    const a = this.agents[row.agent];
    const price = toUnits(row.priceUsdc);
    a.reserved -= price;
    a.spent += price;
    Object.assign(row, { status: "settled", tx, explorer: explorerUrl(this.network, tx), payer, settledAt: this.clock() });
    if (note) row.note = note;
    return row;
  }

  release(key, reason) {
    const row = this.#reserved(key);
    this.agents[row.agent].reserved -= toUnits(row.priceUsdc);
    Object.assign(row, { status: "failed", reason, releasedAt: this.clock() });
    return row;
  }

  /**
   * Record something the network did (an allowance draw, a refused draw) without touching the
   * off-chain budget math. Rows stay append-only like every other attempt.
   */
  note({ type, agent, service, priceUsdc, status, tx = null, reason = null, key = null }) {
    if (!type || !status) throw new Error("note() needs a type and a status");
    return this.#push({
      type, agent, service, priceUsdc: priceUsdc === undefined ? undefined : fromUnits(toUnits(priceUsdc)),
      status, tx, explorer: explorerUrl(this.network, tx), ...(reason && { reason }), ...(key && { key }),
    });
  }

  toJSON() {
    const totals = {};
    for (const [name, a] of Object.entries(this.agents)) {
      totals[name] = {
        allocated: fromUnits(a.allocated),
        delegated: fromUnits(a.delegated),
        reserved: fromUnits(a.reserved),
        spent: fromUnits(a.spent),
        available: fromUnits(a.allocated - a.delegated - a.reserved - a.spent),
      };
    }
    return {
      runId: this.runId,
      network: this.network,
      mandate: this.mandate,
      rows: this.rows,
      totals,
      ...(this.onchain && { onchain: this.onchain }),
      generatedAt: this.clock(),
    };
  }

  #agent(name) {
    const a = this.agents[name];
    if (!a) throw new Error(`Unknown agent ${name}`);
    return a;
  }

  #reserved(key) {
    const row = this.byKey.get(key);
    if (!row || row.status !== "reserved") throw new Error(`No open reservation for ${key}`);
    return row;
  }

  #push(row) {
    const r = { ...row, at: this.clock() };
    this.rows.push(r);
    if (r.key) this.byKey.set(r.key, r);
    return r;
  }
}

function account(allocated) {
  return { allocated, delegated: 0n, reserved: 0n, spent: 0n };
}

export function validateMandate(m) {
  const missing = ["id", "objective", "network", "budgetUsdc", "perCallCapUsdc", "allocations", "allowedServices"]
    .filter((k) => m?.[k] === undefined);
  if (missing.length) throw new Error(`Mandate is missing: ${missing.join(", ")}`);
  if (m.network !== "stellar:testnet") throw new Error("This MVP only runs on stellar:testnet");
  toUnits(m.budgetUsdc);
  toUnits(m.perCallCapUsdc);
  return true;
}
