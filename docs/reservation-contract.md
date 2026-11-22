# Reservation contract and operational acceptance

The contract assigns one holder to one opaque offer ID. It holds no funds, has no token calls, and does not attest physical availability, venue ownership or delivery. Two different offer IDs may refer to the same space; this contract does not enforce space-wide overlap or calendar rules. `Reserved` is final. There is no cancellation, reset, expiry of ownership or reopening operation.

The initial code and dependency versions were selected from PR 36 at `0488322ca4cadf6bacb7c0b3761e9cf5235f6755`. Only `contracts/reservation/` was imported. This does not adopt the proposed repository license, commercial SOW, funding or deployment claims.

## Interface

| Method | Arguments | Result and authority |
| --- | --- | --- |
| `__constructor` | `project: BytesN<32>`, `host: Address` | One-time deployment initialization; host authorization required |
| `publish` | `project: BytesN<32>`, `offer: BytesN<32>`, `space: BytesN<32>` | `Offer`; bound host authorizes, project must match, ID must be new |
| `reserve` | `offer: BytesN<32>`, `brand: Address` | `Offer`; brand authorizes; only `Available` can transition |
| `get` | `offer: BytesN<32>` | `Option<Offer>`; unknown is `None`, never `Available` |
| `project` | none | `Option<BytesN<32>>` |
| `host` | none | `Option<Address>` |
| `maintain` | `offers: Vec<BytesN<32>>` | Count maintained; bound host authorizes, at most 20 distinct existing IDs; empty batch maintains only instance/code |

`Offer` contains `offer`, `project`, `space`, `host`, `state`, `holder`, `published_at` and `reserved_at`. State variants are `Available` and `Reserved`; holder is `Option<Address>`, timestamps are ledger timestamps (`u64`). IDs are 32 opaque bytes. No conversation, image, contact detail or review text belongs in these IDs or events.

Errors retain the original codes: `AlreadyInitialized=1`, `NotInitialized=2`, `WrongProject=3`, `DuplicateOffer=4`, `UnknownOffer=5`, `AlreadyReserved=6`. Maintenance adds `TooManyOffers=7` and `DuplicateMaintenanceOffer=8`. Host authorization failures are host errors, not these contract codes.

Published and Reserved events retain their original typed fields. Maintained records the batch count and host; it changes neither the offer record nor its holder. A retry by the winning brand still returns `AlreadyReserved`. The application recovers a successful prior reservation through transaction evidence and an authoritative read matching that brand; it must not request another signature merely because the response was lost.

RPC event encoding uses ScVal symbols and a symbol-keyed map, with the emitting contract ID checked separately:

| Event | Topics | Data map |
| --- | --- | --- |
| Published | `Symbol("published")`, `Bytes(offer32)` | `host: Address`, `project: Bytes32` |
| Reserved | `Symbol("reserved")`, `Bytes(offer32)` | `holder: Address` |
| Maintained | `Symbol("maintained")` | `count: U32`, `host: Address` |

Event map keys are sorted symbols. Space is deliberately not part of the event: a receipt must also match the confirmed `get` record, its project/space/host and the successful transaction hash.

## Storage lifetime

Host and project use instance storage; each offer uses persistent storage. Successful access explicitly extends the relevant lifetime at or below a fixed 172,800-ledger threshold toward 518,400 ledgers, clamped to the network's current maximum. Callers cannot choose a TTL or bypass the 20-ID maintenance bound. These ledger counts are retention policy, not commercial reservation expiry.

`instance().extend_ttl` covers both the instance and its code. Persistent offer entries are extended individually. A simulated getter does not persist rent or a TTL extension on the network. A submitted, authorized maintenance transaction is necessary to keep inactive records live. Fees/rent remain an operator responsibility; no scheduler, funding or paid transaction is enabled by this change.

Archived persistent entries retain their previous value. Starting with Protocol 23, an invocation can restore them before execution when its simulation has included them in the transaction's restore list. Without the necessary restore resources, execution fails; failure is not proof that an ID is new. The application must show unavailable/reconciliation and retain the same ID and holder until an authoritative restored read succeeds. It must never replace a failed read with a default `Available` record.

## Operator procedure

1. Retain the deployed contract ID, source SHA, WASM hash, host/project binding and confirmed offer IDs outside the contract. Recover IDs from confirmed publication records/events; `maintain` does not enumerate all storage.
2. Inspect code, instance and persistent-entry lifetime before the policy threshold. Prepare batches of at most 20 distinct IDs, using the configured host and the existing Testnet contract.
3. Simulate the exact `maintain` invocation. Review its resource estimate, rent and restore list. An archived instance, code or offer may require restoration resources; do not republish or deploy a replacement contract to avoid restoration.
4. Submit only through the authorized operator process with verified resource coverage. Record the transaction result, then read each offer and verify that ID, host/project and any existing holder are unchanged.
5. If automatic restoration cannot be prepared, use the documented manual restoration-footprint process for the exact entries. Never interpret RPC absence, timeout, archival or failure as availability. Keep the application unavailable until the original state is restored and read back.

This work does not execute the procedure. Real Testnet deployment, signatures, restoration/rent and post-restoration reads remain release gates. Native unit tests and a local WASM host test prove code behavior only; they do not establish current network health, actual fees or a deployed contract's identity.

The local recording-host test advances beyond the offer/instance TTL and verifies automatic restoration preserves the ID, holder and final `Reserved` state, still rejecting duplicate publication and another reservation. This models host storage behavior, not a live RPC restore-footprint transaction. The contention test executes 100 rounds of 20 ledger-ordered contenders (2,000 attempts), requiring exactly one holder per round; it is not a network load benchmark.

## Local verification — 13 November 2026

- Rust `1.95.0`; pinned SDK `25.3.1`; `cargo test --locked --offline`: 14 native tests passed, including the original six.
- Release build for `wasm32v1-none`: 21,366 bytes, SHA-256 `df9a9dc25bdb38cc538ef48522350d8fed06d3d63f06b421d3fffdd80536cd07`.
- `cargo test --locked --offline --features wasm-tests --test wasm`: one built-WASM host test passed, covering deployment without authorization, authorized deployment, attempted reinitialization, unauthorized publication/reservation and final-holder preservation.
- `cargo fmt --check`, workflow YAML parsing and Git whitespace checks passed. Linux CI is configured but was not run remotely as part of this local work.

The imported lock listed an unused direct `ed25519-dalek` dependency for this package. `cargo update --workspace --offline` reconciled it with `Cargo.toml`, updating zero dependency versions. All verification then used `--locked`.

## Primary references

- [Storage example and explicit TTL extension](https://developers.stellar.org/docs/build/smart-contracts/example-contracts/storage)
- [State archival and automatic restoration](https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage/state-archival#contract-data-automatic-restoration)
- [Production storage strategies](https://developers.stellar.org/docs/build/guides/storage/storage-strategies)
- [Manual restoration footprint](https://developers.stellar.org/docs/build/guides/archival/create-restoration-footprint)
- [Constructor authorization test limitations](https://developers.stellar.org/docs/build/guides/testing/test-contract-auth#authorization-in-constructors)

Implementation binds to `soroban-sdk=25.3.1` and its checked-in Cargo lock. Current documentation describes newer SDK constructor-test behavior as well, so constructor authorization is also exercised through a built WASM deployment in the local host, rather than inferred from `Env::register` alone.
