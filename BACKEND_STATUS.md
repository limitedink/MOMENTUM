# Momentum Backend Status

Updated after completing the authoritative client party-management and two-PC playtest milestone.

## Completed

- Backend shell, typed configuration, Fastify server, PostgreSQL pool boundary, structured logging, health/readiness routes, and graceful shutdown.
- Automatic PostgreSQL migrations with checksum tracking and transaction-scoped migration locking.
- Persistent development players with validated 1–24 character display names and opaque sessions.
- SHA-256 token hashing, bearer authentication, `/v1/me`, and current-session revocation.
- Expiring development sessions with a thirty-day lifetime and revocation checks.
- Persistent parties, memberships, secure join codes, one-party-per-player enforcement, member listing, size limits, and safe leadership transfer.
- Authenticated party HTTP routes and PostgreSQL integration coverage.
- Authenticated, party-aware `/v1/ws` connections with header and browser-compatible first-message authentication.
- Versioned WebSocket protocol validation, connection limits, message/rate limits, idle timeouts, lifecycle logging, party refresh, and isolated presence broadcasts.
- One lazily initialized authoritative expedition state per party, persisted with activity selections, passive activity-time segments, claimable rewards, and command idempotency records.
- Authenticated `party.state.get` and `party.command` WebSocket messages with `party.state.snapshot`, `party.state.error`, and `party.command.result` responses.
- Server-owned forest expedition start/completion timestamps, passive completion reconciliation on access, activity-change tracking, per-member reward claims, leader-only reset, optimistic revision checks, and commit-after-broadcast ordering.
- PostgreSQL-backed authorization revalidation, state/activity/reward/command cascade behavior, and real concurrent WebSocket/PostgreSQL integration coverage.
- Browser-compatible client transport adapter with first-message authentication, party scope and presence handling, request/command correlation, newer-only state revisions, bounded reconnect, and command ID preservation.
- Frontend development identity acquisition with a prompted display name, persisted opaque session reuse, explicit local/authoritative party runtime modes, local fallback, and authoritative rendering of party state, elapsed progress, named activity focus, claimable rewards, and membership presence.
- Frontend party management using the existing HTTP routes, including join-code validation, create/join/leave operations, named member display with separate You/Leader badges, presence-triggered membership refresh, and state re-request after membership changes.
- Opt-in backend CORS origins and configurable Vite proxy target for same-LAN or direct browser development.

## WebSocket foundation

- Preferred authentication is `Authorization: Bearer dev_...` during the HTTP upgrade.
- Browser clients that cannot set upgrade headers may send one first message of type `auth` with the token in its payload. Tokens are never accepted in URL query parameters.
- Protocol version 1 supports `ping`, `party.refresh`, `party.state.get`, `party.command`, and first-message `auth`. Server messages include `connection.ready`, `pong`, `party.snapshot`, `party.presence`, `party.state.snapshot`, `party.state.error`, and `party.command.result`.
- Party scope is derived from the authenticated player's persistent membership. Client-supplied party IDs are not accepted.
- After a successful HTTP create, join, or leave operation, clients must send `party.refresh` on each existing socket for that player.
- Authoritative state is one `party_states` row per party. Revisions start at zero and increment once for each accepted state mutation or server reconciliation; stale expected revisions are rejected.
- The supported commands are `expedition.start` to `forest`, party activity selection, `expedition.reward.claim`, and leader-only `expedition.reset`. Start and completion timestamps are server-controlled; completion is reconciled on state access or command processing.
- Command IDs are unique within a party. The request hash, accepted/rejected result, and revision are persisted so exact retries are safe and payload mismatches return `duplicate_command_mismatch`. Records are retained until a later explicit retention policy is designed.
- State broadcasts are emitted only after the PostgreSQL transaction commits and are filtered to current members of the party. The in-memory registry remains a single-server fanout boundary.
- The registry is intentionally in-memory and single-server. Redis, persistent event history, and cross-instance fanout are deferred.

## First incomplete stage

Broader mapping of authoritative expedition actions and a repeatable two-PC browser playtest across real LAN interfaces remain next. Combat-specific reward depth and additional skills remain later stages; the existing party panel now distinguishes server-owned state, passive progress, activity focus, and claimable rewards from the local simulation.

That stage should build on the state and party-presence foundation without adding matchmaking, chat, guilds, or other out-of-scope social systems.

## Verification note

The PostgreSQL integration tests run when `DATABASE_URL` is supplied. Without that environment variable, they are skipped so the normal unit/test suite remains usable without a local database. The integration bootstrap applies `backend/migrations` and is safe when multiple test files initialize the database concurrently. WebSocket and authoritative-state limits/duration are configured with the `WEBSOCKET_*` and `PARTY_STATE_*` environment variables shown in `backend/.env.example`.
