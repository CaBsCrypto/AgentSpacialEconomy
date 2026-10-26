# Advertising MVP — reactivated Testnet pilot

Branch: feature/ads-3d-ar-x402. The feature preserves the approved main release, its run-3 sponsor evidence, Palta lifecycle, dashboard and landing. The original integrated local starting point remains recorded at 171db5576181ae484dd085316f035a55a71ff99e.

The application from this branch is not deployed yet. Vercel Pro infrastructure is prepared, but no real advertiser purchase of 5 USDC and no actual advertisement publication have been demonstrated. The disposable registry deployment and synthetic TIME commitment below are separate historical evidence.

## Offer and existing wallet

The server offer main-stage-test-5m, offerVersion 2, buys five complete main-stage deliveries of 60000 ms each for 5 Testnet USDC total. The plan is PASSES, units=5, requiredUnits=5, unitAmount=10000000 and amountUnits=50000000; designAmount=0. These are integer USDC base units with seven decimals. Other placements and plans are outside this pilot's sale. The client selects the offer; the server freezes version, quantity, duration, placement and price. Existing quotes retain their original plan, units, price and terms.

Each completed minute has a unique pass ID. An interrupted pass earns zero and restarts its minute; fragments do not combine into a complete delivery. Compatible campaigns rotate one full minute per campaign per round. Host priority, safety stops, lost leases and missing canonical frames do not count as delivery.

The current remedy policy is FULFILL_REMAINING with refundDesign=NEVER: unfinished deliveries remain owed. Expiry does not complete the order, fabricate missing passes or automatically refund money. For example, four completed passes leave one owed pass and an explicit reconciliation state. A change to the agreed window requires consent; disputes retain the evidence. Legacy orders keep their quoted remedy policy, including any separately authorized refund process.

The working canonical passkey wallet and its existing Sozu funding are reused. The owner reported receiving 100 USDC through that wallet on Chrome Android. This integration does not prove or create a new one-time 100-USDC grant, require another wallet, clear IndexedDB, change the Redis campaign or repeat a claim. Origin, RP ID, account/verifier configuration and the default Smart Account Kit storage stay unchanged. The restored direct wallet page, header badge and in-venue toolbar read the same session.

Connecting that wallet is distinct from advertiser authentication: the browser must prove a one-use server challenge. The pilot supports the configured single Default-rule WebAuthn signer. The C-account's real x402 auth-entry and facilitator compatibility gate is still pending; wallet creation and an existing USDC balance do not satisfy it.

The supplied HackMeridian presentation remains the silent 10-second main-stage loop. Only a paid, audited, scheduled and currently valid creative replaces it. Stale manifests, suspension and completion restore the host content; payment confirmation alone never publishes an advertisement.

## Infrastructure and local operation

The existing Vercel Pro project is reused. A private Neon PostgreSQL database is connected, and migrations 001–012 have been applied. A private Vercel Blob store is created and connected. Eleven runtime variables are configured for Production and Preview, with registry/publisher secrets and tokens encrypted. This configuration does not deploy or execute the feature and does not establish a successful purchase or published ad.

The private Cron endpoint /api/ads-runner runs every minute with CRON_SECRET authentication. Each invocation is bounded to 600 seconds; its fenced publisher lease lasts 5 seconds and is renewed every second; the Vercel function limit is 800 seconds. Overlapping invocations cannot obtain the same authority. The runner drains durable work and runs the canonical renderer when an eligible placement exists, then releases its authority. Cold start, renderer setup and gaps between invocations do not earn delivery. Unfinished work survives in PostgreSQL.

Serverless Chromium uses the packaged Playwright client and Chromium binary; local development retains desktop Playwright. A maximum-duration function is not a continuously running process. Fresh acknowledgements from the applied canonical playlist are required for each completed pass; phones remain readers, not billing authorities.

For local work, use Node 22, npm ci, npm run build and npm run dev. Open /one16 and /ads?placement=main_stage_screen. The default loop works with checkout disabled and without a database. For a local database, docker compose -f compose.ads.yml up -d exposes port 5441; put ADS_DATABASE_URL in the ignored .env.ads.local. npm run ads:migrate applies ordered migrations under a database lock. Integration tests otherwise use PGlite with the same SQL; CI also exercises PostgreSQL 17.

Copy config/ads.example.json to the ignored config/ads.local.json and complete the operational terms, host calendar, geometry, quotas, model cost ceiling, authorities and retention policy. In Vercel, configure ADS_DATABASE_URL and ADS_STORAGE_KIND=blob using private integration credentials. The approved offer and its fulfillment policy are fixed by the server. Keep checkout gated until the remaining terms and integration checks pass. AI Gateway needs an explicitly configured model and credentials; local tests inject a model and do not spend credits.

npm run ads:keys creates local publisher keys and an ignored environment file, refuses overwrites and does not print secrets. Local continuous workers remain available through npm run ads:worker and npm run ads:publisher. The latter needs Playwright Chromium, publisher keys, ADS_PUBLISHER_TOKEN and ADS_PUBLISHER_ORIGIN. Vercel uses the bounded Cron runner instead.

## Authorities and receiver

The public Testnet receiver prepared for this pilot is [GBJERBDEX5CLPFP6SBEP3W26TZSWSOOHJSI65H4CUWZF2KGXJGXGN7V5](https://stellar.expert/explorer/testnet/account/GBJERBDEX5CLPFP6SBEP3W26TZSWSOOHJSI65H4CUWZF2KGXJGXGN7V5). Its initial USDC balance is zero. The [Friendbot XLM transaction](https://stellar.expert/explorer/testnet/tx/e3d013575f60b74f6ffce4d480065c3202b4cc51a0cfbe8773a42efc40b3717b) and [USDC trustline transaction](https://stellar.expert/explorer/testnet/tx/9eef6907b90b0ab2c801be8952c2dd3370f3774c2cbdcc0b9f783bb36e21b065) prepare receipt capacity; neither is an advertiser's USDC payment. The receiver private key remains local-only in ignored storage; it is not uploaded to Vercel or returned to the browser.

Operational G-address authorities are restricted server/offline signers. Listing a G address as an operator or registry issuer does not give it a WebAuthn browser administrator login. Browser operator actions require a separately authenticated authorized smart wallet. Keep receiver, model, publisher and registry permissions distinct.

For registry operations, configure ADS_REGISTRY_CONTRACT, the public registryIssuer, its operator authorization and evidence grace. ADS_REGISTRY_SIGNER_KEY is a server-only secret alternative to the local ADS_REGISTRY_SIGNER_KEY_FILE. The restricted signer verifies the configured public issuer and allowed operation before signing. Never put either secret value in the public configuration, browser bundle, logs or repository.

## Behaviour and API

- PostgreSQL holds immutable revisions, quotes, attempts, reservations, order transitions, outbox jobs, evidence and disputes. Confirmed settlement and queue creation share a database transaction; blockchain settlement and that transaction are not atomic.
- Signed payloads and nonces are durable before transmission. Timeouts preserve the original attempt. Reconciliation checks the exact successful authorization and transfer; a balance change or unrelated same-price event is insufficient.
- Inventory admission locks locations in sorted order and reserves every obligation or rolls back. Half-open intervals and exclusion constraints prevent overlap. Render lead consumes capacity without adding a charged pass.
- Only fresh, increasing acknowledgements with matching revision, manifest and image hashes from the leased canonical publisher create signed delivery evidence. Lost leases and uncertain gaps never count retrospectively. Multiple phones do not multiply passes or prove human views.
- Generation has a persisted attempt per order/revision. Uncertain model consumption quarantines that revision. Included corrections require a new passing audit and consent, with no new payment; an existing registry commitment may require operator reconciliation.
- PNG/JPEG/WebP bytes are decoded and normalized. SVG/HTML uploads are rejected. File, URL, DNS, redirect, domain and permission checks cannot be waived by model output. Final verdicts bind exact hashes; unsafe or unverified destination changes suspend publication.
- Private assets remain outside the public document root or in private Blob storage. Raw files and personal data never go on chain. Retention maintenance preserves unresolved financial and dispute evidence.
- Refund transfers remain available for applicable legacy terms. Approval stops further delivery; uncertain submission reuses its saved transaction. Only a confirmed transfer can close a refunded legacy obligation. The current pilot instead keeps unfinished passes owed.

State-changing browser operations require exact Origin, campaign ownership and an idempotency key. Public reads include /api/ads/config and /playlists/:placement. Asset access is limited to current authorized rasters; private previews require their owning session.

Authenticated routes cover /auth/challenge, /auth/verify, /auth/me, /auth/logout, uploads, campaigns/revisions/preaudit/preview, quotes and orders/payment/revisions/disputes/refunds/reprogramming. Quote requests select campaignId, offerId, startsAt and endsAt; commercial overrides are rejected. PAYMENT-SIGNATURE or the explicit browser paymentPayload carries the authorization. Conflicting representations fail. Only settled payment returns PAYMENT-RESPONSE; ambiguous attempts return 202 and retain reconciliation.

Authorized operator routes cover order/refund inspection, suspension, release, applicable refund approval/submission/reconciliation/rejection and dispute resolution. Release of a safety hold permits another audited correction, not publication of the previous creative. The contracted dispute authority resolves disputes. These actions never waive technical checks. GET /orders/:id/evidence returns ownership-protected, cursor-paginated signed canonical evidence.

## Historical Soroban registry evidence

contracts/ads-registry is noncustodial: it records commitments and signed delivery; it does not hold, release or refund advertisement funds. Its states distinguish queue receipt, partial delivery, completion, dispute and expiry. Signatures bind network, contract, revision, manifest, interval and nonce. A keeper submits expiry/resolution explicitly.

The original disposable Testnet contract is [CDYMS23PEXE4WMVSMJAWOFOODEVV2S4IQJQUFTHFKFWAFAEVMFBWQRVD](https://stellar.expert/explorer/testnet/contract/CDYMS23PEXE4WMVSMJAWOFOODEVV2S4IQJQUFTHFKFWAFAEVMFBWQRVD): [deployment](https://stellar.expert/explorer/testnet/tx/11a0e3132c480c119d59ec156996a00c0a233c3936592f1b3071b3463bf2ccce) and [synthetic commit](https://stellar.expert/explorer/testnet/tx/380dfd78d95b15eee2f39ca0e4e3350aa09a8800fc2b1cd434041d67487bac45). The saved read remains Queued, delivered=[0], required=300000 milliseconds and next_nonce=0.

This is the unchanged historical TIME fixture, with an explicitly synthetic payment reference. It proves neither a USDC transfer, five PASSES deliveries, runtime integration nor an actual published advertisement. See [original inputs, reads and public checks](testnet-registry/). npm run ads:registry handles durable runtime jobs when its restricted configuration is complete.

## Verification and activation gates

At the latest completed local reactivation checkpoint, the build passed. The root suite had 634 cases: 632 passed, zero failed and two skipped (optional live wallet RPC and the Linux browser-binary check on Windows). The legacy agent passed 36 tests and the Rust contract passed 9. These are local validation results, not live advertising settlements. [verification.json](verification.json) retains its own earlier code revision and historical checkpoint.

Acceptance covers five distinct complete 60-second pass IDs, zero credit for interrupted fragments, retained debt after expiry, campaign fairness, immutable legacy quotes, exactly-once queue creation, and twenty local 5-USDC fixture purchases reducing 100 to zero while the next authorization is refused. Explicit payment/model adapters never count as live evidence.

npm run test:ads covers policy, identity, rasterization, XDR checks, SQL transactions, recovery, canonical evidence, expiry, corrections and remedies. npm test includes frontend regressions. Rust tests cover permissions, replay, partial delivery, interrupted passes, disputes and expiry. PostgreSQL CI fixtures require NODE_ENV=test and an ADS_TEST_DATABASE_URL naming ads_test; each owns an isolated schema.

npm run test:ads:testnet is a read-only gate requiring a positive ADS_EXPECTED_SETTLEMENTS count and fresh persisted transfers independently checked through live RPC. Zero settlements fails.

Remaining gates include the real C-account/facilitator x402 path, an authorized real 5-USDC purchase using the existing wallet, the private runner runtime smoke, its bounded deployed execution and actual canonical ad delivery, and runtime registry evidence. None has been presented as completed here. Existing Chrome Android wallet activation/funding is the owner's report; the new advertiser journey on that phone, Safari iPhone and physical AR retain their separate acceptance checks.

## References

- [Stellar x402 guide](https://developers.stellar.org/docs/build/agentic-payments/x402)
- [Stellar exact x402 specification](https://raw.githubusercontent.com/x402-foundation/x402/main/specs/schemes/exact/scheme_exact_stellar.md)
- [RPC getTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction) and [getEvents](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents)
- [Smart Account Kit](https://github.com/stellar/smart-account-kit) and [SimpleWebAuthn](https://simplewebauthn.dev/docs/packages/server)
- [AI SDK structured outputs](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)

Human passkey compatibility is tested separately at `/ads-compatibility.html` while checkout stays disabled. The authenticated C-account explicitly signs the exact 5-USDC Testnet authorization. The server persists its intent before calling only facilitator verification, never settlement. Three challenges per wallet per hour, a 60-second authorization window, durable idempotency, ownership checks and a bounded verification deadline prevent replay and concurrent retries. The page displays hashes, never the signed XDR or nonce. A positive verification does not itself enable purchases or prove a transfer.


## Latest hosted checkpoint

Two protected previews built successfully. Production was not promoted. The second preview confirmed the complete four-file Chromium asset bundle and request-scoped OIDC readiness, but the renderer failed at module-load: `MODULE_NOT_FOUND: Cannot find module '/var/task/node_modules/playwright-core-vercel/browsers.json'`. Its require stack ends at `playwright-core-vercel/lib/coreBundle.js`. Activation stopped after the second renderer failure; no third attempt or workaround was executed. Checkout remains disabled, the human C-account verification is pending, and no advertiser USDC settlement or actual publication is claimed. See [vercel-verification.json](vercel-verification.json).
