# Exclusive space reservation

One host, one project, host-defined opaque offer IDs, one permanent holder per offer. The contract holds no funds and cannot certify physical availability, venue rights or delivery. It has no cancellation, payment or calendar operations.

The host authorizes deployment and publication. A brand authorizes reservation; every later reservation attempt fails, including a retry by the same holder. Unknown IDs return `None`. Host-authorized `maintain` extends retention for at most 20 distinct existing offers without changing their state. Persistent archival never reopens an offer.

The [interface and operator procedure](../../docs/reservation-contract.md) define the ABI, events, retention policy and outstanding Testnet release gates.

Run from the repository root:

```sh
cargo test --locked --manifest-path contracts/reservation/Cargo.toml
cargo build --locked --release --target wasm32v1-none --manifest-path contracts/reservation/Cargo.toml
RESERVATION_TEST_WASM="$PWD/contracts/reservation/target/wasm32v1-none/release/reservation.wasm" \
  cargo test --locked --manifest-path contracts/reservation/Cargo.toml --features wasm-tests --test wasm
```

The last command runs built WASM through the local host deployment function to check constructor authorization. If `CARGO_TARGET_DIR` is customized, point `RESERVATION_TEST_WASM` to that build output. CI runs all three steps in `.github/workflows/checks.yml`. Tests use local host authorization mocks; they do not submit transactions or establish actual network signatures, rent, restoration or deployment status.
