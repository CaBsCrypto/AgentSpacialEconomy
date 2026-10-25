# SPEC — the MVP for HackMeridian 2026

> Scope is this file. Anything not listed here goes to the **Backlog** at the bottom, not into the code.
> Derived from `THESIS.md`. If the thesis changes, update this file next.

## The demo path (the only flow that must work)

1. **Mandate.** The operator opens the dashboard and loads a mandate for the main stage: an objective ("show the live agenda and the next session on the stage screen"), a total budget in testnet USDC, a per-call cap and a list of allowed services.
2. **Delegation.** The **venue agent** allocates part of the budget to the **stage agent** (one sub-zone, one sub-budget).
3. **Paid call 1.** The stage agent buys the current schedule from `venue-feed` over x402 (≈ $0.01 testnet USDC).
4. **Paid call 2.** The stage agent buys a rendered screen card from `screen-card` over x402 (≈ $0.05 testnet USDC).
5. **Ledger.** The dashboard shows available / reserved / spent per agent and one row per payment with its testnet transaction hash.
6. **Visible result.** The stage screen inside the ONE16 twin shows the purchased card.
7. **The cap holds.** The agent tries a third call that would break the per-call cap or the allocation. It is refused **before anything is signed**, logged as `blocked`, and shown as "needs operator approval".

Everything else is decoration. If time runs short, protect steps 3, 5 and 7.

## Judges can test it (P1, after every P0)

Judges review asynchronously and use the product like beta testers. Give them one way to see a **live** testnet payment without our laptop:

- **Preferred:** host `services.mjs` and a rate-limited "Run on testnet" endpoint (server-held agent key, tiny allocation, one run per minute). The dashboard calls it and shows the new rows.
- **Minimum:** the committed real run, clearly labelled "recorded run", plus a README path a judge can follow in 5 minutes with their own testnet keys.

## Components

| Path | What it is | Notes |
| --- | --- | --- |
| `agent/package.json` | Separate Node package for the agent and services | Keeps the static frontend and its tests untouched. |
| `agent/services.mjs` | Express server selling two routes over x402 under `/paid` | `GET /paid/venue-feed`, `POST /paid/screen-card`. Fails closed: if the recipient is missing or invalid, every `/paid` route returns 503. |
| `agent/ledger.mjs` | Budget ledger and policy check | Pure functions, no network. Unit-tested. |
| `agent/run.mjs` | Venue agent → stage agent run | Deterministic plan for the demo. Writes state files. |
| `agent/mandates/main-stage.json` | The demo mandate | Objective, budget, caps, allowed services. |
| `agent/fixtures/schedule.json` | Data behind `venue-feed` | Public HackMeridian schedule only. |
| `dist/state/ledger.json`, `dist/state/stage.json` | Output of a real run | Committed after the final testnet run so the static site can show it. |
| `dist/dashboard.html` | Operator view | Mandate, allocations, ledger rows with explorer links, blocked attempt. |
| Stage screen in the twin | Reads `state/stage.json` | Falls back to the current default if the file is missing. |

## Payments

- Network: **`stellar:testnet` only.** USDC (SEP-41 SAC).
- Facilitator: start with the **x402.org testnet facilitator** (no API key, fees sponsored). Check `GET <facilitator>/supported` lists `stellar:testnet` before writing code. Fallback: OpenZeppelin Channels testnet (needs an API key).
- Packages: `@x402/express`, `@x402/core`, `@x402/stellar`, `@x402/fetch`, `@stellar/stellar-sdk`, `express`, `dotenv`.
- The payer runs **server-side** (Node). Browsers cannot sign Soroban auth entries through a normal wallet without extra glue, so the page never holds a key.
- Reference implementation: the `agentic-payments` skill in `stellar/stellar-dev-skill` (seller, buyer, testnet setup, the two USDC addresses).

## Ledger rules

- Per agent: `allocated`, `reserved`, `spent`, `available = allocated − reserved − spent`.
- Before a call: check the service is allowed, `price ≤ perCallCap` and `price ≤ available`. Otherwise record `blocked` and do **not** sign.
- Reserve → pay → on success move to `spent` with the transaction hash; on failure release the reservation.
- Every call carries an idempotency key `(runId, step)`. A retry with the same key never pays twice.
- The ledger is append-only JSON. Nothing is deleted.

## Data contracts

```jsonc
// agent/mandates/main-stage.json
{
  "id": "main-stage-hackmeridian",
  "objective": "Show the live agenda and the next session on the main stage screen",
  "network": "stellar:testnet",
  "budgetUsdc": "0.50",
  "perCallCapUsdc": "0.10",
  "allocations": { "stage-agent": "0.20" },
  "allowedServices": ["venue-feed", "screen-card"],
  "requiresApprovalAboveUsdc": "0.10"
}
```

```jsonc
// dist/state/ledger.json (one row per attempt)
{
  "runId": "2026-10-26T08:10:00Z",
  "rows": [
    { "agent": "stage-agent", "service": "venue-feed", "priceUsdc": "0.01",
      "status": "settled", "tx": "<hash>", "explorer": "https://stellar.expert/explorer/testnet/tx/<hash>" },
    { "agent": "stage-agent", "service": "screen-card", "priceUsdc": "0.25",
      "status": "blocked", "reason": "price above per-call cap" }
  ],
  "totals": { "stage-agent": { "allocated": "0.20", "reserved": "0", "spent": "0.06" } }
}
```

## Environment

See `.env.example`. Secrets live only in `.env`, which is git-ignored. Never paste an `S…` key into an issue, a PR, a commit or a chat.

## Done when

- [ ] One command runs the full loop on testnet and prints two settled transaction hashes.
- [ ] The over-cap attempt is refused before signing and appears as `blocked`.
- [ ] Re-running with the same run id does not pay twice.
- [ ] `dist/dashboard.html` shows mandate, allocations and ledger with working explorer links.
- [ ] The stage screen in the twin shows the purchased card; it falls back cleanly when the state file is missing.
- [ ] `npm test` passes for the existing frontend, plus new ledger tests in `agent/`.
- [ ] README explains in its first lines what this is, and how to run the loop.
- [ ] No secrets in git history.

## Backlog (logged, not built this weekend)

- On-chain cap: OpenZeppelin smart account with a spending-limit policy for the agent wallet.
- LLM planner that proposes the plan from the objective (still bounded by the ledger).
- More zones and agents (sponsor stands, check-in, photo lounge).
- Revenue side: charging third parties for screen or AR placement.
- Stellar Passport opt-in profiles for visitors.
- MPP charge or session mode for high-frequency calls.
- Verified physical AR on a real Android device; image or geo anchors.
