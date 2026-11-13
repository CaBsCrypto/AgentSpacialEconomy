# Owner-approved implementation plan

Approved 13 November 2026. This document records scope and acceptance, not completed work.

| Gate | Scope | Acceptance |
|---|---|---|
| H0 | Preserve app changes, isolated checkouts, resource inventory | Exact-byte backup manifest; source SHA and resource coverage identified |
| H1 | Durable legacy payment intent, EOL/vendor integrity, general CI, upstream limits | No repeat payment after timeout/restart; required suites green |
| H2 | Reservation contract, private identity/storage, restricted relay | Authorization, single-holder state, safe retries and privacy verified |
| H3 | Host conversation, spaces, manual map, review and immutable snapshot | Restorable host flow; edits invalidate approval; isolation |
| H4 | Signed publish/reserve, confirmed reads, receipt and public operation | Real Testnet signatures, desktop/Android/iOS acceptance and 24-hour observation |
| H5 | Full-screen advertising integration after H4 acceptance | Combined release, native Chromium/WebGL2, moderation and durable fulfillment |
| H6 | Public Testnet advertising | Two controlled campaigns, five proven passes each, recovery and budget gates |

## Constraints

- Only Stellar Testnet. Reservations never transfer USDC or represent commercial availability.
- One configured host and project; up to twenty spaces, one available offer per project in the app.
- Offer IDs and confirmed holders are immutable. New demos use new IDs, never resets.
- AI proposes, host applies and reviews; only the wallet owner signs publication or reservation.
- Preserve existing wallet origin, RP ID and local identity. Do not automatically fund reservations.
- Private project/conversation/media; only reviewed offer snapshots are public.
- Maps: PNG/JPEG/WebP, 2 MiB, 2048 pixels per side; manual normalized points, no inferred dimensions.
- Session 30 minutes; one-use challenge 120 seconds; auth limits 10/IP/minute and 60/global/minute.
- Host AI: 30 messages/day; 8,000 input and 1,024 output tokens maximum; separate from ads counters.
- Existing configured model and services only. No new paid subscription, top-up or provider fallback.
- A missing or expired resource coverage check disables work before provider calls. Cost reservation
  is atomic and fail-closed; unresolved usage remains reserved. Never promise that quotas alone prevent billing.
- Ads: five complete sixty-second main-stage passes, minimum sixty-second campaign gap, 5 testnet USDC.
- One outstanding ad order per wallet, ten accepted/day and ten global pending obligations maximum.
- Automatic moderation with human review of exceptions before purchase; no override of technical checks.
- Inactive unpublished drafts and unreferenced media may expire after thirty days. Preserve live offers,
  receipts and unpaid delivery obligations. Chain state is not deleted by this cleanup.
- H5 implementation waits for H4 acceptance. Other unblocked stabilization/reservation work can continue
  when resources or signatures are unavailable.

## Working protocol

Root coordinates as PM; Scrum Master owns the live board outside product source. Six specialist roles
work in three pairs: product/backlog, backend/frontend, QA/release. At most two implementers work at
once, each in an isolated checkout. Review is independent from authorship.

Each story records acceptance, owner, dependencies, SHA, environment, tests and limits. Done is not
equivalent to merged or infrastructure Ready. Publication uses the authorization for the reviewed
candidate; user passkeys remain user actions. No additional spend is authorized by implementation.

## Required adverse scenarios

Timeout after settlement, restart before response, concurrent run locks, wrong host/project, duplicate
IDs, reused challenges, expired sessions, direct media access from another account, immutable approved
snapshots, uncertain transaction results, failed resource counters, and unavailable providers must all
fail without duplicate transmission or false confirmation. Reservation concurrency: 100 local rounds
of 20 competitors, followed by a bounded real Testnet demonstration with receipts.

Deployment gates require the exact SHA, configuration fingerprint without secrets, contract and receipts.
Local/PGlite/mock results do not replace native PostgreSQL, real signatures or device acceptance.
