# Reservation operations: review, host authorization and release

The reservation operator uses the existing Testnet wallet and services. The shipped operator policy is disabled. No operator command signs, transmits, provisions a service or reads environment variables. The separate page `/reservations-operator.html` has no public navigation link and no relay. It can connect an existing wallet and request a passkey signature only after a reviewed policy enables the exact candidate, host, project, contract and current resource coverage.

## Roles and immutable identity

The host is a deployed **C-address smart account** with the admitted wallet WASM and original Default WebAuthn rule 0. A G-address fee payer or CLI signer does not satisfy the host's constructor authorization. Bootstrap derives the new contract ID from Testnet, C-host and an explicit 32-byte salt. The create function binds the approved reservation WASM and constructor arguments `[project32, C-host]`.

The built-WASM host test establishes the exact required C-host authorization tree: one `CreateContractV2HostFn` root and one `__constructor(project, host)` child at the derived contract ID, with no grandchildren. Maintenance instead authorizes exactly `maintain(Vec<offer32>)`, with no sub-invocations and at most 20 distinct IDs. There is no generic contract-call, transfer, wallet-creation or wallet-mutation signing path.

Source pins live in `dist/reservations-operator-core.mjs`: Testnet passphrase/RPC, official origin/RP ID, reservation WASM hash, wallet WASM and WebAuthn verifier. The page and CLI share the same XDR validator and SHA-256 canonical configuration fingerprint. The fingerprint includes source SHA, network, origin, contract, host/project and code pins. It excludes secrets and does not claim to fingerprint private provider credentials or the entire deployed environment.

## Offline preparation

Use Node 22 and the existing locked dependencies. Start an operator evidence directory outside tracked public artifacts. Do not include `.env`, credentials, signed auth, passkey IDs or private project/media data in a committed release manifest. The CLI rejects unknown plan input fields and accepts JSON files up to 256 KiB.

Create an input JSON with `kind`, `intentId` (new opaque 64 lowercase hex), `sourceSha` (the reviewed 40-character source commit), `hostAddress` (the user's verified C-address), `projectId` (64 lowercase hex) and `salt` (32 bytes as lowercase hex). The same host/salt must be retained after an uncertain deployment; do not generate another identity to bypass reconciliation.

```sh
node scripts/reservations-ops.mjs bootstrap input.json contracts/reservation/target/wasm32v1-none/release/reservation.wasm > bootstrap-plan.json
node scripts/reservations-ops.mjs check bootstrap-plan.json
```

The local WASM must hash to `df9a9dc25bdb38cc538ef48522350d8fed06d3d63f06b421d3fffdd80536cd07` (21,366 bytes). A different binary requires a source review, updated pins and new tests. The unsigned output is a draft, not a simulated or executable transaction. No nonce is fabricated.

For maintenance, use `kind:"maintain"`, the same intent/source/host/project fields, `contractId` and `offers:[...]`; omit `salt`. An empty array maintains instance/code only. Use IDs from confirmed records, never guesses based on an absent RPC response.

```sh
node scripts/reservations-ops.mjs maintain maintenance-input.json > maintenance-plan.json
```

## Simulation and policy gate

Before any network access, the operator must verify existing resource coverage and reserve an allowance for all RPC reads/simulation, submission, recovery and possible restoration. The offline tool does not consume or reserve the application's provider counters. Operational usage must be accounted separately against the same verified remaining coverage; do not reissue a coverage ID to reset counters. A signing-page policy is an operator attestation, not a billing control. Missing verified coverage leaves the page disabled.

Under a separately approved read-only procedure, verify the Testnet network, the existing C-host's wallet WASM/current rule and credential, the candidate WASM's ledger entry, the host/project binding for maintenance, and the source account to be used by the eventual fee payer. If the WASM is not already uploaded, record `WASM_UPLOAD_REQUIRED`; upload, its fee and receipt are a separate authorized transaction. A local build does not prove the code exists on-chain.

Simulate the plan's **exact** `HostFunction` in recording authorization mode using the approved Testnet source. Export the raw RPC simulation result in this capture wrapper (all identifiers are copied from the plan):

```json
{
  "intentId": "<plan.intentId>", "func": "<plan.func>",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "observedAt": "<UTC observation>", "expiresAt": "<at most 120 seconds later>",
  "coverageId": "<verified coverage ID>",
  "result": {
    "latestLedger": 123, "minResourceFee": "100",
    "transactionData": "<SorobanTransactionData XDR base64>",
    "results": [{"auth": ["<unsigned SorobanAuthorizationEntry XDR base64>"]}]
  }
}
```

```sh
node scripts/reservations-ops.mjs review bootstrap-plan.json simulation-capture.json > reviewed-plan.json
```

The tool preserves the simulated nonce, bounds expiration to `latestLedger+36`, checks the complete auth tree and imports resource/restoration metadata. It rejects failed simulations, multiple authorizations and manual `restorePreamble` captures. It verifies artifact consistency; it cannot authenticate an offline RPC capture or establish current network state. Keep the original RPC response and observation evidence privately. Never hand-edit auth or resource XDR to make a failed review pass.

After the concrete candidate is approved, pin `sourceSha`, `hostAddress`, `projectId`, derived `contractId`, `configFingerprint`, coverage ID/expiry and maximum resource fee in `dist/reservations-operator-policy.mjs`. Enable only after coverage flags are independently evidenced. A JSON plan cannot enable the page. No provider key belongs in this public file. The source SHA identifies the reviewed application/contract input; the final release manifest separately records the deployment/build commit containing the policy change.

## User signature and controlled handoff

1. Open the isolated operator page at the pinned HTTPS origin. Load `reviewed-plan.json`; inspect host, project, derived contract, source/WASM hashes, fingerprint, salt or offer batch, expiration and resource estimate. A preview domain, local origin, expired plan or disabled policy cannot connect or sign.
2. Select **Conectar host existente**. SmartAccountKit performs its existing wallet/provenance checks and may request passkey authentication. The connected C-address must equal the reviewed host. This action does not authorize deployment.
3. Select **Firmar autorización revisada**. The existing passkey signs exactly the validated entry with rule 0. The controller revalidates the plan and policy after the ceremony and rejects any change to nonce, expiry or invocation.
4. Select **Exportar autorización**. Keep the file private: it is usable authorization until expiry. Export is neither submission nor a deployment receipt. The CLI can check its structure with `check-signed reviewed-plan.json signed-auth.json`; the explicit result is `STRUCTURE_VALID_SIGNATURE_UNVERIFIED`.
5. The authorized transaction operator must re-simulate in **enforcing** mode with the signed C auth, current ledger and exact function; inspect signature validity, actual resource/restoration limits and the final G-source/fee envelope. The C signature does not constrain the fee payer's envelope fee. Review total cost and coverage before any separate approval to sign/transmit that envelope. Neither the page nor CLI offers a send command; the public wallet/reservation relays remain restricted and cannot be used as an arbitrary bootstrap relay.
6. Persist the intent and exact exported-payload digest before transmission. Record the actual envelope hash, source, resource charges and submission result. Unknown submission, timeout or missing RPC history stays `NEEDS_RECONCILIATION`; never deploy a second salt, resubmit blindly or release the intent solely because time elapsed. Retrieve the attributable transaction and resulting contract before deciding another user signature is necessary.
7. Confirm bootstrap only after a successful attributable creation transaction and reads prove the deployed code hash, C-host and project match the plan. Confirm maintenance from the successful attributable transaction, its `maintained` event and unchanged existing offer records. Record actual receipt/ledger, not an offline prediction.

No live signature, RPC call, upload, deployment or paid transaction was executed while implementing these tools. Real passkey/device behavior, fees, quota enforcement and deployment identity remain release evidence requirements.

## Retention and restoration

Observe code, instance and offer `liveUntilLedgerSeq` against the same observed latest ledger. Retention target is 518,400 ledgers with threshold 172,800, clamped by the network; it is not reservation expiry. Prioritize batches below the threshold and retain the original IDs/titular. A simulation cannot persist TTL changes.

Protocol 23 simulation can request automatic restoration through `transactionData.ext.resourceExt.archivedSorobanEntries`. The CLI preserves this metadata. Signing such a maintenance plan additionally requires a reviewed policy with `allowRestoration:true`; bootstrap never uses that override. Preserve the complete simulation-derived transaction resources in the eventual envelope. Review restoration rent before authorizing any transaction. The application intentionally shows archived entries as unavailable until restored and read back, even if simulation returns an old Available value.

If automatic restoration exceeds network limits or a manual preamble is returned, stop this signing flow. Prepare an exact `RestoreFootprint` transaction through the approved operator procedure, with real simulated resources/fees and separate fee-payer approval. Zero placeholder resources are not a valid restore. Restore the original code/instance/offer entries, then simulate maintenance again. Restoration must not replace a reserved value, republish its ID or introduce cancellation/payment operations.

## Release manifest and observation

Copy `docs/release/reservations-release.example.json` into private release evidence and fill actual observations. Keep source SHA, final build/deployment SHA, WASM hash, configuration fingerprint, host/project/contract, operator policy digest, verified coverage and evidence references. Secrets, signed auth and private media are separate protected artifacts, referenced only by digest/access-controlled evidence ID.

At activation and each operator observation record:

- Intended and actual app mode (`DISABLED`, `CONTROLLED`, `PUBLIC`), intake state and capability reasons; preserve confirmed receipts and recovery during an intake pause.
- Each active intent ID/state, operation, attributable transaction hash/ledger, first/last observation and private evidence digest. Record uncertainty explicitly; no fabricated confirmation or same-holder-only receipt.
- Coverage ID and expiry, numeric approved allowances and consumed/reserved/unknown usage for function/transfer/RPC/Channels/Blob/Gateway, including dedicated authentication and recovery capacity. Retain counters across restarts and coverage renewals. Do not claim that an application quota alone prevents platform billing.
- Code/instance/offer TTL observations, restoration needs and the original holder of every tracked reserved offer. A missing read is `UNAVAILABLE`, never `AVAILABLE`.
- Privacy/device test evidence, native PostgreSQL and CI results, current schema/migration versions, operational backups and the evidence IDs for actual provider caps/credit coverage.

Alerts requiring operator action: changed contract or wallet binding, decreasing confirmed state, unknown submissions, exhausted/expiring coverage, falling TTL, unavailable RPC history, missing private media or failed recovery. Pause intake before capacity is exhausted; do not clear intents or counters. Disable the operator policy on expiry or a binding mismatch. Re-enable only after new review and adequate recovery allowance. This change does not create a scheduler or automatic monitoring calls.

Database/Blob backup, restore, orphan cleanup and media verification use the separately reviewed data-operations CLI documented in `docs/reservations-backend.md`. Keep its dry-run/apply distinction and schema safeguards; this chain tool performs no database writes or cleanup. A rollback to an earlier app build does not roll back ledger reservations or erase data.

## Verification and primary references

Local tests cover real SDK/XDR and the kit's actual auth-signing encoder with a deterministic fake WebAuthn response; they never invoke a device authenticator or prove cryptographic acceptance on Testnet. The built-WASM test covers the C-creator/constructor tree. The shipped disabled page is additionally inspected in a local browser with all provider traffic blocked.

- [Custom account authorization and `__check_auth`](https://developers.stellar.org/docs/build/guides/auth/contract-authorization#__check_auth)
- [Constructor authorization test limitations](https://developers.stellar.org/docs/build/guides/testing/test-contract-auth#authorization-in-constructors)
- [Simulation and automatic restoration resources](https://developers.stellar.org/docs/build/guides/transactions/simulateTransaction-Deep-Dive#handling-archived-ledger-entries)
- [Manual restoration footprint and resource requirements](https://developers.stellar.org/docs/build/guides/archival/create-restoration-footprint)
- [Transaction submission and uncertainty](https://developers.stellar.org/docs/build/guides/transactions/submit-transaction-wait)

Implementation was also checked against installed `@stellar/stellar-sdk` 16.3.0, `smart-account-kit` 0.9.1, SDK Rust 25.3.1 and host 25.0.1 source. No assumption that a G sponsor can authorize a C-host is made.
