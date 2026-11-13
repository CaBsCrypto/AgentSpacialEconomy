# Reservations interface — implementation contract

This module is independent of advertising. All endpoints use `/api/reservations`; production defaults to disabled until resource coverage and configuration are verified. A missing service returns a useful 503, never a successful simulation presented as an on-chain receipt.

## Data and identity

The configured host wallet owns one configured opaque project ID (64 lowercase hex characters). An authenticated brand can read public offers and its own transaction attempts, not the host project, messages, media or unpublished snapshots. Roles come from server configuration. Never trust a role, owner or contract ID supplied by the browser.

Project shape: `{id, revision, title, context, spaces:[{id,name,purpose}], map:{mediaId,points:[{spaceId,x,y}]}|null, editorialState, approvedSnapshotId, conversation:[]}`. Coordinates are normalized [0,1], IDs are server-issued opaque IDs. Each update includes `expectedRevision`; stale updates return 409 and leave stored data intact. Relevant edits increment revision and clear approval without mutating existing snapshots.

Snapshot shape: `{id, projectId, revision, spaceId, title, context, space, map, contentHash, approvedAt}`. Only approved fields appear publicly after confirmed publication. An offer references exactly one immutable snapshot. Media remains private until the approved public snapshot explicitly references it; public serving requires the offer link, not knowledge of a storage path.

## API families

| Method/path | Purpose |
|---|---|
| GET `/config` | Public safe capabilities, limits, Testnet binding and disabled reasons |
| POST `/auth/challenge` | `{address,credentialId}` → one-use 120s challenge after atomic pre-provider limits |
| POST `/auth/verify` | `{challengeId,response}` → Secure HttpOnly SameSite session cookie and server-derived identity |
| GET `/auth/session` | Current validated identity; never a token in JSON |
| POST `/auth/logout` | Revoke session and clear cookie |
| GET `/project` | Restore the host's project/conversation/current review |
| PUT `/project` | Explicit host changes with `expectedRevision`; server validates full shape and ≤20 spaces |
| POST `/conversation` | `{message,expectedRevision}` → persisted proposal only; no automatic application or publication |
| POST `/media` | Authorized PNG/JPEG/WebP bytes, bounded and decoded server-side |
| GET `/media/:id` | Owner-only bytes, private/no-store; arbitrary Blob URLs are never exposed |
| POST `/approval` | `{expectedRevision,spaceId}` → immutable reviewed snapshot |
| GET `/offers` | Published approved cards only |
| GET `/offers/:id` | Approved card plus authoritative chain availability or explicit unavailable/uncertain state |
| GET `/offers/:id/media` | Only the image referenced by that published approved snapshot |
| POST `/attempts/prepare` | `{operation:'publish',snapshotId}` or `{operation:'reserve',offerId}` → durable intent and restricted signing preparation |
| POST `/attempts/:id/submit` | Signed authorization matching persisted intent; persist before relay; unknown stays locked |
| GET `/attempts/:id` | Owner-only reconciliation and receipt; confirmed requires transaction success AND matching contract read |

Use a consistent error `{code,message}` and status 400/401/403/404/409/413/422/429/503. Client rendering uses text nodes, not untrusted HTML. Invalid image or AI response does not replace saved data.

## Transaction handoff

Backend and wallet implementers must agree the concrete preparation JSON before coding the wallet adapter. Prefer the existing sponsored Channels `{func,auth}` protocol behind a separate strict validator; do not broaden the wallet deployment relay. Signer, network, contract, method, arguments, nonce, expiration and absence of sub-invocations must match the stored intent. No transfer operation is permitted.

Persist attempt and the project publication lock before contacting the relay. Persist the signed payload before transmission. Only one submit owner can progress an intent. HTTP success, relay acknowledgment and simulation are not confirmations. RPC timeout or NOT_FOUND preserve pending/needs-reconciliation. A read showing the same holder recovers that result; a different holder is a conflict. An archived record is unavailable until restored, never AVAILABLE.

An uncertain relay response may lose its returned hash. Keep the intent locked and recover through attributable chain evidence/events; if evidence cannot be recovered, show operator reconciliation rather than requesting another signature. Never fabricate a receipt/hash or release a lock based on elapsed time alone.

## Development boundary

Use injected fake chain/model adapters only in tests. The production factory must never fall back to them. PGlite is local acceptance evidence; native PostgreSQL, deployed WASM, real signatures, origin/RP ID and device flows remain explicit release gates. H3 can proceed against the API adapter while H2 finishes. H4 requires both complete. Ads integration begins only after H4 acceptance.
