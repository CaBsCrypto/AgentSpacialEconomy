# SUBMISSION — paste-ready answers for the HackMeridian portal

Deadline: **Mon 26 Oct 2026, 12:00 WET**. Required to submit: title, description, track, repository link, demo video link (YouTube or Vimeo), pitch deck file (PDF, PPTX, PPT or HTML, up to 20 MiB) and accepted terms.

**Treat *Submit project* as final.** The portal page says a submitted project stays editable until the close, but the kickoff slide (Day 1, 0:07:20) says Submit is final and locked by the server clock. Save drafts until everything is in, then press Submit once. Ask an organizer if you need to change something after that.

**Prizes we can target:** Genesis ranking (4 places across both tracks, 2 finalists per track) and the Smol Wins **Best GTM** and **Best UX** (one prize per team at most). The GTM paragraph below and the dashboard/landing are written with those in mind.

Fill the `TEAM:` gaps before pasting. Same words as the README, the deck and the video.

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
- **Paid venue services over x402.** The stage agent buys the live schedule (0.01 USDC) and then a screen card for the next session (0.05 USDC). Payments use x402 v2 (`exact` scheme) on Stellar testnet through a fee-sponsored facilitator: the agent signs Soroban auth entries only and needs no XLM for fees.
- **A budget ledger that says no before signing.** Allow-list, per-call cap, approval threshold and allocations are checked before any signature. The agent also reads the server's `402 Payment Required` and refuses if it asks for more than it reserved. In the demo, a 0.25 USDC "premium render" is refused by the 0.10 cap and shown as *needs operator approval*. Reruns with the same run id never pay twice.
- **An operator dashboard.** Mandate, budget per agent, every attempt with its Stellar transaction, and the refused call.
- **The result in the place.** The card the stage agent paid for appears on the main stage of our 3D digital twin of ONE16, the HackMeridian venue.
- **A reproducible testnet run.** One command (or a GitHub Actions workflow) creates throwaway testnet accounts, funds the agent with testnet USDC through a DEX path payment, starts the services and runs the loop.

**On-chain evidence (Stellar testnet):** `venue-feed` 0.01 USDC — tx `da696463d66a67f4c520930a9bf495b5a1752b65a540d8841ce82a5557bb8da8`; `screen-card` 0.05 USDC — tx `3b65769cb937948b2edaec3a5d260b4224ef7cc32520c3c557dfb939cb09b9d9`. The service wallet received exactly 0.06 USDC; fees were paid by the facilitator.

**Stellar pieces composed:** x402 (paid APIs) + USDC via its Stellar Asset Contract + Horizon/DEX for funding + a policy ledger in front of the agent wallet. Next: OpenZeppelin smart-account spending limits to put the cap on-chain.

**Honest scope:** one bounded loop on testnet, deterministic plan, no real money; physical AR placement is not verified yet.

## Problem solved

Operators of event venues, campuses and museums program their screens and activations by hand, across several vendors. During a live event the schedule changes faster than the stage screen, and spending on content, data and compute is scattered across invoices with no link to what was shown. They would delegate this to an agent only if every payment is capped, logged and tied to an objective. We give them exactly that: one budget, one rule set, one ledger with a transaction per payment, and the result visible in the venue. <!-- TEAM: add one sentence of first-hand evidence from an event you ran -->

## Challenges

- **Getting testnet USDC without a captcha in CI.** The Circle faucet needs a human, so our runner buys a little testnet USDC with XLM through a DEX path payment and runs end to end with throwaway accounts.
- **Never paying twice, never paying more.** We added a reserve/settle/release ledger with idempotency keys and a preflight check of the server's 402 price before the agent signs anything.
- **Secrets in CI.** An empty CI variable silently overrode the agent key; we now pass run variables to each process explicitly and scan published files for Stellar secret keys.
- **Showing money in a 3D place.** The purchased card is drawn on the twin's stage backdrop without touching the venue model, and nothing changes when no run is published.

## What's next

- On-chain spending limits: an OpenZeppelin smart account with a spending-limit policy for each agent wallet.
- Operator approvals from the dashboard for refused calls.
- More zones and agents (stands, check-in, sponsor slots) and the revenue side: third parties paying to appear on screens or in AR.
- Opt-in Stellar Passport profiles for visitors.
- A pilot in a permanent space (a campus or museum) and an SCF application (SCF #46 closes 8 Nov 2026).
- Operator approval in the operator's own wallet: passkey smart accounts with per-day caps and expiry (Nido, OpenZeppelin smart accounts), and agent-drafted transactions that a human signs.
- Discovery both ways: our agents finding paid data services through an x402 marketplace, and venues selling screen and AR slots to other agents.

**Go-to-market:** first customers are the organizers and venues of hackathons and tech events, who already run multi-day programs with live schedule changes and sponsor screens; we sell a per-event mandate (budget + rules) and take a margin on the services agents buy. From events we move to permanent spaces (campuses, innovation districts, museums) on a monthly mandate, where the same venue also earns by selling screen and AR placements. <!-- TEAM: name your first pilot venue or event network -->

## Repository link *

https://github.com/CaBsCrypto/AgentSpacialEconomy

## Project website link

https://agenticreality.space

Operator dashboard: https://agenticreality.space/dashboard.html · `llms.txt`, `robots.txt` and `sitemap.xml` are served from the site root, as the form suggests.

## Demo video link * (YouTube or Vimeo)

<!-- TEAM: upload the 3-minute video (DEMO.md) and paste the link; check it plays logged out -->

## Deck file *

<!-- TEAM: export the deck (DEMO.md outline, or the portal template) to PDF, under 20 MiB -->

## Thematic track

Stellar Composed (builder track: Genesis — already assigned)

## Tech stack (comma-separated, max 25)

Stellar, Stellar testnet, x402, USDC, Stellar Asset Contract, Soroban auth entries, Horizon, @stellar/stellar-sdk, @x402/express, @x402/fetch, @x402/stellar, Node.js, Express, Three.js, model-viewer, Blender, GitHub Actions, HTML, CSS, JavaScript

## Prior work disclosure

The repository's first commit is from Sun 25 Oct 2026, 10:30 WET, after hacking opened at 09:00, and its full history is public. Everything in it was built during HackMeridian: the ONE16 3D reconstruction and viewer, the Passport AR display, the planning docs, the x402 services, the budget ledger, the agent loop, the operator dashboard, the stage screen and the CI testnet runner. Before the event we had the concept only. <!-- TEAM: confirm, and list anything else prepared before 09:00 Sun (e.g. the supplied Passport front image, Blender sources, sketches) --> Third-party software is used under its own licenses (Three.js, model-viewer, Express, the x402 packages, the Stellar JavaScript SDK).

## AI tooling note

OpenAI Codex: 3D venue reconstruction, viewer and site source. Claude (Anthropic): planning docs, x402 paid services, budget ledger, agent loop, operator dashboard, stage screen and the CI testnet runner. Humans chose the problem, the scope and the design, reviewed the output and ran the demos. <!-- TEAM: confirm and add other tools -->

## Before pressing Submit

- [ ] Repository is public and the README shows summary, problem, setup, environment variables, demo instructions, the Stellar architecture, on-chain evidence and prior work.
- [ ] Live URL opens on a phone, logged out, and the dashboard shows the recorded run.
- [ ] Video link plays logged out; deck PDF opens.
- [ ] Terms checkbox accepted. Submit at **11:00**, not 11:59.
