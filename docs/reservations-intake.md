# Shared admission and recovery operations

The environment is a ceiling; `reservation_intake` in the existing PostgreSQL service is the live admission switch. No new service, console, public operator endpoint or automatic provider call is introduced. Migration `003_intake.sql` creates the table without an OPEN row. Missing, unreadable or malformed state closes new work. Reads, authentication and owner recovery retain their independent coverage requirements.

## Safe activation sequence

1. Keep ingress closed to new writes while replacing older deployments. Old binaries do not consult this table: remove/protect their deployment URLs and drain already admitted operations before claiming all writers honor the switch. A database gate cannot stop a request before its platform Function starts; verified platform caps and the reviewed ingress procedure remain release requirements.
2. Apply the migration explicitly against reviewed capacity/schema/role in the existing PostgreSQL service. Preserve identity, attempts, offers, receipts, resource counters and Gateway holds. Startup never migrates or opens admission automatically.
3. Deploy the reviewed candidate with the same origin/RP ID, network, host/project/contract and database binding. Configure the environment ceiling, CONTROLLED or PUBLIC mode, and current resource coverage separately. Changing environment variables requires a new deployment; it does not update older deployments. Even with an enabled ceiling, a missing/paused DB row stays closed.
4. Initialize a closed row using `pause --apply`, inspect `status`, review the resulting revision and the release evidence. Use the server-configured brand allowlist for CONTROLLED mode. The mode and allowlist remain environment ceilings and are not changed by this CLI.
5. Preview `resume --expected-revision <revision>`, then explicitly apply it only after the release gates are accepted. Resume validates the current environment/coverage and compares the revision under the admission lock. It cannot reset budgets, create another offer or alter a holder.

The internal CLI reads the same explicit server environment as the application. Do not place credentials in command arguments or commit its output with private deployment evidence.

```text
node server/reservations/intake-cli.mjs status
node server/reservations/intake-cli.mjs pause
node server/reservations/intake-cli.mjs pause --apply
node server/reservations/intake-cli.mjs resume --expected-revision 3
node server/reservations/intake-cli.mjs resume --expected-revision 3 --apply
```

`status` is read-only. Changes default to dry-run; `--apply` is required. Pause is always allowed with a valid explicit project/database, even when coverage has expired or the environment is disabled. Every applied action advances the revision, invalidating stale resume approvals. Resume without a matching revision is rejected. There is no reset command. A database failure reports an error, not a successful pause; use the reviewed platform/ingress stop if DB control is unavailable.

## Cutover boundary

Pause and new admissions use the same PostgreSQL advisory lock and `SELECT ... FOR UPDATE` on the project admission row. The short transaction which stores `SUBMITTING` plus the signed payload owns this lock before claiming the attempt. If pause commits first, the claim fails with `503 INTAKE_PAUSED` and no relay is invoked. If the claim commits first, that admitted operation may complete after pause, retaining its durable intent and allowance. No DB transaction stays open during RPC, Blob, Gateway or Channels calls.

Project edits/approval and STAGED uploads check admission in their write transaction. Conversation cost reservation and the final transition to SENT also check admission. A model call or upload already admitted may finish and persist its result; pause never discards its hold, pending intent or receipt. Preliminary read/simulation calls already in progress may finish within their approved quotas. Drain these operations before maintenance or backup; pause is not cancellation of submitted work.

The public config reports `admission:{state,paused,revision,updatedAt}` with states OPEN, PAUSED, MISSING or UNAVAILABLE. `intakeEnabled` and new-work capabilities reflect both ceilings. A disabled/uncovered deployment returns a closed config without querying DB. A live public config poll reserves ordinary request/transfer capacity before reading the gate. If that reservation fails, the API returns HTTP 200 with new admission closed and read/recovery capabilities still derived from their coverage, so an existing owner can reload and recover. It does not claim the gate was read successfully. `mayReserve` in session responses is wallet eligibility under the environment; signing also requires the latest effective config.

Database/gate failures use `503 INTAKE_UNAVAILABLE`; an environment ceiling uses `503 DISABLED`. Clients retain the attempt ID after all rejected or uncertain submissions and consult its receipt. An HTTP error alone never authorizes a fresh attempt or a blind second signature.

## Dedicated recovery allowance

Anonymous challenge/verify, public polling and preparation authority checks use ordinary request/transfer/RPC allowances. The unchanged login throttle remains ten requests per IP/minute and sixty globally/minute before authority RPC.

A locally valid, unexpired, unrevoked session selects the dedicated request/transfer allowance only for GET `/auth/session`, host-owned GET `/project`, or GET `/attempts/:id` whose actor and project match in SQL. Local selection is not authentication: full on-chain wallet-authority verification still occurs before private data is returned. Its RPC uses `rpcAuthCalls`; pending transaction reconciliation uses `rpcRecoveryCalls`. Missing/foreign attempts and a brand reading the host project do not consume that dedicated pool. Receipt lookup still revalidates wallet authority, but a confirmed receipt requires no new transaction RPC.

Ordinary work cannot borrow these cumulative recovery quotas. Authenticated abuse is still bounded by the existing session throttle (60/IP, 60/owner, 120/global per minute) and quantitative coverage, not eliminated. These minute throttles are shared across authenticated routes; no claim of unlimited recovery during an authenticated flood is made. Logout remains independent of wallet RPC and expires the browser cookie even when revocation cannot be confirmed. Coverage expiry or loss of all DB/RPC capacity remains an explicit external recovery block and never clears an intent.

An upgrade preserves prior `rpcAuthCalls` consumption even though new login/preparation no longer uses that pool. Verify its remaining allowance before opening; migration never replenishes existing counters.

## Backups and rollback

Backups now export formatVersion 2 including the project admission row. FormatVersion 1 remains importable. Both restore paths force admission PAUSED; V2 advances its preserved revision, while V1 initializes a closed revision. IDs, relationships, receipts and consumed/uncertain costs remain unchanged. Restore requires the existing empty-target safeguards, including an empty admission table; do not initialize a row in the restore target before import. Environment flags must also remain closed during the existing backup/restore procedure. Native backups must include `reservation_intake` alongside the other reservation/identity tables and shared budget tables.

Do not roll traffic back to code which ignores shared admission, replaces the project/contract binding or restores counters from an older snapshot. Retain a compatible paused candidate, protect old deployment URLs, and verify saved receipts plus pending recovery before reopening. Never rotate a coverage ID merely to obtain fresh counters.

## Verification

`test/reservations-intake.test.mjs` covers two warm services, missing/failed DB state, environment ceilings, revision-controlled CLI, pause on both sides of the claim, commit failure before send, upload/inference races, virtual read-only drafts and V1/V2 backup restoration. `test/reservations-auth.test.mjs` covers anonymous N+1, invalid/foreign routes, exhausted ordinary allowance followed by config/session/receipt recovery, one-use challenges and real local WebAuthn signatures. The common test harness supports PGlite and an explicitly isolated native `reservations_test` database. Local results do not establish deployed caps, network settlement, device passkeys or the 24-hour H4 observation gate.

Environment deployment behavior: [Vercel environment variables](https://vercel.com/docs/environment-variables).
