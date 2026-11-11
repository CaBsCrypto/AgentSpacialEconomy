# Exclusive space reservation (Instawards sprint, week 1)

One host, one project, host-defined offers, one holder per offer. Scope and acceptance criteria come from the Instawards SOW in `docs/instawards/SOW-v0.7.txt` (Deliverable 1).

The contract holds no funds and records only opaque IDs, accounts, states and events. It cannot certify venue rights, physical availability or delivery. `RESERVED` is final: no cancellation, time slots or overlap detection in this sprint.

API: `__constructor(project, host)` (one-time; the host authorizes; a second call fails) · `publish(project, offer, space)` (host-authorized; wrong project and reused ids are rejected without overwriting) · `reserve(offer, brand)` (brand-authorized; the first holder wins and every later attempt fails, including a same-account retry) · `get(offer)` (`None` for unknown ids, never availability) · `project()` · `host()`. Events: `Published`, `Reserved`.

Tests (`src/lib.rs`): initialization, publish-then-reserve, competing and repeated reservations preserving the first holder, duplicate ids, wrong project, unknown offer, and an unauthorized publisher. Mocked authorization in tests does not replace Testnet signing validation.

Run: `cargo test --manifest-path contracts/reservation/Cargo.toml`. Build: `cargo build --release --target wasm32v1-none --manifest-path contracts/reservation/Cargo.toml`. CI: `.github/workflows/contracts.yml`. Not yet deployed; a Testnet deployment and its receipt belong to week 3 of the SOW.
