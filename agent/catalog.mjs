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

export function findService(catalog, id) {
  const s = catalog.find((c) => c.id === id);
  if (!s) throw new Error(`Service ${id} is not in the catalog`);
  return s;
}
