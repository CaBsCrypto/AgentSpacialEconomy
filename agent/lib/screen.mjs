// The main-stage screen split into four sections. Each paid order (5 testnet USDC over x402, paid to
// the venue treasury) buys five minutes of one section. Orders in the same section play one after the
// other, so the screen rotates. Pure helpers only (no network): the rules are unit-tested anywhere.

export const QUADRANTS = ["A", "B", "C", "D"]; // top-left, top-right, bottom-left, bottom-right
export const SLOT_MS = 300000;

/** "b" → "B"; empty → null (any free section); anything else is refused before payment. */
export function parseQuadrant(value) {
  if (value === undefined || value === null) return null;
  const q = String(value).trim().toUpperCase();
  if (!q) return null;
  if (!QUADRANTS.includes(q)) throw new Error(`Unknown screen section ${value}. Use one of ${QUADRANTS.join(", ")}.`);
  return q;
}

const endOf = (schedule, quadrant) =>
  schedule.filter((o) => o.quadrant === quadrant).reduce((end, o) => Math.max(end, o.end), 0);

/**
 * Append one paid order. It starts at payment time if its section is free, otherwise right after the
 * last order in that section. Without a chosen section it takes the one that frees up first (ties: A
 * first). Returns a new array; earlier orders are never changed.
 */
export function scheduleOrder(schedule, { id, quadrant = null, paidAt, slotMs = SLOT_MS, ...rest }) {
  if (!id) throw new Error("order id is required");
  if (schedule.some((o) => o.id === id)) throw new Error(`order ${id} is already scheduled`);
  if (!Number.isSafeInteger(paidAt)) throw new Error("paidAt must be a timestamp in milliseconds");
  const q = quadrant ?? QUADRANTS.reduce((best, c) =>
    Math.max(endOf(schedule, c), paidAt) < Math.max(endOf(schedule, best), paidAt) ? c : best, QUADRANTS[0]);
  if (!QUADRANTS.includes(q)) throw new Error(`Unknown screen section ${q}`);
  const start = Math.max(paidAt, endOf(schedule, q));
  return [...schedule, { ...rest, id, quadrant: q, paidAt, start, end: start + slotMs }];
}

/** For each section: the order playing at time t (or null), the next one, and the time left. */
export function screenState(schedule, t) {
  const out = {};
  for (const q of QUADRANTS) {
    const mine = schedule.filter((o) => o.quadrant === q).sort((a, b) => a.start - b.start);
    const current = mine.find((o) => o.start <= t && t < o.end) ?? null;
    const next = mine.find((o) => o.start >= (current ? current.end : t)) ?? null;
    out[q] = { current, next, remainingMs: current ? current.end - t : 0 };
  }
  return out;
}
