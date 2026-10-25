# DEMO — 3 minutes, deck and submission

Judges score the demo, not the idea. Rehearse with a timer at least twice before recording.

Judging is asynchronous: they review the **demo video, pitch deck, GitHub repo and submission answers**, and they use the product like beta testers. After technical execution, presentation and UX matter most. If a judge cannot open it and see it work, it does not count.

## Rubric self-check (do it Monday 07:00 with Raven, fix the weakest first)

| Criterion (weight) | Question to answer in one sentence, with evidence |
| --- | --- |
| Track alignment (20%) | Which two or more ecosystem tools do we compose, and where in the demo does each one appear? |
| User value & problem (20%) | Who asked for this? Which operator, which pain, what does it cost them today? |
| Technical execution (15%) | Can a judge trigger or verify a real testnet payment and see the cap refuse an overspend? |
| Innovation (15%) | What does this do that Wadzzo, IRL, Stellar Passport or an agent wallet kit alone does not? |
| Hackathon progress (10%) | What exactly was built between Sun 09:00 and Mon 12:00? Does the git history show it? |
| Market & ecosystem potential (10%) | Who pays after the event, how often, and what is the next step (SCF, pilot venue)? |
| Product design & UX (10%) | Can a stranger understand the dashboard in 10 seconds, on a phone? |

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

1. **Name + one-liner.** Same words as the README.
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
