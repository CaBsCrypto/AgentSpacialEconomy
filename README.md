# Spatial Agents · Operating System

AGENTIC REALITY · AUGMENTED SPATIAL EXPERIENCES

![Concept art (made under the earlier working name "Agentic Spatial Economy") — human objectives, bounded agents, spatial experiences](docs/assets/agentic-spatial-economy-cover.png)

**Your venue's AI operator, on a capped USDC budget.**

Spatial Agents · Operating System lets human administrators delegate the operation of physical spaces to agents with explicit authority, spending limits and measurable objectives. Its first prototype recreates ONE16 in Lisbon as a mobile-first 3D event venue, with an in-world Stellar Passport demonstration and experimental native AR launch paths.

**Live: [agenticreality.space](https://agenticreality.space)** · [operator dashboard](https://agenticreality.space/dashboard.html) · [ONE16 twin](https://agenticreality.space/) · [llms.txt](https://agenticreality.space/llms.txt)

> Built at HackMeridian 2026 (Genesis · Stellar Composed). The repository implements the spatial frontend **and one bounded paid loop on Stellar testnet**: a venue agent delegates a budget to a stage agent, which pays for data and content over x402 in testnet USDC, under a per-call cap. It is not a deployed autonomous economy and moves no real money. Repo slug `AgentSpacialEconomy` is the earlier working name.

## Summary

An operator sets an objective, a budget and rules for a place. A **venue agent** splits the budget across zones; a **stage agent** buys what the stage screen needs — the live schedule, then a screen card — paying per call over **x402** in **USDC on Stellar testnet**. Every attempt lands in a ledger the operator can audit: settled payments link to their transaction; anything above the cap is refused **before it is signed** and shown as "needs operator approval". The purchased card appears on the stage of the ONE16 digital twin.

## Problem

A venue's screens, signage and activations are programmed by hand across several vendors and data sources. During a live event the schedule changes faster than anyone can update the stage screen, and the money spent on content, data and compute is scattered across invoices with no link to what was actually shown. Operators will only delegate that spend to an agent if every payment is capped, logged, tied to an objective and visible. See [THESIS.md](THESIS.md).

## How Stellar is used (architecture)

```text
Operator mandate (objective, budget, per-call cap, allowed services)
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
| Wallets | Agent wallet (payer, server-side Ed25519 signer, never in the browser) and service wallet (payee). Both need a USDC trustline |
| APIs | Horizon testnet (accounts, trustlines, DEX path payment used to fund the agent with testnet USDC), Friendbot, Soroban RPC (x402 client), facilitator `/supported`, `/verify`, `/settle` |
| Contracts | No custom contracts; payments invoke the USDC SAC. On-chain spending limits (OpenZeppelin smart-account policy) are in the backlog |
| Spend control | `agent/ledger.mjs`: allow-list, per-call cap, approval threshold, allocations, reserve → settle/release, idempotent reruns |

## On-chain evidence (Stellar testnet)

Recorded run, 25 Oct 2026 23:22 UTC ([Actions run 40244382971](https://github.com/CaBsCrypto/AgentSpacialEconomy/actions/runs/40244382971)):

| What | Transaction |
| --- | --- |
| Agent wallet funded with testnet USDC (DEX path payment XLM → USDC) | [99ef830d…](https://stellar.expert/explorer/testnet/tx/99ef830d2d4db61a4774b0292710231adbe03f6d1d673c92d0d7c23eb12114b6) |
| `venue-feed`, 0.01 USDC over x402 | [da696463…](https://stellar.expert/explorer/testnet/tx/da696463d66a67f4c520930a9bf495b5a1752b65a540d8841ce82a5557bb8da8) |
| `screen-card`, 0.05 USDC over x402 | [3b65769c…](https://stellar.expert/explorer/testnet/tx/3b65769cb937948b2edaec3a5d260b4224ef7cc32520c3c557dfb939cb09b9d9) |
| `premium-render`, 0.25 USDC | refused before signing (above the 0.10 per-call cap) |

Agent account [GB4UYQ…NOGI6](https://stellar.expert/explorer/testnet/account/GB4UYQ46C7ZVFAMGDIRWK6PC7IOCPFC774JY3TLP4KQLAXHOL7ZNOGI6) · service account [GAZ7J3…7ECH](https://stellar.expert/explorer/testnet/account/GAZ7J3C6SGNAFEWI6U3YXT2ZWC5CNZTNLXRCRM7T5BBSZWDVMCHF7ECH) (received exactly 0.06 USDC). Fees were paid by the facilitator.

## Setup, installation and environment variables

Requirements: Node.js 20+ (22 used in CI), npm; Python 3 only for the example static server.

```bash
# 3D venue + dashboard (static)
npm ci && node scripts/vendor.mjs && npm test
python3 -m http.server 8000 --directory dist      # open /  and  /dashboard.html

# paid loop on Stellar testnet
cd agent && npm install && npm test
npm run setup:testnet        # 2 testnet accounts + USDC trustlines → ../.env (secrets never printed)
#   by hand: https://faucet.circle.com → Stellar testnet → USDC to the agent wallet it printed
npm run check:facilitator
npm run services             # terminal 1
npm run loop                 # terminal 2 → writes dist/state/ledger.json and dist/state/stage.json
```

No keys or faucet: `node agent/ci-run.mjs` does everything with throwaway accounts (it buys a little testnet USDC on the DEX), or push to `ci/testnet-run` to run it in GitHub Actions. `npm run loop:dry` walks the plan without signing.

| Variable (`.env` at the repo root, git-ignored) | Purpose |
| --- | --- |
| `STELLAR_NETWORK` | Must be `stellar:testnet` |
| `FACILITATOR_URL` | x402 facilitator (default `https://x402.org/facilitator`) |
| `OZ_API_KEY` | Only for the OpenZeppelin Channels facilitator |
| `SERVICE_RECIPIENT` | Public `G…` key that receives USDC (needs a USDC trustline) |
| `AGENT_SECRET_KEY` | Secret `S…` key of the agent wallet (USDC trustline + testnet USDC). Never commit |
| `SERVICES_URL`, `SERVICES_PORT` | Where the paid services run (default `http://localhost:3001`) |

## Demo instructions

1. Open the operator dashboard (`dashboard.html`): mandate, budget per agent, every attempt with its transaction, and the refused call as an approval card.
2. Open the ONE16 twin, select **Vive la experiencia** and walk to the main stage: the screen shows the card the stage agent paid for.
3. Reproduce the payments: run the loop locally (above) or re-run the **Testnet loop** workflow; new transactions appear in `dist/state/ledger.json`.

## Prior work and what was built at HackMeridian

The first commit in this repository is from **Sun 25 Oct 2026, 10:30 WET**, after hacking opened at 09:00; the full history is in git. Built during the event: the ONE16 3D reconstruction and viewer, the Passport AR display, the planning docs, the x402 paid services, the budget ledger, the agent loop, the operator dashboard, the stage screen and the CI testnet runner. <!-- TEAM: list anything prepared before 09:00 Sun (concept, sketches, the supplied Passport front image, Blender sources) — the submission form asks for it. -->

Third-party software: Three.js, model-viewer, Express, the x402 packages and the Stellar JavaScript SDK, each under its own license.

## AI tooling

AI-assisted development, as the event rules allow: OpenAI Codex (venue reconstruction, viewer and site source — commits authored "Codex") and Claude by Anthropic (planning docs, x402 services, ledger, agent loop, dashboard, stage screen, CI runner). <!-- TEAM: confirm and add any other tools -->

## Project docs

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

x402 is proposed for paid service/API exchanges. It is not an agent identity system, a permission model or a replacement for budgeting and settlement controls. Not every agent interaction needs a payment.

The event is the initial use case. The longer-term opportunity is continuously operated spaces such as museums, universities and shopping centres, where subspaces have different operators, objectives and rights.

## What you can try today

1. Open ONE16 and select **Vive la experiencia**.
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
| Agents and economy | **Implemented on Stellar testnet (one bounded loop):** mandate, venue agent → stage agent allocation, budget ledger with per-call cap, x402 payments in testnet USDC, operator dashboard. Planned: more zones and agents, operator approvals, on-chain spending limits. No real money. |
| Stage screen | Implemented: the card bought by the stage agent is drawn on the stage backdrop; no change if no run is published. Placement in WebGL still to be checked on devices. |
| Builder profiles | Planned: consent-based Stellar Passport/profile integration; no live profile synchronization. |

### Integrated source snapshot — 25 October 2026

- **This branch integrates** the published v19 exterior layout with the Android AR diagnostics previously prepared as v17. Exterior sections **2 and 3** and 34 orphaned railway/fence objects are removed; section **1**, the interior yellow stairs, umbrellas and remaining review IDs are retained.
- **Public demo remains v19**, source `8afc88f46c405d4d6e4bd12d271c5a7d6f8dc87b`, preserved on `release/site-v19`. This integration is a GitHub change, **not a Sites deployment**.
- Android's primary action requests **AR-only**; an explicitly labelled alternative may open 3D without a camera. Fallback and asset diagnostics are preserved. Physical-device AR remains unverified.
- The integrated checkout passes **83 automated tests**, plus real GLB parsing. Automated tests do not establish physical-device tracking or camera access.
- Source history and previous release branches are retained. No force push or production overwrite is required.

## Run locally

Requirements: Node.js with npm; Python 3 for the example static server. Three.js is pinned to **0.180.0**.

```bash
npm ci
node scripts/vendor.mjs
npm test
python3 -m http.server 8000 --directory dist
```

Open `http://localhost:8000`. The deployable static directory is **`dist/`**. There is no `npm run build` or `npm start` script in this prototype.

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

1. **Verify the Passport demo on a physical Android/Chrome device:** launch camera-based AR, place the asset, exit and resume the venue without losing position. If unavailable, show an honest 3D fallback.
2. **Implement one bounded operational loop:** a human mandate → one venue agent → one subspace agent → one authorized service → a visible result.
3. **Add budget enforcement before real spending:** separate available, reserved and spent funds; enforce limits, approvals, idempotency and reconciliation. Start with clearly labelled test transactions.
4. **Demonstrate accountability:** distinguish agent actions, successful service calls, financial settlement and actual visitor interactions in the dashboard.
5. **Expand carefully:** sponsor experiences, host-controlled stage content and opt-in builder profiles. Advertising inventory must respect existing contracts and content rights.

Inputs such as event schedules, social content or camera-derived signals require an appropriate permission and privacy model. The demo does not currently implement autonomous monitoring or personal-data ingestion.

## Fidelity, attribution and rights

This is an interpretive reconstruction, not a measured architectural survey. Geometry, spacing and furniture placement include estimates; unobserved areas are not claimed to be accurate. Venue references include [ONE16](https://www.oneyourfirststop.com/eventos) and the [HackMeridian event](https://www.hackmeridian.com/).

This is an independent prototype. Use of Stellar, Stellar Passport, HackMeridian and venue names or visual references does **not** imply official sponsorship, endorsement or affiliation. “Sponsor” describes a proposed experience category, not a confirmed commercial relationship.

Third-party names, artwork and assets retain their respective rights. Three.js includes its license in `dist/vendor/three/LICENSE` after vendoring. Public source availability does not itself grant a blanket license to project code or third-party assets; check applicable licenses and obtain permission before reuse. Raw reference recordings, personal information and credentials do not belong in public commits.
