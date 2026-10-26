# Spatial Agents · Operating System

AGENTIC REALITY · AUGMENTED SPATIAL EXPERIENCES

![Concept art (made under the earlier working name "Agentic Spatial Economy") — human objectives, bounded agents, spatial experiences](docs/assets/agentic-spatial-economy-cover.png)

**Your venue's AI operator, on a capped USDC budget.**

Spatial Agents · Operating System lets human administrators delegate the operation of physical spaces to agents with explicit authority, spending limits and measurable objectives. Its first prototype recreates ONE16 in Lisbon as a mobile-first 3D event venue, with an in-world Stellar Passport demonstration and experimental native AR launch paths.

**Live: [agenticreality.space](https://agenticreality.space)** · [operator dashboard](https://agenticreality.space/dashboard.html) · [ONE16 twin](https://agenticreality.space/one16) · [llms.txt](https://agenticreality.space/llms.txt)

> Built at HackMeridian 2026 (Genesis · Stellar Composed). The repository implements the spatial frontend **and one bounded paid loop on Stellar testnet**: a venue agent delegates a budget to a stage agent, which pays for data and content over x402 in testnet USDC, under a per-call cap. It is not a deployed autonomous economy and moves no real money. Repo slug `AgentSpacialEconomy` is the earlier working name.

## Summary

An operator sets an objective, a budget and rules for a place. A **venue agent** splits the budget across zones; a **stage agent** buys what the stage screen needs — the schedule fixture, then a screen card — paying per call over **x402** in **USDC on Stellar testnet**. Every attempt lands in a ledger the operator can audit: settled payments link to their transaction; anything above the cap is refused **before it is signed** and shown as "needs operator approval". The purchased card appears on the stage of the ONE16 digital twin.

## Problem

From organizing events ourselves, we have seen a lack of experiences that surprise attendees. We want to help teams plan 3D and AR experiences and communicate those plans more clearly.

This prototype tests one mechanism for that digital layer: an operator gives agents a bounded content and data budget, each purchase is recorded, and the purchased result appears in the venue's digital twin. A venue pilot will test operator demand, coordination benefits and willingness to pay. Physical AR placement remains unverified. Our proposed first pilot is One Sixteen Venue; no agreement or partnership is in place. We would test whether event operators can plan compelling spatial experiences and delegate a small, auditable content budget. A per-event mandate with a service margin is our business-model hypothesis. Campuses, innovation districts and museums are later target markets, subject to pilot results. See [THESIS.md](THESIS.md).

## How Stellar is used (architecture)

```text
Operator mandate (objective, budget, per-call cap, allowed services)
  Treasury approves 0.50 USDC SEP-41 allowance with a ledger expiry
  Venue agent draws 0.20 USDC; an extra 0.31 draw fails simulation
  └─ venue-agent ── allocates 0.20 USDC ──> stage-agent
                                              │  ledger check before signing (cap, allow-list, budget)
                                              ▼
            paid services (Express + @x402/express, routes under /paid)
              ← 402 PAYMENT-REQUIRED (exact scheme, USDC SAC, payTo = service wallet)
              → PAYMENT-SIGNATURE (agent signs Soroban auth entries only)
                         │
                         ▼
            x402 facilitator /verify + /settle  ──>  Stellar testnet (SAC transfer, fees sponsored)
                         │
              ← 200 + PAYMENT-RESPONSE (transaction hash)
  ledger.json / stage.json ──> operator dashboard + stage screen in the ONE16 twin
```

| Piece | Value |
| --- | --- |
| Network | Stellar **testnet** (`stellar:testnet`) |
| Asset | USDC (Circle, testnet). Classic issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`; Stellar Asset Contract (SEP-41) `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Payments | x402 v2, `exact` scheme, via `@x402/express`, `@x402/fetch`, `@x402/stellar` |
| Facilitator | `https://x402.org/facilitator` (testnet, fee-sponsored); OpenZeppelin Channels as fallback |
| Wallets | Operator treasury, venue agent (payer, server-side signer) and service wallet (payee), with testnet USDC trustlines. Payment keys stay on the server. |
| APIs | Horizon testnet (accounts, trustlines, DEX path payment used to fund the treasury with testnet USDC), Friendbot, Soroban RPC (x402 client), facilitator `/supported`, `/verify`, `/settle` |
| Contracts | No custom contracts; payments and the allowance use the USDC SAC (`approve`, `transfer_from`, `allowance`). Per-day caps in a smart account (OpenZeppelin policy or Nido session keys) are in the backlog |
| Spend control | **On-chain:** the operator's treasury approves the venue agent a SEP-41 allowance on the USDC SAC (amount = mandate budget, approved with a roughly 24-hour ledger window); the agent draws its allocations with `transfer_from`; an excessive draw is refused during simulation, with nothing submitted. **Off-chain, before signing:** `agent/ledger.mjs` — allow-list, per-call cap, approval threshold, allocations, reserve → settle/release, idempotent reruns |

## On-chain evidence (Stellar testnet)

Recorded run, 26 Oct 2026 01:23 UTC ([Actions run 40253952685](https://github.com/CaBsCrypto/AgentSpacialEconomy/actions/runs/40253952685)), settled transactions confirmed on Horizon; the rejected draw was a simulation, not a submitted transaction:

| What | Transaction |
| --- | --- |
| Operator treasury funded with testnet USDC (DEX path payment XLM → USDC) | [0815f082…](https://stellar.expert/explorer/testnet/tx/0815f082fab7f628420bf05e68bddb98f5b35dc509f210fc1f93f394e71933ad) |
| Treasury **approves** the venue agent 0.50 USDC until ledger 5408128 (SEP-41 `approve` on the USDC SAC) | [3add5054…](https://stellar.expert/explorer/testnet/tx/3add505423f1dbf84cba31ea2c2f607e6e0d40b75a538de81189d22f50c283fa) |
| Venue agent **draws** its 0.20 USDC allocation (`transfer_from`) | [914076fb…](https://stellar.expert/explorer/testnet/tx/914076fbe1afa6d845ec7d17eb6d875144c91c8c00bf1ce425f2fbcfa0d7f083) |
| Venue agent tries to draw 0.31 USDC (one cent above what is left) | **refused by the network** in simulation, nothing submitted |
| `venue-feed`, 0.01 USDC over x402 | [bb6d3dfb…](https://stellar.expert/explorer/testnet/tx/bb6d3dfbedcf70abf69b5b9cf1a4846604bc08bfcc0e8dcd4cdfb08c25dde2fc) |
| `screen-card`, 0.05 USDC over x402 | [7d3e29ff…](https://stellar.expert/explorer/testnet/tx/7d3e29ff665156095f1443838e0cf1ba0164dfbc536ae24f9546ec1f3ee7d3b0) |
| `premium-render`, 0.25 USDC | refused by the agent before signing (above the 0.10 per-call cap) |

Treasury [GDNNKS…WCZK](https://stellar.expert/explorer/testnet/account/GDNNKSLTL43WDLRXLRU6HWW6Q6GGL4BWU45WZF5AG3ME4WHPTK6JWCZK) · agent [GCK6CK…6BF6](https://stellar.expert/explorer/testnet/account/GCK6CKDDDRVGZNHE2LMJSF6YQKJDQVGPCE7TXOWNNGWUSHTRYXPK6BF6) (0.20 drawn − 0.06 paid = 0.14 USDC left) · service [GAL47K…VCRS](https://stellar.expert/explorer/testnet/account/GAL47K4ZRDYUBK3KNMHKVPCALODUU5CRAQOPTGZWK54TWSH267WBVCRS) (received exactly 0.06 USDC). x402 fees were paid by the facilitator. An earlier run without the allowance (25 Oct 23:22 UTC, [Actions run 40244382971](https://github.com/CaBsCrypto/AgentSpacialEconomy/actions/runs/40244382971)) settled the same two payments.

## Setup, installation and environment variables

Requirements: Node.js 22.x and npm for the site; the separate agent package supports Node.js 20+ (22 used in CI).

```bash
# 3D venue + dashboard (static)
npm ci && node scripts/vendor.mjs && npm run build && npm test
npm run dev                 # http://localhost:4318/ and /dashboard.html

# paid loop on Stellar testnet
cd agent && npm install && npm test
npm run setup:testnet        # 2 testnet accounts + USDC trustlines → ../.env (secrets never printed)
#   by hand: https://faucet.circle.com → Stellar testnet → USDC to the agent wallet it printed
npm run check:facilitator
npm run services             # terminal 1
npm run loop                 # terminal 2 → writes dist/state/ledger.json and dist/state/stage.json
```

No keys or faucet: `node agent/ci-run.mjs` does everything with throwaway accounts (it buys a little testnet USDC on the DEX), or use **Actions > Testnet loop > Run workflow** on **main**. The workflow publishes results to `ci/testnet-results`; it does not update the production site automatically. `npm run loop:dry` walks the plan without signing.

| Variable (`.env` at the repo root, git-ignored) | Purpose |
| --- | --- |
| `STELLAR_NETWORK` | Must be `stellar:testnet` |
| `FACILITATOR_URL` | x402 facilitator (default `https://x402.org/facilitator`) |
| `OZ_API_KEY` | Only for the OpenZeppelin Channels facilitator |
| `SERVICE_RECIPIENT` | Public `G…` key that receives USDC (needs a USDC trustline) |
| `AGENT_SECRET_KEY` | Secret `S…` key of the agent wallet (USDC trustline + testnet USDC). Never commit |
| `SERVICES_URL`, `SERVICES_PORT` | Where the paid services run (default `http://localhost:3001`) |

## Demo instructions

1. Open the [operator dashboard](https://agenticreality.space/dashboard.html). It displays a **recorded real testnet run**: mandate, treasury allowance, per-agent budget, two payments with transaction links, and the blocked 0.25 USDC call.
2. Open the [ONE16 twin](https://agenticreality.space/one16), select **Vive la experiencia** and walk to the main stage to inspect the purchased **Morning briefing** card over the backdrop.
3. Open a payment link in stellar.expert and compare its hash and amount with the dashboard.
4. To create fresh evidence, a person opens [Actions > Testnet loop](https://github.com/CaBsCrypto/AgentSpacialEconomy/actions/workflows/testnet-loop.yml), selects **Run workflow** on **main**, and waits for success (normally about two minutes). Inspect the new `dist/state/*.json` in `ci/testnet-results`; publishing those results needs a reviewed change and deployment before the freeze. The static dashboard does not trigger payments.

Use [DEMO.md](DEMO.md) for the three-minute recording and seven-slide deck. All demonstrated payments are testnet only. Physical AR placement is unverified.

## Prior work and what was built at HackMeridian

We started this project during HackMeridian; no project work existed before hacking opened at 09:00 WET on Sunday 25 October 2026. Our team created the landing page and ONE16 digital twin during the hackathon, using our own venue photos and videos and AI-assisted development. The agent, paid services, allowance integration, budget ledger, dashboard, stage screen, CI runner and supporting documentation were also built during the event. The repository's first commit is dated 25 October 2026, 10:30 WET; its public history records the work. Third-party software is used under its respective licenses.

## AI tooling

We used Claude, OpenAI Codex and Dot during the hackathon for AI-assisted development and preparation of project materials. Our team chose the problem, scope and design, reviewed the outputs and tested the prototype.

## Project docs

- [THESIS.md](THESIS.md) — who it is for, the problem, why Stellar. The source of truth.
- [SPEC.md](SPEC.md) — the HackMeridian MVP: demo path, ledger rules, done criteria.
- [DESIGN.md](DESIGN.md) — name, colors, type and screens.
- [AGENTS.md](AGENTS.md) — rules and tools for coding agents (Raven MCP, Stellar skills).
- [PLAN.md](PLAN.md) · [ISSUES.md](ISSUES.md) · [DEMO.md](DEMO.md) · [SUBMISSION.md](SUBMISSION.md) — schedule to submission, tasks, demo script, portal answers.
- [agent/README.md](agent/README.md) — run the paid loop on Stellar testnet in about 5 minutes. The operator view is `dist/dashboard.html`.

## The idea

```text
Human administrator
  └─ objectives · budget · permitted spaces · content rights · approval rules
      └─ venue administrator agent
          ├─ sponsor / stand agent
          ├─ main-stage agent
          └─ other subspace agents
              └─ authorized services and paid API exchanges through x402
                  └─ mobile, 3D and AR experiences for visitors

Decisions, expenditure and outcomes → administrator dashboard
```

The person remains in control of the mandate. Agents would coordinate services and allocate approved resources; visitors would experience the results through familiar mobile interfaces, the venue's digital twin and AR—not only through an open camera.

x402 is implemented for the two paid service/API exchanges in the testnet loop. It is not an agent identity system, a permission model or a replacement for budgeting and settlement controls. Not every agent interaction needs a payment.

The event is the initial use case. The longer-term opportunity is continuously operated spaces such as museums, universities and shopping centres, where subspaces have different operators, objectives and rights.

## What you can try today

1. Open [/one16](https://agenticreality.space/one16) and select **Vive la experiencia**.
2. Explore the reconstructed entrance, yellow corridor, stairs, check-in, merchandise area, stands and main stage.
3. Use the overview and numbered review map to locate sections; return to the entrance without restarting the visit.
4. Open the **Stellar Passport** display from inside the venue to inspect the 3D asset and attempt its native AR launch on a compatible device.

**Desktop:** WASD / arrow keys and drag to look. **Mobile:** left-thumb virtual joystick and independent right-side touch look. Overview controls support inspection of the layout. The temporary numbered map supports spatial feedback and can be hidden.

The Passport interaction belongs inside the ONE16 experience. The standalone Passport page is a fallback, not the main journey. Its present placement near the activation totem is provisional, not a verified location of the real stand.

## Implementation status

| Layer | Current state |
| --- | --- |
| Venue viewer | Implemented: Three.js scene, walking, stair transitions, overview, reset, numbered map and mobile joystick. |
| Loading | Implemented: background preload, shared model loading, compressed-model transfer and fallback handling. |
| No-WebGL fallback | Static layout/imagery and an explicit fallback—not simulated 3D walking. |
| Passport | 3D asset and in-world inspection panel; Android/iOS native AR launch paths. |
| Physical AR | **Not yet verified on the target phone.** The user reported that the camera did not open. A native 3D viewer is not proof of AR. |
| AR anchoring | No image-marker recognition, venue georeferencing, persistent anchors or shared spatial registration. |
| Activation totem | Informational Stellar Testnet guide; no operational wallet connection, faucet claim or asset transfer. |
| Agents and economy | **Implemented on Stellar testnet (one bounded loop):** mandate, venue agent → stage agent allocation, SEP-41 treasury allowance, budget ledger with per-call cap, x402 payments in testnet USDC, operator dashboard. Planned: more zones and agents, operator approvals and per-day smart-account policies. No real money. |
| Stage screen | Implemented: the card bought by the stage agent is drawn on the stage backdrop; no change if no run is published. Placement in WebGL still to be checked on devices. |
| Builder profiles | Planned: consent-based Stellar Passport/profile integration; no live profile synchronization. |

### Source and release checks

The site source includes the landing and ONE16 twin in `dist/`, the paid loop in `agent/`, and Vercel routing at the repository root. `/` serves the landing; `/one16` serves the twin. The dashboard and `state/` files remain static recorded evidence.

For a release, verify HTTP 200 for `/`, `/one16`, `/dashboard.html`, `/state/ledger.json`, `/state/stage.json`, `/llms.txt`, `/robots.txt` and `/sitemap.xml`. Check the dashboard on a physical phone and walk to the purchased stage card in the twin. Automated tests do not establish physical-device AR placement.

## Run locally

Requirements: Node.js 22.x and npm. Three.js is pinned to **0.180.0**.

```bash
npm ci
node scripts/vendor.mjs
npm run build
npm test
npm run dev
```

Open `http://localhost:4318/` for the landing, `/one16` for the twin and `/dashboard.html` for the recorded run. The development server mirrors the site's routes; the Vercel build outputs the static site to **`dist/`** and serves the existing API handlers separately.

For mobile AR tests, use an HTTPS deployment opened directly in a compatible browser. A desktop localhost preview or embedded browser does not establish mobile AR compatibility. Native AR requires supported device software and an explicit user action; do not assume camera activation succeeded.

### Optional model regeneration

Blender is required to regenerate the venue; it is not required to view the committed assets.

```bash
blender -b --python model/build_venue.py
python3 scripts/prepare-model.py
node scripts/validate-glb.mjs dist/assets/one16.glb
npm test
```

The generation script writes into `dist/assets/`; transfer preparation updates the compressed asset and its loading metadata. Review generated changes before committing. The GLB validator uses the real Three.js loader.

## Repository guide

- `dist/` — static application, navigation, loading, review-map and AR-launch modules.
- `dist/assets/` — venue and Passport assets.
- `model/` — procedural Blender model source and venue sections.
- `scripts/` — dependency vendoring, model preparation and asset validation.
- `test/` — Node test suite for navigation, input, fallback, loading, overview and Passport flows.
- `docs/assets/` — project presentation artwork.

## Next proof points

1. **Test with a venue operator:** propose the first pilot to One Sixteen Venue, with no existing agreement, and test whether spatial planning and a bounded content budget help their work.
2. **Verify physical AR:** on a compatible Android/Chrome device, launch camera-based AR, place the asset, exit and resume the venue. Until that succeeds, label the 3D fallback clearly.
3. **Extend the demonstrated budget controls:** operator approvals, per-day smart-account policies and more zones remain future work.
4. **Measure operator value:** distinguish purchases, financial settlement, visible results and actual visitor interactions; evaluate the per-event mandate business-model hypothesis.
5. **Expand carefully:** sponsor experiences, host-controlled stage content and opt-in profiles require appropriate rights and consent.

Inputs such as event schedules, social content or camera-derived signals require an appropriate permission and privacy model. The demo does not currently implement autonomous monitoring or personal-data ingestion.

## Fidelity, attribution and rights

This is an interpretive reconstruction, not a measured architectural survey. Geometry, spacing and furniture placement include estimates; unobserved areas are not claimed to be accurate. Venue references include [ONE16](https://www.oneyourfirststop.com/eventos) and the [HackMeridian event](https://www.hackmeridian.com/).

This is an independent prototype. Use of Stellar, Stellar Passport, HackMeridian and venue names or visual references does **not** imply official sponsorship, endorsement or affiliation. “Sponsor” describes a proposed experience category, not a confirmed commercial relationship.

Third-party names, artwork and assets retain their respective rights. Three.js includes its license in `dist/vendor/three/LICENSE` after vendoring. Public source availability does not itself grant a blanket license to project code or third-party assets; check applicable licenses and obtain permission before reuse. Raw reference recordings, personal information and credentials do not belong in public commits.
