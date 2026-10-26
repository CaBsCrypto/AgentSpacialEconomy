# PLAN — Sunday 23:00 to Monday 12:00 (Lisbon)

Submission closes **Mon 26 Oct, 12:00** — no late submissions. We submit at **11:00**. Feature freeze at **09:15**.
Four levels, in order: **Set up → Harness → Iterate → Promote.**

Official Monday schedule: mentor support **08:00–12:00**, morning briefing **09:00–09:15**, final build sprint 09:15–12:00, submissions close **12:00**, judging **13:30–14:45** (kickoff slide; the website said 13:00), finalist selection **14:45–15:30**, closing ceremony **15:30**. Finalists pitch live at Meridian on **Wed 28 Oct, 13:50**.

## Roles

Teams can have up to 5 people.

| Role | Owns | Issues |
| --- | --- | --- |
| **A · Payments** | services, ledger, agent run, testnet accounts | #1 – #4 |
| **B · Venue + dashboard** | stage screen in the twin, dashboard, deploy, judge-testable run | #5 – #7, #15 |
| **C · Story** | thesis, one-liner, README, deck, video, submission | #8 – #12 |

<!-- TEAM: write names next to roles. With two people, C is shared after 09:15. -->

## Sunday night

| Time | A · Payments | B · Venue + dashboard | C · Story |
| --- | --- | --- | --- |
| 23:00–23:30 | **Set up.** `scripts/setup-agent-tools.sh`, test Raven. Create agent + service accounts, trustlines. | Commit THESIS/SPEC/DESIGN/AGENTS, run `scripts/create-issues.mjs`. | **Circle faucet by hand** (captcha) → agent wallet. Pick the name and the one-liner. |
| 23:30–01:30 | **Harness.** `services.mjs` with two paid routes; first paid call settled on testnet. | Stage screen reads `state/stage.json` with fallback. Dashboard skeleton. | README first lines, landing hero copy, deck skeleton (DEMO.md). |
| 01:30 | **Checkpoint:** one real testnet tx hash for a paid call. If not, switch facilitator (OZ Channels) and take it to a mentor at 08:00. | | |
| 01:30–02:00 | Ledger tests + over-cap block. | Dashboard reads `state/ledger.json`. | Submission answers draft. |
| 02:00–07:00 | **Sleep.** At least one person sleeps by 02:00; nobody codes past 03:00. | | |

## Monday

| Time | A · Payments | B · Venue + dashboard | C · Story |
| --- | --- | --- | --- |
| 07:00–08:00 | **Iterate.** `run.mjs`: venue → stage agent, two settled calls, one blocked, idempotent rerun. | Wire the full run into the dashboard and twin. | **Rubric self-check with Raven** (DEMO.md): one question per criterion, fix the weakest answer first. |
| 08:00–09:00 | Final real run on testnet. Commit `dist/state/*.json`. | Deploy. Judge-testable run (#15). Check on a phone. | **Mentors open at 08:00.** Test the one-liner and the problem on a mentor. Fix the right file (THESIS / SPEC / DESIGN). |
| 09:00–09:15 | | | **Morning briefing** (one person goes, reports changes to the team). |
| **09:15** | **Feature freeze.** Only fixes from here. | | |
| 09:15–10:00 | Backup recording of the full run. | Fix what the recording exposed. | **Promote.** Record the 3-minute demo (DEMO.md). |
| 10:00–10:45 | Secrets check on git history. | Links check logged out: demo URL, explorer links, repo public. | Submission form, video upload, deck export. |
| **11:00** | **Submit.** | | |
| 11:00–12:00 | Buffer. Do not start anything new. | | |

## After submission

- **12:00–15:30:** judging is asynchronous. Keep the demo URL up and do **not** push to `main` or redeploy: judges are testing what we submitted.
- Stay reachable in case judges have questions. Closing ceremony at 15:30.
- If we are finalists: rehearse the live pitch on Tuesday for **Wed 28 Oct, 13:50** at Meridian.

## Every hour

Issue → branch → PR → merge → deploy (or commit the new state). If a feature is not merged by its slot, drop it to the SPEC backlog. Avoid scope creep.

## If things break

- **Facilitator down or not listing `stellar:testnet`:** switch `FACILITATOR_URL` to OpenZeppelin Channels testnet (needs a key) or ask a mentor; MPP charge mode is the no-facilitator alternative in the same skill.
- **No testnet USDC yet:** keep building against a mocked payer in tests; the real run waits for the faucet, not the other way round.
- **Twin fails on a phone:** the demo uses the dashboard plus a desktop recording of the twin. Do not demo AR; it is not verified.
- **Out of time at 09:15:** ship steps 3, 5 and 7 of the SPEC demo path. That is still a working Stellar integration.
