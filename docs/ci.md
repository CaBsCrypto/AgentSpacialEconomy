# Project validation

`Project checks` runs on every pull request and push to `main`. It builds and tests the frontend and wallet on Linux and Windows with Node 22.20.0, runs the agent's unit tests from its lockfile, and tests/builds every contract with Rust 1.95.0. It has read-only repository permissions, receives no payment credentials, and never invokes the paid workflows or deploys a contract.

Graphics tests use the pinned Python dependencies in `scripts/render-requirements.txt`. `WALLET_RPC_SMOKE` is disabled in this general workflow. The separate manually triggered testnet workflows retain their existing scope; passing this workflow does not provide new payment or mobile-device evidence.

Before a deployment, reconcile the configured Vercel runtime with `package.json`'s Node 22.x requirement. The November inspection reported Node 24.x in the project settings; this change does not alter cloud configuration.

## AR runtime bytes

The separately supplied MindAR license is normalized to LF by `scripts/vendor-ar.mjs` before its manifest hash is calculated. Its Git attribute forces LF on checkout. Distribution JavaScript remains byte-preserved. Rebuild from prepared, pinned tools with `node scripts/vendor-ar.mjs`; an optional directory argument reuses an existing offline `.ar-tools` source directory. The generator test checks that LF and CRLF license sources generate identical bytes and hashes.

## Wallet request boundary

Availability reads check configuration and shared rate limits before reading the shared 15-second status cache. A ten-second Redis refresh lease prevents concurrent cache misses from multiplying provider requests. Redis errors fail closed before subsidy providers are contacted. API responses remain private and uncacheable by browsers/CDNs.

Client identity is supplied by the Node adapter: the socket peer outside Vercel, or a valid single `x-vercel-forwarded-for` IP only when the server's `VERCEL=1` identifies the Vercel boundary. Missing or malformed identity shares an `unknown` bucket. Generic forwarding headers never select a rate-limit bucket. This uses Vercel's [documented request header boundary](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for).

## Advertising integration follow-up

`screen-run.yml` is absent from this main baseline. When integrating the advertising candidate, move `SCREEN_RUN_OUT` out of job-level `env`: `runner.temp` belongs to a runner/step context. Set it in a preparation step using `$RUNNER_TEMP` and `$GITHUB_ENV`, then run the workflow validator without dispatching the paid experiment. The advertisement workflow's acceptance remains separate from these general checks.
