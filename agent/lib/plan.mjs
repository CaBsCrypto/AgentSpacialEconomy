// Deterministic choices for the demo path. An LLM may propose later; these functions decide now.

/** The next session at or after `now`; if the event is over, the last one, so the demo still renders. */
export function nextSession(items, now = new Date().toISOString()) {
  const sessions = (items ?? [])
    .filter((i) => i && i.title && i.start)
    .sort((a, b) => a.start.localeCompare(b.start));
  if (!sessions.length) return null;
  const t = Date.parse(now);
  return sessions.find((s) => Date.parse(s.start) >= t) ?? sessions[sessions.length - 1];
}

export function lisbonTime(iso) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
