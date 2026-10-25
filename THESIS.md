# THESIS — Agentic Spatial Economy

> Single source of truth. Change the idea **here first**, then update `SPEC.md`, `DESIGN.md`, the README, the landing hero and the pitch.

## One line

**Your venue's AI operator, on a capped USDC budget.**

<!-- TEAM: confirm before 01:00. Rule: under 10 words, a stranger gets it in 3 seconds, says what it does.
     Alternatives considered:
     - "Venue agents that buy content and data in USDC."
     - "Set a budget; an agent runs your venue's digital layer."
     The current README tagline (15 words) is too long for the rule. -->

## Who it is for

The person who runs the digital layer of a physical venue: the operations or marketing lead of an event venue, a university campus, a museum or an innovation district. First user: the operator of a multi-day event at a venue like ONE16 in Lisbon.

They do not run agents themselves and they do not hold crypto. They state objectives, a budget and rules. The platform agent does the rest and reports back.

## The problem

A venue's screens, signage, AR activations and sponsor slots are programmed by hand, across several vendors and data sources. During a live event the schedule changes faster than anyone can update the stage screen, and the money spent on content, data and compute is scattered across invoices with no link to what was actually shown.

<!-- TEAM: add one sentence of first-hand evidence (an event you ran, what broke, what it cost).
     Then test this paragraph with a mentor on Monday morning. If they say "nobody has this problem",
     rewrite THIS file first. -->

## The seed (us) → the thesis (us + AI)

- **Seed:** give a place objectives and a budget, and let accountable agents coordinate its digital experiences. Visitors meet the result through the venue's digital twin, their phone and AR.
- **Thesis:** an operator will delegate spending on content, data and compute to an agent **if every payment is capped, logged, tied to an objective and visible**. Stellar makes per-call payments cheap and auditable enough for that to work at the granularity of a single API call.

## Why Stellar

| Need | What Stellar gives us |
| --- | --- |
| Agents pay per call for data and content | **x402 on Stellar**: the agent signs auth entries only; a facilitator assembles, pays fees and settles in USDC. The agent wallet needs USDC but no XLM. |
| A hard spending cap the agent cannot break | **OpenZeppelin smart-account policies**: a spending-limit policy rejects transfers above a cumulative amount over a rolling ledger window. (Stretch goal for this hackathon; the MVP enforces the cap in the agent's ledger.) |
| Money that matches the receipt | Every settled call has a testnet transaction hash the operator can open in an explorer. |
| An audience that already has an event identity | **Stellar Passport** (a HackMeridian partner) already turns attendance into an on-chain profile. Future, opt-in layer; not part of this MVP. |

## Track

**Genesis → Stellar Composed.** We compose x402 (paid APIs), Stellar USDC and, as a stretch, OpenZeppelin spending-limit policies into an agent with a wallet and a budget — one of the combinations the track explicitly asks for.

## What already exists (checked against the Stellar ecosystem database bundled in stellar-build)

| Project | What it does | How we differ |
| --- | --- | --- |
| Wadzzo | Geolocated rewards that organizations place in the world | Consumer rewards; we serve the operator's spend and accountability. |
| IRL | Loyalty and collectibles for brands and venues | Issues rewards; we buy services for the venue. |
| Stellar Passport | Event attendance as long-term engagement | Complementary audience layer we could plug into later. |
| Stellar AI Agent Kit, Crossmint | Agent tooling and agent wallets | Infrastructure we could build on; they do not model a venue, its zones or a budget mandate. |

<!-- TEAM: run the `stellar-competitive-landscape` skill or ask Raven "who else builds venue or AR agents on Stellar?" and update this table. -->

## What we do not claim

- No deployed autonomous economy. One bounded loop on **testnet**.
- No verified physical AR anchoring. The ONE16 twin is an interpretive reconstruction.
- No real money, no mainnet, no personal-data ingestion.
- No affiliation with Stellar, HackMeridian, ONE16 or Stellar Passport.

## How this maps to the judging rubric

| Criterion (weight) | Our answer |
| --- | --- |
| Track alignment (20%) | Agent with a wallet and a spending cap paying APIs in USDC over x402. |
| User value & problem (20%) | Operators get one budget, one log and a visible result per payment. |
| Technical execution (15%) | Real testnet settlements, enforced cap, idempotent retries, tests. |
| Innovation (15%) | Budgets and accountability for the digital layer of physical space. |
| Hackathon progress (10%) | Docs, issues, PRs and the payment loop are all built during the event. |
| Market & ecosystem potential (10%) | Venues, campuses and museums run continuously, not just during events. |
| Product design & UX (10%) | One story and one look across the venue, the dashboard, the deck and the video. |
