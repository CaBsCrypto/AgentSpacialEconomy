// What the paid services sell and for how much (testnet USDC).
// services.mjs prices its routes from this list; the agent reads it from GET /catalog,
// reserves the listed price in its ledger, then checks the 402 asks for no more before signing.
export const CATALOG = [
  {
    id: "venue-feed",
    method: "GET",
    path: "/venue-feed",
    priceUsdc: "0.01",
    description: "Venue schedule feed (public HackMeridian 2026 schedule)",
  },
  {
    id: "screen-card",
    method: "POST",
    path: "/screen-card",
    priceUsdc: "0.05",
    description: "A stage-screen card for one session",
  },
  {
    id: "premium-render",
    method: "POST",
    path: "/premium-render",
    priceUsdc: "0.25",
    description: "Animated high-resolution render (priced above the demo cap on purpose)",
  },
];

// Income, not spend: a sponsor pays this to the venue treasury (never to the service wallet).
// It is not in CATALOG, so the stage agent can never buy it with its own budget.
export const SPONSOR_SLOT = {
  id: "sponsor-slot",
  method: "POST",
  path: "/sponsor-slot",
  priceUsdc: "0.10",
  payee: "venue-treasury",
  description: "One sponsor line on the main-stage screen, paid to the venue treasury",
};

export function findService(catalog, id) {
  const s = catalog.find((c) => c.id === id);
  if (!s) throw new Error(`Service ${id} is not in the catalog`);
  return s;
}
