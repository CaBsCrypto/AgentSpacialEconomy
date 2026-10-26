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
| Contracts | Payments and the allowance use the USDC SAC (`approve`, `transfer_from`, `allowance`). Paid screen time uses **AdsRegistry**, a noncustodial Soroban contract written during the event (`contracts/ads-registry` on `feature/ads-3d-ar-x402`): the treasury commits each paid ad order with its x402 settlement hash; the contract never moves funds. Per-day caps in a smart account (OpenZeppelin policy or Nido session keys) are in the backlog |
| Income | `POST /paid/sponsor-slot` (0.10 testnet USDC) is paid over x402 **to the venue treasury**. The treasury then re-approves the venue agent what is left plus that income (SEP-41 `approve` sets the allowance), so a sponsor refills the agent's capped budget. Income rows never change the agents' budget math |
| Live reads | The dashboard looks up every recorded transaction on Horizon testnet and reads the treasury and agent USDC balances when it loads (read-only, no keys); it falls back to the recorded values if Horizon is unreachable |
| Spend control | **On-chain:** the operator's treasury approves the venue agent a SEP-41 allowance on the USDC SAC (amount = mandate budget, approved with a roughly 24-hour ledger window); the agent draws its allocations with `transfer_from`; an excessive draw is refused during simulation, with nothing submitted. **Off-chain, before signing:** `agent/ledger.mjs` — allow-list, per-call cap, approval threshold, allocations, reserve → settle/release, idempotent reruns |

## On-chain evidence (Stellar testnet)

The public dashboard shows **run 3** (26 Oct 2026 03:21 UTC, [table below](#income-extension-a-sponsor-refills-the-agents-budget-run-3)), which repeats every step of run 2 and adds the sponsor income and the recharge.

Run 2, 26 Oct 2026 01:23 UTC ([Actions run 40253952685](https://github.com/CaBsCrypto/AgentSpacialEconomy/actions/runs/40253952685)), settled transactions confirmed on Horizon; the rejected draw was a simulation, not a submitted transaction:

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

### Income extension: a sponsor refills the agent's budget (run 3)

Run of 26 Oct 2026 03:21 UTC ([Actions run 40263552583](https://github.com/CaBsCrypto/AgentSpacialEconomy/actions/runs/40263552583)), same mandate and the same seven steps as above, then the income side. Balances checked on Horizon after the run.

| What | Transaction |
| --- | --- |
| Treasury **approves** the venue agent 0.50 USDC until ledger 5409535 | [9bcab3db…](https://stellar.expert/explorer/testnet/tx/9bcab3db185200309a3d1bb63ef09c128212d68b8418ffaf2a192206f7ffe62d) |
| Venue agent **draws** its 0.20 USDC allocation (`transfer_from`); a 0.31 draw is then refused in simulation | [7d9edc0a…](https://stellar.expert/explorer/testnet/tx/7d9edc0a7c3cd8e888dcb5d87e418b671bdd2222dbb709c51896031c428ad3fb) |
| `venue-feed`, 0.01 USDC · `screen-card`, 0.05 USDC (x402); `premium-render` 0.25 blocked before signing | [ebb69bd4…](https://stellar.expert/explorer/testnet/tx/ebb69bd495625e948fdb1ce6f3e1ee8b21eaea343fe77b086bed4849598c667a) · [a5378f62…](https://stellar.expert/explorer/testnet/tx/a5378f6257a5e21c67d9d9f49c248e3af32f5170ba94fabbb2108ccd01387ac0) |
| A **sponsor pays the venue treasury** 0.10 USDC over x402 for one line on the stage screen (`POST /paid/sponsor-slot`, payTo = treasury) | [821f7b12…](https://stellar.expert/explorer/testnet/tx/821f7b12035a34dc4bae796e91404a4358cade7626c36d0d18aeb9eda441b5e3) |
| The treasury **re-approves** the venue agent 0.30 + 0.10 = 0.40 USDC (SEP-41 `approve` sets the allowance); read back: 0.40 | [d954f245…](https://stellar.expert/explorer/testnet/tx/d954f245d335089680cd095e07912efb4c9eab5564862bb4a48b74d49ecc7bc9) |

Treasury [GC6FWZ…TOTO](https://stellar.expert/explorer/testnet/account/GC6FWZPKZZ7PVJ3FKOCKA3VSP4HIVKDYB64RXQLQVU6WWT7XA6CITOTO) (−0.20 drawn, +0.10 sponsor) · agent [GAOQEW…H2O2](https://stellar.expert/explorer/testnet/account/GAOQEWK6M5CFFA4NYY77P3D2ZYLOSY6O5JU667GWCVM3DCNFQ7JGH2O2) (0.14 USDC left) · sponsor [GCRS4T…77XW](https://stellar.expert/explorer/testnet/account/GCRS4TEBW5B6PAV235KP34DROX5BC4WHPOGKKMKLBJPCWRBTWN4Q77XW) (−0.10) · service [GDSRUN…CV5G](https://stellar.expert/explorer/testnet/account/GDSRUNKPVMAJ4P6EIKJ6JZQY2HSVLGRT46BYKNDGAFYCEVH4H4BVCV5G) (+0.06). The sponsor is a throwaway testnet wallet named "Demo Sponsor (testnet)", not a real company.

### Paid screen time: an ad order committed on Soroban

Run of 26 Oct 2026 06:24 UTC ([Actions run 40279573914](https://github.com/CaBsCrypto/AgentSpacialEconomy/actions/runs/40279573914)), separate from the loop, with its own throwaway treasury and advertiser. The offer is the pilot fixed on `feature/ads-3d-ar-x402`: 5 testnet USDC for 5 minutes of the main-stage screen.

| What | Transaction |
| --- | --- |
| An **advertiser pays the venue treasury** 5 USDC over x402 (`POST /paid/ad-slot`, payTo = treasury, 402 checked before signing); treasury balance read back 0 → 5 | [06dcd5b2…](https://stellar.expert/explorer/testnet/tx/06dcd5b2b16f7f9419c1b029306b09d74dab0187cb5626f7aa8040cbe352decc) |
| The treasury **deploys an AdsRegistry instance** ([CCF3QI…OCQS](https://stellar.expert/explorer/testnet/contract/CCF3QILVXKYOUE4M2SVZJYOWYQZ3IMS3DODPKPN2UVZELIKMVI63OCQS)) from the WASM already on testnet (`d9caf94b…`, the code the network runs was checked against it) | [3b0eb98b…](https://stellar.expert/explorer/testnet/tx/3b0eb98b2c82d2fd994691ad9d59289f2d858a5654d77abb0cac86058da4bb30) |
| The treasury **commits the order**: hashes of the terms and the ad, the advertiser as claimant, the 5-minute window, and the x402 settlement hash above as `payment` | [0a15bdb4…](https://stellar.expert/explorer/testnet/tx/0a15bdb401be7ea1970acf2153129b839b38108bff03a515000ac16cb3fa9509) |
| `get(order)` read back by simulation | `Queued`, delivered 0 of 300 s, `payment` equal to the settlement hash |

The registry never moves funds. No delivery is recorded, so the order stays `Queued`, and the ad is not shown in the twin. The advertiser is a throwaway testnet wallet named "Demo Advertiser (testnet)". The first deployment of the same contract, with a synthetic order and no payment, is on `feature/ads-3d-ar-x402` (`docs/ads/testnet-registry/`).

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
| `TREASURY_PUBLIC_KEY` | Public `G…` key of the operator treasury. Enables the SEP-41 draw in the loop and the sponsor slot, which pays this account; without it `/paid/sponsor-slot` answers 503 |
| `SPONSOR_SECRET_KEY` | Only for `node agent/sponsor.mjs`: secret `S…` key of a separate testnet wallet with testnet USDC. `ci-run.mjs` creates a throwaway one. Never commit |

## Demo instructions

1. Open the [operator dashboard](https://agenticreality.space/dashboard.html). It displays a **recorded real testnet run**: mandate, treasury allowance, the agent credit pool, per-agent budget, two payments with transaction links, the blocked 0.25 USDC call, and a sponsor payment to the treasury that recharges the allowance. Below the stage card, **Paid screen time** shows a 5 USDC ad order paid to the treasury and committed to the AdsRegistry contract. When the page loads it checks each transaction live on Horizon testnet.
2. Open the [ONE16 twin](https://agenticreality.space/one16), select **Vive la experiencia** and walk to the main stage to inspect the purchased **Morning briefing** card over the backdrop, with the "Presented by Demo Sponsor (testnet)" line the sponsor paid for.
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
| Activation totem | **Working on testnet, tested on a phone on 26 Oct.** From the totem a visitor creates a passkey smart wallet (smart-account-kit, WebAuthn verifier) and receives 100 testnet USDC from the Sozu faucet. Recorded: wallet [CDKOF3…QTGM](https://stellar.expert/explorer/testnet/contract/CDKOF36Q7DSFDL7EG34YSU2IWC7NXGKJOHUX3IO2A6HPF3OU5KVFQTGM) created 06:39:32 UTC from account WASM `c514d35e…` ([276528f3…](https://stellar.expert/explorer/testnet/tx/276528f3c6c5c8f6f91b8b9eb9e16da27788f8d978c6c91b2edbbfeb22b8d683)), 100 USDC received 06:39:47 UTC ([6832aee5…](https://stellar.expert/explorer/testnet/tx/6832aee53b91ef4402e911699a51f27dd4d31d1708409ee45d4a1fd694ad418f)). One phone so far; test USDC only, limited by the faucet's availability. |
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

## Advertising MVP (reactivated Testnet branch)

The advertiser journey under /ads now offers five complete sixty-second main-stage deliveries for 5 Testnet USDC total, with design included. It reuses the working passkey wallet and existing funding. The API, durable queue, audit, canonical publication and private storage are implemented; operational infrastructure is prepared on the existing Vercel Pro project. A diagnostic baseline is deployed with checkout disabled; the integrated five-pass build is under protected Preview validation. No real C-wallet advertiser purchase or canonical ad publication has been demonstrated. See [setup, limitations and evidence](docs/ads/README.md) and [PRD v0.2](docs/ads/PRD-v0.2.md).

## Estado

Reactivación del 26 de octubre de 2026. Rama: feature/ads-3d-ar-x402. Se conservan la marca, landing, Palta y el main actualizado con PR #28, incluido con autorización del propietario. El dashboard no recibió cambios adicionales en esta etapa.

- **Oferta vigente:** main-stage-test-5m, offerVersion 2, PASSES: cinco entregas completas de 60000 ms por **5 USDC de Testnet en total**, diseño incluido. Una interrupción reinicia el minuto; no suma fragmentos. FULFILL_REMAINING conserva cada pase incompleto como deuda, sin cierre ni devolución monetaria automáticos. Las cotizaciones anteriores mantienen su plan y términos.
- **Wallet existente:** se reutilizan la passkey, el origen/RP ID, IndexedDB y la campaña Redis del piloto que el propietario reportó haber activado en Chrome Android y recibido 100 USDC. Se restauraron acceso directo, indicador y toolbar. Esto no acredita un nuevo grant único de 100 USDC ni solicita otra wallet o entrega del faucet.
- **Infraestructura:** Vercel Pro existente, Blob privado y Neon PostgreSQL con migraciones 001–013 aplicadas. Worker y publicador tienen endpoints y leases independientes: generación/auditoría/reconciliación continúan mientras otro anuncio se reproduce. El publicador usa Chromium con WebGL2 comprobado en el runtime de Vercel. Las variables del servidor están cifradas; la clave receptora permanece sólo local. Cerrar compras no detiene obligaciones ya pagadas.
- **Autoridades:** las direcciones G operativas firman de forma restringida en servidor/offline; no constituyen un login WebAuthn de administrador. El registro admite ADS_REGISTRY_SIGNER_KEY como secreto de servidor o el archivo local ADS_REGISTRY_SIGNER_KEY_FILE. No se publican claves privadas.
- **Receptor preparado:** [GBJERBDEX5CLPFP6SBEP3W26TZSWSOOHJSI65H4CUWZF2KGXJGXGN7V5](https://stellar.expert/explorer/testnet/account/GBJERBDEX5CLPFP6SBEP3W26TZSWSOOHJSI65H4CUWZF2KGXJGXGN7V5), con saldo inicial de 0 USDC y clave privada conservada sólo localmente, fuera de Vercel. [Friendbot XLM](https://stellar.expert/explorer/testnet/tx/e3d013575f60b74f6ffce4d480065c3202b4cc51a0cfbe8773a42efc40b3717b) y [trustline USDC](https://stellar.expert/explorer/testnet/tx/9eef6907b90b0ab2c801be8952c2dd3370f3774c2cbdcc0b9f783bb36e21b065) preparan la recepción; no son compras publicitarias.
- **Construido en esta etapa:** cinco unidades estables, intentos completos de 60 s, recuperación dentro de ventana y lotes posteriores consentidos a 0 USDC; disponibilidad autenticada, cinco indicadores privados, contador público desde ACK canónico y retorno al anfitrión al vencer la verificación. Cada lote tiene compromiso y nonces propios, sin alterar pago/cotización originales. El límite agregado de cinco se aplica en PostgreSQL; el contrato actual no lo impone entre lotes.
- **Acceso:** letrero 3D, [QR](dist/assets/main-stage-ads-qr.png), [cartel A5 imprimible](dist/assets/main-stage-ads-poster-a5.pdf) y NFC apuntan a https://agenticreality.space/ads?placement=main_stage_screen. QR y PDF renderizado se decodificaron independientemente. El acceso no crea wallet, solicita fondeo ni cobra automáticamente.
- **Verificación local:** build aprobado; raíz 679 casos: **677 aprobados, 0 fallidos, 2 omitidos**; paquete agente **42/42**; contrato Rust **9/9**. Corrección posterior de reconciliación: **28/28**, incluida carrera SQL que preserva CONFIRMED. PostgreSQL nativo directo: **18/18**, 15 casos SQL y tres puros/deshabilitados, base ads_test y esquemas aislados. Los fixtures no acreditan liquidaciones.
- **Pendiente y cobro cerrado:** conexión real de la wallet C existente detenida por `unverified birth provenance: indexer did not return one complete schema-2 birth claim`; se investiga sin omitir la autenticación. Faltan preauditoría real, pago autorizado de exactamente 5 USDC, cinco pases canónicos completos con registro Soroban, Android/iPhone reales y NFC físico. No hay compra C-wallet ni anuncio real del nuevo piloto demostrado. Modos DISABLED → CONTROLLED (wallet permitida en servidor) → PUBLIC; PUBLIC requiere aceptación y evidencia.

### Evidencia histórica del registro: TIME sintético

La prueba original siguiente permanece sin cambios. Su obligación TIME de 300000 ms no representa la nueva oferta de cinco pases completos.

- **Probado on-chain para publicidad:** sólo el contrato Soroban no custodial en **Stellar Testnet**, [CDYMS23PEXE4WMVSMJAWOFOODEVV2S4IQJQUFTHFKFWAFAEVMFBWQRVD](https://stellar.expert/explorer/testnet/contract/CDYMS23PEXE4WMVSMJAWOFOODEVV2S4IQJQUFTHFKFWAFAEVMFBWQRVD). Desplegado el 26/10 a las **04:30:32 Lisboa** con identidad desechable y XLM de Friendbot; no se utilizó ninguna wallet existente ni Mainnet.
- **Despliegue:** [11a0e3132c480c119d59ec156996a00c0a233c3936592f1b3071b3463bf2ccce](https://stellar.expert/explorer/testnet/tx/11a0e3132c480c119d59ec156996a00c0a233c3936592f1b3071b3463bf2ccce). **Escritura `commit`:** [380dfd78d95b15eee2f39ca0e4e3350aa09a8800fc2b1cd434041d67487bac45](https://stellar.expert/explorer/testnet/tx/380dfd78d95b15eee2f39ca0e4e3350aa09a8800fc2b1cd434041d67487bac45). Ambas verificadas como `SUCCESS` en RPC y exitosas en Horizon.
- **Lectura `get`:** `Queued`, `delivered=[0]`, obligación `300000` ms y `next_nonce=0`. El campo payment de esta orden es una referencia sintética identificada como prueba: **no acredita transferencia USDC ni entrega publicitaria**. Ver [entrada, lectura y comprobaciones públicas](docs/ads/testnet-registry/).

- **Producción histórica:** PR #27 fusionado con merge commit `a03aeaf766c009e7e409e8efc302916bdf9388e2`, conservando sus 5 commits. Ese `main` se desplegó a las **04:36:05 Lisboa**. La actualización diagnóstica posterior incorporó PR #28 por autorización explícita, manteniendo las compras cerradas. Dashboard comprobado con corrida 03:21:08, Agent credit pool y 6/6 confirmaciones en vivo.

### Última validación de Vercel

El fallo histórico `MODULE_NOT_FOUND: playwright-core-vercel/browsers.json` detuvo el hito tras dos fallos; se reanudó con el plan aprobado y una corrección específica de empaquetado. Ya se comprobaron ambos JSON, cuatro binarios comprimidos, Chromium 153.0.8010.0 y WebGL2 con lectura de píxel verde. Producción diagnóstica `dpl_7azPun7M12Ry389bmMveGMv5Pc5r` incorpora main/PR #28 y H1; checkout sigue deshabilitado y origen/RP ID siguen siendo agenticreality.space. Esa prueba técnica no publica anuncios ni acredita entrega. El recorrido integrado posterior aún debe validarse. Ver [checkpoint del piloto](docs/ads/main-stage-checkpoint.json); [fallo histórico preservado](docs/ads/vercel-verification.json).
