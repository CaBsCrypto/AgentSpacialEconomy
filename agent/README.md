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

## Or run it in GitHub Actions (no setup, no faucet)

`node ci-run.mjs` does everything in one go: throwaway testnet accounts, USDC trustlines, a little testnet USDC bought with XLM on the testnet DEX, the services, the facilitator check and the loop. The workflow `.github/workflows/testnet-loop.yml` runs it on every push to `ci/testnet-run` (or "Run workflow" from the Actions tab once it is on `main`) and publishes `dist/state/*.json` plus the log to the `ci/testnet-results` branch.

Recorded run, 25 Oct 2026 23:22 UTC (Stellar testnet, x402.org facilitator):

| Step | Price | Result |
| --- | --- | --- |
| `venue-feed` | 0.01 USDC | settled · [tx da69…8da8](https://stellar.expert/explorer/testnet/tx/da696463d66a67f4c520930a9bf495b5a1752b65a540d8841ce82a5557bb8da8) |
| `screen-card` | 0.05 USDC | settled · [tx 3b65…b9d9](https://stellar.expert/explorer/testnet/tx/3b65769cb937948b2edaec3a5d260b4224ef7cc32520c3c557dfb939cb09b9d9) |
| `premium-render` | 0.25 USDC | blocked before signing — above the 0.10 per-call cap |

Fees were paid by the facilitator, not the agent; the service wallet received exactly 0.06 USDC.

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
| `config/networks.mjs` | Every network-specific value (passphrase, Horizon, RPC, friendbot, explorer, USDC issuer and SAC, facilitator) |
| `out/` | Per-run ledgers and results (git-ignored) |

Commit `dist/state/*.json` only after a real testnet run. Never commit `.env`.

## On-chain budget ceiling (SEP-41 allowance)

The operator's treasury holds the USDC and calls `approve(from = treasury, spender = venue agent, amount = mandate budget, live_until_ledger ≈ +24 h)` on the USDC Stellar Asset Contract. The venue agent starts with no USDC: before paying anything it draws exactly its allocations with `transfer_from`, then simulates a draw one cent above what is left — the network refuses it without anything being submitted. Two limits, two layers:

| Layer | Who enforces it | What it limits |
| --- | --- | --- |
| SEP-41 allowance | Stellar (the USDC contract) | total the agent can ever draw, and until when |
| `ledger.mjs` | the agent itself, before signing | per-call cap, approval threshold, allow-list, per-zone allocations |

`ci-run.mjs` does this by default with throwaway accounts (`onchain.mjs` holds the SDK calls; `lib/allowance.mjs` the tested rules). `run.mjs` switches it on when `TREASURY_PUBLIC_KEY` is set; without it, the agent pays from its own balance as before. Signatures: [token interface](https://developers.stellar.org/docs/tokens/token-interface).

## Network config

All testnet values live in `config/networks.mjs`, so the path to mainnet is one reviewed diff of that file instead of a search through the code. Mainnet is listed with its passphrase, Horizon, explorer, USDC and facilitator, but `enabled: false` makes every entry point refuse it; there is no public SDF mainnet RPC, so a provider must be chosen first. `STELLAR_NETWORK` selects the network (default `stellar:testnet`).
