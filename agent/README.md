# agent/ — the paid loop on Stellar testnet

Venue agent → stage agent → paid services over **x402** → budget ledger → stage screen in the ONE16 twin.
Testnet only. Pattern from the `agentic-payments` skill in [stellar/stellar-dev-skill](https://github.com/stellar/stellar-dev-skill).

## Run it (about 5 minutes)

```bash
cd agent
npm install
npm run setup:testnet      # creates 2 testnet accounts + USDC trustlines, writes ../.env (never prints secrets)
#   then, by hand: https://faucet.circle.com → Stellar testnet → USDC to the AGENT wallet it printed
npm run check:facilitator  # confirms the facilitator lists stellar:testnet
npm run services           # terminal 1: paid routes on http://localhost:3001
npm run loop               # terminal 2: the demo run
```

Without keys or USDC yet: `npm run loop:dry` walks the whole plan and stops before signing anything.

## What the run does

1. `venue-agent` gives `stage-agent` its allocation from the mandate (`mandates/main-stage.json`).
2. `stage-agent` buys `venue-feed` (0.01 USDC) and picks the next session.
3. `stage-agent` buys `screen-card` (0.05 USDC) for that session.
4. `stage-agent` tries `premium-render` (0.25 USDC). The ledger refuses it before signing: above the per-call cap, needs operator approval.
5. Writes `../dist/state/ledger.json` and `../dist/state/stage.json`. The dashboard (`dist/dashboard.html`) and the stage screen in the twin read them.

Before each payment the agent reads the service's `402 Payment Required` and refuses to sign if it asks for more than the price it reserved.

## Rules the ledger enforces (see `ledger.mjs`, tested in `test/`)

- Service must be in the mandate; price within the per-call cap and the approval threshold; enough budget left in the allocation.
- Reserve → settle with the transaction hash, or release on failure. Nothing is deleted.
- Idempotency: `npm run loop -- --run-id <same id>` reuses settled steps and never pays twice. An interrupted payment is marked `needs-reconciliation` and is not retried automatically.

## Files

| File | Role |
| --- | --- |
| `services.mjs` | Express + `@x402/express`, paid routes under `/paid`, fails closed (503) without a valid recipient |
| `run.mjs` | The agents and the plan; payer via `@x402/fetch` + `@x402/stellar` (server-side only) |
| `ledger.mjs` | Budget rules, pure logic |
| `catalog.mjs` | Services and prices |
| `lib/` | USDC math (7 decimals, BigInt), x402 header parsing, planning helpers |
| `setup-testnet.mjs`, `check-facilitator.mjs` | One-time setup and a facilitator check |
| `out/` | Per-run ledgers and results (git-ignored) |

Commit `dist/state/*.json` only after a real testnet run. Never commit `.env`.
