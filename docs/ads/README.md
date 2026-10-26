# Advertising MVP — local implementation

Branch: feature/ads-3d-ar-x402. The integrated local starting point was preserved in commit 171db5576181ae484dd085316f035a55a71ff99e. Work moved to an isolated worktree after another operation changed delivery's checkout. The application was not deployed from this branch. A disposable AdsRegistry Testnet deployment and a synthetic queue write were subsequently authorized for the hackathon; see the Estado block in the root README and testnet-registry/. No new advertiser payment or Sozu pilot funding was performed.

The main stage now plays the supplied HackMeridian GIF as a generated, silent, looping 10-second MP4. A current paid, audited and scheduled creative replaces it; expiry, suspension, stale manifests or completion restore the default loop. Payment confirmation alone does not publish an advertisement.

## Local start

Node 22 is required. Run npm ci, then npm run build and npm run dev. Open /one16 for the venue and /ads?placement=main_stage_screen (or venue_center_banner) for the advertiser journey. The default loop works with purchases disabled and without PostgreSQL.

For the backend, start docker compose -f compose.ads.yml up -d and set ADS_DATABASE_URL in the ignored .env.ads.local to the local ads database on port 5441. npm run ads:migrate applies ordered migrations under a database lock. Docker was not running on the development host, so local integration uses the actual PostgreSQL WASM engine PGlite; CI runs the same SQL against PostgreSQL 17.

Copy config/ads.example.json to ignored config/ads.local.json. The approved pilot fixes main-stage-test-5m at 5 Testnet USDC for 300000 accumulated milliseconds, with design included. Other placements and plans are outside sale. Null operational terms, budgets, geometry and credentials deliberately prevent purchases. The offer/saldo UI and exact one-time 100 USDC grant remain frozen and unfinished. Amounts are integer USDC base units (seven decimals), never floating point. Explicitly configure design and delivery pricing, refundPolicy FULL/PRO_RATA, refundDesign ALWAYS/IF_UNDELIVERED/NEVER, windows, host priority, limits, model quotas/cost ceilings, authority and retention terms.

npm run ads:keys creates local publisher key files and an ignored environment file without printing secret values. It refuses to overwrite files. Complete the configuration before setting ADS_CHECKOUT_ENABLED=true. AI Gateway needs a configured model from the current catalogue and credentials; tests inject a model explicitly and never spend credits.

The initial authentication implementation supports only the pilot's single Default-rule, single-WebAuthn-signer smart wallet with the configured WASM and verifier. The passkey must authenticate on the configured origin/RP and support the exact x402 auth-entry flow. Set walletCompatibilityVerified only after authorized integration evidence for that wallet and facilitator.

Run npm run ads:worker for durable generation, audits, destination monitoring and reconciliation. Run npm run ads:publisher in a separate process for the leased canonical Chromium/Three renderer. It needs Playwright Chromium (npx playwright install chromium), publisher keys, ADS_PUBLISHER_TOKEN and a server reachable at ADS_PUBLISHER_ORIGIN. These continuous processes are separate from stateless Vercel HTTP functions.

## Behaviour and accounting

- PostgreSQL holds immutable revisions, quotes, attempts, reservations, order transitions, outbox jobs, evidence, disputes and refunds. Settlement and queue creation share one DB transaction; chain settlement and that transaction are not atomic.
- Signed payloads and nonces are durable before transmission. Timeouts preserve the original attempt. Reconciliation matches the successful chain envelope's authorization and exact transfer; a balance change or unrelated same-price event is insufficient.
- Inventory admission locks locations in sorted order and plans every obligation or rolls back. Half-open intervals and GiST exclusion constraints prohibit overlap. Future movable rotations are deterministic by campaign, commitment and order ID.
- A technical render lead reserves capacity without charging extra units. Interrupted passes do not count. Only matching, fresh, increasing frame acknowledgements from the leased canonical publisher create signed delivery evidence. Lost leases, stale/backlogged frames and uncertain gaps never count retrospectively.
- Client devices read playlists with a maximum two-second lifetime. They never submit billable impressions. Evidence describes activity in the operator's canonical renderer, including when no visitors are connected; it is not independent evidence of human views.
- Generation has a persisted attempt per order/revision. A crash with uncertain model consumption quarantines that revision instead of silently spending another budget. Included corrections create a new preaudited revision and require explicit consent, with no new payment. Recorded immutable on-chain commitments require operator reconciliation before changing revisions.
- PNG/JPEG/WebP bytes are redecoded and normalized. The user cannot upload SVG/HTML. Templates are trusted escaped SVG rasterized to PNG. Mandatory checks constrain files, URLs, domains, DNS and redirects before model decisions; final verdicts bind the exact manifest hash. Destination monitoring suspends unsafe or unverified changes.
- Main-stage priority and safety withdrawal stop applicable delivery. A paid blocked or partially delivered order preserves its receipt and deficit. Reprogramming requires consent; partially delivered obligations can use their configured refund remedy.
- Refunds are separate restricted operator transfers. The signer file must match the public recipient. Approval stops further delivery; an uncertain submission reuses its saved transaction. Only a confirmed transfer closes a refunded obligation. Design and delivered units remain separately visible.
- Private assets are outside the document root or in private Blob storage. Raw advertising files and personal data never go on chain. Apply the configured retention policy through operator maintenance; unresolved financial/dispute evidence must be retained.

## API

All state-changing browser operations require the exact Origin, campaign ownership and an idempotency key. /api/ads/config and /playlists/:placement are read-only. /assets/:key serves only current authorized raster assets. Private previews require the owning session.

Authenticated operations: /auth/challenge, /auth/verify, /auth/me, /auth/logout; /uploads; /campaigns; /campaigns/:id/revisions, /preaudit, /preview; /quotes; /orders; /orders/:id, /pay, /revision, /disputes, /refunds and /reprogram.

Operator operations: GET /operator/orders and /operator/refunds; POST /operator/orders/:id/suspend with reason; /operator/refunds/:id/approve, /submit, /reconcile or /reject with reason. POST /operator/disputes/:id/resolve requires outcome REMEDIED or REJECTED and a reason; REMEDIED requires confirmed delivery or refund first. Operator actions never waive file, signature or publication checks.

## Soroban registry

contracts/ads-registry contains a noncustodial contract and tests. Its state distinguishes receipt, partial delivery, completion, dispute and expiration. Publisher signatures bind domain, network, contract, revision, manifest, intervals and nonce. A keeper explicitly submits expiry/resolution transactions; the contract does not wake itself.

A disposable Testnet contract was deployed and tested with one synthetic commit and a read; see testnet-registry/. It is not connected to the application runtime. Without ADS_REGISTRY_CONTRACT, the API still labels its own configured registry NOT_DEPLOYED. After a separately authorized deployment, set the issuer, evidence grace and restricted signer file; npm run ads:registry prepares/submits durable registry jobs. The issuer/publication signer are separate from the creative model. The registry never transfers or releases advertisement funds.

## Verification

Final local result: build passed; root 438 passed, 0 failed, 1 externally configured wallet integration skipped; legacy agent 30 passed; Soroban contract 8 passed and release WASM built. See [machine-readable evidence](verification.json) for tested code revision and explicit simulation/activation boundaries.

npm run test:ads covers local policy, identity, real rasterization, exact XDR validation, database transactions, recovery, publisher evidence, client expiry, corrections and remedies. npm test includes the existing frontend regressions. cargo test --manifest-path contracts/ads-registry/Cargo.toml covers contract permissions, replay, partial delivery, interrupted passes, disputes and expiry.

The CI database helper uses PostgreSQL only when NODE_ENV=test and ADS_TEST_DATABASE_URL explicitly names ads_test. Every fixture owns an isolated schema. Otherwise it uses PGlite with the same migrations and exclusion constraints.

npm run test:ads:testnet is a read-only integration gate. ADS_EXPECTED_SETTLEMENTS must be positive, and it verifies NEW persisted settlements through live Stellar RPC. Zero settlements fails; unit fixtures never count as testnet evidence.

Desktop Chrome verified the actual 10-second video loop, mobile-width layout, QR/NFC placement selection, configuration-disabled UI, neutral fallback and Three frame application. Fixture-driven transitions are labelled local simulations. Android/iPhone hardware, physical NFC cards, camera permissions on real phones, live passkey/facilitator compatibility, fresh testnet payments/refunds and the deployed registry remain separate activation gates.

## References

- [Stellar x402 guide](https://developers.stellar.org/docs/build/agentic-payments/x402)
- [Stellar exact x402 specification](https://raw.githubusercontent.com/x402-foundation/x402/main/specs/schemes/exact/scheme_exact_stellar.md)
- [RPC getTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction) and [getEvents](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents)
- [Smart Account Kit](https://github.com/stellar/smart-account-kit) and [SimpleWebAuthn](https://simplewebauthn.dev/docs/packages/server)
- [AI SDK structured outputs](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)


The upload decoder runs in a secret-free subprocess with bounded bytes, dimensions, pixels, heap and wall time. It performs no network work. Trusted template rendering uses the bundled DM Sans font under its accompanying SIL OFL; an isolated Fontconfig directory avoids platform font scanning. See media/fonts/OFL.txt for the complete font license.

The operator may POST /operator/orders/:id/release with a reason to release a safety hold for a newly audited correction. This does not authorize publication of the previous creative. A contracted dispute authority, rather than an arbitrary operator, resolves disputes. GET /orders/:id/evidence returns ownership-protected, cursor-paginated signed canonical evidence.

Payment requests accept the standard PAYMENT-SIGNATURE header or the explicit browser JSON paymentPayload. Conflicting representations fail. Only confirmed settlement returns PAYMENT-RESPONSE; ambiguous attempts return 202 and retain reconciliation.

Each quote and each accepted paid correction owns a separate immutable generation revision copied from the admitted intake brief. Reauditing/editing an intake draft therefore cannot downgrade a paid revision or cause two concurrent orders to overwrite one manifest. The earned design obligation is preserved independently when a later included correction fails.

Existing legacy testnet CI now rejects zero, stale, missing or reused settlement receipts and independently checks transaction success through Testnet RPC; failed runs no longer publish a success result. This guard does not make the old JSON demonstration the advertising ledger.

Preaudit and preview commit a durable action before model work. Replaying the same key returns the saved result; conflicting content fails. A process lost during model consumption leaves an uncertain action for review instead of automatically spending again. Browser business mutations require an Idempotency-Key; authentication uses one-use challenges.
