# Momentum Backend Status

Updated after completing authenticated, party-aware WebSocket connections.

## Completed

- Backend shell, typed configuration, Fastify server, PostgreSQL pool boundary, structured logging, health/readiness routes, and graceful shutdown.
- Automatic PostgreSQL migrations with checksum tracking and transaction-scoped migration locking.
- Persistent development players and opaque sessions.
- SHA-256 token hashing, bearer authentication, `/v1/me`, and current-session revocation.
- Expiring development sessions with a thirty-day lifetime and revocation checks.
- Persistent parties, memberships, secure join codes, one-party-per-player enforcement, member listing, size limits, and safe leadership transfer.
- Authenticated party HTTP routes and PostgreSQL integration coverage.
- Authenticated, party-aware `/v1/ws` connections with header and browser-compatible first-message authentication.
- Versioned WebSocket protocol validation, connection limits, message/rate limits, idle timeouts, lifecycle logging, party refresh, and isolated presence broadcasts.

## WebSocket foundation

- Preferred authentication is `Authorization: Bearer dev_...` during the HTTP upgrade.
- Browser clients that cannot set upgrade headers may send one first message of type `auth` with the token in its payload. Tokens are never accepted in URL query parameters.
- Protocol version 1 supports `ping`, `party.refresh`, and first-message `auth`. Server messages are `connection.ready`, `pong`, `party.snapshot`, and `party.presence`.
- Party scope is derived from the authenticated player's persistent membership. Client-supplied party IDs are not accepted.
- After a successful HTTP create, join, or leave operation, clients must send `party.refresh` on each existing socket for that player.
- The registry is intentionally in-memory and single-server. Redis, persistent event history, and cross-instance fanout are deferred.

## First incomplete stage

Authoritative WebSocket snapshots, activity synchronization, and expedition simulation.

That stage should build on this connection and party-presence foundation without adding matchmaking, chat, guilds, or other out-of-scope social systems.

## Verification note

The PostgreSQL integration tests run when `DATABASE_URL` is supplied. Without that environment variable, they are skipped so the normal unit/test suite remains usable without a local database. The integration bootstrap applies `backend/migrations` and is safe when multiple test files initialize the database concurrently. WebSocket limits are configured with the `WEBSOCKET_*` environment variables shown in `backend/.env.example`.
