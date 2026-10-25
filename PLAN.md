# PLAN — Sunday 23:00 to Monday 12:00 (Lisbon)

Submission closes **Mon 26 Oct, 12:00**. We submit at **11:00**. Feature freeze at **09:00**.
Four levels, in order: **Set up → Harness → Iterate → Promote.**

## Roles

| Role | Owns | Issues |
| --- | --- | --- |
| **A · Payments** | services, ledger, agent run, testnet accounts | #1 – #4 |
| **B · Venue + dashboard** | stage screen in the twin, dashboard, deploy | #5 – #7 |
| **C · Story** | thesis, one-liner, README, deck, video, submission | #8 – #12 |

<!-- TEAM: write names next to roles. With two people, C is shared after 09:00. -->

## Sunday night

| Time | A · Payments | B · Venue + dashboard | C · Story |
| --- | --- | --- | --- |
| 23:00–23:30 | **Set up.** `scripts/setup-agent-tools.sh`, test Raven. Create agent + service accounts, trustlines. | Commit THESIS/SPEC/DESIGN/AGENTS, run `scripts/create-issues.mjs`. | **Circle faucet by hand** (captcha) → agent wallet. Pick the name and the one-liner. |
| 23:30–01:30 | **Harness.** `services.mjs` with two paid routes; first paid call settled on testnet. | Stage screen reads `state/stage.json` with fallback. Dashboard skeleton. | README first lines, landing hero copy, deck skeleton (DEMO.md). |
| 01:30 | **Checkpoint:** one real testnet tx hash for a paid call. If not, switch facilitator (OZ Channels) or ask a mentor first thing. | | |
| 01:30–02:00 | Ledger tests + over-cap block. | Dashboard reads `state/ledger.json`. | Submission answers draft. |
| 02:00–07:00 | **Sleep.** At least one person sleeps by 02:00; nobody codes past 03:00. | | |

## Monday

| Time | A · Payments | B · Venue + dashboard | C · Story |
| --- | --- | --- | --- |
| 07:00–08:00 | **Iterate.** `run.mjs`: venue → stage agent, two settled calls, one blocked, idempotent rerun. | Wire the full run into the dashboard and twin. | Book mentor time. Test the one-liner and the problem on a mentor. Fix the right file (THESIS / SPEC / DESIGN). |
| 08:00–09:00 | Final real run on testnet. Commit `dist/state/*.json`. | Deploy the static site with the committed run. Check on a phone. | Deck with real screenshots and tx hashes. |
| **09:00** | **Feature freeze.** Only fixes from here. | | |
| 09:00–10:00 | Backup recording of the full run. | Fix what the recording exposed. | **Promote.** Record the 3-minute demo (DEMO.md). |
| 10:00–10:45 | Secrets check on git history. | Links check: demo URL, explorer links, repo public. | Submission form, video upload, deck export. |
| **11:00** | **Submit.** | | |
| 11:00–12:00 | Buffer. Do not start anything new. | | |

## Every hour

Issue → branch → PR → merge → deploy (or commit the new state). If a feature is not merged by its slot, drop it to the SPEC backlog.

## If things break

- **Facilitator down or not listing `stellar:testnet`:** switch `FACILITATOR_URL` to OpenZeppelin Channels testnet (needs a key) or ask a mentor; MPP charge mode is the no-facilitator alternative in the same skill.
- **No testnet USDC yet:** keep building against a mocked payer in tests; the real run waits for the faucet, not the other way round.
- **Twin fails on a phone:** the demo uses the dashboard plus a desktop recording of the twin. Do not demo AR; it is not verified.
- **Out of time at 09:00:** ship steps 3, 5 and 7 of the SPEC demo path. That is still a working Stellar integration.
