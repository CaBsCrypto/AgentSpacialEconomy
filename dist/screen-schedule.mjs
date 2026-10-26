// Read-only recorded rotation. This module never accounts for payments or delivery.
export const SECTIONS = Object.freeze(["A", "B", "C", "D"]);
const HASH = /^[0-9a-f]{64}$/i;

export function isSectionsPreview(search = "") {
  return new URLSearchParams(search).has("sections");
}

/** Reject ambiguous recordings before showing them as a schedule. */
export function validScreen(state) {
  if (state?.network !== "stellar:testnet" || !Array.isArray(state.orders) || !state.orders.length) return false;
  const ids = new Set(), payments = new Set();
  for (const order of state.orders) {
    if (!order || typeof order.id !== "string" || !order.id.trim() || ids.has(order.id) ||
        !SECTIONS.includes(order.quadrant) ||
        !Number.isSafeInteger(order.start) || !Number.isSafeInteger(order.end) ||
        order.start <= 0 || order.end <= order.start || !HASH.test(order.tx ?? "")) return false;
    const payment = order.tx.toLowerCase();
    if (payments.has(payment)) return false;
    ids.add(order.id); payments.add(payment);
  }
  for (const section of SECTIONS) {
    const orders = state.orders.filter(order => order.quadrant === section).sort((a, b) => a.start - b.start);
    if (orders.some((order, index) => index > 0 && orders[index - 1].end > order.start)) return false;
  }
  return true;
}

export function sectionsAt(orders, t) {
  const out = {};
  for (const q of SECTIONS) {
    const mine = orders.filter((o) => o.quadrant === q).sort((a, b) => a.start - b.start);
    const current = mine.find((o) => o.start <= t && t < o.end) ?? null;
    const next = mine.find((o) => o.start >= (current ? current.end : t)) ?? null;
    out[q] = { current, next, remainingMs: current ? current.end - t : 0 };
  }
  return out;
}

/** "live" means the recording's scheduled window, never attested delivery. */
export function screenNow(state, now = Date.now(), { replay = true } = {}) {
  if (!validScreen(state) || !Number.isFinite(now)) return null;
  const first = Math.min(...state.orders.map((o) => o.start));
  const last = Math.max(...state.orders.map((o) => o.end));
  let t = now;
  let mode = now < first ? "upcoming" : now < last ? "live" : "finished";
  if (now >= last && replay) {
    t = first + ((now - first) % (last - first));
    mode = "replay";
  }
  return { mode, t, first, last, sections: sectionsAt(state.orders, t) };
}

/** "4:05" for 245000 ms. */
export function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
