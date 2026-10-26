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

Show **AGENTIC REALITY · AUGMENTED SPATIAL EXPERIENCES**, **Spatial Agents · Operating System**, and **Your venue's AI operator, on a capped USDC budget.** in the opening title card; the one-liner appears in the first five seconds. The narration below is 344 words; rehearse it with the exact block timings before recording.

| Time | Block | On screen | Narration |
| --- | --- | --- | --- |
| 00:00-00:30 | **Problem** | Title card and ONE16 twin. | Your venue's AI operator, on a capped USDC budget. From organizing events ourselves, we have seen a lack of experiences that surprise attendees. We want teams to plan 3D and AR experiences and communicate those plans more clearly. Spatial Agents · Operating System tests a budget for content and data purchases, with a record and a visible result. |
| 00:30-02:00 | **Demo** | Recorded-run label, On-chain budget ceiling, both payment rows, stellar.expert, /one16 stage card and blocked call. | Here is the operator dashboard, showing a recorded run on Stellar testnet. No real funds are involved. The operator gives the main stage an objective: show the agenda and the next session. The budget is fifty cents in testnet USDC. The treasury approves an expiring SEP-41 allowance. The agent draws twenty cents. A further thirty-one-cent draw exceeds the remaining allowance and is rejected during network simulation. Nothing is submitted. The stage agent buys the schedule fixture for one cent and a screen card for five cents over x402. Both settled payments have transaction links. Opening one in Stellar Expert shows the actual testnet receipt. Now we enter the ONE16 digital twin and walk to the main stage. The purchased card, Morning briefing, appears on the backdrop. The receipt connects to a visible result. The treasury allowance and the per-call cap provide two separate spending checks. Finally, a twenty-five-cent request is blocked before signing: it exceeds the ten-cent per-call cap. The dashboard explains the refusal and shows that operator approval is needed. |
| 02:00-02:30 | **How** | Mandate, treasury allowance, agents, x402, Stellar, ledger and screen diagram. | The flow is a mandate, a venue agent, a stage agent, and paid services. The agent receives an x402 payment challenge, checks the price, and signs only when the budget rules allow it. The facilitator settles the payments in USDC on Stellar testnet and pays their fees. Transaction hashes connect the ledger to the stage card. |
| 02:30-03:00 | **Next** | Proposed pilot, future-work labels, repo/site end card. | Our proposed first pilot is One Sixteen Venue. No agreement or partnership is in place. We want to test operator value, then explore more zones, human approvals, per-day smart-account policies, and sponsor revenue. Our team built this during HackMeridian using our own venue photos and videos, with Claude, OpenAI Codex and Dot. Physical AR placement remains unverified. Explore agenticreality.space. |

Record a complete backup before the final take. Label any reused run as **Recorded testnet run** with its actual date. The static dashboard does not start payments. If fresh evidence is needed, the person opens [Testnet loop](https://github.com/CaBsCrypto/AgentSpacialEconomy/actions/workflows/testnet-loop.yml), chooses **Run workflow** on **main**, waits for success and verifies artifacts; workflow results do not update the site automatically.

Human steps: start recording, capture dashboard/explorer without secrets, walk to the stage, record a second take, review, then upload to YouTube as unlisted or Vimeo. Verify playback without signing in before adding the final URL to SUBMISSION.md.

## Deck outline (7 slides)

Export a PDF strictly under **20 MiB**, using DESIGN.md colors and DM Sans. Include at least one complete real transaction hash with its testnet explorer link.

1. **Brand + name + one-liner.** Use the three exact opening texts above.
2. **Problem.** Our first-hand event experience: a lack of experiences that surprise attendees. Goal: plan 3D/AR experiences and improve team communication. Spending benefits are a hypothesis to test.
3. **What it does.** Operator mandate, treasury allowance, venue agent, stage agent, paid services, visible result. One zone and a deterministic testnet plan.
4. **Demo evidence.** Dashboard with 0.01/0.05 USDC payments and real hashes, Morning briefing on the stage, blocked 0.25 USDC call. Label captures as a recorded run.
5. **Stellar integration.** SEP-41 allowance: approve 0.50, draw 0.20, reject a further 0.31 in simulation. x402 payments with facilitator-paid fees. Agent-side per-call cap; per-day smart-account policies are future work.
6. **Market experiment.** Proposed first pilot: One Sixteen Venue, without an agreement. Test a per-event mandate and service margin; campuses/museums are later target markets.
7. **Next + our team.** Built during HackMeridian from our own venue photos/videos. AI: Claude, OpenAI Codex, Dot. Future work and repo/site/final-video links. Physical AR placement remains unverified.

## Submission data (same words everywhere)

| Field | Value |
| --- | --- |
| Project name | Spatial Agents · Operating System |
| One-liner | Your venue's AI operator, on a capped USDC budget. |
| Path / track | Genesis · Stellar Composed |
| Repository | https://github.com/CaBsCrypto/AgentSpacialEconomy |
| Website | https://agenticreality.space |
| Dashboard | https://agenticreality.space/dashboard.html |
| ONE16 twin | https://agenticreality.space/one16 |
| Video | Pending human upload and logged-out playback verification; put final URL in SUBMISSION.md. |
| Deck | Pending final PDF verification and portal attachment; strictly under 20 MiB. |
| Built during event | Landing, twin, agent, paid services, allowance, ledger, dashboard, stage screen, CI runner and docs. No prior project work; own venue photos/videos. |
| AI tools | Claude, OpenAI Codex, Dot. |
| First pilot | One Sixteen Venue, proposed without an agreement or partnership. |
| Test it yourself | [Agent setup and recorded evidence](agent/README.md); [Testnet loop workflow](https://github.com/CaBsCrypto/AgentSpacialEconomy/actions/workflows/testnet-loop.yml). |

Feature freeze: **Monday 26 October, 09:15 WET**. Review the portal draft with the person and submit once at **11:00 WET**, before the **12:00 WET** close. Login, upload, terms and portal clicks are human steps: guide one step at a time and wait for confirmation.
