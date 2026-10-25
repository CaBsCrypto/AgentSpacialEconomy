# AGENTS.md — how coding agents work in this repo

> `THESIS.md`, `SPEC.md` and `DESIGN.md` say **what** to build. This file says **how**. Read all four before the first change.

## Mission

Spatial Agents · Operating System: an operator gives a venue a budget and an objective; a venue agent delegates to a stage agent, which pays for data and content over x402 on **Stellar testnet** and puts the result on the stage screen of the ONE16 twin. Demo-ready before **Mon 26 Oct, 11:00 Lisbon** (submission closes at 12:00).

## Ground rules

- Read freely. **Ask before** pushing, merging, deploying or deleting anything.
- Never commit, print or paste secret keys (`S…`), API keys or `.env`. Use `.env.example` for names only.
- Testnet only. Never point anything at `stellar:pubnet`.
- Every Stellar fact needs a source: Raven, the Stellar docs or the official skills. Cite it in the PR description.
- Do not edit generated assets in `dist/assets/` or the vendored `dist/vendor/` by hand.
- Keep the README's rights and non-affiliation section intact. Submissions must be original or properly licensed (event terms).
- Mon 26 Oct 12:00–15:30 is judging: no pushes to `main`, no redeploys.

## Scope

`SPEC.md` is the scope. If a task is not in it, add one line to the SPEC backlog and move on. Do not build it.

## Tools

- **Raven MCP** (`.mcp.json`): Stellar docs plus live ecosystem data. Use it before asserting anything about Stellar.
- **Stellar Docs MCP** (`.mcp.json`): read-only docs, no sign-in.
- **Official Stellar skills** (`scripts/setup-agent-tools.sh` installs them into `.claude/skills/`):
  - `agentic-payments` — x402 seller and buyer, testnet setup, the two USDC addresses. **Primary reference for this MVP.**
  - `dapp`, `assets`, `data` — wallets, trustlines, RPC.
- `https://developers.stellar.org/llms.txt` — the full docs index in one file.

## Commands

```bash
# frontend (existing)
npm ci && node scripts/vendor.mjs && npm test
python3 -m http.server 8000 --directory dist

# agent and paid services (new, see SPEC.md)
cd agent && npm ci
node services.mjs           # terminal 1: paid routes on :3001
node run.mjs --mandate mandates/main-stage.json   # terminal 2: the loop
npm test                    # ledger unit tests
```

## Working style

- One issue → one branch (`feature/<short-name>`) → one PR → merge. Small steps, roughly hourly.
- Blocked? Ask **one** question and state your best guess, then continue with the guess.
- The same thing failed twice? Stop and report what you tried and the exact error.
- Prefer deterministic code for the demo path. An LLM may propose; the ledger decides.
- Write the test for the ledger rule before the rule.

## Done when

- The `SPEC.md` "Done when" list is checked.
- `npm test` passes at the root and in `agent/`.
- README says what this is in its first lines and how to run the loop.
- `git log -p --all | grep -E "\bS[A-Z2-7]{55}\b"` finds nothing (Stellar secret keys).

## Repo map

- `dist/` — static app (venue twin, Passport, review map). Deployed as-is.
- `model/` — Blender sources for the venue. Not needed for the MVP.
- `scripts/` — vendoring, model prep, validation, agent tool setup, issue creation.
- `test/` — frontend tests.
- `agent/` — new: services, ledger, run, mandates, fixtures, tests.
