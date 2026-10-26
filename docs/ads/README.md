# Advertising MVP - completed controlled Testnet pilot

Branch: `feature/ads-3d-ar-x402`. This feature preserves the approved main release, its recorded sponsor runs, Palta lifecycle, dashboard and landing. The original integrated local starting point remains recorded at `171db5576181ae484dd085316f035a55a71ff99e`.

The deployed pilot now has a real passkey-authorized 5-USDC Testnet payment, five completed main-stage deliveries, visual evidence from the 3D venue and confirmed Soroban registry operations. These are separate from the earlier synthetic TIME fixture and local payment/model simulations. The verified release is `104770ec85cf66e933b2da623129d798de8cf83c`, Vercel deployment `dpl_96RBMGgJNd5yMGy5EdUapbWc7fgt`.

## Final paid pilot evidence

- Order `81eaf2a8-61cb-4e5f-9731-8a8db9ba9722` is `COMPLETED`: five unique, fully measured 60-second passes, five delivered and zero owed. The last pass completed after automatic recovery; an interrupted attempt did not earn a partial unit.
- The exact [5-USDC payment transaction](https://stellar.expert/explorer/testnet/tx/7b4349d0942b045f606eb5a1195fa4e1e91acd98276bd727e6cc76a9110603b2) succeeded on Stellar Testnet. RPC and Horizon agree at ledger `5396981`; the invocation and transfer event bind the exact USDC asset, existing C-wallet, public receiver and `50000000` base units. The payer's observed balance was `950000000` units, or 95 USDC. Fees were sponsored. See [payment evidence](testnet-registry/main-stage-payment.json).
- The paid advertisement was observed on the main-stage surface inside ONE16. The supplied host presentation was also observed between passes. Its GIF source is converted to `/assets/main-stage-default.mp4`; the video has `loop=true`, autoplay and muted playback. Advertisement removal reveals that same host surface again. See [paid-ad image](evidence/main-stage-paid-ad.png), [host-loop image](evidence/main-stage-host-loop.png), [receipt UI showing 5/5 FULFILLED](evidence/main-stage-receipt.png) and [delivery evidence](testnet-registry/main-stage-fulfillment.json).
- All seven registry jobs are `CONFIRMED`. The [closing transaction](https://stellar.expert/explorer/testnet/tx/2bf5d4c4f1a922acc3cd44763b610bcdb79838bee278270573434addf98692d2) is confirmed. A read of the configured contract returns `Completed`, delivered 5, required 5 and `nextNonce=5`. See [contract read](testnet-registry/main-stage-contract-read.json) and [final pilot summary](testnet-registry/main-stage-complete.json).

The live registry is [CDYMS23PEXE4WMVSMJAWOFOODEVV2S4IQJQUFTHFKFWAFAEVMFBWQRVD](https://stellar.expert/explorer/testnet/contract/CDYMS23PEXE4WMVSMJAWOFOODEVV2S4IQJQUFTHFKFWAFAEVMFBWQRVD), the same deployed noncustodial contract identified in the historical evidence below. The completed PASSES order has its own commitment and delivery records.

## Offer and existing wallet

The server offer `main-stage-test-5m`, offerVersion 2, buys five complete main-stage deliveries of `60000` ms each for 5 Testnet USDC total. The plan is `PASSES`, units=5, requiredUnits=5, unitAmount=`10000000` and amountUnits=`50000000`; designAmount=0. These are integer USDC base units with seven decimals. New quotes freeze `minCampaignGapMs=60000`: one complete minute of this campaign, then at least one minute before its next pass. Host content returns when no other eligible advertisement occupies that interval. This is the full main-stage screen; no quadrant offer is sold. Other placements and plans remain outside this pilot's sale. Existing quotes retain their original plan, units, spacing, price and terms.

Each completed minute has a unique pass ID. An interrupted pass earns zero and restarts its minute; fragments do not combine into a complete delivery. Compatible campaigns rotate one full minute per campaign per round. Host priority, safety stops, lost leases and missing canonical frames do not count as delivery. Multiple viewers cannot multiply units.

The current remedy policy is `FULFILL_REMAINING` with refundDesign=`NEVER`: unfinished deliveries remain owed. Expiry does not complete the order, fabricate missing passes or automatically refund money. A change to the agreed window requires consent; disputes retain the evidence. Legacy orders keep their quoted remedy policy, including any separately authorized refund process.

The working canonical passkey wallet and its existing Sozu funding were reused. The paid pilot used `CCNKDO25M3S33RNDGSHDO2NOKEJE37YNKQHJP4G443CVQUJVLETKOXYM`. Its initial 100-USDC balance was not automatically replenished after the 5-USDC purchase. This release does not establish a new durable, universal one-time 100-USDC grant. It does not clear IndexedDB, change the Redis funding campaign or repeat a claim. Origin, RP ID, account/verifier configuration and default Smart Account Kit storage remain unchanged.

Advertiser authentication uses a one-use server WebAuthn challenge and live wallet authority checks. The configured single-rule passkey signer completed the real x402 path in this pilot. Recovery of missing indexer birth metadata uses the actual successful creation receipt and the unchanged public SDK's independent birth and fresh-ownership checks; a server-supplied constructor approval hash is not trusted.

Access remains `CONTROLLED` for the existing authorized C-wallet, subject to its configured purchase window and server gates. `PUBLIC` purchase access has not been enabled. A successful diagnostic alone never changes that policy.

The project website is required. An X profile is optional; if supplied, its HTTPS domain, DNS, redirects and successful inspection remain mandatory. Omitting X produces one real website CTA, not an invented profile. Rights declarations, logo normalization, preaudit and final model review remain required.

## Infrastructure and local operation

The pilot runs in the existing Vercel Pro project with private Neon PostgreSQL persistence and private Vercel Blob assets. Ordered SQL migrations, durable payment intents, outbox work, reservations, fulfillment batches and registry jobs were exercised by the completed paid order. Runtime secrets and internal tokens are server-only encrypted variables; no secret is part of the public configuration or evidence files.

The selected authenticated Testnet facilitator is `https://channels.openzeppelin.com/x402/testnet`. Only that exact approved URL receives the existing Channels server credential. The public `https://x402.org/facilitator` path never receives it. Provider selection is explicit, with no automatic fallback, mainnet route or replacement custodial payer. Transport rejects redirects and bounds response size and duration. After signing, the client simulates again and rebuilds resource data and fees while preserving the exact signed authorization.

The private Cron endpoint `/api/ads-runner` uses `CRON_SECRET` authentication. Each invocation is bounded to 600 seconds; its fenced publisher lease lasts 5 seconds and is renewed every second; the Vercel function limit is 800 seconds. Overlapping invocations cannot obtain the same authority. The runner drains durable work and runs the canonical renderer for eligible slots, then releases authority. Cold start, renderer setup and gaps between invocations do not earn delivery. Unfinished work survives in PostgreSQL.

Serverless Chromium uses the packaged Playwright client and Chromium binary; local development retains desktop Playwright. A maximum-duration function is not a continuously running process. Fresh acknowledgements from the applied canonical playlist are required for each completed pass; phones remain readers, not billing authorities.

For local work, use Node 22, `npm ci`, `npm run build` and `npm run dev`. Open `/one16` and `/ads?placement=main_stage_screen`. The host loop works with checkout disabled and without a database. For a local database, `docker compose -f compose.ads.yml up -d` exposes port 5441; put `ADS_DATABASE_URL` in ignored `.env.ads.local`. `npm run ads:migrate` applies ordered migrations under a database lock. Local integration fixtures otherwise use PGlite with the same SQL; CI exercises PostgreSQL 17.

Copy `config/ads.example.json` to ignored `config/ads.local.json` and complete operational terms, host calendar, geometry, quotas, model cost ceilings, authorities and retention policy. In Vercel, configure private integration credentials and `ADS_STORAGE_KIND=blob`. AI Gateway requires an explicitly configured model and credentials; local model adapters do not spend credits or constitute live moderation evidence.

`npm run ads:keys` creates local publisher keys and an ignored environment file, refuses overwrites and does not print secrets. Local continuous workers remain available through `npm run ads:worker` and `npm run ads:publisher`; Vercel uses the bounded Cron runner.

## Authorities and receiver

The public Testnet receiver is [GBJERBDEX5CLPFP6SBEP3W26TZSWSOOHJSI65H4CUWZF2KGXJGXGN7V5](https://stellar.expert/explorer/testnet/account/GBJERBDEX5CLPFP6SBEP3W26TZSWSOOHJSI65H4CUWZF2KGXJGXGN7V5). It was prepared before the pilot by the [Friendbot XLM transaction](https://stellar.expert/explorer/testnet/tx/e3d013575f60b74f6ffce4d480065c3202b4cc51a0cfbe8773a42efc40b3717b) and [USDC trustline transaction](https://stellar.expert/explorer/testnet/tx/9eef6907b90b0ab2c801be8952c2dd3370f3774c2cbdcc0b9f783bb36e21b065). Those preparation transactions are distinct from the subsequent exact 5-USDC advertiser transfer. Its private key remains local-only in ignored storage, not in Vercel or the browser.

Operational G-address authorities are restricted server/offline signers. Listing a G address as an operator or registry issuer does not grant a WebAuthn browser administrator login. Browser operator actions require a separately authenticated authorized smart wallet. Receiver, model, publisher and registry permissions remain separate.

Registry operations use `ADS_REGISTRY_CONTRACT`, the public registry issuer and restricted operator authorization. `ADS_REGISTRY_SIGNER_KEY` is a server-only alternative to `ADS_REGISTRY_SIGNER_KEY_FILE`. The signer checks the public issuer and allowed operation before signing. Secret values never belong in public configuration, browser bundles, logs or the repository.

## Behaviour and API

- PostgreSQL holds immutable revisions, quotes, attempts, reservations, order transitions, outbox jobs, delivery evidence and disputes. Confirmed settlement and queue creation share one database transaction; blockchain settlement and that transaction are not atomic.
- Signed payloads and nonces are durable before transmission. Timeouts preserve the original attempt. Reconciliation checks the exact successful authorization and transfer; a balance change or unrelated same-price event is insufficient.
- Inventory admission locks locations in sorted order and reserves obligations or rolls back. Half-open intervals and exclusion constraints prevent overlap. Render lead consumes capacity without adding a charged pass.
- Only fresh increasing acknowledgements with matching revision, manifest and image hashes from the leased canonical publisher create signed delivery evidence. Uncertain gaps never count retrospectively. Digital delivery does not measure physical attendance or views.
- Generation has a persisted attempt per order/revision. Uncertain model consumption quarantines that revision. Included corrections require a new passing audit and consent without another payment; an existing registry commitment may require reconciliation.
- PNG/JPEG/WebP bytes are decoded and normalized; SVG/HTML uploads are rejected. File, URL, DNS, redirect, domain and permission checks cannot be waived by model output. Final verdicts bind exact hashes.
- Private previews and advertiser details require their owning session. Current authorized raster access supports public playback. Raw files and personal data never go on chain; retention preserves unresolved financial and dispute evidence.
- Refund transfers remain available for applicable legacy terms. Only confirmed transfers close refunded legacy obligations. The current pilot instead keeps unfinished passes owed.

State-changing browser operations require exact Origin, ownership and an idempotency key. Public reads include `/api/ads/config` and `/playlists/:placement`. Authenticated routes cover login/logout, uploads, campaigns/revisions/preaudit/preview, availability, quotes, orders, payments, delivery evidence, claims and reprogramming. Quote requests select campaignId, offerId, startsAt and endsAt; commercial overrides are rejected. `PAYMENT-SIGNATURE` or the explicit browser paymentPayload carries the authorization. Conflicting representations fail. Only settled payment returns `PAYMENT-RESPONSE`; ambiguous attempts return 202 and preserve reconciliation.

The separate `/ads-compatibility.html` diagnostic signs the exact Testnet authorization and persists its intent before facilitator verification. It never settles, orders, publishes or enables checkout. The three-per-hour wallet budget counts durable signed verification admissions, including ambiguous admissions; unsigned cancelled or expired drafts do not consume it. One active unsigned draft is reused, and private GET status recovers refresh or lost responses without another signature or payload POST. The 60-second draft admission window and bounded verification deadline are separate. The UI shows server-anchored validity, quota and Retry-After without signed XDR or nonce.

Authorized operator routes cover suspension, safety-hold release, applicable refund actions and dispute resolution. Release permits another audited correction, not publication of an unapproved creative. These actions never waive technical checks. `GET /orders/:id/evidence` returns ownership-protected, cursor-paginated signed canonical evidence.

## Historical Soroban and stopped checkpoints

`contracts/ads-registry` is noncustodial: it records commitments and signed delivery; it does not hold, release or refund advertisement funds. Signatures bind network, contract, revision, manifest, interval and nonce. Keeper expiry/resolution is explicit.

The same disposable Testnet contract's original [deployment](https://stellar.expert/explorer/testnet/tx/11a0e3132c480c119d59ec156996a00c0a233c3936592f1b3071b3463bf2ccce) and [synthetic TIME commitment](https://stellar.expert/explorer/testnet/tx/380dfd78d95b15eee2f39ca0e4e3350aa09a8800fc2b1cd434041d67487bac45) remain historical fixtures. The saved [original read](testnet-registry/read-result.json) is Queued, delivered=[0], required=300000 milliseconds and next_nonce=0. It uses an explicitly synthetic payment reference and does not prove a transfer. Do not confuse that earlier record with the completed five-PASSES order above.

Earlier protected previews failed because `playwright-core-vercel/browsers.json` was missing at module load. Work stopped after two identical renderer failures at that checkpoint; [vercel-verification.json](vercel-verification.json) preserves the failure rather than claiming success. Later releases repaired the packaged renderer, and the final live paid pilot provides its separate successful evidence above.

The earlier final native Neon SQL repeat stopped at 15 of 19 passing, with four connectivity failures (`read ECONNRESET` and connection timeout). It was not rerun after the repeated failure. The prior 18/18 native result remains historical, not a replacement for that stopped repeat. The later CI PostgreSQL run below is a distinct environment and result, not a retroactive relabeling of Neon failures. [verification.json](verification.json) and the earlier checkpoint history retain their own revisions and counts.

The initial public facilitator rejected the signed payload for its fee ceiling; the first OZ diagnostic then rejected an insufficient post-sign resource fee. These observations were not settlements. Explicit provider selection and post-sign simulation/reassembly preceded the successful paid pilot; no ambiguous authorization was silently replayed or replaced with a custodial payer.

## Verification and remaining validation

CI run `40301786694` used Node 22 and PostgreSQL 17: 752 passed, zero failed and one skipped. The agent suite passed 42 tests and the Rust registry suite passed 9. These automated results are distinct from the real Testnet transfer, canonical delivery and contract reads linked above.

Acceptance tests cover unique complete pass IDs, zero credit for interrupted fragments, retained debt, campaign spacing/fairness, immutable legacy quotes, exactly-once queue creation and twenty local fixture purchases reducing 100 to zero before insufficient balance. Fixture payment/model adapters never count as live evidence. `npm run test:ads:testnet` requires a positive expected settlement count and checks persisted transfers through live RPC; zero expected transfers observed fails the gate.

Still pending for this checkout: real Android and iPhone/Safari acceptance, physical QR/NFC installation and tag programming, camera denial/slow-network device checks and physical/shared AR alignment. The owner's earlier Chrome Android wallet activation/funding report does not validate this new purchase journey on that device. The demonstrated venue playback and measured delivery are digital, not proof of a physical display or human audience. Public purchase rollout and durable universal initial-grant guarantees are not claimed.

## References

- [Stellar x402 guide](https://developers.stellar.org/docs/build/agentic-payments/x402)
- [Stellar exact x402 specification](https://raw.githubusercontent.com/x402-foundation/x402/main/specs/schemes/exact/scheme_exact_stellar.md)
- [OpenZeppelin x402 facilitator](https://docs.openzeppelin.com/relayer/guides/stellar-x402-facilitator-guide)
- [RPC getTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction) and [getEvents](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents)
- [Smart Account Kit](https://github.com/stellar/smart-account-kit) and [SimpleWebAuthn](https://simplewebauthn.dev/docs/packages/server)
- [AI SDK structured outputs](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)
