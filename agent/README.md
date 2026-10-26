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

Run 2, 26 Oct 2026 01:23 UTC (Stellar testnet, x402.org facilitator, allowance mode). The site now shows run 3, which repeats these steps and adds the sponsor income (below):

| Step | Amount | Result |
| --- | --- | --- |
| treasury `approve` → venue agent | 0.50 USDC, ~24 h | settled · [3add5054…](https://stellar.expert/explorer/testnet/tx/3add505423f1dbf84cba31ea2c2f607e6e0d40b75a538de81189d22f50c283fa) |
| venue agent `transfer_from` (its allocations) | 0.20 USDC | settled · [914076fb…](https://stellar.expert/explorer/testnet/tx/914076fbe1afa6d845ec7d17eb6d875144c91c8c00bf1ce425f2fbcfa0d7f083) |
| venue agent draw above what is left | 0.31 USDC | refused by the network (simulation) |
| `venue-feed` | 0.01 USDC | settled · [bb6d3dfb…](https://stellar.expert/explorer/testnet/tx/bb6d3dfbedcf70abf69b5b9cf1a4846604bc08bfcc0e8dcd4cdfb08c25dde2fc) |
| `screen-card` | 0.05 USDC | settled · [7d3e29ff…](https://stellar.expert/explorer/testnet/tx/7d3e29ff665156095f1443838e0cf1ba0164dfbc536ae24f9546ec1f3ee7d3b0) |
| `premium-render` | 0.25 USDC | blocked before signing — above the 0.10 per-call cap |

x402 fees were paid by the facilitator; the service wallet received exactly 0.06 USDC and the agent kept 0.14.

### Income: a sponsor refills the agent's budget

With `TREASURY_PUBLIC_KEY` set, `services.mjs` also sells `POST /paid/sponsor-slot` (0.10 testnet USDC), paid **to the treasury**. After the loop, with the services still running:

```bash
SPONSOR_SECRET_KEY=S... node sponsor.mjs   # a separate testnet wallet with testnet USDC; never commit it
```

`sponsor.mjs` checks the 402 before signing (price ≤ `--max`, testnet, payTo = treasury), appends an `income` row to `dist/state/ledger.json` (idempotent per run) and a "Presented by" line to `dist/state/stage.json`. In allowance mode `ci-run.mjs` does this with a throwaway sponsor and then has the treasury re-approve the agent what is left plus the income, reading the allowance back. Run 3 (26 Oct 03:21 UTC): sponsor → treasury 0.10 USDC [821f7b12…](https://stellar.expert/explorer/testnet/tx/821f7b12035a34dc4bae796e91404a4358cade7626c36d0d18aeb9eda441b5e3), re-approve 0.30 → 0.40 USDC [d954f245…](https://stellar.expert/explorer/testnet/tx/d954f245d335089680cd095e07912efb4c9eab5564862bb4a48b74d49ecc7bc9).

### Paid screen time: an ad order committed on Soroban

`services.mjs` also sells `POST /paid/ad-slot`: the pilot offer `main-stage-test-5m`, 5 testnet USDC for 5 minutes of `main_stage_screen`, paid **to the treasury**.

```bash
ADVERTISER_SECRET_KEY=S... node advertiser.mjs --run-id <id>   # a separate testnet wallet with testnet USDC; never commit it
node ads-ci.mjs                                                # or everything with throwaway accounts (needs internet)
```

`advertiser.mjs` checks the 402 before signing (price ≤ `--max`, testnet, payTo = treasury), raises the x402 client's per-payment cap to exactly that maximum, and writes `dist/state/ads.json`. `ads-ci.mjs` then has the treasury deploy an AdsRegistry instance from the WASM already on testnet (`registry.mjs`), commit the order with the settlement hash as `payment` (`lib/ads.mjs` builds and checks the commitment) and read it back with `get`. Nothing is delivered, so the order stays `Queued`. In GitHub Actions: push to `ci/ads-run` (workflow **Paid screen time (testnet)**); results land on `ci/ads-results`.

### Isolated four-section screen experiment

The original `POST /paid/ad-slot` and `AD_SLOT` remain whole-screen offers. Explicit `advertiser.mjs --section A|B|C|D` uses the separate `POST /paid/ad-section` offer `main-stage-section-test-5m`: exactly 5 Testnet USDC for 300000 ms of one section. Invalid section requests are rejected before the payment gate. This experiment does not enable the passkey pilot or credit delivered passes.

```bash
node advertiser.mjs --run-id <unique-id> --section B --out out/order-b.json
node screen-ci.mjs --out out/<fresh-directory>
node verify-screen.mjs --input out/<fresh-directory>/screen.json --out out/<fresh-directory>/audit.json
# Audit the original PR recording without changing its historical terms:
node verify-screen.mjs --input ../dist/state/screen.json --out out/historical-audit.json --legacy-offer
```

The paid runner requires committed, clean source and claims a new output directory atomically. It makes at most six purchases, for at most 30 Testnet USDC. A journal keyed by run ID prevents a different `--out` from authorizing another attempt. Unknown outcomes stop the run for read-only reconciliation; never delete the journal to retry. Keys remain in process memory.

Success requires six unique exact payment receipts, a 30-USDC treasury balance change, the expected registry WASM and six complete `Queued` commitments. `verify-screen.mjs` independently rereads all payments, the deployment, six commits and each full contract record. It never signs or submits. New results are written under `agent/out/`, never over the recorded fixture. CI is manual and uploads run-specific artifacts, including explicit partial-failure diagnostics; it does not push branches.

The stage preview is opt-in at `/one16?sections`. It is a labelled recording, isolated from publishing and delivery acknowledgements. The dashboard shows its separate treasury and the date of its saved verification; playback never earns income or proves delivery.

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
