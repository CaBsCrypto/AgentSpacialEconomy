// What the four-section main-stage screen shows at a given moment, from state/screen.json
// (written by agent/screen-ci.mjs). Used by the twin's stage screen and by the dashboard.
// A recorded run lies in the past, so by default the recorded rotation is replayed on a loop and
// marked as such; it never pretends to be live.

export const SECTIONS = ["A", "B", "C", "D"];
const HASH = /^[0-9a-f]{64}$/i;

/** True for a recorded testnet screen run with at least one well-formed paid order. */
export function validScreen(state) {
  return state?.network === "stellar:testnet" && Array.isArray(state.orders) && state.orders.length > 0 &&
    state.orders.every((o) => SECTIONS.includes(o.quadrant) && Number.isFinite(o.start) && Number.isFinite(o.end) && o.end > o.start && HASH.test(String(o.tx ?? "")));
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

/**
 * { mode: "live" | "upcoming" | "replay", t, sections }. After the recorded window ends, the window
 * is replayed on a loop (mode "replay") so the rotation stays visible.
 */
export function screenNow(state, now = Date.now(), { replay = true } = {}) {
  if (!validScreen(state)) return null;
  const first = Math.min(...state.orders.map((o) => o.start));
  const last = Math.max(...state.orders.map((o) => o.end));
  let t = now;
  let mode = now < first ? "upcoming" : "live";
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
