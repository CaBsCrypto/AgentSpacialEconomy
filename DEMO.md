# DEMO — 3 minutes, deck and submission

Judges score the demo, not the idea. Rehearse with a timer at least twice before recording.

Judging is asynchronous: they review the **demo video, pitch deck, GitHub repo and submission answers**, and they use the product like beta testers. After technical execution, presentation and UX matter most. If a judge cannot open it and see it work, it does not count.

## Rubric self-check (official portal rubric: each criterion rated 1–10, weighted to a total out of 100)

Scale: 1–2 poor · 3–4 below expectations · 5–6 meets expectations with clear evidence · 7–8 strong, minor gaps · 9–10 exceptional, compelling evidence. Judges weigh what the team shows by the end of HackMeridian against its starting point.

| Criterion (weight) | Portal question | Our evidence — aim for 9–10 |
| --- | --- | --- |
| Thematic alignment (20%) | How effectively does the project deliver on its selected Stellar theme (Stellar Composed)? | An agent with a wallet and a spending cap pays APIs in USDC over x402 — the track's own example. Show the 402 → signature → settlement chain and the cap refusing a call. |
| User value & problem (20%) | How clearly does it address a real problem for its intended users? | One named operator, one pain, one sentence of first-hand evidence; the dashboard answers "what did we pay for, and why" in 10 seconds. |
| Technical execution (15%) | How reliably does the demonstrated implementation work? | Real testnet transactions in the README, a CI run anyone on the team can repeat, 19 ledger tests, fail-closed services. |
| Innovation (15%) | How original and useful is the approach? | Budgets and accountability for the digital layer of physical space; preflight price check before signing. |
| Hackathon progress (10%) | How much meaningful new work during HackMeridian? | First commit Sun 10:30 WET; everything in git was built at the event. Say it plainly in the prior-work field. |
| Market & ecosystem potential (10%) | How credible are adoption and the contribution to Stellar? | Venues, campuses, museums run all year; every screen update is a stablecoin micropayment on Stellar; next step SCF + a pilot venue. |
| Product design & UX (10%) | How clear and usable for its intended users? | One look (DESIGN.md), labels not just colors, works on a phone, the twin shows the result where the audience would see it. |

Ask Raven: "Given these judging criteria, what is weakest in this project?" and paste THESIS.md. Then take the answer to a mentor.

## Video script (3:00)

| Time | Block | On screen | Say (paraphrase, keep it short) |
| --- | --- | --- | --- |
| 0:00–0:30 | **Problem** | Title card with the one-liner, then the ONE16 twin | One operator, one venue, many screens. The schedule changes, content and data come from several vendors, and nobody can say what each payment bought. |
| 0:30–2:00 | **Live demo** | Dashboard → Run → ledger rows appear → explorer tx → twin stage screen updates → blocked card | Give the venue a budget and an objective. The venue agent hands the stage a sub-budget. The stage agent pays for the schedule and a screen card in testnet USDC over x402. Here are the transactions. Here is the screen. And here the agent tried to overspend and was stopped before it signed anything. |
| 2:00–2:30 | **How** | Simple diagram: mandate → agents → x402 facilitator → Stellar → ledger → screen | Why Stellar: agents pay per call without holding XLM, settlement in seconds, every payment has a hash. Built with the official Stellar skills and Raven. |
| 2:30–3:00 | **Next** | Backlog list, repo link card | On-chain spending limits with OpenZeppelin policies, more zones, the revenue side for sponsors, opt-in Stellar Passport profiles, and permanent spaces like campuses and museums. |

Keep the recorded backup of the full run ready. If the live run stalls, cut to the backup without comment.

## Deck outline (7 slides)

1. **Brand line + name + one-liner.** `AGENTIC REALITY · AUGMENTED SPATIAL EXPERIENCES` small above *Spatial Agents · Operating System*, then the one-liner. Same words as the README.
2. **Problem.** One operator, one venue, scattered spend. One sentence of first-hand evidence.
3. **What it does.** Mandate → venue agent → stage agent → paid services → visible result.
4. **Demo screenshots.** Ledger with a real testnet tx hash, the stage screen, the blocked card.
5. **Stellar integration.** x402 on Stellar with USDC; facilitator-sponsored fees; why per-call payments matter here; stretch: OpenZeppelin spending-limit policy.
6. **Market.** Events first; campuses, museums and innovation districts run all year. Who pays and why.
7. **Next + team.** Backlog, what we built during the event, links (repo, demo, video).

## Submission data (fill in, same words everywhere)

| Field | Value |
| --- | --- |
| Project name | <!-- TEAM: the one name from DESIGN.md --> |
| One-liner | Your venue's AI operator, on a capped USDC budget. <!-- TEAM: confirm --> |
| Path / track | Genesis · Stellar Composed |
| Repository | https://github.com/CaBsCrypto/AgentSpacialEconomy |
| Live demo | <!-- deployed dashboard + twin URL --> |
| Video | <!-- link, works logged out --> |
| Deck | <!-- PDF link --> |
| Stellar integration (one sentence) | A budget-capped agent pays for data and content per call in testnet USDC over x402; every payment is logged with its transaction hash. |
| Built during the event | Agent, paid services, ledger, dashboard, stage-screen integration, docs. <!-- TEAM: list exactly what existed before Sun 25 Oct 09:00 and what was built here; judges check git history and value a sharp scope over a long feature list. If the twin was started earlier, say so and say what changed at the event. --> |
| Test it yourself | <!-- link to the judge-testable run (#15) or the 5-minute README path --> |
