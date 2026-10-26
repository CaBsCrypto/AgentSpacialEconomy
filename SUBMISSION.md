# SUBMISSION — paste-ready answers for the HackMeridian portal

Deadline: **Mon 26 Oct 2026, 12:00 WET**. Required to submit: title, description, track, repository link, demo video link (YouTube or Vimeo), pitch deck file (PDF, PPTX, PPT or HTML, up to 20 MiB) and accepted terms.

**Treat *Submit project* as final.** The portal page says a submitted project stays editable until the close, but the kickoff slide (Day 1, 0:07:20) says Submit is final and locked by the server clock. Save drafts until everything is in, then press Submit once. Ask an organizer if you need to change something after that.

**Prizes we can target:** Genesis ranking (4 places across both tracks, 2 finalists per track) and the Smol Wins **Best GTM** and **Best UX** (one prize per team at most). The GTM paragraph below and the dashboard/landing are written with those in mind.

The team disclosures below are confirmed. Add the final video URL and deck file only after they are verified. Keep the same words in the README, deck and video.

---

## Project title *

Spatial Agents · Operating System

## Tagline (max 120 characters)

Your venue's AI operator, on a capped USDC budget.

<!-- The brand line "AGENTIC REALITY · AUGMENTED SPATIAL EXPERIENCES" goes on the deck and video title cards, not here: judges read the tagline to learn what the product does. -->

## Description * (Markdown, max 8000 characters)

**Spatial Agents · Operating System** lets the people who run a physical venue hand its digital layer — stage screens, signage, activations — to accountable agents. The operator sets an objective, a budget and rules. Agents spend it per call, in USDC on Stellar, and every payment is capped, logged and visible.

**What we built at HackMeridian**

- **A venue agent and a stage agent.** The venue agent allocates part of the operator's budget to the stage agent (one zone, one sub-budget).
- **Paid venue services over x402.** The stage agent buys the schedule fixture (0.01 USDC) and then a screen card for the next session (0.05 USDC). Payments use x402 v2 (`exact` scheme) on Stellar testnet through a fee-sponsored facilitator: the agent signs Soroban auth entries only and needs no XLM to pay the fees of those x402 payments.
- **A budget ceiling the network enforces.** The operator's treasury approves the venue agent a SEP-41 allowance on the USDC contract (amount = budget, approved with a roughly 24-hour ledger window). The agent starts with no USDC, draws exactly its allocations with `transfer_from`, and a draw above the remaining allowance is refused during network simulation without being submitted.
- **A budget ledger that says no before signing.** Allow-list, per-call cap, approval threshold and allocations are checked before any signature. The agent also reads the server's `402 Payment Required` and refuses if it asks for more than it reserved. In the demo, a 0.25 USDC "premium render" is refused by the 0.10 cap and shown as *needs operator approval*. Reruns with the same run id never pay twice.
- **An operator dashboard.** Mandate, budget per agent, the agent credit pool (1 credit = 0.01 USDC), every attempt with its Stellar transaction checked live on Horizon testnet, and the refused call.
- **Income that refills the budget.** A sponsor pays the venue treasury 0.10 USDC over x402 for a line on the stage screen; the treasury then re-approves the agent's SEP-41 allowance by that amount (0.30 → 0.40 USDC, read back from the network).
- **Paid screen time recorded on Soroban.** An advertiser pays the venue treasury 5 USDC over x402 for five minutes of the main-stage screen. The treasury commits that order to AdsRegistry, a noncustodial Soroban contract we wrote during the event, with the x402 settlement hash as its payment reference, and reads it back (`Queued`, nothing delivered yet).
- **The result in the place.** The card the stage agent paid for appears on the main stage of our 3D digital twin of ONE16, the HackMeridian venue.
- **A visitor wallet in one tap.** At the activation totem in the twin, a visitor creates a passkey smart wallet on Stellar testnet and receives 100 test USDC from the Sozu faucet. Tested on a phone on 26 Oct: wallet `CDKOF36Q7DSFDL7EG34YSU2IWC7NXGKJOHUX3IO2A6HPF3OU5KVFQTGM`, created in tx `276528f3c6c5c8f6f91b8b9eb9e16da27788f8d978c6c91b2edbbfeb22b8d683`, funded with 100 USDC in tx `6832aee53b91ef4402e911699a51f27dd4d31d1708409ee45d4a1fd694ad418f`.
- **A reproducible testnet run.** One command (or a GitHub Actions workflow) creates throwaway testnet accounts, funds the treasury with testnet USDC through a DEX path payment, approves the allowance, draws the allocation, starts the services and runs the loop.

**On-chain evidence (Stellar testnet, 26 Oct 03:21 UTC, run 3):** allowance `approve` 0.50 USDC — tx `9bcab3db185200309a3d1bb63ef09c128212d68b8418ffaf2a192206f7ffe62d`; budget draw 0.20 USDC — tx `7d9edc0a7c3cd8e888dcb5d87e418b671bdd2222dbb709c51896031c428ad3fb`; a 0.31 USDC draw refused during network simulation, with nothing submitted; `venue-feed` 0.01 USDC — tx `ebb69bd495625e948fdb1ce6f3e1ee8b21eaea343fe77b086bed4849598c667a`; `screen-card` 0.05 USDC — tx `a5378f6257a5e21c67d9d9f49c248e3af32f5170ba94fabbb2108ccd01387ac0`; sponsor slot 0.10 USDC paid to the treasury — tx `821f7b12035a34dc4bae796e91404a4358cade7626c36d0d18aeb9eda441b5e3`; treasury re-approves 0.40 USDC — tx `d954f245d335089680cd095e07912efb4c9eab5564862bb4a48b74d49ecc7bc9`. The service wallet received exactly 0.06 USDC; x402 fees were paid by the facilitator. Run 2 (01:23 UTC) is in the README.

**Paid screen time (26 Oct 06:24 UTC):** advertiser pays the treasury 5 USDC over x402 — tx `06dcd5b2b16f7f9419c1b029306b09d74dab0187cb5626f7aa8040cbe352decc`; AdsRegistry instance `CCF3QILVXKYOUE4M2SVZJYOWYQZ3IMS3DODPKPN2UVZELIKMVI63OCQS` deployed — tx `3b0eb98b2c82d2fd994691ad9d59289f2d858a5654d77abb0cac86058da4bb30`; order committed with that payment hash — tx `0a15bdb401be7ea1970acf2153129b839b38108bff03a515000ac16cb3fa9509`; read back `Queued`.

**Stellar pieces composed:** x402 (paid APIs) + USDC via its Stellar Asset Contract (payments and a SEP-41 allowance as the on-chain budget ceiling) + a Soroban contract that records paid ad orders + Horizon/DEX for funding + a policy ledger in front of the agent wallet. Next: per-day caps in a smart account (OpenZeppelin policies or Nido session keys).

**Honest scope:** one bounded loop and one recorded ad order on testnet, deterministic plan, no real money; the ad order is committed but not delivered; physical AR placement is not verified yet.

## Problem solved

From organizing events ourselves, we have seen a lack of experiences that surprise attendees. We want to help teams plan 3D and AR experiences and communicate those plans more clearly.

This prototype tests one mechanism for that digital layer: an operator gives agents a bounded content and data budget, each purchase is recorded, and the purchased result appears in the venue's digital twin. A venue pilot will test operator demand, coordination benefits and willingness to pay. Physical AR placement remains unverified.

## Challenges

- **Getting testnet USDC without a captcha in CI.** The Circle faucet needs a human, so our runner buys a little testnet USDC with XLM through a DEX path payment and runs end to end with throwaway accounts.
- **Never paying twice, never paying more.** We added a reserve/settle/release ledger with idempotency keys and a preflight check of the server's 402 price before the agent signs anything.
- **Secrets in CI.** An empty CI variable silently overrode the agent key; we now pass run variables to each process explicitly and scan published files for Stellar secret keys.
- **Showing money in a 3D place.** The purchased card is drawn on the twin's stage backdrop without touching the venue model, and nothing changes when no run is published.

## What's next

- Per-day spending policies in a smart account, building on the SEP-41 treasury allowance already demonstrated on testnet.
- Operator approvals from the dashboard for refused calls.
- More zones and agents (stands, check-in, sponsor slots) and the revenue side: third parties paying to appear on screens or in AR.
- Opt-in Stellar Passport profiles for visitors.
- A proposed pilot at One Sixteen Venue, followed by research with permanent spaces and a possible SCF application. No pilot agreement or partnership is in place.
- Operator approval in the operator's own wallet: passkey smart accounts with per-day caps and expiry (Nido, OpenZeppelin smart accounts), and agent-drafted transactions that a human signs.
- Discovery both ways: our agents finding paid data services through an x402 marketplace, and venues selling screen and AR slots to other agents.

**Go-to-market:** Our proposed first pilot is One Sixteen Venue; no agreement or partnership is in place. We would test whether event operators can plan compelling spatial experiences and delegate a small, auditable content budget. A per-event mandate with a service margin is our business-model hypothesis. Campuses, innovation districts and museums are later target markets, subject to pilot results.

## Repository link *

https://github.com/CaBsCrypto/AgentSpacialEconomy

## Project website link

https://agenticreality.space

Operator dashboard: https://agenticreality.space/dashboard.html · ONE16 twin: https://agenticreality.space/one16. Verify these links and the root discovery files before submission.

## Demo video link * (YouTube or Vimeo)

Pending human upload: paste the final YouTube or Vimeo URL here after confirming that the 3-minute video plays without signing in.

## Deck file *

Attach `docs/submission/spatial-agents-deck.pdf`: the verified final 7-slide PDF (1.401 MiB), with real dashboard/twin screenshots and a linked testnet transaction hash. Upload the PDF file in the portal; its repository copy is https://github.com/CaBsCrypto/AgentSpacialEconomy/blob/main/docs/submission/spatial-agents-deck.pdf.

## Thematic track

Stellar Composed (builder track: Genesis — already assigned)

## Tech stack (comma-separated, max 25)

Stellar testnet, x402, USDC, Stellar Asset Contract, SEP-41, Soroban (Rust contract and auth entries), Horizon, @stellar/stellar-sdk, @x402/express, @x402/fetch, @x402/stellar, Node.js, Express, Three.js, model-viewer, Blender, GitHub Actions, Vercel, HTML, CSS, JavaScript, smart-account-kit, @sozu/faucet, @upstash/redis, esbuild

## Prior work disclosure

We started this project during HackMeridian; no project work existed before hacking opened at 09:00 WET on Sunday 25 October 2026. Our team created the landing page and ONE16 digital twin during the hackathon, using our own venue photos and videos and AI-assisted development. The agent, paid services, allowance integration, budget ledger, dashboard, stage screen, CI runner and supporting documentation were also built during the event. The repository's first commit is dated 25 October 2026, 10:30 WET; its public history records the work. Third-party software is used under its respective licenses.

## AI tooling note

We used Claude, OpenAI Codex and Dot during the hackathon for AI-assisted development and preparation of project materials. Our team chose the problem, scope and design, reviewed the outputs and tested the prototype.

## Before pressing Submit

- [ ] Repository is public and the README shows summary, problem, setup, environment variables, demo instructions, the Stellar architecture, on-chain evidence and prior work.
- [ ] Live URL opens on a phone, logged out, and the dashboard shows the recorded run.
- [ ] Video link plays logged out; deck PDF opens.
- [ ] Our team has reviewed all fields, the video and the attached deck with the person handling the portal.
- [ ] The person has accepted the terms and saved a draft.
- [ ] After the final review, press **Submit project once at 11:00 WET on Monday 26 October** and record the confirmation URL. Treat the action as final.
