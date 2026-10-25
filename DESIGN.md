# DESIGN — one look everywhere

> Derived from `THESIS.md`. Every screen, the landing hero, the deck and the video reuse this file.

## The rule

**The venue looks like the venue. Everything that is us looks like us.**

- Inside the ONE16 twin, keep the event's own yellow and black: it is a reconstruction of a real place.
- The dashboard, the landing hero, the deck, the video title cards and the README cover use the identity below, taken from `docs/assets/agentic-spatial-economy-cover.svg`.
- Never present the event's branding as ours. The README disclaimer stays.

## Name

One name in the repo, the app title, the deck, the video and the submission form.

**Spatial Agents · Operating System** — decided 25 Oct. Use it exactly like that in the README, the dashboard, the deck, the video and the submission form.

- Repo slug stays `AgentSpacialEconomy` (renaming needs the repo owner); the README says so in one line.
- The cover artwork in `docs/assets/` still reads "Agentic Spatial Economy". Treat it as concept art or re-export it with the new name.
- "SpatialOS" alone is also the name of an existing platform by Improbable, so always write the full name.

**Brand line:** `AGENTIC REALITY · AUGMENTED SPATIAL EXPERIENCES` — set small, letter-spaced, with the gold rule, above the name (dashboard header, README, deck title slide, video title card). It is the mood, not the explanation: the portal tagline and every place where a reader must learn what the product does keep the one-liner from THESIS.md. Physical AR is not verified yet, so the brand line never stands alone as a claim in the demo or the submission.

## Colors

| Token | Hex | Use |
| --- | --- | --- |
| `--ase-night` | `#07121f` | Page background |
| `--ase-deep` | `#102742` | Panels, cards |
| `--ase-zone` | `#17485b` | Zone fills, table headers |
| `--ase-line` | `#498095` | Borders, grid lines |
| `--ase-signal` | `#72e3df` | Agents, live state, links |
| `--ase-budget` | `#e3bd79` | Money: budgets, caps, spend, the operator |
| `--ase-text` | `#eef4f7` | Primary text |
| `--ase-muted` | `#90a8bb` | Secondary text |

Status colors in the ledger: `settled` uses `--ase-signal`, `blocked` uses `--ase-budget` with a label (never color alone), `failed` uses plain text "failed" with an icon.

## Type

- **DM Sans** for everything (the app already loads it). Weights 400 and 700.
- A monospace face for transaction hashes, amounts and code: the system monospace stack is fine.
- Amounts always show the unit: `0.05 USDC (testnet)`.

## Logo

The diamond-in-a-circle mark from the cover (the "administrator agent" node), gold on night. Wordmark in DM Sans Bold. No new logo this weekend.

## Screens for the demo

1. **Mandate** — objective, total budget, per-call cap, allowed services, approval threshold. One primary button: "Run".
2. **Run log** — venue agent → stage agent, each step with price, status and explorer link.
3. **Budget** — allocated / reserved / spent / available per agent, as a single bar each.
4. **Blocked** — the refused call as a card: what it wanted, why it was refused, "Approve" and "Decline" (approve is out of scope; the button may be disabled with a note).
5. **Venue** — the ONE16 twin with the stage screen showing the purchased card.

## Copy

- The one-liner from `THESIS.md` appears in README line 1 (tagline), the dashboard header, deck slide 1 and the first five seconds of the video. Same words.
- Say what it does. Avoid: "revolutionary", "seamless", "metaverse", "autonomous economy".
- Language: the app UI is in Spanish today, the README in English. Judges review in English, so submission-facing screens should be English. <!-- TEAM: decide -->

## Video

A screen recording of the real testnet run beats an animated explainer. Add two title cards (one-liner at the start, repo link at the end) in the colors above. Keep a recorded backup of the full run in case the live demo fails.
