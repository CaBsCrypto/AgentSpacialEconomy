# Main-stage pilot — PM execution board

Approved 26 Oct 2026. Baseline: 7d2d6ad on feature/ads-3d-ar-x402. This document tracks implementation; an unchecked item is not production evidence.

## Scope locked by the owner

Only main_stage_screen in the 3D/AR twin. QR/NFC plus clickable sign share https://agenticreality.space/ads?placement=main_stage_screen. Logo/text and rights declaration, optional indicative preview, suggested editable one-hour window. Exactly 50000000 Testnet USDC base units buys five complete 60000-ms passes, design included. Interrupted minutes earn zero and remain owed. No automatic monetary refund closes debt. Reuse the working wallet/funding and existing origin; no new grant mechanism, mainnet, physical-screen control, central banner or dashboard changes.

## Owners and integration

- PM/root: contracts between components, purchase eligibility, HTTP wiring, registry lots/issuer serialization, integration and evidence.
- Platform/pilot_pm: Vercel metadata packaging, separate authenticated worker/publisher Cron endpoints and runtime tests.
- Backend/pilot_runtime_audit: migration013, fulfillment units/lots, scheduler, publisher ACK accounting, availability/recovery/reprogramming, service/jobs and tests.
- Experience/pilot_journey_audit: mobile form/calendar/progress, public countdown, 3D sign, QR/NFC printable artifacts and frontend tests.
- Independent QA: occupies a released slot, reviews another agent's work and gates release.

## Gates

- [x] H1: deploy includes Playwright browsers.json, all Chromium files, browser startup and WebGL2 pass.
- [ ] H2: worker continues while publisher holds its lease; stable units, lot evidence and issuer serialization pass.
- [ ] H3: QR/NFC/sign, suggested availability, private five-unit progress and public authoritative countdown pass.
- [ ] H4: real C-wallet compatibility and real content preaudit pass before a controlled exact-5-USDC purchase.
- [ ] H5: one settled purchase, five complete unique passes, honest Soroban state and host fallback; independent QA approves public activation.

Current checkout remains disabled. Initial activation is limited to a server-side allowlisted C-wallet; public activation is a separate PM go/no-go after evidence. Public APIs never expose wallet/saldo/brief or private future queue.

## Interface contract

GET /api/ads/availability?campaignId=... is authenticated and owner-scoped, returning serverTime, window{startsAt,endsAt}, estimatedPasses[{number,estimatedStartsAt,estimatedEndsAt}], estimated:true. Suggestions never reserve capacity; existing POST /quotes does.

Order.fulfillment = {version,serverTime,window,units:[{number,status,estimatedStartsAt,completedAt,batchId}],nextEstimatedAt}; statuses PENDING/SCHEDULED/ACTIVE/COMPLETED/DEBT. Reprogram POST accepts {startsAt,endsAt,fulfillmentVersion,accept:true}, requires explicit owner consent and derives only the remaining units under locks.

Playlist.playback = {phase,passId,durationMs,startedAt,confirmedThrough,remainingMs,validUntil}; phases IDLE/STARTING/PLAYING/PAUSED. All timestamps ISO UTC; remaining/duration in integer ms. Start is the canonical ACK pass_started_at, not a 70-second reservation boundary. UI clock is read-only and never earns delivery.

## Recovery invariants

One commercial order/payment; stable five units. Attempts, reservations and delivery rows reference batch and unit. Initial batch id equals order id; later batches have new ids and only the deficit, same immutable creative/payment, explicit consent, no extra charge. A complete ACK consumes one still-pending unit transactionally. Late parent ACKs cannot credit a child. Original quote/receipt/commit stay immutable. Registry nonces/jobs are scoped by batch and submissions serialized per issuer. Original on-chain commitment is not marked complete with later-window deliveries. The aggregate five-unit cap is enforced by the application's ledger, not natively across independent contract commitments.

## Failure and reporting policy

Historical runtime attempts stopped at MODULE_NOT_FOUND: playwright-core-vercel/browsers.json. This approved plan resumes with a targeted packaging fix, not a blind retry. Two failures from the same cause across the team stop that milestone and require an exact error report; no financial fallback. No claim of advertiser settlement/publication until actual evidence exists.

Report: 04:30 Santiago / 07:30 Lisbon. Freeze: 06:15 Santiago / 09:15 Lisbon. If a gate is incomplete, report NOT VALIDATED and keep purchases closed. Physical poster/tag placement and native passkey confirmations require the operator/device owner.

## Checkpoint 07:24 UTC / Lisboa

H1 PASS on Vercel Chromium153/WebGL2. H2/H3 implementation and local/native SQL evidence pass; hosted full-build validation in progress. H4 blocked by the existing wallet indexer birth provenance response; no bypass and no charge. H5 NOT VALIDATED. Checkout stays closed. Main/PR28 included by explicit owner approval. Native direct DB18/18; root677 PASS/2 skip; agent42 PASS; Rust9 PASS; reconciliation race fix28 PASS. Physical devices/NFC and real purchase plus five unique passes remain pending.

## Post-promotion checkpoint

Full pilot code deployed as dpl_Fc7NWThdiq5LW8CR9jE7L7G3Q1e4 (3f600c5), checkout DISABLED. Root690 PASS/2 skip; release73/73. Server recovery validates the actual Testnet CreateContractV2 receipt; human connection remains pending. The final native SQL repeat stopped with15/19 passing and4 connectivity failures (read ECONNRESET, connection timeout). No retry after repeated failure. Prior18/18 remains historical evidence, not the final repeat. H4/H5 NOT VALIDATED; no advertiser settlement or canonical five-pass evidence.
