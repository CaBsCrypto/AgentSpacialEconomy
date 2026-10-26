# DEMO — 3 minutes, deck and submission

Judges score the demo, not the idea. Rehearse with a timer at least twice before recording.

Judging is asynchronous: they review the **demo video, pitch deck, GitHub repo and submission answers**, and they use the product like beta testers. After technical execution, presentation and UX matter most. If a judge cannot open it and see it work, it does not count.

## Rubric self-check (official portal rubric: each criterion rated 1–10, weighted to a total out of 100)

Scale: 1–2 poor · 3–4 below expectations · 5–6 meets expectations with clear evidence · 7–8 strong, minor gaps · 9–10 exceptional, compelling evidence. Judges weigh what the team shows by the end of HackMeridian against its starting point.

| Criterion (weight) | Portal question | Our evidence — aim for 9–10 |
| --- | --- | --- |
| Thematic alignment (20%) | How effectively does the project deliver on its selected Stellar theme (Stellar Composed)? | An agent with a wallet and a spending cap pays APIs in USDC over x402 — the track's own example. Show the 402 → signature → settlement chain and the cap refusing a call. |
| User value & problem (20%) | How clearly does it address a real problem for its intended users? | First-hand event experience motivates spatial planning and communication; distinguish that evidence from the budget hypothesis. |
| Technical execution (15%) | How reliably does the demonstrated implementation work? | Real testnet transactions in the README, a CI run anyone on the team can repeat, the passing agent test suite, fail-closed services. |
| Innovation (15%) | How original and useful is the approach? | Budgets and accountability for the digital layer of physical space; preflight price check before signing. |
| Hackathon progress (10%) | How much meaningful new work during HackMeridian? | First commit Sun 10:30 WET; everything in git was built at the event. Say it plainly in the prior-work field. |
| Market & ecosystem potential (10%) | How credible are adoption and the contribution to Stellar? | Proposed pilot at One Sixteen Venue, without an agreement; test the per-event mandate business model before expanding. |
| Product design & UX (10%) | How clear and usable for its intended users? | One look (DESIGN.md), labels not just colors, works on a phone, the twin shows the result where the audience would see it. |

Ask Raven: "Given these judging criteria, what is weakest in this project?" and paste THESIS.md. Then take the answer to a mentor.

## Video script (3:00)

Use the exact project name **Spatial Agents · Operating System**, brand line **AGENTIC REALITY · AUGMENTED SPATIAL EXPERIENCES**, and one-liner **Your venue's AI operator, on a capped USDC budget.** Show the one-liner in the first five seconds.

| Time | Block | On screen | Say (paraphrase within the time) |
| --- | --- | --- | --- |
| 0:00-0:30 | **Problem** | Brand/title card, then the ONE16 twin | From organizing events ourselves, we have seen a lack of experiences that surprise attendees. We want teams to plan 3D and AR experiences and communicate those plans more clearly. This prototype tests a bounded way for a venue's agent to buy the content and data behind an experience, with a record of what each payment produced. |
| 0:30-2:00 | **Testnet demo** | Dashboard recorded-run label, On-chain budget ceiling, both payment rows, stellar.expert, then /one16 and the stage card, then blocked card | Here is a recorded real testnet run. The operator approved 0.50 USDC with an expiring SEP-41 allowance. The agent drew 0.20; a further 0.31 draw exceeded the remaining allowance and was refused during network simulation, with nothing submitted. The stage agent bought the schedule fixture for 0.01 and the Morning briefing screen card for 0.05 USDC over x402. Open one transaction to inspect the settlement. In the ONE16 twin, select Vive la experiencia and walk to the main stage: the purchased card appears over the backdrop. Back on the dashboard, the 0.25 USDC premium render is blocked by the 0.10 per-call cap before signing. These are separate protections: the USDC contract limits treasury draws; our policy ledger checks each proposed call. |
| 2:00-2:30 | **How** | Diagram: mandate, treasury allowance, venue/stage agents, x402, Stellar, ledger, screen | The plan is deterministic. The operator sets the objective and budget. The USDC contract enforces the treasury allowance, while the policy ledger checks the service, price and allocation before the agent signs. A facilitator settles the x402 payments and pays their fees. The resulting transaction hashes and card connect spending to a visible result. |
| 2:30-3:00 | **Next** | Proposed pilot, future-work labels, repo/site end card | Our proposed first pilot is One Sixteen Venue; no agreement or partnership is in place. We want to test whether the budget mechanism helps real operators, then explore more zones, human approvals and per-day smart-account policies. Physical AR placement is still unverified. Everything shown here was built during HackMeridian with our own venue references and AI-assisted development. |

Record a complete backup before the final take. Label any reused run as **Recorded testnet run** with its actual date; do not imply that a static dashboard starts payments. If a fresh run is needed, the person opens [Testnet loop](https://github.com/CaBsCrypto/AgentSpacialEconomy/actions/workflows/testnet-loop.yml), chooses **Run workflow** on **main**, waits for a successful run and verifies its artifacts. A new workflow result does not update the public site automatically.

Human steps: start the screen recording, capture the dashboard and explorer without secrets, walk to the stage, record a second take, then upload the final video to YouTube as unlisted or to Vimeo. Verify playback without signing in before adding the link to SUBMISSION.md. Keep the backup recording available.

## Deck outline (7 slides)

Export a PDF strictly under **20 MiB**. Use the DESIGN.md colors and typography, English text, and at least one complete real transaction hash with its testnet explorer link.

1. **Brand + name + one-liner.** `AGENTIC REALITY · AUGMENTED SPATIAL EXPERIENCES` above *Spatial Agents · Operating System*, then `Your venue's AI operator, on a capped USDC budget.`
2. **Problem.** Our first-hand event experience: a lack of experiences that surprise attendees. Goal: plan 3D/AR experiences and improve team communication. Label the spending problem as a hypothesis to test.
3. **What it does.** Operator mandate and treasury allowance, venue agent, stage agent, paid services, visible result. One zone and a deterministic plan on testnet.
4. **Demo evidence.** Dashboard with 0.01/0.05 USDC payments and real hashes, the Morning briefing card on the stage, and the blocked 0.25 USDC call. Label captures as a recorded run.
5. **Stellar integration.** SEP-41 allowance: approve 0.50, draw 0.20, reject a further 0.31 in simulation. x402 payments with facilitator-paid fees. Per-call cap in the agent ledger; per-day smart-account policies are future work.
6. **Market experiment.** Proposed first pilot: One Sixteen Venue, no agreement. Test a per-event mandate and service margin; campuses and museums are later target markets.
7. **Next + our team.** Built during HackMeridian from our own venue photos/videos. AI tools: Claude, OpenAI Codex, Dot. Future work and links to repo, website and final video. Physical AR placement remains unverified.

## Submission data (fill in, same words everywhere)

| Field | Value |
| --- | --- |
| Project name | Spatial Agents · Operating System |
| One-liner | Your venue's AI operator, on a capped USDC budget. |
| Path / track | Genesis · Stellar Composed |
| Repository | https://github.com/CaBsCrypto/AgentSpacialEconomy |
| Website | https://agenticreality.space |
| Dashboard | https://agenticreality.space/dashboard.html |
| ONE16 twin | https://agenticreality.space/one16 |
| Video | Pending human upload and playback verification without signing in; put the final URL in SUBMISSION.md. |
| Deck | Pending final PDF verification and portal attachment; strictly under 20 MiB. |
| Stellar integration | A SEP-41 allowance bounds treasury draws; an agent-side policy ledger checks calls before x402 payments in testnet USDC, each with a transaction hash. |
| Built during the event | Landing, ONE16 twin, agent, paid services, allowance integration, ledger, dashboard, stage screen, CI runner and docs. No project work existed before the event; our team used its own venue photos/videos. |
| AI tools | Claude, OpenAI Codex, Dot. |
| First pilot | One Sixteen Venue, proposed without an agreement or partnership. |
| Test it yourself | [Agent setup and recorded evidence](agent/README.md); [Testnet loop workflow](https://github.com/CaBsCrypto/AgentSpacialEconomy/actions/workflows/testnet-loop.yml). |

Feature freeze: **Monday 26 October, 09:15 WET**. Review the saved portal draft with the person and submit once at **11:00 WET**, ahead of the **12:00 WET** close. Login, upload, terms acceptance and portal clicks are human steps: guide one step at a time and wait for confirmation.
