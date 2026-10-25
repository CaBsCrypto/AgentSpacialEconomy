# ISSUES — SPEC tasks ready for GitHub

Generated from `docs/issues.json`. Create them with `node scripts/create-issues.mjs --create` (needs `gh` logged in).

| # | Priority | Title | Labels |
| --- | --- | --- | --- |
| 1 | P0 | Testnet accounts, trustlines and USDC for agent and services | payments, setup |
| 2 | P0 | Paid services: venue-feed and screen-card over x402 | payments |
| 3 | P0 | Budget ledger with per-call cap, allocations and idempotency | payments, tests |
| 4 | P0 | Agent run: venue agent → stage agent → two paid calls + one blocked | payments, agent |
| 5 | P0 | Stage screen in the ONE16 twin shows the purchased card | venue |
| 6 | P0 | Operator dashboard: mandate, budget bars, ledger with explorer links | dashboard |
| 7 | P0 | Deploy the static site with a committed real run | deploy |
| 8 | P1 | README: one-liner first, how it works, how to run the loop | story |
| 9 | P1 | Landing hero with the one-liner | story, design |
| 10 | P1 | Demo video (3 minutes) + backup recording | story |
| 11 | P1 | Pitch deck | story |
| 12 | P1 | Submission form answers | story |
| 13 | P2 | Stretch: on-chain cap with an OpenZeppelin spending-limit policy | payments |
| 14 | P2 | Stretch: LLM planner proposes the plan from the objective | agent |

## 1. Testnet accounts, trustlines and USDC for agent and services

Labels: P0, payments, setup

Owner: A (faucet step: C).

- Create two testnet accounts: venue agent (payer) and services (recipient).
- Fund both with friendbot XLM; add a USDC trustline to both.
- Get testnet USDC for the agent wallet from the Circle faucet (web captcha, manual).
- Put the values in `.env` only (see `.env.example`).
- Confirm `GET $FACILITATOR_URL/supported` lists `stellar:testnet`.

Reference: `agentic-payments` skill, testnet setup and the two USDC addresses.

**Done when** both accounts show a USDC balance line and the facilitator check passes.

## 2. Paid services: venue-feed and screen-card over x402

Labels: P0, payments

Owner: A.

- `agent/services.mjs`: Express server, x402 middleware mounted under `/paid`.
- `GET /paid/venue-feed` (~0.01 USDC) returns `agent/fixtures/schedule.json`.
- `POST /paid/screen-card` (~0.05 USDC) returns a card `{title, subtitle, time, theme}` built from the posted session.
- Fail closed: missing or invalid `SERVICE_RECIPIENT` → every `/paid` route returns 503.

**Done when** an unpaid request gets 402 and a paid request from the buyer client gets 200 with a settled testnet tx hash.

## 3. Budget ledger with per-call cap, allocations and idempotency

Labels: P0, payments, tests

Owner: A.

- `agent/ledger.mjs`: pure functions, no network.
- Per agent: allocated, reserved, spent, available.
- Check before pay: service allowed, price ≤ per-call cap, price ≤ available. Otherwise `blocked`, no signature.
- Reserve → settle (with tx hash) or release on failure.
- Idempotency key `(runId, step)`: a retry never pays twice.
- Append-only JSON output.

**Done when** unit tests cover allow, block by cap, block by allocation, release on failure and idempotent retry.

## 4. Agent run: venue agent → stage agent → two paid calls + one blocked

Labels: P0, payments, agent

Owner: A.

- `agent/run.mjs --mandate agent/mandates/main-stage.json`.
- Venue agent allocates to stage agent; stage agent buys venue-feed, then screen-card.
- Third attempt above the cap is refused and logged.
- Writes `dist/state/ledger.json` and `dist/state/stage.json`.
- Deterministic plan for the demo.

**Done when** one command prints two settled tx hashes and one blocked row, and both state files are written.

## 5. Stage screen in the ONE16 twin shows the purchased card

Labels: P0, venue

Owner: B.

- On load, fetch `state/stage.json`; render the card on the stage screen surface.
- If the file is missing or invalid, keep today's default and log once.
- Add a test for the fallback.

**Done when** the committed state file appears on the stage screen locally and on the deployed site.

## 6. Operator dashboard: mandate, budget bars, ledger with explorer links

Labels: P0, dashboard

Owner: B.

- `dist/dashboard.html` reads `state/ledger.json` and the mandate.
- Shows objective, total budget, per-call cap; one bar per agent (allocated / spent / available); one row per attempt with status and a stellar.expert testnet link.
- Blocked row rendered as a card with the reason. Labels, not color alone.
- Uses DESIGN.md tokens.

**Done when** a stranger can tell what was paid, for what and what was refused, in under 10 seconds.

## 7. Deploy the static site with a committed real run

Labels: P0, deploy

Owner: B.

- After the final testnet run, commit `dist/state/*.json`.
- Deploy `dist/` (current host) and check the twin and dashboard on a phone.
- Link the dashboard from the twin and the README.

**Done when** the public URL shows the real run and every explorer link resolves.

## 8. README: one-liner first, how it works, how to run the loop

Labels: P1, story

Owner: C.

- Tagline under the title = the THESIS one-liner.
- Short 'How it works' (mandate → agents → x402 → ledger → screen) with links to THESIS, SPEC, DESIGN, AGENTS.
- Run instructions for `agent/`.
- Update the implementation status table honestly.

**Done when** a judge can run the loop from the README alone.

## 9. Landing hero with the one-liner

Labels: P1, story, design

Owner: C (+B).

- Top of the dashboard or a small landing section: name, one-liner, 'See the run' and 'Walk the venue' buttons.
- Same words as README and deck.

**Done when** the hero, README line and deck slide 1 match exactly.

## 10. Demo video (3 minutes) + backup recording

Labels: P1, story

Owner: C.

- Follow DEMO.md: problem 0:30, live demo 1:30, how 0:30, next 0:30.
- Real testnet run, real tx hashes on screen.
- Record a full backup run at 09:00 regardless.

**Done when** the video is uploaded and its link works logged out.

## 11. Pitch deck

Labels: P1, story

Owner: C.

- Outline in DEMO.md. Real screenshots, one tx hash, the rubric-facing slide on Stellar integration.
- Export to PDF.

**Done when** the deck opens from the submission link.

## 12. Submission form answers

Labels: P1, story

Owner: C.

- Name, one-liner, path/track (Genesis · Stellar Composed), repo, demo URL, video, deck.
- Submit at 11:00, not 11:59.

**Done when** the confirmation is received.

## 13. Stretch: on-chain cap with an OpenZeppelin spending-limit policy

Labels: P2, payments

Only if every P0 is merged before 08:00.

- Agent wallet as an OpenZeppelin smart account with a spending-limit policy (cumulative cap over a rolling ledger window).
- Show that a transfer above the window cap fails on-chain.

Reference: OpenZeppelin Stellar contracts, accounts → policies.

## 14. Stretch: LLM planner proposes the plan from the objective

Labels: P2, agent

Only if every P0 is merged before 08:00.

- The LLM proposes steps and prices; the ledger still decides.
- Keep the deterministic plan as the demo default.
