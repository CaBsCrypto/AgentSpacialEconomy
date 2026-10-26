# THESIS — Agentic Realities · Spatial AI for Venues and Events

> Single source of truth. Change the idea **here first**, then update `SPEC.md`, `DESIGN.md`, the README, the landing hero and the pitch.

## One line

**Your venue's AI operator automating your event AR layer with x402 on a capped USDC budget.**

The official public name was approved on 26 Oct 2026 for the landing and README. The recorded HackMeridian demo, dashboard and submission materials retain their historical name, **Spatial Agents · Operating System**. The current implementation remains a bounded Stellar testnet prototype; physical AR placement is unverified.

## Who it is for

The intended user is the person who runs the digital layer of a physical venue: the operations or marketing lead of an event venue, a university campus, a museum or an innovation district. Our proposed first pilot is One Sixteen Venue in Lisbon; no agreement or partnership is in place.

Our design lets the operator state objectives, a budget and rules, then inspect the agent's actions and spending. The current prototype demonstrates one bounded testnet loop.

## The problem

From organizing events ourselves, we have seen a lack of experiences that surprise attendees. We want to help teams plan 3D and AR experiences and communicate those plans more clearly.

This prototype tests one mechanism for that digital layer: an operator gives agents a bounded content and data budget, each purchase is recorded, and the purchased result appears in the venue's digital twin. A venue pilot will test operator demand, coordination benefits and willingness to pay. Physical AR placement remains unverified.

## The seed (us) → the thesis (us + AI)

- **Seed:** give a place objectives and a budget, and let accountable agents coordinate its digital experiences. Visitors meet the result through the venue's digital twin, their phone and AR.
- **Hypothesis to test:** an operator will delegate spending on content, data and compute to an agent **if every payment is capped, logged, tied to an objective and visible**. Our Stellar testnet loop tests the payment and accountability mechanism; a venue pilot would test its value to operators.

## Why Stellar

| Need | What Stellar gives us |
| --- | --- |
| Agents pay per call for data and content | **x402 on Stellar**: the agent signs auth entries only; a facilitator assembles, pays fees and settles in USDC. The facilitator pays the fees for those x402 payments. |
| A ceiling on what the agent can draw from the treasury | **Implemented on testnet:** a SEP-41 allowance on the USDC Stellar Asset Contract, with an amount and ledger expiry. A 0.50 USDC approval and 0.20 USDC draw settled; a further 0.31 USDC draw was refused during simulation, without submission. The agent's ledger separately enforces per-call limits before signing. Per-day smart-account policies remain future work. |
| Income that refills the budget | **Recorded on testnet (run 3):** a sponsor pays the venue treasury over x402 for a stage-screen line; the treasury re-approves the agent's SEP-41 allowance by that income. |
| Money that matches the receipt | Every settled call has a testnet transaction hash the operator can open in an explorer. |
| An audience that already has an event identity | **Stellar Passport** (a HackMeridian partner) already turns attendance into an on-chain profile. Future, opt-in layer; not part of this MVP. |

## Track

**Genesis → Stellar Composed.** We compose x402 paid APIs, Stellar USDC, a SEP-41 treasury allowance and an agent-side policy ledger into one bounded testnet loop. Per-day smart-account policies are future work. See the [recorded transactions](README.md#on-chain-evidence-stellar-testnet) and the official [token interface](https://developers.stellar.org/docs/tokens/token-interface).

## What already exists (checked against the Stellar ecosystem database bundled in stellar-build)

| Project | What it does | How we differ |
| --- | --- | --- |
| Wadzzo | Geolocated rewards that organizations place in the world | Consumer rewards; we serve the operator's spend and accountability. |
| IRL | Loyalty and collectibles for brands and venues | Issues rewards; we buy services for the venue. |
| Stellar Passport | Event attendance as long-term engagement | Complementary audience layer we could plug into later. |
| Stellar AI Agent Kit, Crossmint | Agent tooling and agent wallets | Infrastructure we could build on; they do not model a venue, its zones or a budget mandate. |

This is an initial landscape, not an exhaustive competitor or adoption study.

## What we do not claim

- No deployed autonomous economy. One bounded loop on **testnet**.
- No verified physical AR anchoring. The ONE16 twin is an interpretive reconstruction.
- No real money, no mainnet, no personal-data ingestion.
- No affiliation with Stellar, HackMeridian, ONE16 or Stellar Passport.

## How this maps to the judging rubric

Judges rate each criterion 1–10 and weight it into a total out of 100 (HackMeridian portal). Detailed self-check in [DEMO.md](DEMO.md).

| Criterion (weight) | Our answer |
| --- | --- |
| Thematic alignment (20%) | Agent with a wallet and a spending cap paying APIs in USDC over x402. |
| User value & problem (20%) | Our event experience motivates better spatial experiences and team communication; the budget experiment makes each testnet purchase visible and auditable. Operator value remains to be tested. |
| Technical execution (15%) | Real testnet settlements, enforced cap, idempotent retries, tests. |
| Innovation (15%) | Budgets and accountability for the digital layer of physical space. |
| Hackathon progress (10%) | Docs, issues, PRs and the payment loop are built during the event; the submission states exactly what existed before. |
| Market & ecosystem potential (10%) | Proposed first pilot: One Sixteen Venue, without an agreement; campuses and museums are later target markets. |
| Product design & UX (10%) | One story and one look across the venue, the dashboard, the deck and the video. |
