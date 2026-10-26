# SPEC — the MVP for HackMeridian 2026

> Scope is this file. Anything not listed here goes to the **Backlog** at the bottom, not into the code.
> Derived from `THESIS.md`. If the thesis changes, update this file next.

## The demo path (the only flow that must work)

1. **Mandate.** The operator opens the dashboard and loads a mandate for the main stage: an objective ("show the live agenda and the next session on the stage screen"), a total budget in testnet USDC, a per-call cap and a list of allowed services.
2. **Treasury ceiling and delegation.** The operator approves a 0.50 USDC SEP-41 allowance with a ledger expiry. The venue agent draws 0.20 USDC; a further 0.31 USDC draw is refused during network simulation without submission. The **venue agent** allocates part of the budget to the **stage agent** (one sub-zone, one sub-budget).
3. **Paid call 1.** The stage agent buys the schedule fixture from `venue-feed` over x402 (≈ $0.01 testnet USDC).
4. **Paid call 2.** The stage agent buys a rendered screen card from `screen-card` over x402 (≈ $0.05 testnet USDC).
5. **Ledger.** The dashboard shows available / reserved / spent per agent and one row per payment with its testnet transaction hash.
6. **Visible result.** The stage screen inside the ONE16 twin shows the purchased card.
7. **The cap holds.** The agent tries a third call that would break the per-call cap or the allocation. It is refused **before anything is signed**, logged as `blocked`, and shown as "needs operator approval".

Everything else is decoration. If time runs short, protect steps 3, 5 and 7.

## Extension built on 26 Oct (P2, after every P0 and P1)

8. **Income.** A sponsor buys one line on the stage screen: `POST /paid/sponsor-slot`, 0.10 testnet USDC over x402, paid to the **venue treasury**. The sponsor checks the 402 before signing (price, testnet, payTo = treasury). The payment is an `income` row in the ledger; it never changes an agent's budget.
9. **Recharge.** The treasury re-approves the venue agent what is left on the allowance plus the income (SEP-41 `approve` sets, it does not add) and reads it back. Recorded in run 3 (0.30 → 0.40 USDC).
10. **Credit pool and live reads.** The dashboard shows the allowance as credits (1 credit = `mandate.creditUsdc`, default 0.01 USDC) and checks every recorded transaction and the treasury and agent balances on Horizon testnet when it loads, falling back to the recorded values.
11. **Paid screen time on Soroban.** An advertiser buys the pilot offer from `feature/ads-3d-ar-x402` (`main-stage-test-5m`: 5 testnet USDC for 5 minutes of `main_stage_screen`): `POST /paid/ad-slot` over x402, paid to the **venue treasury**, after the same 402 preflight as the sponsor. The treasury deploys an AdsRegistry instance from the WASM already on testnet, commits the order with the settlement hash as `payment`, and reads it back with `get` (`Queued`, nothing delivered). The registry never moves funds; no delivery is claimed. Separate run, separate state file (`dist/state/ads.json`), shown on the dashboard.
12. **Isolated main-stage screen experiment.** Explicit `/paid/ad-section` buys 300000 ms of one section A–D for 5 Testnet USDC; `/paid/ad-slot` and the passkey pilot retain their original offers. Six ephemeral advertisers pay at most 30 Testnet USDC. Fresh receipts and complete registry commitments are independently verified, with failed/ambiguous outcomes stopping purchases. `/one16?sections` and the separate dashboard block replay the recording without delivery acknowledgements or budget credits. New evidence never overwrites the historical fixture automatically. Visitor purchases of sections remain unimplemented.

## Judges can test it (P1, after every P0)

Judges review asynchronously and use the product like beta testers. Give them the recorded real testnet evidence and a reproducible path to fresh payments without our laptop:

- **Future work:** host a rate-limited testnet run endpoint. The current static dashboard does not start payments.
- **Delivered path:** the committed real run, clearly labelled "recorded run", plus the README setup and the **Testnet loop** GitHub Actions workflow. Fresh results go to `ci/testnet-results` and require a reviewed update before they appear on the public site.

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
| Stage screen in the twin | Reads `state/stage.json` | Falls back to the current default if the file is missing. Shows the sponsor line only for a settled sponsor payment. |
| `agent/sponsor.mjs`, `agent/lib/income.mjs` | Income side (extension) | Sponsor payment to the treasury, recharge rules. Unit-tested. |
| `dist/credits.mjs`, `dist/live-chain.mjs` | Dashboard helpers (extension) | Credit math and read-only Horizon checks. Unit-tested. |
| `agent/advertiser.mjs`, `agent/registry.mjs`, `agent/lib/ads.mjs`, `agent/ads-ci.mjs` | Paid screen time (extension) | Ad payment to the treasury, AdsRegistry deploy/commit/get, commitment rules. Unit-tested; run by the **Paid screen time (testnet)** workflow. |

## Payments

- Treasury draw ceiling: SEP-41 `approve` / `transfer_from` on the USDC SAC; the allowance decreases when drawn and has a ledger expiry. This bounds access to treasury funds, while the agent ledger separately enforces per-call policy. Reference: [official token interface](https://developers.stellar.org/docs/tokens/token-interface).
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
  "allowedServices": ["venue-feed", "screen-card", "premium-render"],
  "requiresApprovalAboveUsdc": "0.10"
}
// premium-render (0.25) is allowed on purpose: the per-call cap, not the allow-list, is what refuses it in the demo.
```

```jsonc
// dist/state/ledger.json (one row per attempt)
{
  "runId": "2026-10-26T08:10:00Z",
  "rows": [
    { "agent": "stage-agent", "service": "venue-feed", "priceUsdc": "0.01",
      "status": "settled", "tx": "<hash>", "explorer": "https://stellar.expert/explorer/testnet/tx/<hash>" },
    { "agent": "stage-agent", "service": "screen-card", "priceUsdc": "0.05",
      "status": "settled", "tx": "<hash>", "explorer": "https://stellar.expert/explorer/testnet/tx/<hash>" },
    { "agent": "stage-agent", "service": "premium-render", "priceUsdc": "0.25",
      "status": "blocked", "reason": "price above per-call cap" }
  ],
  "totals": { "stage-agent": { "allocated": "0.20", "reserved": "0", "spent": "0.06" } }
}
```

## Environment

See `.env.example`. Secrets live only in `.env`, which is git-ignored. Never paste an `S…` key into an issue, a PR, a commit or a chat.

## Done when

- [ ] The recorded run shows the 0.50 USDC allowance, 0.20 USDC draw and rejected 0.31 USDC simulation, with settled transaction links for approve and draw.
- [ ] One command runs the full loop on testnet and prints two settled transaction hashes.
- [ ] The over-cap attempt is refused before signing and appears as `blocked`.
- [ ] Re-running with the same run id does not pay twice.
- [ ] `dist/dashboard.html` shows mandate, allocations and ledger with working explorer links.
- [ ] The stage screen in the twin shows the purchased card; it falls back cleanly when the state file is missing.
- [ ] `npm test` passes for the existing frontend, plus new ledger tests in `agent/`.
- [ ] README explains in its first lines what this is, and how to run the loop.
- [ ] No secrets in git history.

## Venue visual revision authorized on 26 Oct

The owner approved the separate codex/render-textures-ui revision from sponsor run 3 (298fefa). Implement the thirteen-video evidence register in docs/render-review-2026-10-26/: eight double-sided exhibition positions, games and giant keyboard, arrival seating, check-in graphics, skills board, Energy Corner and photo booth, Content Hub recording set, stage branding, and the 8-by-3 photo lounge backdrop. Add shared exportable surface textures and polish the existing responsive viewer controls. Preserve the testnet agent loop, sponsor card, Passport, wallet, seven interior steps, shortened corridor, and removed exterior sections. New informational review IDs start at 21; physical dimensions remain estimates. Games and the recording set are visual reconstructions. The source videos stay outside Git.

## Backlog (logged, not built this weekend)

- Per-day smart-account spending policies (OpenZeppelin policies or Nido session keys), beyond the implemented SEP-41 treasury allowance.
- LLM planner that proposes the plan from the objective (still bounded by the ledger).
- More zones and agents (sponsor stands, check-in, photo lounge).
- Revenue side beyond the sponsor slot: AR placement, pricing, several sponsors, a real sponsor-facing flow (the first sponsor slot is built, see Extension).
- Stellar Passport opt-in profiles for visitors.
- MPP charge or session mode for high-frequency calls.
- Verified physical AR on a real Android device; image or geo anchors.

## Authorized advertising extension — PRD v0.2

The revenue-side backlog entry is superseded for this feature branch by docs/ads/PRD-v0.2.md and docs/ads/README.md. Implement the advertiser journey on Stellar Testnet only, with separate payment, queue, audit, scheduling, delivery and remedy states. PostgreSQL and an outbox are the source of truth. New purchases remain disabled until all commercial configuration and wallet/facilitator integration gates pass. The legacy recorded agent run is not evidence for this new flow.

Default main-stage content: the user-supplied HackMeridian Day 1 presentation, converted from GIF to a 10-second silent looping MP4. A paid audited scheduled advertisement temporarily replaces the loop; payment alone never publishes it.

Approved 26 Oct main-stage pilot: implement the owner-approved QR/NFC, five measured passes, suggested scheduling, fulfillment recovery and PM/QA gates in docs/ads/main-stage-pilot.md. This supersedes the former incomplete-pilot freeze only within feature/ads-3d-ar-x402; preserve the recorded demo, wallet identity and main/dashboard.

## Second venue review authorized on 26 Oct

Continue codex/render-textures-ui from da9b680. Replace lower lounge box seating with rounded padded components, reserve check-in identity areas, add five labeled skills sheets including BACK END, wall-mount the games display with parallel giant keyboard and inward-facing sofa, reconstruct the eighteen-button arcade, and correct all eight white-table horizontal wordmarks and stand gaps. Reduce Content Hub to two bodies (6.6 m), synchronize its entrance/map/collisions, and add four practical fixtures plus two soft shadowless local lights. Separate the football and net for repeatable local tap/accessible-button interaction with reduced motion. Preserve all IDs and approved stage/photo booth designs; label reference 19 Zona de fotos · junto al escenario. Include the owner’s attached food-area screenshot by replacing its centered blocked view with a clear oblique buffet view. Integrate after per-section comparisons, run all existing suites and regressions, verify four agreed viewports on GPU within 5 MiB compressed, and publish one final mobile preview.


## Onboarding and furniture follow-up authorized on 26 Oct

Move the wallet totem near map reference 12 and guide visitors from the entrance spawn to its clear approach with floor-following luminous dots, including all seven steps and a matching map path. End guidance at the existing Testnet wallet/test-USDC flow. Remove the black curtain and its collision. Review every chair/table, especially central section 13, to remove deformed chair geometry and interpenetration; widen branded dividers while preserving the central passage. Move the Palta Labs avocado display to the DeFindex/Soroswap table and the physical Passport display to the Stellar Passport table, with a substantially larger, proportionate book. Synchronize semantic zones, views, minimap, interaction proximity, obstacles and accessible actions. Preserve approved graphics and existing wallet/Passport behavior, validate per-section on GPU and deploy the revised preview after review.


## Final guided visitor delivery authorized on 26 Oct

Continue codex/render-textures-ui from 349175e. Advance the USDC kiosk to Three (2.6,0,-5.6), beside the check-in bar, with approach (2.6,-4.3); synchronize physical/collision/zone/map data. Reduce only the Palta pedestal by 12.5%, enlarge the animated fruit by 8%, and replace all eight vertical project headers with horizontal headings while preserving approved desk wordmarks. Remove public review numbers and legends from ground, maps, overview, static and accessible content while preserving functional navigation and compatibility IDs. Guide entry to the kiosk, then unlock a shared companies route and two labeled branches only after a kiosk-origin Continue with verified deployed Testnet wallet and positive test USDC balance. Complete Passport on a loaded first frame and Palta on explicit visible interaction, in either order; dim visited branches and finish after both. Preserve visual progress per tab/wallet/configuration across rebuild and AR return, with a guide-only reset that never funds or changes the wallet. Verify all existing suites, regressions, four agreed viewports and real GPU within the venue model 5 MiB compressed budget; publish one final mobile preview with evidence.

## Landing cleanup authorized on 26 Oct

Remove the Spatial Agents submission-proof card and its dashboard/GitHub buttons from the public landing hero, as explicitly requested by the owner. Keep the Agentic Reality Space landing, ONE16 entry and the directly accessible dashboard.
